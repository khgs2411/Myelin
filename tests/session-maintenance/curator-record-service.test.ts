import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import type { EmbeddingTransport } from "../../src/memory/embedding-types.ts";
import { stableJson } from "../../src/runtime/json.ts";
import { recordCuratorActionChargeInOpenTransaction } from "../../src/session-maintenance/curator-action-charges.ts";
import { recordSMCBudgetGrant } from "../../src/session-maintenance/coverage-receipts.ts";
import { fetchCuratorRecord, type CuratorRecordRequest } from "../../src/session-maintenance/curator-record-service.ts";
import { transitionSessionMemoryAnchorJob } from "../../src/session-maintenance/job-lifecycle.ts";
import { readSMCOverlayIdentity } from "../../src/session-maintenance/overlay-store.ts";
import { readSMCManifest } from "../../src/session-maintenance/manifest.ts";
import { readCuratorAffectedWorkSet } from "../../src/session-maintenance/curator-retrieval-service.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  planEvidence,
  prepareWithWorkflowBudgets,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_NOW,
  SMC_TEST_WORKFLOW_BUDGETS,
} from "../helpers/smc-preparation.ts";
import { buildSMCTestProposal, completeSMCTestCoverage, stageSMCTestProposal } from "../helpers/smc-proposal-stage.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
});

afterEach(() => db.close());

test("fetches complete frozen memory and source records under exact revisions", () => {
  const context = runningAnchor();
  const memoryRow = db.query("SELECT revision, state_digest FROM smc_memory_snapshot WHERE job_id = ? AND memory_id = 'memory-base'")
    .get(context.job_id) as { revision: number; state_digest: string };
  const memory = fetchCuratorRecord(db, {
    ...recordIdentity(context),
    record_kind: "memory",
    stable_id: "memory-base",
    expected_revision: { origin: "base", revision: memoryRow.revision, state_digest: memoryRow.state_digest },
    max_encoded_bytes: 100_000,
  });
  expect(memory).toMatchObject({
    kind: "record",
    record: {
      kind: "memory",
      stable_id: "memory-base",
      revision_identity: { origin: "base", revision: memoryRow.revision },
    },
  });
  if (memory.kind !== "record") throw new Error(JSON.stringify(memory));
  expect(memory.encoded_bytes).toBe(Buffer.byteLength(stableJson(memory), "utf8"));

  const sourceRow = db.query("SELECT content_hash FROM smc_evidence_snapshot WHERE job_id = ? AND source_id = 'evt-1'")
    .get(context.job_id) as { content_hash: string };
  const source = fetchCuratorRecord(db, {
    ...recordIdentity(context),
    record_kind: "source",
    stable_id: "evt-1",
    expected_source_hash: sourceRow.content_hash,
    max_encoded_bytes: 100_000,
  });
  expect(source).toMatchObject({ kind: "record", record: { kind: "source", stable_id: "evt-1", content_hash: sourceRow.content_hash } });
  expect(fetchCuratorRecord(db, {
    ...recordIdentity(context), record_kind: "memory", stable_id: "memory-base",
    expected_revision: { origin: "base", revision: memoryRow.revision, state_digest: memoryRow.state_digest },
    max_encoded_bytes: 100_000,
  })).toEqual(memory);
  expect(db.query("SELECT count(*) AS n FROM smc_curator_action_charges").get()).toEqual({ n: 2 });
  expect(db.query("SELECT count(*) AS n FROM smc_curator_fetch_receipts").get()).toEqual({ n: 2 });
  expect(fetchCuratorRecord(db, {
    ...recordIdentity(context), record_kind: "memory", stable_id: "memory-base",
    expected_revision: { origin: "base", revision: memoryRow.revision, state_digest: memoryRow.state_digest },
    max_encoded_bytes: 1,
  })).toMatchObject({ kind: "rejected", code: "curator_action_charge_conflict" });

  expect(fetchCuratorRecord(db, {
    ...recordIdentity(context),
    record_kind: "memory",
    stable_id: "memory-base",
    expected_revision: { origin: "base", revision: memoryRow.revision + 1, state_digest: memoryRow.state_digest },
    max_encoded_bytes: 100_000,
  })).toMatchObject({ kind: "rejected", code: "curator_record_revision_mismatch" });

  const memoryAction = db.query(
    "SELECT action_key FROM smc_curator_fetch_receipts WHERE job_id = ? AND request_json LIKE '%memory-base%'",
  ).get(context.job_id) as { action_key: string };
  db.query("DELETE FROM smc_curator_action_charges WHERE job_id = ? AND action_key = ?")
    .run(context.job_id, memoryAction.action_key);
  expect(fetchCuratorRecord(db, {
    ...recordIdentity(context), record_kind: "memory", stable_id: "memory-base",
    expected_revision: { origin: "base", revision: memoryRow.revision, state_digest: memoryRow.state_digest },
    max_encoded_bytes: 100_000,
  })).toMatchObject({ kind: "rejected", code: "curator_action_charge_missing" });
});

