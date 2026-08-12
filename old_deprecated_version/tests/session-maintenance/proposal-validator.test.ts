import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import type { EmbeddingTransport } from "../../src/memory/embedding-types.ts";
import { stableJson } from "../../src/runtime/json.ts";
import { defaultSMCGoverningIdentities, planSessionMaintenanceEvidence } from "../../src/session-maintenance/evidence-selection.ts";
import { transitionSessionMemoryAnchorJob } from "../../src/session-maintenance/job-lifecycle.ts";
import { stageSMCBatchProposal } from "../../src/session-maintenance/overlay-store.ts";
import { parseSMCBatchProposal, type SMCBatchProposal } from "../../src/session-maintenance/proposal-contract.ts";
import { inspectSMCBatchProposal, validateSMCBatchProposal } from "../../src/session-maintenance/proposal-validator.ts";
import { buildSessionMaintenanceProjection } from "../../src/session-maintenance/projection.ts";
import {
  evaluateCuratorBatchCoverage,
  prepareCuratorBatchChannelPlan,
  queryCuratorMemory,
  readCuratorAffectedWorkSet,
} from "../../src/session-maintenance/curator-retrieval-service.ts";
import type { CuratorBatchChannelPlan } from "../../src/session-maintenance/curator-channel-plan.ts";
import type { CuratorQueryRequest } from "../../src/session-maintenance/curator-retrieval-types.ts";
import { fetchCuratorRecord } from "../../src/session-maintenance/curator-record-service.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  prepareWithWorkflowBudgets,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_NOW,
  SMC_TEST_WORKFLOW_BUDGETS,
} from "../helpers/smc-preparation.ts";

const databases: MemoryDb[] = [];
afterEach(() => { while (databases.length > 0) databases.pop()!.close(); });

test("strict proposal validation accepts exact selected-source and affected-work-set coverage without canonical writes", async () => {
  const context = await runningAnchor({ evidence_count: 1 });
  const proposal = proposalFor(context, context.batch_ids[0]!, 0);
  expect(codes(inspectSMCBatchProposal(context.db, validationInput(context, { ...proposal, unknown: true }))))
    .toContain("proposal_contract_invalid");
  const canonicalBefore = canonicalCounts(context.db);
  const receiptCountBefore = context.db.query("SELECT count(*) AS n FROM smc_coverage_receipts").get();
  const result = validateSMCBatchProposal(context.db, validationInput(context, proposal));
  expect(result).toMatchObject({ valid: true, expected_overlay_revision: 0 });
  expect(canonicalCounts(context.db)).toEqual(canonicalBefore);
  expect(context.db.query("SELECT count(*) AS n FROM smc_coverage_receipts").get()).toEqual(receiptCountBefore);

  expect(await stageSMCBatchProposal(context.db, {
    ...validationInput(context, proposal),
    attempt_id: context.attempt_id,
    owner_epoch: context.owner_epoch,
    document_contract: context.document_contract,
    embedding_transport: fixedTransport(),
    created_at: SMC_TEST_NOW,
  })).toMatchObject({ kind: "accepted", overlay: { revision: 1 } });
  expect(canonicalCounts(context.db)).toEqual(canonicalBefore);
});

