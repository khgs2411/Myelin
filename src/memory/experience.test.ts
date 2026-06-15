import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "./db.ts";
import {
  claimExperienceEvents,
  countLeasedExperienceEvents,
  countUnleasedExperienceEvents,
  finalizeClaimedExperienceEvents,
  finalizeLeasedExperienceEventsInOpenTransaction,
  finalizeRemainingClaimedExperienceEvents,
  finalizeRemainingLeasedExperienceEvents,
  leaseExperienceEvents,
  listExperienceEvents,
  recordExperienceEvent,
  recordHookError,
  recoverStaleTombstoneLease,
  tombstoneExperienceEvent,
} from "./experience.ts";

let dir: string;
let db: MemoryDb;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "myelin-experience-"));
  db = openMemoryDbAt(join(dir, "memory.db"));
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

test("records valid provider-neutral experience events", () => {
  const row = recordExperienceEvent(db, {
    id: "evt_1",
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    hook_event_name: "UserPromptSubmit",
    event_kind: "user.prompt",
    cwd: "/repo",
    provider: "codex",
    provider_session_id: "sess_1",
    turn_id: "turn_1",
    raw_text: "How do we auth with Supabase?",
    raw_payload_json: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
    source: "codex-hook",
    status: "valid",
  });

  expect(row?.id).toBe("evt_1");
  expect(listExperienceEvents(db, "class-kit").map((event) => event.event_kind)).toEqual(["user.prompt"]);
});

test("records invalid rows with minimum required fields", () => {
  const row = recordExperienceEvent(db, {
    id: "evt_invalid",
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    provider: "codex",
    raw_payload_json: JSON.stringify({ malformed: true }),
    source: "codex-hook",
    status: "invalid",
  });

  expect(row?.status).toBe("invalid");
  expect(row?.hook_event_name).toBeNull();
  expect(row?.cwd).toBeNull();
});

test("deduplicates provider identity when available and keeps uncertain duplicates", () => {
  const input = {
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    hook_event_name: "UserPromptSubmit",
    event_kind: "user.prompt",
    cwd: "/repo",
    provider: "codex",
    provider_session_id: "sess_1",
    turn_id: "turn_1",
    raw_text: "same",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid" as const,
  };

  recordExperienceEvent(db, { ...input, id: "evt_1" });
  recordExperienceEvent(db, { ...input, id: "evt_2" });
  recordExperienceEvent(db, { ...input, id: "evt_3", provider_session_id: undefined, turn_id: undefined });

  expect(listExperienceEvents(db, "class-kit").map((event) => event.id)).toEqual(["evt_1", "evt_3"]);
});

test("tombstones delete raw rows only with terminal output references", () => {
  recordExperienceEvent(db, {
    id: "evt_1",
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    provider: "codex",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "invalid",
  });

  tombstoneExperienceEvent(db, {
    id: "tomb_1",
    original_event_id: "evt_1",
    project_key: "class-kit",
    processed_at: "2026-06-12T10:05:00.000Z",
    terminal_decision: "rejected.no-action",
    output_references: ["projects/class-kit/state/rejections.json"],
  });

  expect(listExperienceEvents(db, "class-kit")).toEqual([]);
});

test("claiming experience events moves rows into claimed tombstones", () => {
  recordExperienceEvent(db, {
    id: "evt_1",
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    provider: "codex",
    provider_session_id: "sess_1",
    turn_id: "turn_1",
    hook_event_name: "UserPromptSubmit",
    raw_text: "remember this",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid",
  });

  const claimed = claimExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "class-kit",
    limit: 10,
    claimed_at: "2026-06-12T10:01:00.000Z",
    tombstone_id_for: (event) => `tomb_${event.id}`,
  });

  expect(claimed.map((row) => row.original_event_id)).toEqual(["evt_1"]);
  expect(listExperienceEvents(db, "class-kit")).toEqual([]);
  const tombstones = db.query("SELECT state, ingest_job_id FROM experience_event_tombstones").all() as Array<{
    state: string;
    ingest_job_id: string;
  }>;
  expect(tombstones).toEqual([{ state: "claimed", ingest_job_id: "job_1" }]);
});

