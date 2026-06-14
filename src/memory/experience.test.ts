import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "./db.ts";
import {
  claimExperienceEvents,
  finalizeClaimedExperienceEvents,
  finalizeRemainingClaimedExperienceEvents,
  listExperienceEvents,
  recordExperienceEvent,
  recordHookError,
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
