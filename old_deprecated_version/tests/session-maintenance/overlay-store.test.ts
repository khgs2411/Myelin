import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import type { EmbeddingTransport } from "../../src/memory/embedding-types.ts";
import type { ActiveEmbeddingContract } from "../../src/runtime/config.ts";
import { defaultSMCGoverningIdentities, planSessionMaintenanceEvidence } from "../../src/session-maintenance/evidence-selection.ts";
import { transitionSessionMemoryAnchorJob } from "../../src/session-maintenance/job-lifecycle.ts";
import {
  readSMCOverlayIdentity,
  reconstructSMCOverlay,
  stagedSMCRecordId,
} from "../../src/session-maintenance/overlay-store.ts";
import { readCuratorAffectedWorkSet } from "../../src/session-maintenance/curator-retrieval-service.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  prepareWithWorkflowBudgets,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_NOW,
  SMC_TEST_WORKFLOW_BUDGETS,
} from "../helpers/smc-preparation.ts";
import {
  buildSMCTestProposal,
  completeSMCTestCoverage,
  stageSMCTestProposal,
  type SMCTestBatchIdentity,
} from "../helpers/smc-proposal-stage.ts";

let db: MemoryDb;
let documentContract: ActiveEmbeddingContract;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  documentContract = { ...configureSMCTestContract(db), purpose: "retrieval_document" };
});

afterEach(() => db.close());

test("validated proposals advance overlay CAS with stable staged IDs and reconstruct every accepted revision", async () => {
  const context = prepareRunningAnchor();
  const firstIdentity = identity(context, 0, 0);
  await completeSMCTestCoverage(db, firstIdentity, fixedTransport());
  const base = readCuratorAffectedWorkSet(db, { job_id: context.job_id, work_batch_id: firstIdentity.work_batch_id })
    .find((member) => member.stable_id === "memory-base")!;
  const firstProposal = buildSMCTestProposal(db, {
    identity: firstIdentity,
    staged_operations: [{
      record_kind: "memory",
      operation: "upsert",
      stable_key: "proposal-1",
      value: memoryPayload("memory-final-1", "v1", ["evt-1"]),
    }],
    memory_dispositions: [{
      memory_id: base.stable_id,
      revision_identity: base.revision_identity,
      disposition: "supersede",
      replacement_memory_id: "memory-final-1",
      relationship: "supersedes",
      reason: "replacement staged",
      source_event_refs: ["evt-1"],
    }],
  });
  const first = await stage(context, firstIdentity, firstProposal, SMC_TEST_NOW);
  expect(first).toMatchObject({ kind: "accepted", overlay: { revision: 1 }, replayed: false });
  const stagedId = stagedSMCRecordId(context.job_id, "memory", "proposal-1");
  expect(reconstructSMCOverlay(db, { job_id: context.job_id, revision: 1 }).records)
    .toEqual(expect.arrayContaining([expect.objectContaining({ staged_id: stagedId, final_id: "memory-final-1", payload: memoryPayload("memory-final-1", "v1", ["evt-1"]) })]));

  const staleIdentity = identity(context, 1, 0);
  const staleProposal = buildSMCTestProposal(db, { identity: staleIdentity });
  expect(await stage(context, staleIdentity, staleProposal, SMC_TEST_NOW)).toMatchObject({
    kind: "rejected",
    code: "proposal_validation_failed",
    issues: expect.arrayContaining([expect.objectContaining({ code: "proposal_overlay_revision_stale" })]),
  });

  const secondIdentity = identity(context, 1, 1);
  await completeSMCTestCoverage(db, secondIdentity, fixedTransport());
  const secondProposal = buildSMCTestProposal(db, {
    identity: secondIdentity,
    staged_operations: [{
      record_kind: "memory",
      operation: "upsert",
      stable_key: "proposal-1",
      value: memoryPayload("memory-final-1", "v2", ["evt-2", "evt-1"]),
    }],
  });
  const second = await stage(context, secondIdentity, secondProposal, "2026-08-11T12:01:00.000Z");
  expect(second).toMatchObject({ kind: "accepted", overlay: { revision: 2 } });
  expect(reconstructSMCOverlay(db, { job_id: context.job_id, revision: 1 }).records)
    .toEqual(expect.arrayContaining([expect.objectContaining({ staged_id: stagedId, payload: memoryPayload("memory-final-1", "v1", ["evt-1"]) })]));
  expect(reconstructSMCOverlay(db, { job_id: context.job_id, revision: 2 }).records)
    .toEqual(expect.arrayContaining([expect.objectContaining({
      staged_id: stagedId,
      final_id: "memory-final-1",
      payload: memoryPayload("memory-final-1", "v2", ["evt-1", "evt-2"]),
    })]));
});

