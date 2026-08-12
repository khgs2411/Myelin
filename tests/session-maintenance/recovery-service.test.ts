import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import type { EmbeddingTransport } from "../../src/memory/embedding-types.ts";
import type { ActiveEmbeddingContract } from "../../src/runtime/config.ts";
import { withAnchorLifecycleAdmission } from "../../src/memory/session-memory-write-firewall.ts";
import { executeJournaledSMCAction } from "../../src/session-maintenance/action-journal.ts";
import { recordSMCBudgetGrant } from "../../src/session-maintenance/coverage-receipts.ts";
import {
  heartbeatSessionMemoryAnchorJob,
  listSessionMemoryAnchorAttempts,
  transitionSessionMemoryAnchorJob,
} from "../../src/session-maintenance/job-lifecycle.ts";
import {
  beginSessionMaintenanceCoordinatorResume,
  recoverStaleSessionMaintenanceAnchor,
  validateSessionMaintenanceFrozenState,
  validateSessionMaintenanceResume,
} from "../../src/session-maintenance/recovery-service.ts";
import {
  writeSMCTerminalReceiptInOpenTransaction,
} from "../../src/session-maintenance/terminal-receipts.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  planEvidence,
  prepare,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_NOW,
} from "../helpers/smc-preparation.ts";
import { buildSMCTestProposal, completeSMCTestCoverage, stageSMCTestProposal, type SMCTestBatchIdentity } from "../helpers/smc-proposal-stage.ts";

let db: MemoryDb;
let documentContract: ActiveEmbeddingContract;
const invocation = { provider: "codex", model: "gpt-test", reasoning_effort: "medium" };

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  documentContract = { ...configureSMCTestContract(db), purpose: "retrieval_document" };
  seedIndexedMemory(db, { id: "memory-base" });
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);
});

afterEach(() => db.close());

test("stale preparation takes over the same job, blocks before coordinator availability, then resumes with a fresh epoch and attempt", () => {
  const prepared = prepare(db, planEvidence(db, "job-recover"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));

  const blocked = recoverStaleSessionMaintenanceAnchor(db, {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    stale_before: "2026-08-11T12:01:00.000Z",
    now: "2026-08-11T12:02:00.000Z",
    attempt_id: "attempt-resume-1",
    invocation,
  });
  expect(blocked).toMatchObject({ kind: "blocked", code: "smc_coordinator_not_available" });
  expect(db.query("SELECT phase, owner_epoch, reason_code FROM session_memory_anchor_jobs WHERE job_id = ?")
    .get(prepared.manifest.job_id)).toEqual({
      phase: "needs_followup",
      owner_epoch: 2,
      reason_code: "smc_coordinator_not_available",
    });
  expect(listSessionMemoryAnchorAttempts(db, prepared.manifest.job_id)).toHaveLength(0);

  const stale = heartbeatSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: 1,
    now: "2026-08-11T12:03:00.000Z",
  });
  expect(stale).toMatchObject({ kind: "rejected", code: "session_memory_anchor_stale_epoch" });

  const launches: unknown[] = [];
  const resumed = beginSessionMaintenanceCoordinatorResume(db, {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    expected_owner_epoch: 2,
    attempt_id: "attempt-resume-1",
    invocation,
    now: "2026-08-11T12:04:00.000Z",
    coordinator: (context) => launches.push(context),
  });
  expect(resumed).toMatchObject({ kind: "launched", anchor: { phase: "running", owner_epoch: 3 } });
  expect(launches).toHaveLength(1);
  expect(listSessionMemoryAnchorAttempts(db, prepared.manifest.job_id)).toMatchObject([
    { id: "attempt-resume-1", attempt_number: 1, owner_epoch: 3, status: "running" },
  ]);
});

