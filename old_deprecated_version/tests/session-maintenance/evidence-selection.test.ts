import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  countExperienceContentEvents,
  isExperienceContentEvent,
  recordExperienceEvent,
} from "../../src/memory/experience.ts";
import {
  defaultSMCGoverningIdentities,
  planSessionMaintenanceEvidence,
} from "../../src/session-maintenance/evidence-selection.ts";
import type { SMCManifest } from "../../src/session-maintenance/manifest.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  prepare,
  seedIndexedMemory,
} from "../helpers/smc-preparation.ts";

let dir: string;
let db: MemoryDb;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "myelin-evidence-selection-"));
  db = openMemoryDbAt(join(dir, "memory.db"));
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

test("selects valid content by inserted time and stable ID with deterministic normalized hashes", () => {
  seedContent("late_occurred_first_inserted", "2026-08-11T12:00:00.000Z", "2026-08-11T10:00:00.000Z", "α");
  seedContent("a_tie", "2026-08-11T09:00:00.000Z", "2026-08-11T10:01:00.000Z", "second");
  seedContent("b_tie", "2026-08-11T08:00:00.000Z", "2026-08-11T10:01:00.000Z", "third");

  const before = databaseState();
  const beforeBytes = db.serialize();
  const first = plan({ compatibility_selection_limit: null });
  const second = plan({ compatibility_selection_limit: null });

  expect(first).toEqual(second);
  expect(first.kind).toBe("planned");
  if (first.kind !== "planned") throw new Error("expected planned evidence");
  expect(first.plan.ordered_source_ids).toEqual(["late_occurred_first_inserted", "a_tie", "b_tie"]);
  expect(first.plan.evidence[0]?.encoded_bytes).toBeGreaterThan(first.plan.evidence[1]?.encoded_bytes ?? 0);
  expect(first.plan.evidence.every((item) => item.content_hash.startsWith("sha256:"))).toBe(true);
  expect(first.plan.total_encoded_bytes).toBe(
    first.plan.evidence.reduce((total, item) => total + item.encoded_bytes, 0),
  );
  expect(databaseState()).toEqual(before);
  expect(db.serialize()).toEqual(beforeBytes);
});

test("keeps compatibility selection separate from internal batch packing", () => {
  seedContent("evt_1", "2026-08-11T09:00:00.000Z", "2026-08-11T09:00:00.000Z", "one");
  seedContent("evt_2", "2026-08-11T09:01:00.000Z", "2026-08-11T09:01:00.000Z", "two");
  seedContent("evt_3", "2026-08-11T09:02:00.000Z", "2026-08-11T09:02:00.000Z", "three");

  const result = plan({
    compatibility_selection_limit: 2,
    budgets: {
      max_items_per_batch: 1,
      max_encoded_bytes_per_batch: 100_000,
      max_encoded_bytes_per_item: 100_000,
    },
  });

  if (result.kind !== "planned") throw new Error("expected planned evidence");
  expect(result.plan.compatibility_selection_limit).toBe(2);
  expect(result.plan.ordered_source_ids).toEqual(["evt_1", "evt_2"]);
  expect(result.plan.batches.map((batch) => batch.source_ids)).toEqual([["evt_1"], ["evt_2"]]);
});

test("compatibility selection caps the total content-first source set", () => {
  seed({ id: "control", status: "valid", event_kind: "session.start", raw_text: null, inserted_at: "2026-08-11T09:00:00.000Z" });
  seedContent("content", "2026-08-11T09:01:00.000Z", "2026-08-11T09:01:00.000Z", "curate first");
  seed({ id: "invalid", status: "invalid", event_kind: null, raw_text: null, inserted_at: "2026-08-11T09:02:00.000Z" });

  const first = plan({ compatibility_selection_limit: 1 });
  if (first.kind !== "planned") throw new Error("expected content plan");
  expect(first.plan.ordered_source_ids).toEqual(["content"]);
  expect(first.plan.no_agent_intents).toEqual([]);

  const second = plan({ compatibility_selection_limit: 2 });
  if (second.kind !== "planned") throw new Error("expected content and no-agent plan");
  expect(second.plan.ordered_source_ids).toEqual(["content", "control"]);
  expect(second.plan.no_agent_intents.map((intent) => intent.source_id)).toEqual(["control"]);
});

