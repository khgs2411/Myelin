import { afterEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import type { EmbeddingTransport } from "../../src/memory/embedding-types.ts";
import { defaultSMCGoverningIdentities, planSessionMaintenanceEvidence } from "../../src/session-maintenance/evidence-selection.ts";
import { transitionSessionMemoryAnchorJob } from "../../src/session-maintenance/job-lifecycle.ts";
import { stageSMCBatchProposal } from "../../src/session-maintenance/overlay-store.ts";
import { parseSMCBatchProposal } from "../../src/session-maintenance/proposal-contract.ts";
import { validateSMCBatchProposal } from "../../src/session-maintenance/proposal-validator.ts";
import { buildSessionMaintenanceProjection } from "../../src/session-maintenance/projection.ts";
import {
  evaluateCuratorBatchCoverage,
  prepareCuratorBatchChannelPlan,
  queryCuratorMemory,
  readCuratorAffectedWorkSet,
} from "../../src/session-maintenance/curator-retrieval-service.ts";
import type { CuratorQueryRequest } from "../../src/session-maintenance/curator-retrieval-types.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  prepare,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_NOW,
} from "../helpers/smc-preparation.ts";

const databases: MemoryDb[] = [];
afterEach(() => { while (databases.length > 0) databases.pop()!.close(); });

test("projection fold is deterministic across proposal ordering and remains noncanonical", async () => {
  const first = await acceptedProjection(false);
  const second = await acceptedProjection(true);
  expect(second.result.projection).toEqual(first.result.projection);
  expect(second.result.projection_digest).toBe(first.result.projection_digest);
  expect(first.result.projection.memory_dispositions.map((item) => item.memory_id)).toEqual(["memory-0", "memory-1"]);
  expect(first.result.projection.session_memories.map((item) => item.id)).toEqual(["memory-new"]);
  expect(first.db.query("SELECT count(*) AS n FROM session_memories").get()).toEqual({ n: 2 });
  expect(first.db.query("SELECT state FROM experience_event_tombstones").all()).toEqual([{ state: "claimed" }]);
});

test("projection rejects incomplete batches and stale overlay identity", async () => {
  const context = await runningAnchor();
  expect(() => buildSessionMaintenanceProjection(context.db, {
    job_id: context.job_id, project_key: context.project_key,
    manifest_digest: context.manifest_digest, snapshot_token: context.snapshot_token,
    overlay_revision: 0, overlay_digest: context.overlay_digest,
  })).toThrow("projection_batch_incomplete");
  const accepted = await stageProposal(context, false);
  expect(() => buildSessionMaintenanceProjection(context.db, {
    job_id: context.job_id, project_key: context.project_key,
    manifest_digest: context.manifest_digest, snapshot_token: context.snapshot_token,
    overlay_revision: accepted.overlay.revision, overlay_digest: `sha256:${"0".repeat(64)}`,
  })).toThrow("projection_overlay_stale");
  context.db.query("DELETE FROM smc_coverage_receipts WHERE job_id = ? AND receipt_kind = 'query'")
    .run(context.job_id);
  expect(() => buildSessionMaintenanceProjection(context.db, {
    job_id: context.job_id, project_key: context.project_key,
    manifest_digest: context.manifest_digest, snapshot_token: context.snapshot_token,
    overlay_revision: accepted.overlay.revision, overlay_digest: accepted.overlay.digest,
  })).toThrow("projection_historical_coverage_invalid");
});

