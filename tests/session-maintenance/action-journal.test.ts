import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { executeJournaledSMCAction, readSMCActionJournal } from "../../src/session-maintenance/action-journal.ts";
import {
  recordSMCBudgetGrant,
  recordSMCCoverageReceiptInOpenTransaction,
  readSMCCoverageReceipt,
  sumSMCBudgetGrants,
} from "../../src/session-maintenance/coverage-receipts.ts";
import { transitionSessionMemoryAnchorJob } from "../../src/session-maintenance/job-lifecycle.ts";
import {
  defaultSMCGoverningIdentities,
  planSessionMaintenanceEvidence,
} from "../../src/session-maintenance/evidence-selection.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  prepare,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_NOW,
} from "../helpers/smc-preparation.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  configureSMCTestContract(db);
});

afterEach(() => db.close());

test("records a result before return, replays it exactly, and rejects changed content", () => {
  const context = prepareRunningAnchor();
  let executions = 0;
  const input = {
    ...context,
    sequence: 0,
    expected_overlay_revision: 0,
    action_kind: "query" as const,
    request: { query: "session reliability" },
    created_at: SMC_TEST_NOW,
    execute: () => ({ ordered_ids: ["memory-base"], execution: ++executions }),
  };
  const first = executeJournaledSMCAction(db, input);
  if (first.kind === "rejected") throw new Error(JSON.stringify(first));
  expect(first).toMatchObject({ kind: "executed", result: { execution: 1 } });
  expect(readSMCActionJournal(db, { job_id: context.job_id })).toHaveLength(1);
  const replay = executeJournaledSMCAction(db, input);
  expect(replay).toEqual({ kind: "replayed", result: first.result, result_digest: first.result_digest });
  expect(executions).toBe(1);
  expect(executeJournaledSMCAction(db, { ...input, request: { query: "changed" } }))
    .toEqual({ kind: "rejected", code: "journal_idempotency_conflict" });
});

test("a lost response after durable append replays without executing again", () => {
  const context = prepareRunningAnchor();
  let executions = 0;
  const base = {
    ...context,
    sequence: 1,
    expected_overlay_revision: 0,
    action_kind: "fetch_record" as const,
    request: { id: "memory-base" },
    created_at: SMC_TEST_NOW,
    execute: () => ({ id: "memory-base", execution: ++executions }),
  };
  expect(() => executeJournaledSMCAction(db, {
    ...base,
    failure_injection: { afterCommitBeforeReturn: () => { throw new Error("lost-response"); } },
  })).toThrow("lost-response");
  expect(db.query("SELECT count(*) AS n FROM smc_action_journal").get()).toEqual({ n: 1 });
  expect(executeJournaledSMCAction(db, base)).toMatchObject({ kind: "replayed", result: { execution: 1 } });
  expect(executions).toBe(1);
});

test("manifest and current owner epoch are required even for replay", () => {
  const context = prepareRunningAnchor();
  const input = {
    ...context,
    sequence: 2,
    expected_overlay_revision: 0,
    action_kind: "blocker" as const,
    request: { code: "bounded" },
    created_at: SMC_TEST_NOW,
    execute: () => ({ accepted: true }),
  };
  expect(executeJournaledSMCAction(db, input)).toMatchObject({ kind: "executed" });
  expect(executeJournaledSMCAction(db, { ...input, manifest_digest: `sha256:${"0".repeat(64)}` }))
    .toEqual({ kind: "rejected", code: "journal_identity_mismatch" });
  const paused = transitionSessionMemoryAnchorJob(db, {
    jobId: context.job_id,
    projectKey: context.project_key,
    expectedPhase: "running",
    expectedOwnerEpoch: context.owner_epoch,
    nextPhase: "needs_followup",
    reasonCode: "provider_interrupted",
    now: "2026-08-11T12:01:00.000Z",
  });
  expect(paused).toMatchObject({ kind: "updated", anchor: { owner_epoch: 2 } });
  expect(executeJournaledSMCAction(db, input))
    .toEqual({ kind: "rejected", code: "journal_identity_mismatch" });
});