test("validation rejects missing coverage, stale revisions, invalid references, collisions, and provenance gaps", async () => {
  const context = await runningAnchor({ evidence_count: 1 });
  const valid = proposalFor(context, context.batch_ids[0]!, 0);
  const missingSource = { ...valid, source_event_dispositions: [] };
  expect(codes(inspectSMCBatchProposal(context.db, validationInput(context, missingSource))))
    .toContain("missing_source_disposition");
  const missingMemory = { ...valid, memory_dispositions: [] };
  expect(codes(inspectSMCBatchProposal(context.db, validationInput(context, missingMemory))))
    .toContain("missing_memory_disposition");
  const stale = {
    ...valid,
    memory_dispositions: valid.memory_dispositions.map((item) => ({
      ...item,
      revision_identity: item.revision_identity.origin === "base"
        ? { ...item.revision_identity, revision: item.revision_identity.revision + 1 }
        : item.revision_identity,
    })),
  } as SMCBatchProposal;
  expect(codes(inspectSMCBatchProposal(context.db, validationInput(context, stale))))
    .toContain("memory_revision_mismatch");
  const badRef = {
    ...valid,
    source_event_dispositions: [{
      source_event_id: "evt-0", disposition: "used" as const,
      output_refs: ["session_memories/not-the-output"], reason: "bad ref",
    }],
    checked_output_refs: ["session_memories/not-the-output"],
  };
  expect(codes(inspectSMCBatchProposal(context.db, validationInput(context, badRef))))
    .toContain("output_reference_mismatch");
  const noProvenance = {
    ...valid,
    staged_operations: valid.staged_operations.map((operation) => operation.operation === "upsert"
      ? { ...operation, value: { ...operation.value, source_event_refs: ["evt-unselected"] } }
      : operation),
  } as SMCBatchProposal;
  expect(codes(inspectSMCBatchProposal(context.db, validationInput(context, noProvenance))))
    .toContain("output_provenance_missing");
  const collision = {
    ...valid,
    staged_operations: valid.staged_operations.map((operation) => operation.operation === "upsert"
      ? { ...operation, value: { ...operation.value, id: "memory-0" } }
      : operation),
    source_event_dispositions: [{
      source_event_id: "evt-0", disposition: "used" as const,
      output_refs: ["session_memories/memory-0"], reason: "collision",
    }],
    checked_output_refs: ["session_memories/memory-0"],
  } as SMCBatchProposal;
  expect(codes(inspectSMCBatchProposal(context.db, validationInput(context, collision))))
    .toContain("output_id_collision");
  context.db.query(
    "DELETE FROM smc_coverage_receipts WHERE job_id = ? AND work_batch_id = ? AND receipt_kind = 'query'",
  ).run(context.job_id, context.batch_ids[0]);
  expect(codes(inspectSMCBatchProposal(context.db, validationInput(context, valid))))
    .toContain("proposal_channel_coverage_incomplete");
});

test("audit proposals reject source dispositions and disposition receipt reuse", async () => {
  const context = await runningAnchor({ evidence_count: 1, include_audit: true });
  const auditBatchId = context.batch_ids[1]!;
  await completeCoverage(context, auditBatchId, 0);
  fetchAuditTargets(context, auditBatchId, 0);
  const valid = auditProposalFor(context, auditBatchId, 0);
  expect(validateSMCBatchProposal(context.db, validationInput(context, valid))).toMatchObject({ valid: true });

  const withSourceDisposition = parseSMCBatchProposal({
    ...valid,
    source_event_dispositions: [{
      source_event_id: "evt-0",
      disposition: "no_output",
      reason: "audit batches do not own evidence dispositions",
    }],
  });
  expect(codes(inspectSMCBatchProposal(context.db, validationInput(context, withSourceDisposition))))
    .toContain("source_outside_work_batch");

  const member = valid.memory_dispositions[0]!;
  const withReceiptReuse = parseSMCBatchProposal({
    ...valid,
    memory_dispositions: [],
    disposition_receipt_reuses: [{
      memory_id: member.memory_id,
      revision_identity: member.revision_identity,
      accepted_work_batch_id: context.batch_ids[0],
      accepted_overlay_revision: 1,
      accepted_overlay_digest: context.manifest.current_overlay_identity.digest,
      accepted_disposition_digest: sha("not-an-audit-receipt"),
      policy_identity: context.manifest.governing_identities.policy.digest,
      output_contract_identity: context.manifest.governing_identities.output_contract.digest,
      tool_protocol_identity: context.manifest.governing_identities.tool_protocol.digest,
      invocation_identity: context.manifest.governing_identities.invocation,
    }],
  });
  expect(codes(inspectSMCBatchProposal(context.db, validationInput(context, withReceiptReuse))))
    .toContain("disposition_receipt_reuse_invalid");
});

test("audit output provenance accepts inherited refs and rejects arbitrary historical refs", async () => {
  const context = await runningAnchor({ evidence_count: 1, include_audit: true });
  const auditBatchId = context.batch_ids[1]!;
  await completeCoverage(context, auditBatchId, 0);
  fetchAuditTargets(context, auditBatchId, 0);
  const valid = auditProposalFor(context, auditBatchId, 0, "inherited-source");
  expect(validateSMCBatchProposal(context.db, validationInput(context, valid))).toMatchObject({ valid: true });

  const arbitrary = parseSMCBatchProposal({
    ...valid,
    staged_operations: valid.staged_operations.map((operation) => operation.operation === "upsert"
      ? { ...operation, value: { ...operation.value, source_event_refs: ["historical-but-not-inherited"] } }
      : operation),
  });
  expect(codes(inspectSMCBatchProposal(context.db, validationInput(context, arbitrary))))
    .toEqual(expect.arrayContaining(["source_reference_outside_work_batch", "output_provenance_missing"]));
});