test("resume launch failure preserves the same anchor as recoverable with a stable blocker", () => {
  const prepared = prepare(db, planEvidence(db, "job-resume-launch-failure"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const paused = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: 1,
    nextPhase: "needs_followup",
    reasonCode: "stale_preparing_owner",
    now: "2026-08-11T12:01:00.000Z",
  });
  if (paused.kind !== "updated") throw new Error(JSON.stringify(paused));

  const result = beginSessionMaintenanceCoordinatorResume(db, {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    expected_owner_epoch: 2,
    attempt_id: "attempt-launch-failure",
    invocation,
    now: "2026-08-11T12:02:00.000Z",
    coordinator: () => { throw new Error("spawn unavailable"); },
  });

  expect(result).toMatchObject({ kind: "blocked", code: "smc_coordinator_launch_failed" });
  expect(db.query("SELECT phase, owner_epoch, reason_code FROM session_memory_anchor_jobs WHERE job_id = ?")
    .get(prepared.manifest.job_id)).toEqual({
      phase: "needs_followup",
      owner_epoch: 4,
      reason_code: "smc_coordinator_launch_failed",
    });
  expect(listSessionMemoryAnchorAttempts(db, prepared.manifest.job_id)).toMatchObject([
    { id: "attempt-launch-failure", owner_epoch: 3, status: "needs_followup" },
  ]);
  expect(db.query("SELECT count(*) AS n FROM ingest_jobs WHERE id = ?").get(prepared.manifest.job_id))
    .toEqual({ n: 1 });
});

test("recovery rejects an audit member moved to an evidence batch", () => {
  const plan = planEvidence(db, "job-corrupt-audit-member", { includeAudit: true });
  const prepared = prepare(db, plan);
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const evidenceBatch = plan.batches.find((batch) => batch.work_kind === "evidence")!;
  db.exec("PRAGMA foreign_keys = OFF");
  db.query("UPDATE smc_audit_batch_members SET batch_id = ? WHERE job_id = ?")
    .run(evidenceBatch.id, plan.anchor_job_id);
  db.exec("PRAGMA foreign_keys = ON");

  expect(validateSessionMaintenanceFrozenState(db, prepared.manifest)).toMatchObject({
    kind: "blocked",
    code: "smc_manifest_identity_mismatch",
  });
});

test("recovery rejects evidence inserted into an audit batch", () => {
  const plan = planEvidence(db, "job-corrupt-evidence-member", { includeAudit: true });
  const prepared = prepare(db, plan);
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const auditBatch = plan.batches.find((batch) => batch.work_kind === "audit")!;
  db.exec("PRAGMA foreign_keys = OFF");
  db.query(
    `INSERT INTO smc_evidence_batch_members
      (job_id, batch_id, work_kind, source_id, ordinal, content_hash)
     VALUES (?, ?, 'evidence', ?, 0, ?)`,
  ).run(plan.anchor_job_id, auditBatch.id, plan.evidence[0]!.source_id, plan.evidence[0]!.content_hash);
  db.exec("PRAGMA foreign_keys = ON");

  expect(validateSessionMaintenanceFrozenState(db, prepared.manifest)).toMatchObject({
    kind: "blocked",
    code: "smc_manifest_identity_mismatch",
  });
});

test("governing identity drift remains blocked under the same project fence", () => {
  const prepared = prepare(db, planEvidence(db, "job-drift"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const takeover = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: 1,
    nextPhase: "needs_followup",
    now: "2026-08-11T12:01:00.000Z",
  });
  if (takeover.kind !== "updated") throw new Error(JSON.stringify(takeover));
  db.query("UPDATE smc_manifests SET governing_identities_json = '{}' WHERE job_id = ?")
    .run(prepared.manifest.job_id);

  const result = validateSessionMaintenanceResume(db, {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    expected_owner_epoch: 2,
    invocation,
  });
  expect(result).toMatchObject({ kind: "blocked", code: "smc_resume_manifest_identity_mismatch" });
  expect(db.query("SELECT owner_id, owner_epoch, phase FROM project_session_mutation_fences WHERE project_key = 'demo'").get())
    .toEqual({ owner_id: prepared.manifest.job_id, owner_epoch: 2, phase: "needs_followup" });
});