test("classifies control, invalid, and empty rows as deterministic no-agent intents", () => {
  seed({ id: "control", status: "valid", event_kind: "session.start", raw_text: null });
  seed({ id: "invalid", status: "invalid", event_kind: null, raw_text: null });
  seed({ id: "empty", status: "valid", event_kind: "assistant.response", raw_text: "  " });
  seedContent("content", "2026-08-11T09:03:00.000Z", "2026-08-11T09:03:00.000Z", "curate me");

  const result = plan({ compatibility_selection_limit: null });

  if (result.kind !== "planned") throw new Error("expected planned evidence");
  expect(result.plan.batches.flatMap((batch) => batch.source_ids)).toEqual(["content"]);
  expect(result.plan.no_agent_intents.map((intent) => ({
    source_id: intent.source_id,
    terminal_state: intent.terminal_state,
    terminal_decision: intent.terminal_decision,
  }))).toEqual([
    { source_id: "control", terminal_state: "no_output", terminal_decision: "no_agent.control_event" },
    { source_id: "empty", terminal_state: "no_output", terminal_decision: "no_agent.empty_content" },
    { source_id: "invalid", terminal_state: "no_output", terminal_decision: "no_agent.invalid_status" },
  ]);
});

test("returns stable no-work and oversize outcomes without consuming raw rows", () => {
  const empty = plan({ compatibility_selection_limit: null });
  expect(empty.kind).toBe("no_work");

  seedContent("oversize", "2026-08-11T09:00:00.000Z", "2026-08-11T09:00:00.000Z", "x".repeat(500));
  const before = databaseState();
  const beforeBytes = db.serialize();
  const oversize = plan({
    compatibility_selection_limit: null,
    budgets: {
      max_items_per_batch: 1,
      max_encoded_bytes_per_batch: 400,
      max_encoded_bytes_per_item: 400,
    },
  });

  expect(oversize).toMatchObject({
    kind: "blocked",
    code: "evidence_item_too_large",
    source_id: "oversize",
    max_encoded_bytes_per_item: 400,
  });
  expect(databaseState()).toEqual(before);
  expect(db.serialize()).toEqual(beforeBytes);
});

test("plans a no-agent-only workload without constructing a curator batch", () => {
  seed({ id: "legacy_control", status: "valid", event_kind: "session.start", raw_text: null });

  const result = plan({ compatibility_selection_limit: null });

  if (result.kind !== "planned") throw new Error("expected no-agent plan");
  expect(result.plan.workload).toBe("no_agent_only");
  expect(result.plan.batches).toEqual([]);
  expect(result.plan.no_agent_intents).toHaveLength(1);
});

test("uses identical JavaScript, threshold/status SQL, and preparation whitespace eligibility", () => {
  const cases = [
    ["ordinary", "memory text", true],
    ["spaces", "   ", false],
    ["tab", "\t", false],
    ["lf", "\n", false],
    ["cr", "\r", false],
    ["nbsp", "\u00a0", false],
    ["mixed_whitespace", " \t\n\r\u00a0 ", false],
    ["mixed_with_text", " \tmemory\n\r\u00a0", true],
  ] as const;

  for (const [index, [name, rawText, eligible]] of cases.entries()) {
    const projectKey = `whitespace_${index}`;
    const row = recordExperienceEvent(db, {
      id: `evt_${name}`,
      project_key: projectKey,
      occurred_at: "2026-08-11T09:00:00.000Z",
      event_kind: "user.prompt",
      provider: "codex",
      raw_text: rawText,
      raw_payload_json: "{}",
      source: "codex-hook",
      status: "valid",
    }, new Date("2026-08-11T09:00:00.000Z"));
    if (!row) throw new Error(`failed to seed ${name}`);

    expect(isExperienceContentEvent(row), `${name}: JavaScript predicate`).toBe(eligible);
    expect(countExperienceContentEvents(db, projectKey), `${name}: shared threshold/status SQL`).toBe(eligible ? 1 : 0);

    const result = planSessionMaintenanceEvidence(db, {
      anchor_job_id: `job_${name}`,
      project_key: projectKey,
      trigger_reason: "manual",
      governing_identities: defaultSMCGoverningIdentities({ provider: "codex", model: "test", reasoning_effort: null }),
      budgets: {
        max_items_per_batch: 1,
        max_encoded_bytes_per_batch: 100_000,
        max_encoded_bytes_per_item: 100_000,
      },
    });
    if (result.kind !== "planned") throw new Error(`expected planned result for ${name}`);
    expect(result.plan.evidence.map((item) => item.source_id), `${name}: preparation content`).toEqual(
      eligible ? [`evt_${name}`] : [],
    );
    expect(result.plan.no_agent_intents.map((intent) => intent.source_id), `${name}: preparation no-agent`).toEqual(
      eligible ? [] : [`evt_${name}`],
    );
  }
});