test("exact proposal replay returns the accepted revision and changed response fails closed", async () => {
  const context = prepareRunningAnchor();
  const batchIdentity = identity(context, 0, 0);
  await completeSMCTestCoverage(db, batchIdentity, fixedTransport());
  const proposal = buildSMCTestProposal(db, {
    identity: batchIdentity,
    staged_operations: [{
      record_kind: "candidate",
      operation: "upsert",
      stable_key: "candidate-1",
      value: candidatePayload("candidate-1", "evt-1"),
    }],
    terminal_summary: "original response",
  });
  expect(await stage(context, batchIdentity, proposal, SMC_TEST_NOW)).toMatchObject({ kind: "accepted", replayed: false });
  expect(await stage(context, batchIdentity, proposal, SMC_TEST_NOW)).toMatchObject({ kind: "accepted", replayed: true, overlay: { revision: 1 } });
  const changed = { ...proposal, terminal_summary: "different response" };
  expect(await stage(context, batchIdentity, changed, SMC_TEST_NOW))
    .toEqual({ kind: "rejected", code: "overlay_batch_conflict" });
});

test("raw unvalidated deltas have no public staging path", async () => {
  const context = prepareRunningAnchor();
  const module = await import("../../src/session-maintenance/overlay-store.ts");
  expect(Object.hasOwn(module, "applySMCOverlayDelta")).toBe(false);
  const batchIdentity = identity(context, 0, 0);
  await completeSMCTestCoverage(db, batchIdentity, fixedTransport());
  expect(await stage(context, batchIdentity, { schema_version: 1, unknown_delta: [] }, SMC_TEST_NOW)).toMatchObject({
    kind: "rejected",
    code: "proposal_validation_failed",
    issues: expect.arrayContaining([expect.objectContaining({ code: "proposal_contract_invalid" })]),
  });
  expect(readSMCOverlayIdentity(db, context.job_id)).toMatchObject({ revision: 0 });
});

test("reconstruction rejects a same-length mutation of persisted overlay vector bytes", async () => {
  const context = prepareRunningAnchor();
  const batchIdentity = identity(context, 0, 0);
  await completeSMCTestCoverage(db, batchIdentity, fixedTransport());
  const proposal = buildSMCTestProposal(db, {
    identity: batchIdentity,
    staged_operations: [{
      record_kind: "memory",
      operation: "upsert",
      stable_key: "vector-tamper",
      value: memoryPayload("memory-vector", "vector tamper", ["evt-1"]),
    }],
  });
  expect(await stage(context, batchIdentity, proposal, SMC_TEST_NOW)).toMatchObject({ kind: "accepted" });
  const row = db.query("SELECT vector_bytes FROM smc_overlay_search_indexes WHERE job_id = ?")
    .get(context.job_id) as { vector_bytes: Uint8Array };
  const tampered = new Uint8Array(row.vector_bytes);
  tampered[0] = tampered[0]! ^ 1;
  db.query("UPDATE smc_overlay_search_indexes SET vector_bytes = ? WHERE job_id = ?")
    .run(tampered, context.job_id);
  expect(tampered.byteLength).toBe(row.vector_bytes.byteLength);
  expect(() => reconstructSMCOverlay(db, { job_id: context.job_id }))
    .toThrow("SMC overlay vector digest mismatch");
});