test("a stale finalizing anchor with a durable finalization receipt reconciles completion instead of resuming", () => {
  const prepared = prepare(db, planEvidence(db, "job-receipt-recovery"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status,
       details_json, created_at, updated_at)
     VALUES ('attempt-finalize', ?, 1, 1, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(prepared.manifest.job_id, SMC_TEST_NOW, SMC_TEST_NOW);
  const running = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: 1,
    nextPhase: "running",
    now: SMC_TEST_NOW,
  });
  if (running.kind !== "updated") throw new Error(JSON.stringify(running));
  const finalizing = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "running",
    expectedOwnerEpoch: 1,
    nextPhase: "finalizing",
    now: SMC_TEST_NOW,
  });
  if (finalizing.kind !== "updated") throw new Error(JSON.stringify(finalizing));
  db.transaction(() => writeSMCTerminalReceiptInOpenTransaction(db, {
    id: "receipt-finalized",
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    receipt_kind: "finalization",
    terminal_basis: {
      kind: "smc_manifest",
      digest: prepared.manifest.manifest_digest as `sha256:${string}`,
    },
    target_owner_epoch: 1,
    result: { outcome: "completed" },
    created_at: SMC_TEST_NOW,
  })).immediate();

  const recovered = recoverStaleSessionMaintenanceAnchor(db, {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    stale_before: "2026-08-11T12:01:00.000Z",
    now: "2026-08-11T12:02:00.000Z",
    attempt_id: "unused",
    invocation,
  });
  expect(recovered).toMatchObject({ kind: "completed", receipt: { id: "receipt-finalized" } });
  expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(prepared.manifest.job_id))
    .toEqual({ phase: "completed" });
  expect(db.query("SELECT 1 FROM project_session_mutation_fences WHERE project_key = 'demo'").get()).toBeNull();
});

test("resume validates the complete journal request identity and blocks a changed stored digest", () => {
  const prepared = prepare(db, planEvidence(db, "job-journal-recovery"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status,
       details_json, created_at, updated_at)
     VALUES ('attempt-journal', ?, 1, 1, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(prepared.manifest.job_id, SMC_TEST_NOW, SMC_TEST_NOW);
  const running = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: 1,
    nextPhase: "running",
    now: SMC_TEST_NOW,
  });
  if (running.kind !== "updated") throw new Error(JSON.stringify(running));
  const batch = db.query("SELECT batch_id FROM smc_work_batches WHERE job_id = ?")
    .get(prepared.manifest.job_id) as { batch_id: string };
  expect(executeJournaledSMCAction(db, {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    work_batch_id: batch.batch_id,
    attempt_id: "attempt-journal",
    sequence: 0,
    owner_epoch: 1,
    manifest_digest: prepared.manifest.manifest_digest,
    snapshot_token: prepared.manifest.snapshot_token,
    expected_overlay_revision: 0,
    action_kind: "query",
    request: { query: "durable recovery" },
    created_at: SMC_TEST_NOW,
    execute: () => ({ ordered_ids: ["memory-base"] }),
  })).toMatchObject({ kind: "executed" });
  const paused = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "running",
    expectedOwnerEpoch: 1,
    nextPhase: "needs_followup",
    reasonCode: "provider_interrupted",
    now: "2026-08-11T12:01:00.000Z",
  });
  if (paused.kind !== "updated") throw new Error(JSON.stringify(paused));

  expect(validateSessionMaintenanceResume(db, {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    expected_owner_epoch: 2,
    invocation,
  })).toMatchObject({ kind: "compatible" });
  db.query(`UPDATE smc_action_journal SET request_digest = ? WHERE job_id = ?`)
    .run(`sha256:${"0".repeat(64)}`, prepared.manifest.job_id);
  expect(validateSessionMaintenanceResume(db, {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    expected_owner_epoch: 2,
    invocation,
  })).toMatchObject({ kind: "blocked", code: "smc_resume_journal_integrity_mismatch" });
});

test("persisting the budget blocker does not bypass the required additive grant", () => {
  const prepared = prepare(db, planEvidence(db, "job-budget-recovery"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const paused = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: 1,
    nextPhase: "needs_followup",
    reasonCode: "budget_exhausted",
    now: "2026-08-11T12:01:00.000Z",
  });
  if (paused.kind !== "updated") throw new Error(JSON.stringify(paused));
  const blocked = beginSessionMaintenanceCoordinatorResume(db, {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    expected_owner_epoch: 2,
    attempt_id: "attempt-budget",
    invocation,
    now: "2026-08-11T12:02:00.000Z",
  });
  expect(blocked).toMatchObject({ kind: "blocked", code: "smc_budget_grant_required" });
  expect(validateSessionMaintenanceResume(db, {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    expected_owner_epoch: 2,
    invocation,
  })).toMatchObject({ kind: "blocked", code: "smc_budget_grant_required" });

  recordSMCBudgetGrant(db, {
    id: "grant-budget-recovery",
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    owner_epoch: 2,
    budget_name: "max_queries",
    additive_amount: 1,
    operator_id: "operator:test",
    reason: "continue bounded recovery",
    manifest_digest: prepared.manifest.manifest_digest,
    created_at: "2026-08-11T12:03:00.000Z",
  });
  expect(validateSessionMaintenanceResume(db, {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    expected_owner_epoch: 2,
    invocation,
  })).toMatchObject({ kind: "compatible" });
});