test("same-revision receipt reuse stays identity-bound across a multi-batch staged-memory revision", async () => {
  const context = await runningAnchor({ evidence_count: 2 });
  const first = proposalFor(context, context.batch_ids[0]!, 0);
  const validatedFirst = validateSMCBatchProposal(context.db, validationInput(context, first));
  await stage(context, validatedFirst);
  await completeCoverage(context, context.batch_ids[1]!, 1);
  const workSet = readCuratorAffectedWorkSet(context.db, { job_id: context.job_id, work_batch_id: context.batch_ids[1]! });
  expect(workSet.length).toBeGreaterThanOrEqual(2);
  const reusedMember = workSet.find((member) => member.stable_id === "memory-0")!;
  const directMembers = workSet.filter((member) => member.stable_id !== reusedMember.stable_id);
  expect(directMembers.some((member) => member.revision_identity.origin === "overlay"
    && member.revision_identity.overlay_revision === 1)).toBe(true);
  const dispositionRow = context.db.query(
    `SELECT r.payload_digest, v.overlay_digest
     FROM smc_overlay_records r JOIN smc_overlay_revisions v
       ON v.job_id = r.job_id AND v.revision = r.revision
     WHERE r.job_id = ? AND r.record_kind = 'memory_disposition'`,
  ).get(context.job_id) as { payload_digest: string; overlay_digest: string };
  const sourceId = "evt-1";
  const manifest = context.manifest;
  const checkedRefs = [`memory_dispositions/${reusedMember.stable_id}`, "session_memories/memory-new"];
  const second = parseSMCBatchProposal({
    schema_version: 1,
    work_batch_id: context.batch_ids[1],
    expected_overlay_revision: 1,
    source_event_dispositions: [{
      source_event_id: sourceId,
      disposition: "used",
      output_refs: checkedRefs,
      reason: "already represented by the checked memory revision",
    }],
    memory_dispositions: directMembers.map((member) => ({
      memory_id: member.stable_id,
      revision_identity: member.revision_identity,
      disposition: "keep",
      reason: "staged memory remains current",
      source_event_refs: [],
    })),
    disposition_receipt_reuses: [{
      memory_id: reusedMember.stable_id,
      revision_identity: reusedMember.revision_identity,
      accepted_work_batch_id: context.batch_ids[0],
      accepted_overlay_revision: 1,
      accepted_overlay_digest: dispositionRow.overlay_digest,
      accepted_disposition_digest: dispositionRow.payload_digest,
      policy_identity: manifest.governing_identities.policy.digest,
      output_contract_identity: manifest.governing_identities.output_contract.digest,
      tool_protocol_identity: manifest.governing_identities.tool_protocol.digest,
      invocation_identity: manifest.governing_identities.invocation,
    }],
    staged_operations: [{
      record_kind: "memory",
      operation: "upsert",
      stable_key: "memory-new",
      value: {
        id: "memory-new",
        source_event_refs: [sourceId, "evt-0"],
        memory_kind: "continuity",
        title: "New memory revised",
        summary: "New durable summary revised by the second batch",
        payload: { state: "current", revision: 2 },
        confidence: "high",
        risk: "low",
      },
    }],
    checked_output_refs: checkedRefs,
    terminal_summary: "Second batch was already represented.",
  });
  const tampered = {
    ...second,
    disposition_receipt_reuses: second.disposition_receipt_reuses.map((item) => ({ ...item, accepted_disposition_digest: sha("wrong") })),
  } as SMCBatchProposal;
  expect(codes(inspectSMCBatchProposal(context.db, validationInput(context, tampered))))
    .toContain("disposition_receipt_reuse_invalid");
  const validatedSecond = validateSMCBatchProposal(context.db, validationInput(context, second));
  const acceptedSecond = await stage(context, validatedSecond);
  const projection = buildSessionMaintenanceProjection(context.db, {
    job_id: context.job_id,
    project_key: context.project_key,
    manifest_digest: context.manifest_digest,
    snapshot_token: context.snapshot_token,
    overlay_revision: acceptedSecond.overlay.revision,
    overlay_digest: acceptedSecond.overlay.digest,
  });
  expect(projection.projection.source_event_dispositions).toContainEqual({
    source_event_id: sourceId,
    disposition: "used",
    output_refs: checkedRefs,
    reason: "already represented by the checked memory revision",
  });
  expect(projection.projection.session_memories).toContainEqual(expect.objectContaining({
    id: "memory-new",
    source_event_refs: ["evt-0", sourceId],
    summary: "New durable summary revised by the second batch",
  }));
});