test("claiming experience events rolls back when tombstone insert fails", () => {
  const input = {
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    provider: "codex",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid" as const,
  };
  recordExperienceEvent(db, { ...input, id: "evt_1" });
  recordExperienceEvent(db, { ...input, id: "evt_2", occurred_at: "2026-06-12T10:01:00.000Z" });

  expect(() =>
    claimExperienceEvents(db, {
      ingest_job_id: "job_1",
      project_key: "class-kit",
      limit: 2,
      claimed_at: "2026-06-12T10:02:00.000Z",
      tombstone_id_for: () => "duplicate_tombstone",
    }),
  ).toThrow();

  expect(listExperienceEvents(db, "class-kit").map((event) => event.id)).toEqual(["evt_1", "evt_2"]);
  expect(db.query("SELECT COUNT(*) AS count FROM experience_event_tombstones").get()).toEqual({ count: 0 });
});

test("finalizing claimed tombstones records output references and keeps replay dedupe", () => {
  const input = {
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    hook_event_name: "UserPromptSubmit",
    event_kind: "user.prompt",
    cwd: "/repo",
    provider: "codex",
    provider_session_id: "sess_1",
    turn_id: "turn_1",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid" as const,
  };
  recordExperienceEvent(db, { ...input, id: "evt_1" });
  claimExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "class-kit",
    limit: 1,
    claimed_at: "2026-06-12T10:01:00.000Z",
    tombstone_id_for: () => "tomb_1",
  });

  finalizeClaimedExperienceEvents(db, {
    ingest_job_id: "job_1",
    tombstone_ids: ["tomb_1"],
    finalized_at: "2026-06-12T10:02:00.000Z",
    state: "output",
    terminal_decision: "session_memory",
    output_references: ["session_memories/mem_1"],
  });

  const replay = recordExperienceEvent(db, { ...input, id: "evt_2" });
  expect(replay).toBeNull();
  const tombstone = db
    .query("SELECT state, terminal_decision, output_references_json FROM experience_event_tombstones WHERE id = ?")
    .get("tomb_1") as {
    state: string;
    terminal_decision: string;
    output_references_json: string;
  };
  expect(tombstone).toEqual({
    state: "output",
    terminal_decision: "session_memory",
    output_references_json: JSON.stringify(["session_memories/mem_1"]),
  });
});

test("job-level finalization marks remaining claimed tombstones", () => {
  recordExperienceEvent(db, {
    id: "evt_1",
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    provider: "codex",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid",
  });
  claimExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "class-kit",
    limit: 1,
    claimed_at: "2026-06-12T10:01:00.000Z",
    tombstone_id_for: () => "tomb_1",
  });

  const changed = finalizeRemainingClaimedExperienceEvents(db, {
    ingest_job_id: "job_1",
    finalized_at: "2026-06-12T10:02:00.000Z",
    state: "failed",
    terminal_decision: "provider_failed",
  });

  expect(changed).toBe(1);
  expect(db.query("SELECT state, output_references_json FROM experience_event_tombstones").get()).toEqual({
    state: "failed",
    output_references_json: "[]",
  });
});

test("legacy terminal tombstone targets the requested event id, not the oldest project event", () => {
  const base = {
    project_key: "class-kit",
    provider: "codex",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid" as const,
  };
  recordExperienceEvent(db, { ...base, id: "evt_old", occurred_at: "2026-06-12T09:00:00.000Z" });
  recordExperienceEvent(db, { ...base, id: "evt_target", occurred_at: "2026-06-12T10:00:00.000Z" });

  tombstoneExperienceEvent(db, {
    id: "tomb_target",
    original_event_id: "evt_target",
    project_key: "class-kit",
    processed_at: "2026-06-12T10:05:00.000Z",
    terminal_decision: "session_memory",
    output_references: ["session_memories/mem_1"],
  });

  expect(listExperienceEvents(db, "class-kit").map((event) => event.id)).toEqual(["evt_old"]);
  const tombstone = db
    .query("SELECT original_event_id, state FROM experience_event_tombstones WHERE id = ?")
    .get("tomb_target") as { original_event_id: string; state: string };
  expect(tombstone).toEqual({ original_event_id: "evt_target", state: "output" });
});

test("tombstoned provider identities prevent replayed raw rows", () => {
  const input = {
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    hook_event_name: "UserPromptSubmit",
    event_kind: "user.prompt",
    cwd: "/repo",
    provider: "codex",
    provider_session_id: "sess_1",
    turn_id: "turn_1",
    raw_text: "same",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid" as const,
  };

  recordExperienceEvent(db, { ...input, id: "evt_1" });
  tombstoneExperienceEvent(db, {
    id: "tomb_1",
    original_event_id: "evt_1",
    project_key: "class-kit",
    processed_at: "2026-06-12T10:05:00.000Z",
    terminal_decision: "memory.candidate",
    output_references: ["projects/class-kit/state/candidates.json"],
  });

  const replay = recordExperienceEvent(db, { ...input, id: "evt_2" });

  expect(replay).toBeNull();
  expect(listExperienceEvents(db, "class-kit")).toEqual([]);
});