test("replay fails closed when a stored result no longer matches its digest", () => {
  const context = prepareRunningAnchor();
  const input = {
    ...context,
    sequence: 4,
    expected_overlay_revision: 0,
    action_kind: "fetch_record" as const,
    request: { id: "memory-base" },
    created_at: SMC_TEST_NOW,
    execute: () => ({ id: "memory-base", summary: "trusted" }),
  };
  expect(executeJournaledSMCAction(db, input)).toMatchObject({ kind: "executed" });
  db.query("UPDATE smc_action_journal SET result_json = '{\"summary\":\"tampered\"}'").run();
  expect(executeJournaledSMCAction(db, input))
    .toEqual({ kind: "rejected", code: "journal_integrity_mismatch" });
});

test("coverage receipts persist inside the action transaction and budget grants are additive", () => {
  const context = prepareRunningAnchor();
  const journaled = executeJournaledSMCAction(db, {
    ...context,
    sequence: 3,
    expected_overlay_revision: 0,
    action_kind: "query",
    request: { query: "coverage" },
    created_at: SMC_TEST_NOW,
    execute: (transaction) => recordSMCCoverageReceiptInOpenTransaction(transaction, {
      id: "coverage-1",
      ...context,
      receipt_kind: "query",
      channel: "lexical",
      overlay_revision: 0,
      complete: true,
      truncated: false,
      payload: { ordered_ids: ["memory-base"], next_cursor: null },
      created_at: SMC_TEST_NOW,
    }),
  });
  expect(journaled).toMatchObject({ kind: "executed", result: { id: "coverage-1", complete: true } });
  expect(db.query("SELECT count(*) AS n FROM smc_coverage_receipts").get()).toEqual({ n: 1 });
  db.query("UPDATE smc_coverage_receipts SET payload_json = '{\"tampered\":true}' WHERE id = 'coverage-1'").run();
  expect(() => readSMCCoverageReceipt(db, "coverage-1"))
    .toThrow("invalid_smc_coverage_receipt:");

  const paused = transitionSessionMemoryAnchorJob(db, {
    jobId: context.job_id,
    projectKey: context.project_key,
    expectedPhase: "running",
    expectedOwnerEpoch: context.owner_epoch,
    nextPhase: "needs_followup",
    reasonCode: "budget_exhausted",
    now: "2026-08-11T12:01:00.000Z",
  });
  if (paused.kind !== "updated") throw new Error(JSON.stringify(paused));
  const grant = recordSMCBudgetGrant(db, {
    id: "grant-1",
    job_id: context.job_id,
    project_key: context.project_key,
    owner_epoch: paused.anchor.owner_epoch,
    budget_name: "max_queries",
    additive_amount: 5,
    operator_id: "operator:test",
    reason: "continue bounded investigation",
    manifest_digest: context.manifest_digest,
    created_at: "2026-08-11T12:02:00.000Z",
  });
  expect(recordSMCBudgetGrant(db, {
    id: "grant-1",
    job_id: context.job_id,
    project_key: context.project_key,
    owner_epoch: paused.anchor.owner_epoch,
    budget_name: "max_queries",
    additive_amount: 5,
    operator_id: "operator:test",
    reason: "continue bounded investigation",
    manifest_digest: context.manifest_digest,
    created_at: "2026-08-11T12:02:00.000Z",
  })).toEqual(grant);
  expect(sumSMCBudgetGrants(db, { job_id: context.job_id, budget_name: "max_queries" })).toBe(5);
});

test("overlay, journal, and coverage storage reject missing and cross-job work batches", () => {
  seedIndexedMemory(db, { id: "memory-other", project_key: "other" });
  seedEvidence(db, "evt-other", "Evidence evt-other", "other");
  const current = prepareRunningAnchor();
  const other = prepareRunningAnchor({
    job_id: "job-other",
    project_key: "other",
    attempt_id: "attempt-other",
    memory_id: "memory-other",
    evidence_id: "evt-other",
    preseeded: true,
  });

  for (const batchId of ["missing-batch", other.work_batch_id]) {
    expect(() => insertOverlayRevision(current, batchId)).toThrow("FOREIGN KEY constraint failed");
    expect(() => insertJournalEntry(current, batchId)).toThrow("FOREIGN KEY constraint failed");
    expect(() => insertCoverageReceipt(current, batchId)).toThrow("FOREIGN KEY constraint failed");
  }
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.query("SELECT count(*) AS n FROM smc_overlay_revisions").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM smc_action_journal").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM smc_coverage_receipts").get()).toEqual({ n: 0 });
});