test("prospective closure rejects a referenced discard and accepts lifecycle replacement by retained staged memory", async () => {
  const context = await runningAnchor({ evidence_count: 2 });
  const first = validateSMCBatchProposal(context.db, validationInput(context, proposalFor(context, context.batch_ids[0]!, 0)));
  await stage(context, first);
  await completeCoverage(context, context.batch_ids[1]!, 1);
  const workSet = readCuratorAffectedWorkSet(context.db, { job_id: context.job_id, work_batch_id: context.batch_ids[1]! });
  const keep = workSet.map((member) => ({
    memory_id: member.stable_id,
    revision_identity: member.revision_identity,
    disposition: "keep" as const,
    reason: "unchanged",
    source_event_refs: [],
  }));
  const discard = parseSMCBatchProposal({
    schema_version: 1,
    work_batch_id: context.batch_ids[1],
    expected_overlay_revision: 1,
    source_event_dispositions: [{ source_event_id: "evt-1", disposition: "no_output", reason: "no output" }],
    memory_dispositions: keep,
    disposition_receipt_reuses: [],
    staged_operations: [{ record_kind: "memory", operation: "discard", stable_key: "memory-new" }],
    checked_output_refs: [],
    terminal_summary: "Discard attempted.",
  });
  expect(codes(inspectSMCBatchProposal(context.db, validationInput(context, discard))))
    .toContain("output_reference_invalid");

  const base = workSet.find((member) => member.stable_id === "memory-0")!;
  const retainedReplacement = parseSMCBatchProposal({
    schema_version: 1,
    work_batch_id: context.batch_ids[1],
    expected_overlay_revision: 1,
    source_event_dispositions: [{
      source_event_id: "evt-1",
      disposition: "used",
      output_refs: ["memory_dispositions/memory-0"],
      reason: "superseded by retained staged memory",
    }],
    memory_dispositions: workSet.map((member) => member.stable_id === base.stable_id ? {
      memory_id: member.stable_id,
      revision_identity: member.revision_identity,
      disposition: "supersede" as const,
      replacement_memory_id: "memory-new",
      relationship: "supersedes" as const,
      reason: "retained staged replacement",
      source_event_refs: ["evt-1"],
    } : {
      memory_id: member.stable_id,
      revision_identity: member.revision_identity,
      disposition: "keep" as const,
      reason: "unchanged",
      source_event_refs: [],
    }),
    disposition_receipt_reuses: [],
    staged_operations: [],
    checked_output_refs: ["memory_dispositions/memory-0"],
    terminal_summary: "Retained replacement accepted.",
  });
  expect(await stage(context, validateSMCBatchProposal(context.db, validationInput(context, retainedReplacement))))
    .toMatchObject({ kind: "accepted", overlay: { revision: 2 } });
});

test("stage revalidates after indexing and refuses coverage changed before CAS", async () => {
  const context = await runningAnchor({ evidence_count: 1 });
  const proposal = proposalFor(context, context.batch_ids[0]!, 0);
  let mutated = false;
  const result = await stageSMCBatchProposal(context.db, {
    ...validationInput(context, proposal),
    document_contract: context.document_contract,
    embedding_transport: {
      async embed(request) {
        if (!mutated) {
          mutated = true;
          context.db.query("DELETE FROM smc_coverage_receipts WHERE job_id = ? AND receipt_kind = 'query'")
            .run(context.job_id);
        }
        return { embedding: [0.1, 0.2, 0.3], model: request.contract.model, dimensions: request.contract.dimensions };
      },
    },
    created_at: SMC_TEST_NOW,
  });
  expect(result).toMatchObject({
    kind: "rejected",
    code: "proposal_validation_failed",
    issues: expect.arrayContaining([expect.objectContaining({ code: "proposal_channel_coverage_incomplete" })]),
  });
  expect(context.db.query("SELECT current_revision FROM smc_overlay_state WHERE job_id = ?").get(context.job_id))
    .toEqual({ current_revision: 0 });
});