test("claiming experience events respects prompt character budget", () => {
  for (let index = 0; index < 3; index += 1) {
    recordExperienceEvent(db, {
      id: `evt_budget_${index}`,
      project_key: "class-kit",
      occurred_at: `2026-06-12T10:0${index}:00.000Z`,
      provider: "codex",
      raw_text: "x".repeat(100),
      raw_payload_json: JSON.stringify({ payload: "y".repeat(100) }),
      source: "codex-hook",
      status: "valid",
    });
  }

  const claimed = claimExperienceEvents(db, {
    ingest_job_id: "job_budget",
    project_key: "class-kit",
    limit: 3,
    max_prompt_chars: 900,
    claimed_at: "2026-06-12T10:05:00.000Z",
    tombstone_id_for: (event) => `tomb_${event.id}`,
  });

  expect(claimed.length).toBeGreaterThan(0);
  expect(claimed.length).toBeLessThan(3);
  expect(listExperienceEvents(db, "class-kit")).toHaveLength(3 - claimed.length);
});

test("leaseExperienceEvents creates tombstone stubs without deleting source rows", () => {
  seedExperienceEvent(db, "demo", "evt_1", { raw_text: "useful evidence", raw_payload_json: JSON.stringify({ message: "useful evidence" }) });

  const leased = leaseExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "demo",
    provider_session_id: "sess_1",
    limit: 10,
    max_prompt_chars: 100_000,
    prompt_chars_for_lease: (lease) => JSON.stringify(lease.prompt_evidence).length,
    claimed_at: "2026-06-15T09:01:00.000Z",
    tombstone_id_for: (event) => `tomb_job_1_${event.id}`,
  });

  expect(leased).toHaveLength(1);
  expect(listExperienceEvents(db, "demo").map((row) => row.id)).toEqual(["evt_1"]);
  expect(
    db
      .query("SELECT id, original_event_id, state, finalized_at, retained_evidence_json FROM experience_event_tombstones")
      .all(),
  ).toEqual([
    {
      id: "tomb_job_1_evt_1",
      original_event_id: "evt_1",
      state: "claimed",
      finalized_at: null,
      retained_evidence_json: JSON.stringify({}),
    },
  ]);

  const second = leaseExperienceEvents(db, {
    ingest_job_id: "job_2",
    project_key: "demo",
    limit: 10,
    claimed_at: "2026-06-15T09:02:00.000Z",
    tombstone_id_for: (event) => `tomb_job_2_${event.id}`,
  });
  expect(second).toEqual([]);
});

test("leaseExperienceEvents skips already guarded rows and continues to eligible rows", () => {
  const input = {
    project_key: "demo",
    provider: "codex",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid" as const,
  };
  recordExperienceEvent(db, { ...input, id: "evt_1", occurred_at: "2026-06-15T09:00:00.000Z" });
  recordExperienceEvent(db, { ...input, id: "evt_2", occurred_at: "2026-06-15T09:01:00.000Z" });
  leaseExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "demo",
    limit: 1,
    claimed_at: "2026-06-15T09:02:00.000Z",
    tombstone_id_for: () => "tomb_evt_1",
  });

  const leased = leaseExperienceEvents(db, {
    ingest_job_id: "job_2",
    project_key: "demo",
    limit: 10,
    claimed_at: "2026-06-15T09:03:00.000Z",
    tombstone_id_for: (event) => `tomb_${event.id}`,
  });

  expect(leased.map((row) => row.original_event_id)).toEqual(["evt_2"]);
  expect(listExperienceEvents(db, "demo").map((row) => row.id)).toEqual(["evt_1", "evt_2"]);
});

test("leaseExperienceEvents skips tombstone insert conflicts without deleting source rows", () => {
  seedExperienceEvent(db, "demo", "evt_1");
  seedExperienceEvent(db, "demo", "evt_conflict");
  leaseExperienceEvents(db, {
    ingest_job_id: "job_conflict_seed",
    project_key: "demo",
    limit: 1,
    claimed_at: "2026-06-15T09:01:00.000Z",
    tombstone_id_for: () => "tomb_evt_conflict",
  });

  const leased = leaseExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "demo",
    limit: 1,
    claimed_at: "2026-06-15T09:02:00.000Z",
    tombstone_id_for: () => "tomb_evt_conflict",
  });

  expect(leased).toEqual([]);
  expect(listExperienceEvents(db, "demo").map((row) => row.id)).toEqual(["evt_1", "evt_conflict"]);
});