test("projection preserves an explicit no-output source path", async () => {
  const context = await runningAnchor();
  const workSet = readCuratorAffectedWorkSet(context.db, { job_id: context.job_id, work_batch_id: context.batch_id });
  const proposal = parseSMCBatchProposal({
    schema_version: 1,
    work_batch_id: context.batch_id,
    expected_overlay_revision: 0,
    source_event_dispositions: [{ source_event_id: "evt-0", disposition: "no_output", reason: "not reusable" }],
    memory_dispositions: workSet.map((member) => ({
      memory_id: member.stable_id,
      revision_identity: member.revision_identity,
      disposition: "keep" as const,
      reason: "still current",
      source_event_refs: [],
    })),
    disposition_receipt_reuses: [],
    staged_operations: [],
    checked_output_refs: [],
    terminal_summary: "No durable output.",
  });
  const stageInput = {
    job_id: context.job_id,
    project_key: context.project_key,
    attempt_id: context.attempt_id,
    owner_epoch: context.owner_epoch,
    manifest_digest: context.manifest_digest,
    snapshot_token: context.snapshot_token,
    proposal,
    document_contract: context.document_contract,
    embedding_transport: fixedTransport(),
    created_at: SMC_TEST_NOW,
  };
  const accepted = await stageSMCBatchProposal(context.db, stageInput);
  if (accepted.kind !== "accepted") throw new Error(JSON.stringify(accepted));
  const result = buildSessionMaintenanceProjection(context.db, {
    job_id: context.job_id,
    project_key: context.project_key,
    manifest_digest: context.manifest_digest,
    snapshot_token: context.snapshot_token,
    overlay_revision: accepted.overlay.revision,
    overlay_digest: accepted.overlay.digest,
  });
  expect(result.projection.source_event_dispositions).toEqual([
    { source_event_id: "evt-0", disposition: "no_output", reason: "not reusable" },
  ]);
});

async function acceptedProjection(reverse: boolean) {
  const context = await runningAnchor();
  const accepted = await stageProposal(context, reverse);
  return {
    db: context.db,
    result: buildSessionMaintenanceProjection(context.db, {
      job_id: context.job_id, project_key: context.project_key,
      manifest_digest: context.manifest_digest, snapshot_token: context.snapshot_token,
      overlay_revision: accepted.overlay.revision, overlay_digest: accepted.overlay.digest,
    }),
  };
}

async function runningAnchor() {
  const db = openMemoryDbAt(":memory:"); databases.push(db);
  const documentContract = { ...configureSMCTestContract(db), purpose: "retrieval_document" as const };
  seedIndexedMemory(db, { id: "memory-0", summary: "Summary zero" });
  seedIndexedMemory(db, { id: "memory-1", summary: "Summary one" });
  seedEvidence(db, "evt-0", "Summary session_memories/memory-0 session_memories/memory-1");
  activateSMCAuthority(db);
  const planned = planSessionMaintenanceEvidence(db, {
    anchor_job_id: "job-projection", project_key: "demo", trigger_reason: "manual",
    governing_identities: defaultSMCGoverningIdentities({ provider: "codex", model: "gpt-test", reasoning_effort: "medium" }),
    budgets: { max_items_per_batch: 10, max_encoded_bytes_per_batch: 100_000, max_encoded_bytes_per_item: 100_000 },
  });
  if (planned.kind !== "planned") throw new Error(JSON.stringify(planned));
  const prepared = prepare(db, planned.plan);
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const insertContext = db.query(
    `INSERT INTO smc_memory_snapshot_contexts
      (job_id, memory_id, ordinal, repo_path, git_branch, git_commit, git_worktree_id, source_event_ref)
     VALUES (?, ?, 0, '/repo', 'feature/smc', 'abc123', 'wt-1', ?)`,
  );
  for (const memoryId of ["memory-0", "memory-1"]) {
    insertContext.run(prepared.manifest.job_id, memoryId, `context-${memoryId}`);
  }
  const attemptId = "attempt-projection";
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status, details_json, created_at, updated_at)
     VALUES (?, ?, 1, ?, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(attemptId, prepared.manifest.job_id, prepared.manifest.owner_epoch, SMC_TEST_NOW, SMC_TEST_NOW);
  const transitioned = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id, projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing", expectedOwnerEpoch: prepared.manifest.owner_epoch,
    nextPhase: "running", now: SMC_TEST_NOW,
  });
  if (transitioned.kind !== "updated") throw new Error(JSON.stringify(transitioned));
  const batch = db.query("SELECT batch_id FROM smc_work_batches WHERE job_id = ?").get(prepared.manifest.job_id) as { batch_id: string };
  const context = {
    db, document_contract: documentContract, job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key, attempt_id: attemptId,
    owner_epoch: prepared.manifest.owner_epoch, manifest_digest: prepared.manifest.manifest_digest,
    snapshot_token: prepared.manifest.snapshot_token, overlay_digest: prepared.manifest.current_overlay_identity.digest,
    batch_id: batch.batch_id,
  };
  await completeCoverage(context);
  return context;
}