test("nested set ordering yields identical response, delta, overlay, and projection digests", async () => {
  const forward = await canonicalOutcome(false);
  const reversed = await canonicalOutcome(true);
  expect(reversed).toEqual(forward);
});

async function canonicalOutcome(reverse: boolean) {
  const context = await runningAnchor({ evidence_count: 2, max_items_per_batch: 2 });
  const workBatchId = context.batch_ids[0]!;
  const workSet = readCuratorAffectedWorkSet(context.db, { job_id: context.job_id, work_batch_id: workBatchId });
  const sourceRefs = reverse ? ["evt-1", "evt-0"] : ["evt-0", "evt-1"];
  const proposal = {
    schema_version: 1,
    work_batch_id: workBatchId,
    expected_overlay_revision: 0,
    source_event_dispositions: sourceRefs.map((sourceId) => ({
      source_event_id: sourceId,
      disposition: "used",
      output_refs: ["session_memories/memory-canonical"],
      reason: "canonical output",
    })),
    memory_dispositions: (reverse ? [...workSet].reverse() : workSet).map((member) => ({
      memory_id: member.stable_id,
      revision_identity: member.revision_identity,
      disposition: "keep",
      reason: "unchanged",
      source_event_refs: [],
    })),
    disposition_receipt_reuses: [],
    staged_operations: [{
      record_kind: "memory",
      operation: "upsert",
      stable_key: "memory-canonical",
      value: {
        id: "memory-canonical",
        source_event_refs: sourceRefs,
        memory_kind: "continuity",
        title: "Canonical",
        summary: "Canonical nested set ordering",
        payload: { state: "current" },
        confidence: "high",
        risk: "low",
      },
    }],
    checked_output_refs: ["session_memories/memory-canonical"],
    terminal_summary: "Canonicalized.",
  };
  const validation = validateSMCBatchProposal(context.db, validationInput(context, proposal));
  const accepted = await stage(context, validation);
  const projection = buildSessionMaintenanceProjection(context.db, {
    job_id: context.job_id,
    project_key: context.project_key,
    manifest_digest: context.manifest_digest,
    snapshot_token: context.snapshot_token,
    overlay_revision: accepted.overlay.revision,
    overlay_digest: accepted.overlay.digest,
  });
  return {
    response_digest: validation.response_digest,
    delta_digest: validation.delta_digest,
    overlay_digest: accepted.overlay.digest,
    projection_digest: projection.projection_digest,
  };
}

async function runningAnchor(input: { evidence_count: number; max_items_per_batch?: number; include_audit?: boolean }) {
  const db = openMemoryDbAt(":memory:"); databases.push(db);
  const documentContract = { ...configureSMCTestContract(db), purpose: "retrieval_document" as const };
  seedIndexedMemory(db, {
    id: "memory-0",
    summary: "Summary memory",
    source_event_refs: input.include_audit ? ["inherited-source"] : [],
  });
  for (let index = 0; index < input.evidence_count; index += 1) {
    seedEvidence(db, `evt-${index}`, `Summary evidence ${index} session_memories/memory-0`);
  }
  activateSMCAuthority(db);
  const planned = planSessionMaintenanceEvidence(db, {
    anchor_job_id: "job-proposal",
    project_key: "demo",
    trigger_reason: "manual",
    governing_identities: defaultSMCGoverningIdentities({ provider: "codex", model: "gpt-test", reasoning_effort: "medium" }),
    budgets: { max_items_per_batch: input.max_items_per_batch ?? 1, max_encoded_bytes_per_batch: 100_000, max_encoded_bytes_per_item: 100_000 },
    include_audit: input.include_audit,
    audit_partition_limit: input.include_audit ? 10 : undefined,
  });
  if (planned.kind !== "planned") throw new Error(JSON.stringify(planned));
  const prepared = prepareWithWorkflowBudgets(db, planned.plan, {
    ...SMC_TEST_WORKFLOW_BUDGETS,
    max_queries: input.evidence_count > 1 ? 100 : SMC_TEST_WORKFLOW_BUDGETS.max_queries,
  });
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  db.query(
    `INSERT INTO smc_memory_snapshot_contexts
      (job_id, memory_id, ordinal, repo_path, git_branch, git_commit, git_worktree_id, source_event_ref)
     VALUES (?, 'memory-0', 0, '/repo', 'feature/smc', 'abc123', 'wt-1', 'context-memory-0')`,
  ).run(prepared.manifest.job_id);
  const attemptId = "attempt-proposal";
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status, details_json, created_at, updated_at)
     VALUES (?, ?, 1, ?, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(attemptId, prepared.manifest.job_id, prepared.manifest.owner_epoch, SMC_TEST_NOW, SMC_TEST_NOW);
  const transition = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: prepared.manifest.owner_epoch,
    nextPhase: "running",
    now: SMC_TEST_NOW,
  });
  if (transition.kind !== "updated") throw new Error(JSON.stringify(transition));
  const batchIds = (db.query("SELECT batch_id FROM smc_work_batches WHERE job_id = ? ORDER BY ordinal")
    .all(prepared.manifest.job_id) as Array<{ batch_id: string }>).map((row) => row.batch_id);
  const context = {
    db, job_id: prepared.manifest.job_id, project_key: prepared.manifest.project_key,
    attempt_id: attemptId, owner_epoch: prepared.manifest.owner_epoch,
    manifest_digest: prepared.manifest.manifest_digest, snapshot_token: prepared.manifest.snapshot_token,
    manifest: prepared.manifest, batch_ids: batchIds, document_contract: documentContract,
  };
  await completeCoverage(context, batchIds[0]!, 0);
  return context;
}