test.each([
  ["leased evidence", "smc_resume_lease_identity_mismatch", (jobId: string) => {
    withAnchorLifecycleAdmission(db, {
      operation: "anchor_resume",
      projectKey: "demo",
      ownerId: jobId,
      ownerEpoch: 2,
      phase: "needs_followup",
    }, () => db.query(
      "UPDATE experience_event_tombstones SET state = 'unfinished' WHERE ingest_job_id = ? AND state = 'claimed'",
    ).run(jobId));
  }],
  ["frozen memory", "smc_resume_memory_snapshot_mismatch", (jobId: string) => {
    db.query("UPDATE smc_memory_snapshot SET summary = 'tampered' WHERE job_id = ?").run(jobId);
  }],
  ["frozen retrieval", "smc_resume_embedding_identity_mismatch", (jobId: string) => {
    db.query("UPDATE smc_memory_snapshot_search_texts SET normalized_text = 'tampered' WHERE job_id = ?").run(jobId);
  }],
  ["overlay", "smc_resume_overlay_identity_mismatch", (jobId: string) => {
    db.query("UPDATE smc_overlay_state SET current_digest = ? WHERE job_id = ?")
      .run(`sha256:${"0".repeat(64)}`, jobId);
  }],
] as const)("resume blocks changed %s identity with %s", (_label, expectedCode, mutate) => {
  const prepared = prepare(db, planEvidence(db, `job-identity-${expectedCode}`));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const paused = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: 1,
    nextPhase: "needs_followup",
    reasonCode: "provider_interrupted",
    now: "2026-08-11T12:01:00.000Z",
  });
  if (paused.kind !== "updated") throw new Error(JSON.stringify(paused));
  mutate(prepared.manifest.job_id);
  expect(validateSessionMaintenanceResume(db, {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    expected_owner_epoch: 2,
    invocation,
  })).toMatchObject({ kind: "blocked", code: expectedCode });
});

test("preparing after-commit launch loss preserves one resumable higher epoch", () => {
  let committedJobId = "";
  expect(() => prepare(db, planEvidence(db, "job-preparing-injected"), {
    afterCommitBeforeReturn: (manifest) => {
      committedJobId = manifest.job_id;
      throw new Error("injected preparing launch loss");
    },
  })).toThrow("injected preparing launch loss");
  expect(committedJobId).toBe("job-preparing-injected");
  expect(() => recoverStaleSessionMaintenanceAnchor(db, {
    job_id: committedJobId,
    project_key: "demo",
    stale_before: "2026-08-11T12:01:00.000Z",
    now: "2026-08-11T12:02:00.000Z",
    attempt_id: "attempt-injected",
    invocation,
    failure_injection: { after_takeover: () => { throw new Error("injected preparing handoff loss"); } },
  })).toThrow("injected preparing handoff loss");
  expect(db.query("SELECT phase, owner_epoch FROM session_memory_anchor_jobs WHERE job_id = ?").get(committedJobId))
    .toEqual({ phase: "needs_followup", owner_epoch: 2 });
  expect(listSessionMemoryAnchorAttempts(db, committedJobId)).toHaveLength(0);
});

test("a running owner loss takes over the same job before a replacement coordinator can launch", () => {
  const prepared = prepare(db, planEvidence(db, "job-running-injected"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const running = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: "demo",
    expectedPhase: "preparing",
    expectedOwnerEpoch: 1,
    nextPhase: "running",
    now: SMC_TEST_NOW,
  });
  if (running.kind !== "updated") throw new Error(JSON.stringify(running));
  expect(() => recoverStaleSessionMaintenanceAnchor(db, {
    job_id: prepared.manifest.job_id,
    project_key: "demo",
    stale_before: "2026-08-11T12:01:00.000Z",
    now: "2026-08-11T12:02:00.000Z",
    attempt_id: "attempt-running-recovery",
    invocation,
    failure_injection: { after_takeover: () => { throw new Error("injected running handoff loss"); } },
  })).toThrow("injected running handoff loss");
  expect(db.query("SELECT phase, owner_epoch FROM session_memory_anchor_jobs WHERE job_id = ?")
    .get(prepared.manifest.job_id)).toEqual({ phase: "needs_followup", owner_epoch: 2 });
});