async function completeCoverage(context: any) {
  for (let round = 0; round < 8; round += 1) {
    const plan = prepareCuratorBatchChannelPlan(context.db, identity(context));
    let stale = false;
    for (const obligation of plan.obligations) {
      const request = {
        ...identity(context), plan_revision: plan.plan_revision, plan_digest: plan.plan_digest,
        obligation_ids: [obligation.id],
        ...(obligation.kind === "text" ? { query_text: "Summary" } : {}),
        page_limit: 100,
      } satisfies CuratorQueryRequest;
      let result = await queryCuratorMemory(context.db, request, { embedding_transport: fixedTransport() });
      while (result.kind === "page" && result.next_cursor) {
        result = await queryCuratorMemory(context.db, { ...request, cursor: result.next_cursor }, { embedding_transport: fixedTransport() });
      }
      if (result.kind === "blocked" && result.code === "curator_channel_plan_stale") { stale = true; break; }
      if (result.kind !== "page") throw new Error(JSON.stringify(result));
    }
    if (stale) continue;
    if (evaluateCuratorBatchCoverage(context.db, identity(context)).complete) return;
  }
  throw new Error("coverage did not reach a fixed point");
}

async function stageProposal(context: any, reverse: boolean) {
  const workSet = readCuratorAffectedWorkSet(context.db, { job_id: context.job_id, work_batch_id: context.batch_id });
  const dispositions = workSet.map((member) => ({
    memory_id: member.stable_id, revision_identity: member.revision_identity,
    disposition: "keep" as const, reason: "still current", source_event_refs: [],
  }));
  const operations = [
    {
      record_kind: "memory" as const, operation: "upsert" as const, stable_key: "memory-new",
      value: {
        id: "memory-new", source_event_refs: ["evt-0"], memory_kind: "continuity" as const,
        title: "New memory", summary: "New durable summary", payload: { current: true }, confidence: "high", risk: "low",
      },
    },
  ];
  const proposal = parseSMCBatchProposal({
    schema_version: 1, work_batch_id: context.batch_id, expected_overlay_revision: 0,
    source_event_dispositions: [{
      source_event_id: "evt-0", disposition: "used", output_refs: ["session_memories/memory-new"], reason: "created",
    }],
    memory_dispositions: reverse ? [...dispositions].reverse() : dispositions,
    disposition_receipt_reuses: [],
    staged_operations: reverse ? [...operations].reverse() : operations,
    checked_output_refs: ["session_memories/memory-new"], terminal_summary: "Curated.",
  });
  const accepted = await stageSMCBatchProposal(context.db, {
    job_id: context.job_id, project_key: context.project_key, attempt_id: context.attempt_id,
    owner_epoch: context.owner_epoch, manifest_digest: context.manifest_digest,
    snapshot_token: context.snapshot_token, proposal,
    document_contract: context.document_contract,
    embedding_transport: fixedTransport(),
    created_at: SMC_TEST_NOW,
  });
  if (accepted.kind !== "accepted") throw new Error(JSON.stringify(accepted));
  return accepted;
}

function identity(context: any) {
  return {
    job_id: context.job_id, project_key: context.project_key, work_batch_id: context.batch_id,
    attempt_id: context.attempt_id, owner_epoch: context.owner_epoch,
    manifest_digest: context.manifest_digest, snapshot_token: context.snapshot_token,
    overlay_revision: 0,
  };
}

function fixedTransport(): EmbeddingTransport {
  return { async embed(request) { return { embedding: [0.1, 0.2, 0.3], model: request.contract.model, dimensions: request.contract.dimensions }; } };
}