test("fetch receipt and charge are atomic and charge-without-receipt fails closed", () => {
  const context = runningAnchor();
  const request = {
    ...recordIdentity(context), record_kind: "memory" as const, stable_id: "memory-base",
    expected_revision: baseRevision(context.job_id), max_encoded_bytes: 100_000,
  };
  expect(fetchCuratorRecord(db, request, {
    failure_injection: { after_charge() { throw new Error("fetch-receipt-rollback"); } },
  })).toMatchObject({ kind: "rejected", code: "curator_action_charge_invalid" });
  expect(db.query("SELECT count(*) AS n FROM smc_curator_action_charges").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM smc_curator_fetch_receipts").get()).toEqual({ n: 0 });

  expect(fetchCuratorRecord(db, request)).toMatchObject({ kind: "record" });
  expect(() => db.query("UPDATE smc_curator_fetch_receipts SET result_json = result_json WHERE job_id = ?")
    .run(context.job_id)).toThrow("smc_curator_fetch_receipt_immutable");
  db.query("DELETE FROM smc_curator_fetch_receipts WHERE job_id = ?").run(context.job_id);
  expect(fetchCuratorRecord(db, request)).toMatchObject({
    kind: "rejected", code: "curator_action_charge_invalid",
  });
  expect(db.query("SELECT count(*) AS n FROM smc_curator_action_charges").get()).toEqual({ n: 1 });
  expect(db.query("SELECT count(*) AS n FROM smc_curator_fetch_receipts").get()).toEqual({ n: 0 });
});

test("fetch receipt replays across attempt recovery without recharging", () => {
  const context = runningAnchor();
  const request = {
    ...recordIdentity(context), record_kind: "memory" as const, stable_id: "memory-base",
    expected_revision: baseRevision(context.job_id), max_encoded_bytes: 100_000,
  };
  const first = fetchCuratorRecord(db, request);
  expect(first).toMatchObject({ kind: "record" });
  db.query("UPDATE session_memory_anchor_attempts SET status = 'failed' WHERE id = ?").run(context.attempt_id);
  const recoveredEpoch = context.owner_epoch + 1;
  db.query("UPDATE session_memory_anchor_jobs SET owner_epoch = ? WHERE job_id = ?").run(recoveredEpoch, context.job_id);
  db.query("UPDATE project_session_mutation_fences SET owner_epoch = ? WHERE owner_id = ?").run(recoveredEpoch, context.job_id);
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status,
       details_json, created_at, updated_at)
     VALUES ('attempt-record-recovered', ?, 2, ?, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(context.job_id, recoveredEpoch, SMC_TEST_NOW, SMC_TEST_NOW);
  expect(fetchCuratorRecord(db, {
    ...request, attempt_id: "attempt-record-recovered", owner_epoch: recoveredEpoch,
  })).toEqual(first);
  expect(db.query("SELECT count(*) AS n FROM smc_curator_action_charges").get()).toEqual({ n: 1 });
  expect(db.query("SELECT count(*) AS n FROM smc_curator_fetch_receipts").get()).toEqual({ n: 1 });
});

test("fetch replay rejects a changed materialized result", () => {
  const context = runningAnchor();
  const request = {
    ...recordIdentity(context), record_kind: "memory" as const, stable_id: "memory-base",
    expected_revision: baseRevision(context.job_id), max_encoded_bytes: 100_000,
  };
  expect(fetchCuratorRecord(db, request)).toMatchObject({ kind: "record" });
  db.query("UPDATE smc_memory_snapshot SET summary = 'changed after receipt' WHERE job_id = ? AND memory_id = 'memory-base'")
    .run(context.job_id);
  expect(fetchCuratorRecord(db, request)).toMatchObject({
    kind: "rejected", code: "curator_action_charge_conflict",
  });
});

test("fetches staged memory by overlay revision and hides a masked base record", async () => {
  const context = runningAnchor();
  await completeSMCTestCoverage(db, recordIdentity(context), fixedTransport());
  const base = readCuratorAffectedWorkSet(db, { job_id: context.job_id, work_batch_id: context.work_batch_id })
    .find((member) => member.stable_id === "memory-base")!;
  const proposal = buildSMCTestProposal(db, {
    identity: recordIdentity(context),
    staged_operations: [{
      record_kind: "memory",
      stable_key: "replacement",
      operation: "upsert",
      value: {
        id: "replacement",
        memory_kind: "decision",
        title: "Replacement",
        summary: "Replacement summary",
        payload: { decision: "new" },
        source_event_refs: ["evt-1"],
        confidence: "high",
        risk: "low",
      },
    }],
    memory_dispositions: [{
      memory_id: base.stable_id,
      revision_identity: base.revision_identity,
      disposition: "supersede",
      replacement_memory_id: "replacement",
      relationship: "supersedes",
      reason: "replacement",
      source_event_refs: ["evt-1"],
    }],
  });
  const applied = await stageSMCTestProposal(db, {
    identity: recordIdentity(context),
    proposal,
    document_contract: context.document_contract,
    embedding_transport: fixedTransport(),
    created_at: SMC_TEST_NOW,
  });
  if (applied.kind !== "accepted") throw new Error(JSON.stringify(applied));
  const overlay = readSMCOverlayIdentity(db, context.job_id)!;
  const staged = db.query(
    "SELECT staged_id FROM smc_overlay_records WHERE job_id = ? AND record_kind = 'memory'",
  ).get(context.job_id) as { staged_id: string };
  const stagedPayload = db.query("SELECT payload_digest FROM smc_overlay_records WHERE staged_id = ?")
    .get(staged.staged_id) as { payload_digest: string };
  const stagedResult = fetchCuratorRecord(db, {
    ...recordIdentity(context),
    overlay_revision: 1,
    record_kind: "memory",
    stable_id: staged.staged_id,
    expected_revision: {
      origin: "overlay",
      overlay_revision: 1,
      overlay_digest: overlay.digest,
      payload_digest: stagedPayload.payload_digest,
    },
    max_encoded_bytes: 100_000,
  });
  expect(stagedResult).toMatchObject({
    kind: "record",
    record: { stable_id: staged.staged_id, memory: { summary: "Replacement summary" } },
  });
  expect(fetchCuratorRecord(db, {
    ...recordIdentity(context),
    overlay_revision: 1,
    record_kind: "memory",
    stable_id: "memory-base",
    expected_revision: { origin: "base", revision: 1, state_digest: "masked" },
    max_encoded_bytes: 100_000,
  })).toMatchObject({ kind: "rejected", code: "curator_record_not_found" });
});

test("audit membership can fetch a frozen base masked by an earlier evidence batch", async () => {
  const context = runningAnchor({}, { includeAudit: true });
  await completeSMCTestCoverage(db, recordIdentity(context), fixedTransport());
  const base = readCuratorAffectedWorkSet(db, { job_id: context.job_id, work_batch_id: context.work_batch_id })
    .find((member) => member.stable_id === "memory-base")!;
  const proposal = buildSMCTestProposal(db, {
    identity: recordIdentity(context),
    staged_operations: [{
      record_kind: "memory",
      stable_key: "replacement",
      operation: "upsert",
      value: {
        id: "replacement",
        memory_kind: "decision",
        title: "Replacement",
        summary: "Replacement summary",
        payload: { decision: "new" },
        source_event_refs: ["evt-1"],
        confidence: "high",
        risk: "low",
      },
    }],
    memory_dispositions: [{
      memory_id: base.stable_id,
      revision_identity: base.revision_identity,
      disposition: "supersede",
      replacement_memory_id: "replacement",
      relationship: "supersedes",
      reason: "replacement",
      source_event_refs: ["evt-1"],
    }],
  });
  const applied = await stageSMCTestProposal(db, {
    identity: recordIdentity(context),
    proposal,
    document_contract: context.document_contract,
    embedding_transport: fixedTransport(),
    created_at: SMC_TEST_NOW,
  });
  if (applied.kind !== "accepted") throw new Error(JSON.stringify(applied));
  const auditBatch = db.query(
    "SELECT batch_id FROM smc_work_batches WHERE job_id = ? AND work_kind = 'audit'",
  ).get(context.job_id) as { batch_id: string };
  const result = fetchCuratorRecord(db, {
    ...recordIdentity(context),
    work_batch_id: auditBatch.batch_id,
    overlay_revision: 1,
    record_kind: "memory",
    stable_id: "memory-base",
    expected_revision: baseRevision(context.job_id),
    max_encoded_bytes: 100_000,
  });

  expect(result).toMatchObject({
    kind: "record",
    record: {
      stable_id: "memory-base",
      current_overlay_disposition: { disposition: "supersede", replacement_memory_id: "replacement" },
    },
  });
});

test("record fetch fails closed on stale overlay and frozen byte bounds", () => {
  const context = runningAnchor();
  expect(fetchCuratorRecord(db, {
    ...recordIdentity(context),
    overlay_revision: 1,
    record_kind: "memory",
    stable_id: "memory-base",
    expected_revision: { origin: "base", revision: 1, state_digest: "stale" },
    max_encoded_bytes: 100_000,
  })).toMatchObject({ kind: "rejected", code: "curator_identity_mismatch" });
  expect(fetchCuratorRecord(db, {
    ...recordIdentity(context),
    record_kind: "memory",
    stable_id: "memory-base",
    expected_revision: baseRevision(context.job_id),
    max_encoded_bytes: 1,
  })).toMatchObject({ kind: "rejected", code: "curator_record_too_large" });
});

test("record fetch requires the discriminator-specific immutable identity", () => {
  const context = runningAnchor();
  const missingRevision = {
    ...recordIdentity(context), record_kind: "memory", stable_id: "memory-base", max_encoded_bytes: 100_000,
  } as unknown as CuratorRecordRequest;
  expect(fetchCuratorRecord(db, missingRevision)).toMatchObject({
    kind: "rejected", code: "curator_record_request_invalid", reason: "memory fetch requires expected_revision",
  });
  const missingHash = {
    ...recordIdentity(context), record_kind: "source", stable_id: "evt-1", max_encoded_bytes: 100_000,
  } as unknown as CuratorRecordRequest;
  expect(fetchCuratorRecord(db, missingHash)).toMatchObject({
    kind: "rejected", code: "curator_record_request_invalid", reason: "source fetch requires expected_source_hash",
  });
});

test("provider and cumulative grants extend authoritative fetch budgets", () => {
  const context = runningAnchor({ max_provider_envelope_bytes: 700, max_cumulative_returned_result_bytes: 1 });
  const request = {
    ...recordIdentity(context), record_kind: "memory" as const, stable_id: "memory-base",
    expected_revision: baseRevision(context.job_id), max_encoded_bytes: 100_000,
  };
  expect(fetchCuratorRecord(db, request)).toMatchObject({ kind: "rejected", code: "curator_record_too_large" });
  grant(context, "max_provider_envelope_bytes", 100_000, "provider-grant");
  expect(fetchCuratorRecord(db, request)).toMatchObject({ kind: "rejected", code: "curator_budget_exceeded" });
  grant(context, "max_cumulative_returned_result_bytes", 100_000, "cumulative-grant");
  expect(fetchCuratorRecord(db, request)).toMatchObject({ kind: "record" });
});

test("job-wide returned bytes combine provider-visible fetch charges", () => {
  const context = runningAnchor();
  const memory = fetchCuratorRecord(db, {
    ...recordIdentity(context), record_kind: "memory", stable_id: "memory-base",
    expected_revision: baseRevision(context.job_id), max_encoded_bytes: 100_000,
  });
  if (memory.kind !== "record") throw new Error(JSON.stringify(memory));
  const manifest = readSMCManifest(db, context.job_id)!;
  const fillerBytes = manifest.workflow_budgets.max_cumulative_returned_result_bytes - memory.encoded_bytes;
  db.transaction(() => recordCuratorActionChargeInOpenTransaction(db, manifest, {
    job_id: context.job_id, action_key: `curator_action_${sha("fetch-filler-action").slice(7)}`, action_kind: "fetch_record",
    request_digest: sha("fetch-filler-request"), result_digest: sha("fetch-filler-result"),
    query_count: 0, result_bytes: fillerBytes, manifest_digest: context.manifest_digest, created_at: SMC_TEST_NOW,
  })).immediate();
  const sourceHash = (db.query("SELECT content_hash FROM smc_evidence_snapshot WHERE job_id = ? AND source_id = 'evt-1'")
    .get(context.job_id) as { content_hash: string }).content_hash;
  expect(fetchCuratorRecord(db, {
    ...recordIdentity(context), record_kind: "source", stable_id: "evt-1",
    expected_source_hash: sourceHash, max_encoded_bytes: 100_000,
  })).toMatchObject({ kind: "rejected", code: "curator_budget_exceeded" });
  expect(db.query("SELECT count(*) AS n FROM smc_curator_action_charges").get()).toEqual({ n: 2 });
});

function runningAnchor(
  overrides: Partial<typeof SMC_TEST_WORKFLOW_BUDGETS> = {},
  options: { includeAudit?: boolean } = {},
) {
  const documentContract = configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-base", summary: "Frozen base summary" });
  seedEvidence(db, "evt-1", "Durable source evidence");
  activateSMCAuthority(db);
  const prepared = prepareWithWorkflowBudgets(db, planEvidence(db, "job-record-fetch", {
    includeAudit: options.includeAudit,
  }), {
    ...SMC_TEST_WORKFLOW_BUDGETS, ...overrides,
  });
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  db.query(
    `INSERT INTO smc_memory_snapshot_contexts
      (job_id, memory_id, ordinal, repo_path, git_branch, git_commit, git_worktree_id, source_event_ref)
     VALUES (?, 'memory-base', 0, '/repo', 'feature/smc', 'abc123', 'wt-1', 'context-memory-base')`,
  ).run(prepared.manifest.job_id);
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status,
       details_json, created_at, updated_at)
     VALUES ('attempt-record', ?, 1, ?, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(prepared.manifest.job_id, prepared.manifest.owner_epoch, SMC_TEST_NOW, SMC_TEST_NOW);
  const transition = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: prepared.manifest.owner_epoch,
    nextPhase: "running",
    now: SMC_TEST_NOW,
  });
  if (transition.kind !== "updated") throw new Error(JSON.stringify(transition));
  const batch = db.query("SELECT batch_id FROM smc_work_batches WHERE job_id = ? AND work_kind = 'evidence'")
    .get(prepared.manifest.job_id) as { batch_id: string };
  return {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    work_batch_id: batch.batch_id,
    attempt_id: "attempt-record",
    owner_epoch: prepared.manifest.owner_epoch,
    manifest_digest: prepared.manifest.manifest_digest,
    snapshot_token: prepared.manifest.snapshot_token,
    overlay_revision: 0,
    document_contract: { ...documentContract, purpose: "retrieval_document" as const },
  };
}