test("accepted overlay survives a lost response and receipt-less finalizing blocks without its fixed digest", async () => {
  const prepared = prepare(db, planEvidence(db, "job-overlay-injected"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status,
       details_json, created_at, updated_at)
     VALUES ('attempt-overlay', ?, 1, 1, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(prepared.manifest.job_id, SMC_TEST_NOW, SMC_TEST_NOW);
  const running = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: "demo",
    expectedPhase: "preparing",
    expectedOwnerEpoch: 1,
    nextPhase: "running",
    now: SMC_TEST_NOW,
  });
  if (running.kind !== "updated") throw new Error(JSON.stringify(running));
  const batch = db.query("SELECT batch_id FROM smc_work_batches WHERE job_id = ?")
    .get(prepared.manifest.job_id) as { batch_id: string };
  const identity = batchIdentity(prepared.manifest, batch.batch_id, "attempt-overlay");
  await completeSMCTestCoverage(db, identity, fixedTransport());
  const proposal = buildSMCTestProposal(db, { identity });
  await expect(stageSMCTestProposal(db, {
    identity,
    proposal,
    document_contract: documentContract,
    embedding_transport: fixedTransport(),
    created_at: SMC_TEST_NOW,
    failure_injection: { afterCommitBeforeReturn: () => { throw new Error("lost overlay response"); } },
  })).rejects.toThrow("lost overlay response");
  expect(db.query("SELECT current_revision FROM smc_overlay_state WHERE job_id = ?").get(prepared.manifest.job_id))
    .toEqual({ current_revision: 1 });
  const finalizing = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: "demo",
    expectedPhase: "running",
    expectedOwnerEpoch: 1,
    nextPhase: "finalizing",
    now: SMC_TEST_NOW,
  });
  if (finalizing.kind !== "updated") throw new Error(JSON.stringify(finalizing));
  const recovered = recoverStaleSessionMaintenanceAnchor(db, {
    job_id: prepared.manifest.job_id,
    project_key: "demo",
    stale_before: "2026-08-11T12:01:00.000Z",
    now: "2026-08-11T12:02:00.000Z",
    attempt_id: "attempt-finalizing-recovery",
    invocation,
  });
  expect(recovered).toMatchObject({ kind: "blocked", code: "smc_resume_finalizing_digest_missing" });
  expect(db.query("SELECT phase, owner_epoch FROM session_memory_anchor_jobs WHERE job_id = ?")
    .get(prepared.manifest.job_id)).toEqual({ phase: "needs_followup", owner_epoch: 2 });
});

test("resume rejects an accepted batch whose response digest is replaced by another valid SHA-256", async () => {
  const prepared = prepare(db, planEvidence(db, "job-accepted-batch-drift"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status,
       details_json, created_at, updated_at)
     VALUES ('attempt-accepted-batch', ?, 1, 1, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(prepared.manifest.job_id, SMC_TEST_NOW, SMC_TEST_NOW);
  const running = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: "demo",
    expectedPhase: "preparing",
    expectedOwnerEpoch: 1,
    nextPhase: "running",
    now: SMC_TEST_NOW,
  });
  if (running.kind !== "updated") throw new Error(JSON.stringify(running));
  const batch = db.query("SELECT batch_id FROM smc_work_batches WHERE job_id = ?")
    .get(prepared.manifest.job_id) as { batch_id: string };
  const identity = batchIdentity(prepared.manifest, batch.batch_id, "attempt-accepted-batch");
  await completeSMCTestCoverage(db, identity, fixedTransport());
  const proposal = buildSMCTestProposal(db, { identity });
  expect(await stageSMCTestProposal(db, {
    identity,
    proposal,
    document_contract: documentContract,
    embedding_transport: fixedTransport(),
    created_at: SMC_TEST_NOW,
  })).toMatchObject({ kind: "accepted" });
  const paused = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: "demo",
    expectedPhase: "running",
    expectedOwnerEpoch: 1,
    nextPhase: "needs_followup",
    reasonCode: "provider_interrupted",
    now: "2026-08-11T12:01:00.000Z",
  });
  if (paused.kind !== "updated") throw new Error(JSON.stringify(paused));
  db.query("UPDATE smc_overlay_revisions SET response_digest = ? WHERE job_id = ?")
    .run(`sha256:${"3".repeat(64)}`, prepared.manifest.job_id);
  expect(validateSessionMaintenanceResume(db, {
    job_id: prepared.manifest.job_id,
    project_key: "demo",
    expected_owner_epoch: 2,
    invocation,
  })).toMatchObject({ kind: "blocked", code: "smc_resume_overlay_identity_mismatch" });
});