test("a memory-bearing lost response replays or conflicts before embedding", async () => {
  const context = prepareRunningAnchor();
  const batchIdentity = identity(context, 0, 0);
  await completeSMCTestCoverage(db, batchIdentity, fixedTransport());
  const proposal = buildSMCTestProposal(db, {
    identity: batchIdentity,
    staged_operations: [{
      record_kind: "memory",
      operation: "upsert",
      stable_key: "lost-response-memory",
      value: memoryPayload("lost-response-memory-final", "lost response", ["evt-1"]),
    }],
  });
  await expect(stageSMCTestProposal(db, {
    identity: batchIdentity,
    proposal,
    document_contract: documentContract,
    embedding_transport: fixedTransport(),
    created_at: SMC_TEST_NOW,
    failure_injection: { afterCommitBeforeReturn: () => { throw new Error("lost overlay response"); } },
  })).rejects.toThrow("lost overlay response");
  expect(readSMCOverlayIdentity(db, context.job_id)).toMatchObject({ revision: 1 });

  let replayEmbeddingCalls = 0;
  const throwingReplayTransport: EmbeddingTransport = {
    async embed() {
      replayEmbeddingCalls += 1;
      throw new Error("replay must not request an embedding");
    },
  };
  expect(await stageSMCTestProposal(db, {
    identity: batchIdentity,
    proposal,
    document_contract: documentContract,
    embedding_transport: throwingReplayTransport,
    created_at: SMC_TEST_NOW,
  })).toMatchObject({ kind: "accepted", replayed: true, overlay: { revision: 1 } });
  expect(replayEmbeddingCalls).toBe(0);

  const changedProposal = {
    ...proposal,
    staged_operations: proposal.staged_operations.map((operation) => operation.record_kind === "memory"
      && operation.operation === "upsert"
      ? {
        ...operation,
        value: {
          ...operation.value,
          title: "changed after acceptance",
          summary: "changed after acceptance",
        },
      }
      : operation),
  };
  let conflictEmbeddingCalls = 0;
  const differentConflictTransport: EmbeddingTransport = {
    async embed(request) {
      conflictEmbeddingCalls += 1;
      return {
        embedding: [0.9, 0.8, 0.7],
        model: request.contract.model,
        dimensions: request.contract.dimensions,
      };
    },
  };
  expect(await stageSMCTestProposal(db, {
    identity: batchIdentity,
    proposal: changedProposal,
    document_contract: documentContract,
    embedding_transport: differentConflictTransport,
    created_at: SMC_TEST_NOW,
  })).toEqual({ kind: "rejected", code: "overlay_batch_conflict" });
  expect(conflictEmbeddingCalls).toBe(0);
});

test("revision chain rejects replacement of an accepted response digest", async () => {
  const context = prepareRunningAnchor();
  const batchIdentity = identity(context, 0, 0);
  await completeSMCTestCoverage(db, batchIdentity, fixedTransport());
  const proposal = buildSMCTestProposal(db, { identity: batchIdentity });
  expect(await stage(context, batchIdentity, proposal, SMC_TEST_NOW)).toMatchObject({ kind: "accepted", overlay: { revision: 1 } });
  db.query("UPDATE smc_overlay_revisions SET response_digest = ? WHERE job_id = ? AND revision = 1")
    .run(`sha256:${"1".repeat(64)}`, context.job_id);
  expect(() => reconstructSMCOverlay(db, { job_id: context.job_id })).toThrow("SMC overlay digest mismatch");
  expect(await stage(context, batchIdentity, proposal, SMC_TEST_NOW)).toEqual({ kind: "rejected", code: "overlay_identity_mismatch" });
});