test("eligible evidence is followed by one bounded deterministic audit partition", () => {
  configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-a", created_at: "2026-08-10T00:00:00.000Z" });
  seedIndexedMemory(db, { id: "memory-b", created_at: "2026-08-10T01:00:00.000Z" });
  seedContent("evt-1", "2026-08-11T09:00:00.000Z", "2026-08-11T09:00:00.000Z", "new evidence");
  const result = planSessionMaintenanceEvidence(db, {
    anchor_job_id: "job-fairness",
    project_key: "demo",
    trigger_reason: "manual",
    governing_identities: defaultSMCGoverningIdentities({ provider: "codex", model: "test", reasoning_effort: null }),
    budgets: { max_items_per_batch: 100, max_encoded_bytes_per_batch: 100_000, max_encoded_bytes_per_item: 100_000 },
    include_audit: true,
    audit_partition_limit: 1,
  });
  if (result.kind !== "planned") throw new Error(JSON.stringify(result));

  expect(result.plan.batches.map((batch) => batch.work_kind)).toEqual(["evidence", "audit"]);
  expect(result.plan.audit_selection).toMatchObject({
    due_count: 2,
    members: [{ memory_id: "memory-a", ordinal: 0, selection_basis: "never_audited" }],
  });
  expect(result.plan.workload).toBe("evidence_and_audit");
});

test("repeated bounded audit partitions advance deterministically without starving older due memories", () => {
  const contract = configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-a", created_at: "2026-08-10T00:00:00.000Z" });
  seedIndexedMemory(db, { id: "memory-b", created_at: "2026-08-10T01:00:00.000Z" });
  seedIndexedMemory(db, { id: "memory-c", created_at: "2026-08-10T02:00:00.000Z" });
  activateSMCAuthority(db);
  const identities = defaultSMCGoverningIdentities({ provider: "codex", model: "test", reasoning_effort: null });
  const first = auditPlan("job-audit-fairness-1", identities);
  expect(first.audit_selection.members.map((member) => member.memory_id)).toEqual(["memory-a"]);
  const prepared = prepare(db, first);
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  insertAuditCoverage("memory-a", prepared.manifest, contract.id, first.audit_selection.work_batch_id!);

  const second = auditPlan("job-audit-fairness-2", identities);
  expect(second.audit_selection.members.map((member) => member.memory_id)).toEqual(["memory-b"]);
  insertAuditCoverage("memory-b", prepared.manifest, contract.id, first.audit_selection.work_batch_id!);

  const third = auditPlan("job-audit-fairness-3", identities);
  const repeated = auditPlan("job-audit-fairness-3", identities);
  expect(third.audit_selection.members.map((member) => member.memory_id)).toEqual(["memory-c"]);
  expect(repeated.audit_selection).toEqual(third.audit_selection);
  expect(third.audit_selection.due_count).toBe(1);
});

function auditPlan(
  jobId: string,
  identities: ReturnType<typeof defaultSMCGoverningIdentities>,
) {
  const result = planSessionMaintenanceEvidence(db, {
    anchor_job_id: jobId,
    project_key: "demo",
    trigger_reason: "manual_audit",
    governing_identities: identities,
    budgets: { max_items_per_batch: 100, max_encoded_bytes_per_batch: 100_000, max_encoded_bytes_per_item: 100_000 },
    include_audit: true,
    audit_partition_limit: 1,
  });
  if (result.kind !== "planned") throw new Error(JSON.stringify(result));
  return result.plan;
}