test("resume rejects a same-length mutation of accepted overlay vector bytes", async () => {
  const prepared = prepare(db, planEvidence(db, "job-overlay-vector-drift"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status,
       details_json, created_at, updated_at)
     VALUES ('attempt-overlay-vector', ?, 1, 1, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(prepared.manifest.job_id, SMC_TEST_NOW, SMC_TEST_NOW);
  const running = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id, projectKey: "demo", expectedPhase: "preparing",
    expectedOwnerEpoch: 1, nextPhase: "running", now: SMC_TEST_NOW,
  });
  if (running.kind !== "updated") throw new Error(JSON.stringify(running));
  const batch = db.query("SELECT batch_id FROM smc_work_batches WHERE job_id = ?")
    .get(prepared.manifest.job_id) as { batch_id: string };
  const identity = batchIdentity(prepared.manifest, batch.batch_id, "attempt-overlay-vector");
  await completeSMCTestCoverage(db, identity, fixedTransport());
  const proposal = buildSMCTestProposal(db, {
    identity,
    staged_operations: [{
      record_kind: "memory",
      stable_key: "resume-vector",
      operation: "upsert",
      value: {
        id: "resume-vector",
        memory_kind: "continuity",
        title: "Resume vector",
        summary: "Resume vector",
        payload: {},
        source_event_refs: ["evt-1"],
        confidence: "high",
        risk: "low",
      },
    }],
  });
  expect(await stageSMCTestProposal(db, {
    identity,
    proposal,
    document_contract: documentContract,
    embedding_transport: fixedTransport(),
    created_at: SMC_TEST_NOW,
  })).toMatchObject({ kind: "accepted" });
  const paused = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id, projectKey: "demo", expectedPhase: "running",
    expectedOwnerEpoch: 1, nextPhase: "needs_followup", reasonCode: "provider_interrupted",
    now: "2026-08-11T12:01:00.000Z",
  });
  if (paused.kind !== "updated") throw new Error(JSON.stringify(paused));
  const row = db.query("SELECT vector_bytes FROM smc_overlay_search_indexes WHERE job_id = ?")
    .get(prepared.manifest.job_id) as { vector_bytes: Uint8Array };
  const tampered = new Uint8Array(row.vector_bytes);
  tampered[0] = tampered[0]! ^ 1;
  db.query("UPDATE smc_overlay_search_indexes SET vector_bytes = ? WHERE job_id = ?")
    .run(tampered, prepared.manifest.job_id);
  expect(validateSessionMaintenanceResume(db, {
    job_id: prepared.manifest.job_id, project_key: "demo", expected_owner_epoch: 2, invocation,
  })).toMatchObject({ kind: "blocked", code: "smc_resume_overlay_identity_mismatch" });
});

function batchIdentity(
  manifest: {
    job_id: string;
    project_key: string;
    owner_epoch: number;
    manifest_digest: string;
    snapshot_token: string;
  },
  workBatchId: string,
  attemptId: string,
): SMCTestBatchIdentity {
  return {
    job_id: manifest.job_id,
    project_key: manifest.project_key,
    work_batch_id: workBatchId,
    attempt_id: attemptId,
    owner_epoch: manifest.owner_epoch,
    manifest_digest: manifest.manifest_digest,
    snapshot_token: manifest.snapshot_token,
    overlay_revision: 0,
  };
}

function fixedTransport(): EmbeddingTransport {
  return {
    async embed(request) {
      return { embedding: [0.1, 0.2, 0.3], model: request.contract.model, dimensions: request.contract.dimensions };
    },
  };
}