function fixedTransport(): EmbeddingTransport {
  return {
    async embed(request) {
      return { embedding: [0.1, 0.2, 0.3], model: request.contract.model, dimensions: request.contract.dimensions };
    },
  };
}

function recordIdentity(context: ReturnType<typeof runningAnchor>) {
  const { document_contract: _documentContract, ...identity } = context;
  return identity;
}

function baseRevision(jobId: string) {
  const row = db.query("SELECT revision, state_digest FROM smc_memory_snapshot WHERE job_id = ? AND memory_id = 'memory-base'")
    .get(jobId) as { revision: number; state_digest: string };
  return { origin: "base" as const, revision: row.revision, state_digest: row.state_digest };
}

function sha(value: string): `sha256:${string}` {
  return `sha256:${new Bun.CryptoHasher("sha256").update(value).digest("hex")}`;
}

function grant(
  context: ReturnType<typeof runningAnchor>,
  budgetName: "max_provider_envelope_bytes" | "max_cumulative_returned_result_bytes",
  amount: number,
  id: string,
) {
  return recordSMCBudgetGrant(db, {
    id, job_id: context.job_id, project_key: context.project_key, owner_epoch: context.owner_epoch,
    budget_name: budgetName, additive_amount: amount, operator_id: "operator", reason: id,
    manifest_digest: context.manifest_digest, created_at: SMC_TEST_NOW,
  });
}