function prepareRunningAnchor(input: {
  job_id: string;
  project_key: string;
  attempt_id: string;
  memory_id: string;
  evidence_id: string;
  preseeded?: boolean;
} = {
  job_id: "job-journal",
  project_key: "demo",
  attempt_id: "attempt-journal",
  memory_id: "memory-base",
  evidence_id: "evt-1",
}) {
  if (!input.preseeded) {
    seedIndexedMemory(db, { id: input.memory_id, project_key: input.project_key });
    seedEvidence(db, input.evidence_id, `Evidence ${input.evidence_id}`, input.project_key);
  }
  activateSMCAuthority(db);
  const planned = planSessionMaintenanceEvidence(db, {
    anchor_job_id: input.job_id,
    project_key: input.project_key,
    trigger_reason: "manual",
    governing_identities: defaultSMCGoverningIdentities({
      provider: "codex",
      model: "gpt-test",
      reasoning_effort: "medium",
    }),
    budgets: {
      max_items_per_batch: 10,
      max_encoded_bytes_per_batch: 100_000,
      max_encoded_bytes_per_item: 100_000,
    },
  });
  if (planned.kind !== "planned") throw new Error(JSON.stringify(planned));
  const prepared = prepare(db, planned.plan);
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status,
       details_json, created_at, updated_at)
     VALUES (?, ?, 1, ?, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(input.attempt_id, prepared.manifest.job_id, prepared.manifest.owner_epoch, SMC_TEST_NOW, SMC_TEST_NOW);
  const transition = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: prepared.manifest.owner_epoch,
    nextPhase: "running",
    now: SMC_TEST_NOW,
  });
  if (transition.kind !== "updated") throw new Error(JSON.stringify(transition));
  const batch = db.query("SELECT batch_id FROM smc_work_batches WHERE job_id = ?").get(prepared.manifest.job_id) as { batch_id: string };
  return {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    work_batch_id: batch.batch_id,
    attempt_id: input.attempt_id,
    owner_epoch: prepared.manifest.owner_epoch,
    manifest_digest: prepared.manifest.manifest_digest,
    snapshot_token: prepared.manifest.snapshot_token,
  };
}

function insertOverlayRevision(context: ReturnType<typeof prepareRunningAnchor>, batchId: string): void {
  db.query(
    `INSERT INTO smc_overlay_revisions
      (job_id, revision, parent_revision, work_batch_id, attempt_id, owner_epoch,
       response_digest, delta_digest, overlay_digest, created_at)
     VALUES (?, 1, 0, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    context.job_id,
    batchId,
    context.attempt_id,
    context.owner_epoch,
    validDigest("1"),
    validDigest("2"),
    validDigest("3"),
    SMC_TEST_NOW,
  );
}

function insertJournalEntry(context: ReturnType<typeof prepareRunningAnchor>, batchId: string): void {
  db.query(
    `INSERT INTO smc_action_journal
      (job_id, work_batch_id, attempt_id, sequence, owner_epoch, protocol_version,
       manifest_digest, snapshot_token, expected_overlay_revision, action_kind,
       request_json, request_digest, result_json, result_digest, created_at)
     VALUES (?, ?, ?, 99, ?, '1', ?, ?, 0, 'query', '{}', ?, '{}', ?, ?)`,
  ).run(
    context.job_id,
    batchId,
    context.attempt_id,
    context.owner_epoch,
    context.manifest_digest,
    context.snapshot_token,
    validDigest("4"),
    validDigest("5"),
    SMC_TEST_NOW,
  );
}

function insertCoverageReceipt(context: ReturnType<typeof prepareRunningAnchor>, batchId: string): void {
  db.query(
    `INSERT INTO smc_coverage_receipts
      (id, job_id, work_batch_id, attempt_id, owner_epoch, receipt_kind, channel,
       manifest_digest, snapshot_token, overlay_revision, complete, truncated,
       payload_json, receipt_digest, created_at)
     VALUES (?, ?, ?, ?, ?, 'query', 'lexical', ?, ?, 0, 1, 0, '{}', ?, ?)`,
  ).run(
    `coverage-${batchId}`,
    context.job_id,
    batchId,
    context.attempt_id,
    context.owner_epoch,
    context.manifest_digest,
    context.snapshot_token,
    validDigest("6"),
    SMC_TEST_NOW,
  );
}

function validDigest(hex: string): string {
  return `sha256:${hex.repeat(64)}`;
}