async function completeCoverage(context: Awaited<ReturnType<typeof runningAnchor>> | any, workBatchId: string, overlayRevision: number) {
  for (let round = 0; round < 8; round += 1) {
    const plan = prepareCuratorBatchChannelPlan(context.db, identity(context, workBatchId, overlayRevision));
    let stale = false;
    for (const obligation of plan.obligations) {
      if (!await exhaust(context, workBatchId, overlayRevision, plan, obligation.id)) { stale = true; break; }
    }
    if (stale) continue;
    const coverage = evaluateCuratorBatchCoverage(context.db, identity(context, workBatchId, overlayRevision));
    if (coverage.complete) return;
  }
  throw new Error("coverage did not reach a fixed point");
}

async function exhaust(context: any, workBatchId: string, overlayRevision: number, plan: CuratorBatchChannelPlan, obligationId: string): Promise<boolean> {
  const obligation = plan.obligations.find((item) => item.id === obligationId)!;
  const base = {
    ...identity(context, workBatchId, overlayRevision),
    plan_revision: plan.plan_revision,
    plan_digest: plan.plan_digest,
    obligation_ids: [obligationId],
    ...(obligation.kind === "text" ? { query_text: String(obligation.selector.source_id ?? "Summary") } : {}),
    page_limit: 100,
  } satisfies CuratorQueryRequest;
  let result = await queryCuratorMemory(context.db, base, { embedding_transport: fixedTransport() });
  while (result.kind === "page" && result.next_cursor) {
    result = await queryCuratorMemory(context.db, { ...base, cursor: result.next_cursor }, { embedding_transport: fixedTransport() });
  }
  if (result.kind === "blocked" && result.code === "curator_channel_plan_stale") return false;
  if (result.kind !== "page") throw new Error(JSON.stringify(result));
  return true;
}

function proposalFor(context: any, workBatchId: string, overlayRevision: number): SMCBatchProposal {
  const sourceId = context.db.query(
    "SELECT source_id FROM smc_evidence_batch_members WHERE job_id = ? AND batch_id = ?",
  ).get(context.job_id, workBatchId) as { source_id: string };
  const workSet = readCuratorAffectedWorkSet(context.db, { job_id: context.job_id, work_batch_id: workBatchId });
  return parseSMCBatchProposal({
    schema_version: 1,
    work_batch_id: workBatchId,
    expected_overlay_revision: overlayRevision,
    source_event_dispositions: [{
      source_event_id: sourceId.source_id, disposition: "used",
      output_refs: ["session_memories/memory-new"], reason: "created durable memory",
    }],
    memory_dispositions: workSet.map((member) => ({
      memory_id: member.stable_id, revision_identity: member.revision_identity,
      disposition: "keep", reason: "still current", source_event_refs: [],
    })),
    disposition_receipt_reuses: [],
    staged_operations: [{
      record_kind: "memory", operation: "upsert", stable_key: "memory-new",
      value: {
        id: "memory-new", source_event_refs: [sourceId.source_id], memory_kind: "continuity",
        title: "New memory", summary: "New durable summary", payload: { state: "current" },
        confidence: "high", risk: "low",
      },
    }],
    checked_output_refs: ["session_memories/memory-new"],
    terminal_summary: "Batch curated.",
  });
}