test("recordExperienceEvent returns null when non-terminal tombstone guard exists", () => {
  const input = {
    project_key: "demo",
    occurred_at: "2026-06-15T09:00:00.000Z",
    hook_event_name: "UserPromptSubmit",
    provider: "codex",
    provider_session_id: "sess_1",
    turn_id: "turn_1",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid" as const,
  };
  recordExperienceEvent(db, { ...input, id: "evt_1" });
  leaseExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "demo",
    limit: 1,
    claimed_at: "2026-06-15T09:01:00.000Z",
    tombstone_id_for: () => "tomb_evt_1",
  });

  expect(recordExperienceEvent(db, { ...input, id: "evt_2" })).toBeNull();
});

test("recoverStaleTombstoneLease reuses the same tombstone identity and appends attempt history", () => {
  seedExperienceEvent(db, "demo", "evt_1");
  leaseExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "demo",
    limit: 1,
    claimed_at: "2026-06-15T09:01:00.000Z",
    tombstone_id_for: () => "tomb_evt_1",
  });

  const recovered = recoverStaleTombstoneLease(db, {
    tombstone_id: "tomb_evt_1",
    next_ingest_job_id: "job_2",
    recovered_at: "2026-06-15T09:10:00.000Z",
    reason: "provider_timeout",
  });

  expect(recovered.id).toBe("tomb_evt_1");
  expect(recovered.ingest_job_id).toBe("job_2");
  expect(db.query("SELECT id FROM experience_events WHERE id = ?").get("evt_1")).toEqual({ id: "evt_1" });
  const row = db.query("SELECT source_metadata_json FROM experience_event_tombstones WHERE id = ?").get("tomb_evt_1") as {
    source_metadata_json: string;
  };
  expect(JSON.parse(row.source_metadata_json).attempts).toEqual([
    { ingest_job_id: "job_1", ended_at: "2026-06-15T09:10:00.000Z", reason: "provider_timeout" },
  ]);
});

test("finalizeLeasedExperienceEvents populates tombstone evidence and deletes source rows", () => {
  seedExperienceEvent(db, "demo", "evt_1");
  leaseExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "demo",
    limit: 1,
    claimed_at: "2026-06-15T09:01:00.000Z",
    tombstone_id_for: () => "tomb_evt_1",
  });

  finalizeLeasedExperienceEventsInOpenTransaction(db, {
    ingest_job_id: "job_1",
    tombstone_ids: ["tomb_evt_1"],
    finalized_at: "2026-06-15T09:05:00.000Z",
    state: "output",
    terminal_decision: "output",
    output_references: ["session_memories/mem_1"],
  });

  expect(listExperienceEvents(db, "demo")).toEqual([]);
  const tombstone = db.query("SELECT state, retained_evidence_json, output_references_json FROM experience_event_tombstones WHERE id = ?").get("tomb_evt_1") as {
    state: string;
    retained_evidence_json: string;
    output_references_json: string;
  };
  expect(tombstone.state).toBe("output");
  expect(JSON.parse(tombstone.retained_evidence_json)).toEqual({ raw_text: null, raw_payload_json: "{}" });
  expect(JSON.parse(tombstone.output_references_json)).toEqual(["session_memories/mem_1"]);
});