function insertAuditCoverage(
  memoryId: string,
  manifest: SMCManifest,
  embeddingContractId: string,
  workBatchId: string,
): void {
  const memory = db.query("SELECT revision, state_digest FROM session_memories WHERE id = ?")
    .get(memoryId) as { revision: number; state_digest: string };
  const receiptDigest = `sha256:${new Bun.CryptoHasher("sha256").update(`receipt:${memoryId}`).digest("hex")}`;
  db.query(
    `INSERT INTO session_memory_audit_receipts
      (id, project_key, memory_id, reviewed_revision, reviewed_state_digest, job_id,
       work_batch_id, manifest_digest, accepted_projection_digest,
       policy_version, policy_digest, output_contract_version, output_contract_digest,
       tool_protocol_version, tool_protocol_digest, embedding_contract_id, disposition,
       resulting_status, resulting_revision, resulting_state_digest, receipt_digest, created_at)
     VALUES (?, 'demo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'keep',
             'active', ?, ?, ?, ?)`,
  ).run(
    `receipt-${memoryId}`,
    memoryId,
    memory.revision,
    memory.state_digest,
    manifest.job_id,
    workBatchId,
    manifest.manifest_digest,
    receiptDigest,
    manifest.governing_identities.policy.version,
    manifest.governing_identities.policy.digest,
    manifest.governing_identities.output_contract.version,
    manifest.governing_identities.output_contract.digest,
    manifest.governing_identities.tool_protocol.version,
    manifest.governing_identities.tool_protocol.digest,
    embeddingContractId,
    memory.revision,
    memory.state_digest,
    receiptDigest,
    "2026-08-11T12:00:00.000Z",
  );
}

function plan(input: {
  compatibility_selection_limit: number | null;
  budgets?: { max_items_per_batch: number; max_encoded_bytes_per_batch: number; max_encoded_bytes_per_item: number };
}) {
  return planSessionMaintenanceEvidence(db, {
    anchor_job_id: "job_1",
    project_key: "demo",
    trigger_reason: "manual",
    compatibility_selection_limit: input.compatibility_selection_limit,
    governing_identities: defaultSMCGoverningIdentities({
      provider: "codex",
      model: "gpt-test",
      reasoning_effort: "medium",
    }),
    budgets: input.budgets ?? {
      max_items_per_batch: 100,
      max_encoded_bytes_per_batch: 100_000,
      max_encoded_bytes_per_item: 100_000,
    },
  });
}

function seedContent(id: string, occurredAt: string, insertedAt: string, rawText: string): void {
  seed({ id, status: "valid", event_kind: "user.prompt", raw_text: rawText, occurred_at: occurredAt, inserted_at: insertedAt });
}

function seed(input: {
  id: string;
  status: "valid" | "invalid";
  event_kind: string | null;
  raw_text: string | null;
  occurred_at?: string;
  inserted_at?: string;
}): void {
  recordExperienceEvent(db, {
    id: input.id,
    project_key: "demo",
    occurred_at: input.occurred_at ?? "2026-08-11T09:00:00.000Z",
    hook_event_name: input.event_kind === "session.start" ? "SessionStart" : "UserPromptSubmit",
    event_kind: input.event_kind,
    provider: "codex",
    provider_session_id: `session_${input.id}`,
    turn_id: `turn_${input.id}`,
    raw_text: input.raw_text,
    raw_payload_json: JSON.stringify({ id: input.id }),
    source: "codex-hook",
    status: input.status,
    repo_path: "/repo",
    git_branch: "feature/smc",
    git_commit: "abc123",
    git_worktree_id: "wt_1",
  }, new Date(input.inserted_at ?? "2026-08-11T09:00:00.000Z"));
}

function databaseState(): unknown {
  return {
    events: db.query("SELECT * FROM experience_events ORDER BY inserted_at, id").all(),
    tombstones: db.query("SELECT * FROM experience_event_tombstones ORDER BY id").all(),
    jobs: db.query("SELECT * FROM ingest_jobs ORDER BY id").all(),
  };
}