function auditProposalFor(
  context: any,
  workBatchId: string,
  overlayRevision: number,
  inheritedSourceRef?: string,
): SMCBatchProposal {
  const workSet = readCuratorAffectedWorkSet(context.db, { job_id: context.job_id, work_batch_id: workBatchId });
  return parseSMCBatchProposal({
    schema_version: 1,
    work_batch_id: workBatchId,
    expected_overlay_revision: overlayRevision,
    source_event_dispositions: [],
    memory_dispositions: workSet.map((member) => ({
      memory_id: member.stable_id,
      revision_identity: member.revision_identity,
      disposition: "keep",
      reason: "audit confirmed current state",
      source_event_refs: [],
    })),
    disposition_receipt_reuses: [],
    staged_operations: inheritedSourceRef ? [{
      record_kind: "memory",
      operation: "upsert",
      stable_key: "audit-derived",
      value: {
        id: "audit-derived",
        source_event_refs: [inheritedSourceRef],
        memory_kind: "continuity",
        title: "Audit-derived memory",
        summary: "Derived only from frozen inherited provenance",
        payload: { audited: true },
        confidence: "high",
        risk: "low",
      },
    }] : [],
    checked_output_refs: [],
    terminal_summary: "Audit batch curated.",
  });
}

function fetchAuditTargets(context: any, workBatchId: string, overlayRevision: number): void {
  const members = readCuratorAffectedWorkSet(context.db, { job_id: context.job_id, work_batch_id: workBatchId });
  for (const member of members) {
    if (member.revision_identity.origin !== "base") throw new Error("expected frozen audit base revision");
    const result = fetchCuratorRecord(context.db, {
      ...identity(context, workBatchId, overlayRevision),
      record_kind: "memory",
      stable_id: member.stable_id,
      expected_revision: member.revision_identity,
      max_encoded_bytes: 100_000,
    });
    if (result.kind !== "record") throw new Error(JSON.stringify(result));
  }
}

async function stage(context: any, validation: ReturnType<typeof validateSMCBatchProposal>) {
  const result = await stageSMCBatchProposal(context.db, {
    ...validationInput(context, validation.proposal),
    document_contract: context.document_contract,
    embedding_transport: fixedTransport(),
    created_at: SMC_TEST_NOW,
  });
  if (result.kind !== "accepted") throw new Error(JSON.stringify(result));
  return result;
}

function identity(context: any, workBatchId: string, overlayRevision: number) {
  return {
    job_id: context.job_id, project_key: context.project_key, work_batch_id: workBatchId,
    attempt_id: context.attempt_id, owner_epoch: context.owner_epoch,
    manifest_digest: context.manifest_digest, snapshot_token: context.snapshot_token,
    overlay_revision: overlayRevision,
  };
}

function validationInput(context: any, proposal: unknown) {
  return {
    job_id: context.job_id, project_key: context.project_key, attempt_id: context.attempt_id,
    owner_epoch: context.owner_epoch, manifest_digest: context.manifest_digest,
    snapshot_token: context.snapshot_token, proposal,
  };
}

function canonicalCounts(db: MemoryDb) {
  return {
    memories: db.query("SELECT count(*) AS n FROM session_memories").get(),
    candidates: db.query("SELECT count(*) AS n FROM memory_candidates").get(),
    tombstones: db.query("SELECT state, count(*) AS n FROM experience_event_tombstones GROUP BY state ORDER BY state").all(),
  };
}

function codes(result: ReturnType<typeof inspectSMCBatchProposal>): string[] {
  return result.valid ? [] : result.issues.map((item) => item.code);
}

function fixedTransport(): EmbeddingTransport {
  return { async embed(request) { return { embedding: [0.1, 0.2, 0.3], model: request.contract.model, dimensions: request.contract.dimensions }; } };
}

function sha(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