test("replay fixture recovers stale tombstone stub and commits accepted retry output", () => {
  seedExperienceEvent(db, "demo", "evt_1", { raw_text: "remember retry evidence" });
  leaseExperienceEvents(db, {
    ingest_job_id: "job_failed",
    project_key: "demo",
    limit: 1,
    claimed_at: "2026-06-15T09:01:00.000Z",
    tombstone_id_for: () => "tomb_evt_1",
  });

  expect(db.query("SELECT id FROM experience_events WHERE id = ?").get("evt_1")).toEqual({ id: "evt_1" });
  const recovered = recoverStaleTombstoneLease(db, {
    tombstone_id: "tomb_evt_1",
    next_ingest_job_id: "job_retry",
    recovered_at: "2026-06-15T09:10:00.000Z",
    reason: "detached_worker_exited",
  });

  expect(recovered.id).toBe("tomb_evt_1");
  expect(recovered.ingest_job_id).toBe("job_retry");
  finalizeLeasedExperienceEventsInOpenTransaction(db, {
    ingest_job_id: "job_retry",
    tombstone_ids: ["tomb_evt_1"],
    finalized_at: "2026-06-15T09:15:00.000Z",
    state: "output",
    terminal_decision: "output",
    output_references: ["session_memories/mem_retry"],
  });

  expect(listExperienceEvents(db, "demo")).toEqual([]);
  const tombstone = db
    .query(
      "SELECT state, source_metadata_json, retained_evidence_json, output_references_json FROM experience_event_tombstones WHERE id = ?",
    )
    .get("tomb_evt_1") as {
    state: string;
    source_metadata_json: string;
    retained_evidence_json: string;
    output_references_json: string;
  };
  expect(tombstone.state).toBe("output");
  expect(JSON.parse(tombstone.source_metadata_json).attempts).toEqual([
    { ingest_job_id: "job_failed", ended_at: "2026-06-15T09:10:00.000Z", reason: "detached_worker_exited" },
  ]);
  expect(JSON.parse(tombstone.retained_evidence_json)).toEqual({
    raw_text: "remember retry evidence",
    raw_payload_json: "{}",
  });
  expect(JSON.parse(tombstone.output_references_json)).toEqual(["session_memories/mem_retry"]);
});

test("finalizeRemainingLeasedExperienceEvents commits no-output leases and deletes source rows", () => {
  seedExperienceEvent(db, "demo", "evt_1");
  leaseExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "demo",
    limit: 1,
    claimed_at: "2026-06-15T09:01:00.000Z",
    tombstone_id_for: () => "tomb_evt_1",
  });

  const finalized = finalizeRemainingLeasedExperienceEvents(db, {
    ingest_job_id: "job_1",
    finalized_at: "2026-06-15T09:05:00.000Z",
    state: "no_output",
    terminal_decision: "no_output",
  });

  expect(finalized).toBe(1);
  expect(listExperienceEvents(db, "demo")).toEqual([]);
  expect(db.query("SELECT state, terminal_decision FROM experience_event_tombstones WHERE id = ?").get("tomb_evt_1")).toEqual({
    state: "no_output",
    terminal_decision: "no_output",
  });
});

test("lease count helpers separate active unleased rows from tombstone-backed leases", () => {
  seedExperienceEvent(db, "demo", "evt_1");
  seedExperienceEvent(db, "demo", "evt_2");
  leaseExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "demo",
    limit: 1,
    claimed_at: "2026-06-15T09:01:00.000Z",
    tombstone_id_for: (event) => `tomb_${event.id}`,
  });

  expect(countLeasedExperienceEvents(db, "demo")).toBe(1);
  expect(countUnleasedExperienceEvents(db, "demo")).toBe(1);
});

test("tombstones keep uncertain duplicates when no dedupe identity exists", () => {
  const input = {
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    provider: "codex",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid" as const,
  };

  recordExperienceEvent(db, { ...input, id: "evt_1" });
  tombstoneExperienceEvent(db, {
    id: "tomb_1",
    original_event_id: "evt_1",
    project_key: "class-kit",
    processed_at: "2026-06-12T10:05:00.000Z",
    terminal_decision: "rejected.no-action",
    output_references: ["projects/class-kit/state/rejections.json"],
  });

  const uncertainReplay = recordExperienceEvent(db, { ...input, id: "evt_2" });

  expect(uncertainReplay?.id).toBe("evt_2");
  expect(listExperienceEvents(db, "class-kit").map((event) => event.id)).toEqual(["evt_2"]);
});

test("hook errors fall back to jsonl when sqlite is unavailable", async () => {
  db.close();
  recordHookError(null, join(dir, "state", "hook-errors.jsonl"), {
    occurred_at: "2026-06-12T10:00:00.000Z",
    provider: "codex",
    source: "codex-hook",
    error_message: "db unavailable",
  });

  const lines = (await readFile(join(dir, "state", "hook-errors.jsonl"), "utf8")).trim().split("\n");
  expect(JSON.parse(lines[0]).error_message).toBe("db unavailable");
});

function seedExperienceEvent(
  db: MemoryDb,
  projectKey: string,
  id: string,
  overrides: Partial<Parameters<typeof recordExperienceEvent>[1]> = {},
): void {
  recordExperienceEvent(db, {
    id,
    project_key: projectKey,
    occurred_at: "2026-06-15T09:00:00.000Z",
    provider: "codex",
    raw_text: null,
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid",
    ...overrides,
  });
}