function prepareRunningAnchor() {
  seedIndexedMemory(db, { id: "memory-base" });
  seedEvidence(db, "evt-1");
  seedEvidence(db, "evt-2");
  activateSMCAuthority(db);
  const planned = planSessionMaintenanceEvidence(db, {
    anchor_job_id: "job-overlay",
    project_key: "demo",
    trigger_reason: "manual",
    governing_identities: defaultSMCGoverningIdentities({ provider: "codex", model: "gpt-test", reasoning_effort: "medium" }),
    budgets: { max_items_per_batch: 1, max_encoded_bytes_per_batch: 100_000, max_encoded_bytes_per_item: 100_000 },
  });
  if (planned.kind !== "planned") throw new Error(JSON.stringify(planned));
  const prepared = prepareWithWorkflowBudgets(db, planned.plan, {
    ...SMC_TEST_WORKFLOW_BUDGETS,
    max_queries: 100,
    max_cumulative_returned_result_bytes: 2_000_000,
  });
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  db.query(
    `INSERT INTO smc_memory_snapshot_contexts
      (job_id, memory_id, ordinal, repo_path, git_branch, git_commit, git_worktree_id, source_event_ref)
     VALUES (?, 'memory-base', 0, '/repo', 'feature/smc', 'abc123', 'wt-1', 'context-memory-base')`,
  ).run(prepared.manifest.job_id);
  insertRunningAttempt(prepared.manifest.job_id, prepared.manifest.owner_epoch);
  const transition = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: prepared.manifest.owner_epoch,
    nextPhase: "running",
    now: SMC_TEST_NOW,
  });
  if (transition.kind !== "updated") throw new Error(JSON.stringify(transition));
  const batches = db.query("SELECT batch_id FROM smc_work_batches WHERE job_id = ? ORDER BY ordinal")
    .all(prepared.manifest.job_id) as Array<{ batch_id: string }>;
  return {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    attempt_id: "attempt-overlay",
    owner_epoch: prepared.manifest.owner_epoch,
    manifest_digest: prepared.manifest.manifest_digest,
    snapshot_token: prepared.manifest.snapshot_token,
    batch_ids: batches.map((row) => row.batch_id),
  };
}

function identity(context: ReturnType<typeof prepareRunningAnchor>, batchIndex: number, overlayRevision: number): SMCTestBatchIdentity {
  return {
    job_id: context.job_id,
    project_key: context.project_key,
    work_batch_id: context.batch_ids[batchIndex]!,
    attempt_id: context.attempt_id,
    owner_epoch: context.owner_epoch,
    manifest_digest: context.manifest_digest,
    snapshot_token: context.snapshot_token,
    overlay_revision: overlayRevision,
  };
}

async function stage(
  context: ReturnType<typeof prepareRunningAnchor>,
  batchIdentity: SMCTestBatchIdentity,
  proposal: unknown,
  createdAt: string,
) {
  return stageSMCTestProposal(db, {
    identity: batchIdentity,
    proposal,
    document_contract: documentContract,
    embedding_transport: fixedTransport(),
    created_at: createdAt,
  });
}

function insertRunningAttempt(jobId: string, ownerEpoch: number): void {
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status,
       details_json, created_at, updated_at)
     VALUES ('attempt-overlay', ?, 1, ?, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(jobId, ownerEpoch, SMC_TEST_NOW, SMC_TEST_NOW);
}

function memoryPayload(id: string, summary: string, sourceRefs: string[]) {
  return {
    id,
    source_event_refs: sourceRefs,
    memory_kind: "continuity" as const,
    title: summary,
    summary,
    payload: { status: "active" },
    confidence: "high",
    risk: "low",
  };
}

function candidatePayload(id: string, sourceId: string) {
  return {
    id,
    source_event_refs: [sourceId],
    scope: "project" as const,
    status: "pending" as const,
    candidate_type: "project.note",
    title: "Candidate",
    summary: "Candidate summary",
    evidence: { observed_facts: ["Observed"], relevant_paths: [], uncertainties: [] },
    proposed_payload: { durable_facts: ["Durable"], change_kind: "update", suggested_subjects: [], verification_needed: [] },
    confidence: "medium",
    risk: "low",
    reason: "Fixture candidate",
  };
}

function fixedTransport(): EmbeddingTransport {
  return { async embed(request) { return { embedding: [0.1, 0.2, 0.3], model: request.contract.model, dimensions: request.contract.dimensions }; } };
}
