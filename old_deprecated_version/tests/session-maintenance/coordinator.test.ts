import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import type { EmbeddingTransport } from "../../src/memory/embedding-types.ts";
import type { SMCTurnInvoker } from "../../src/agents/smc-adapter.ts";
import type { ActiveEmbeddingContract } from "../../src/runtime/config.ts";
import { stableJson } from "../../src/runtime/json.ts";
import { runSMCCoordinator } from "../../src/session-maintenance/coordinator.ts";
import { persistJournaledSMCActionResult } from "../../src/session-maintenance/action-journal.ts";
import { recordSMCBudgetGrant } from "../../src/session-maintenance/coverage-receipts.ts";
import { defaultSMCGoverningIdentities, planSessionMaintenanceEvidence } from "../../src/session-maintenance/evidence-selection.ts";
import { transitionSessionMemoryAnchorJob } from "../../src/session-maintenance/job-lifecycle.ts";
import { finalizeSessionMaintenance } from "../../src/session-maintenance/finalization-service.ts";
import { parseSMCBatchProposal } from "../../src/session-maintenance/proposal-contract.ts";
import { readCuratorAffectedWorkSet } from "../../src/session-maintenance/curator-retrieval-service.ts";
import { SMCResultSchema, SMC_TOOL_PROTOCOL_VERSION, type SMCActionIdentity } from "../../src/session-maintenance/protocol.ts";
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
setDefaultTimeout(20_000);
afterEach(() => { while (databases.length > 0) databases.pop()!.close(); });

test("coordinator completes a prepared batch through strict journaled query/proposal turns without canonical writes", async () => {
  const context = runningAnchor({ job_id: "job-coordinator" });
  const prompts: string[] = [];
  const invoke = scriptedCurator(context, prompts);
  const before = canonicalCounts(context.db);
  const result = await runSMCCoordinator(context.db, coordinatorInput(context, invoke));
  expect(result.kind).toBe("accepted_projection");
  if (result.kind !== "accepted_projection") throw new Error(JSON.stringify(result));
  expect(result.projection.projection.source_event_dispositions).toEqual([
    { source_event_id: "evt-0", disposition: "no_output", reason: "no reusable change" },
  ]);
  expect(canonicalCounts(context.db)).toEqual(before);
  expect(context.db.query("SELECT state FROM experience_event_tombstones WHERE ingest_job_id = ?")
    .all(context.job_id)).toEqual([{ state: "claimed" }]);
  expect(context.db.query("SELECT count(*) AS n FROM smc_action_journal WHERE job_id = ?")
    .get(context.job_id)).toEqual({ n: prompts.length + 1 });
  expect(context.db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?")
    .get(context.job_id)).toEqual({ phase: "running" });
  expect(prompts.every((prompt) => Buffer.byteLength(prompt, "utf8") <= SMC_TEST_WORKFLOW_BUDGETS.max_provider_envelope_bytes))
    .toBeTrue();
  const coverageProgress = prompts.map((prompt) => envelope(prompt).progress.current_batch.coverage);
  expect(coverageProgress[0]).toMatchObject({ complete: false });
  expect(coverageProgress.at(-1)).toMatchObject({ complete: true, missing_count: 0 });
});

test("invalid provider actions are journaled as validation results and cannot dispatch capabilities", async () => {
  const context = runningAnchor({ job_id: "job-invalid-action" });
  const valid = scriptedCurator(context, []);
  let first = true;
  const result = await runSMCCoordinator(context.db, coordinatorInput(context, async (request) => {
    if (first) {
      first = false;
      return {
        action: { action: "arbitrary_sql", sql: "DELETE FROM session_memories" },
        invocation: request.resolvedInvocation,
        tokens_consumed: { input_chars: request.prompt.length, output_chars: 1, is_estimate: true },
      };
    }
    return valid(request);
  }));
  if (result.kind !== "accepted_projection") throw new Error(JSON.stringify(result));
  expect(result.kind).toBe("accepted_projection");
  const firstRow = context.db.query(
    "SELECT action_kind, result_json FROM smc_action_journal WHERE job_id = ? AND action_kind = 'blocker' ORDER BY rowid LIMIT 1",
  ).get(context.job_id) as { action_kind: string; result_json: string };
  expect(firstRow.action_kind).toBe("blocker");
  expect(JSON.parse(firstRow.result_json)).toMatchObject({
    result_kind: "action_validation_failed",
    code: "action_validation_failed",
  });
  expect(canonicalCounts(context.db)).toEqual({ memories: 1, candidates: 0 });
});

test("digest-valid journal rows with schema-invalid fetch payloads fail integrity before provider dispatch", async () => {
  const context = runningAnchor({ job_id: "job-invalid-fetch-journal" });
  const batch = context.db.query(
    "SELECT batch_id FROM smc_work_batches WHERE job_id = ? ORDER BY ordinal LIMIT 1",
  ).get(context.job_id) as { batch_id: string };
  const source = context.db.query(
    "SELECT source_id, content_hash FROM smc_evidence_snapshot WHERE job_id = ? ORDER BY ordinal LIMIT 1",
  ).get(context.job_id) as { source_id: string; content_hash: string };
  const action = {
    protocol_version: SMC_TOOL_PROTOCOL_VERSION,
    job_id: context.job_id,
    project_key: context.project_key,
    work_batch_id: batch.batch_id,
    attempt_id: context.attempt_id,
    sequence: 0,
    owner_epoch: context.owner_epoch,
    manifest_digest: context.manifest_digest,
    snapshot_token: context.snapshot_token,
    expected_overlay_revision: 0,
    action: "fetch_record" as const,
    request: {
      record_kind: "source" as const,
      stable_id: source.source_id,
      expected_source_hash: source.content_hash,
      max_encoded_bytes: 10_000,
    },
  };
  const {
    action: _actionKind,
    request: _actionRequest,
    ...actionIdentity
  } = action;
  expect(persistJournaledSMCActionResult(context.db, {
    ...actionIdentity,
    action_kind: "fetch_record",
    request: action,
    result: {
      ...actionIdentity,
      result_kind: "fetch_record_result",
      result: {
        kind: "record",
        record: {
          kind: "source",
          stable_id: source.source_id,
          ordinal: 0,
          tombstone_id: "tombstone-invalid",
          content_hash: source.content_hash,
          encoded_bytes: 1,
          evidence: { malformed: true },
        },
        encoded_bytes: 1,
      },
    },
    created_at: SMC_TEST_NOW,
  }).kind).toBe("executed");
  const durable = context.db.query(
    "SELECT result_json, result_digest FROM smc_action_journal WHERE job_id = ? AND sequence = 0",
  ).get(context.job_id) as { result_json: string; result_digest: string };
  expect(durable.result_json).toBe(stableJson(JSON.parse(durable.result_json)));
  expect(durable.result_digest).toBe(
    `sha256:${createHash("sha256").update(durable.result_json, "utf8").digest("hex")}`,
  );

  let dispatched = false;
  const result = await runSMCCoordinator(context.db, coordinatorInput(context, async () => {
    dispatched = true;
    throw new Error("provider must not be invoked for invalid durable journal state");
  }));
  expect(result).toEqual({
    kind: "rejected",
    code: "coordinator_journal_rejected",
    reason: "journal_integrity_mismatch",
  });
  expect(dispatched).toBeFalse();
});

test("provider interruption is journaled and moves the same anchor to resumable needs_followup", async () => {
  const context = runningAnchor({ job_id: "job-provider-interrupt" });
  const result = await runSMCCoordinator(context.db, coordinatorInput(context, async () => {
    throw new Error("provider temporarily unavailable");
  }));
  expect(result).toMatchObject({
    kind: "needs_followup",
    code: "provider_transport_error",
    retryable: true,
    owner_epoch: context.owner_epoch + 1,
  });
  expect(context.db.query("SELECT phase, reason_code FROM session_memory_anchor_jobs WHERE job_id = ?")
    .get(context.job_id)).toEqual({ phase: "needs_followup", reason_code: "provider_transport_error" });
  const journal = context.db.query("SELECT action_kind, result_json FROM smc_action_journal WHERE job_id = ? ORDER BY rowid DESC LIMIT 1")
    .get(context.job_id) as { action_kind: string; result_json: string };
  expect(journal.action_kind).toBe("blocker");
  expect(JSON.parse(journal.result_json)).toMatchObject({ result_kind: "coordinator_failure", retryable: true });
});

test("accepted overlay and submit result are atomic across a lost response", async () => {
  const context = runningAnchor({ job_id: "job-lost-accepted-response" });
  await expect(runSMCCoordinator(context.db, {
    ...coordinatorInput(context, scriptedCurator(context, [])),
    failure_injection: {
      after_accepted_proposal_commit_before_return: () => { throw new Error("lost accepted response"); },
    },
  })).rejects.toThrow("lost accepted response");
  expect(context.db.query("SELECT count(*) AS n FROM smc_overlay_revisions WHERE job_id = ?")
    .get(context.job_id)).toEqual({ n: 1 });
  expect(context.db.query(
    "SELECT count(*) AS n FROM smc_action_journal WHERE job_id = ? AND action_kind = 'submit_proposal'",
  ).get(context.job_id)).toEqual({ n: 1 });

  let invoked = false;
  const recovered = await runSMCCoordinator(context.db, coordinatorInput(context, async () => {
    invoked = true;
    throw new Error("accepted work must reconstruct without another provider turn");
  }));
  expect(recovered.kind).toBe("accepted_projection");
  expect(invoked).toBeFalse();
});

test("query receipt, charge, and journal result are atomic across a lost response", async () => {
  const context = runningAnchor({ job_id: "job-lost-query-response" });
  let failOnce = true;
  await expect(runSMCCoordinator(context.db, {
    ...coordinatorInput(context, scriptedCurator(context, [])),
    failure_injection: {
      after_query_commit_before_return: () => {
        if (!failOnce) return;
        failOnce = false;
        throw new Error("lost query response");
      },
    },
  })).rejects.toThrow("lost query response");
  expect(context.db.query(
    "SELECT count(*) AS n FROM smc_coverage_receipts WHERE job_id = ? AND receipt_kind = 'query'",
  ).get(context.job_id)).toEqual({ n: 1 });
  expect(context.db.query(
    "SELECT count(*) AS n FROM smc_curator_action_charges WHERE job_id = ? AND action_kind = 'query'",
  ).get(context.job_id)).toEqual({ n: 1 });
  expect(context.db.query(
    "SELECT count(*) AS n FROM smc_action_journal WHERE job_id = ? AND action_kind = 'query'",
  ).get(context.job_id)).toEqual({ n: 1 });

  const recovered = await runSMCCoordinator(
    context.db,
    coordinatorInput(context, scriptedCurator(context, [])),
  );
  expect(recovered.kind).toBe("accepted_projection");
});

test("fetch receipt, charge, and journal result are atomic across a lost response", async () => {
  const context = runningAnchor({ job_id: "job-lost-fetch-response", max_turns: 30 });
  let failOnce = true;
  await expect(runSMCCoordinator(context.db, {
    ...coordinatorInput(context, scriptedCurator(context, [], { fetch_source_before_proposal: true })),
    failure_injection: {
      after_fetch_commit_before_return: () => {
        if (!failOnce) return;
        failOnce = false;
        throw new Error("lost fetch response");
      },
    },
  })).rejects.toThrow("lost fetch response");
  expect(context.db.query(
    "SELECT count(*) AS n FROM smc_curator_fetch_receipts WHERE job_id = ?",
  ).get(context.job_id)).toEqual({ n: 1 });
  expect(context.db.query(
    "SELECT count(*) AS n FROM smc_curator_action_charges WHERE job_id = ? AND action_kind = 'fetch_record'",
  ).get(context.job_id)).toEqual({ n: 1 });
  expect(context.db.query(
    "SELECT count(*) AS n FROM smc_action_journal WHERE job_id = ? AND action_kind = 'fetch_record'",
  ).get(context.job_id)).toEqual({ n: 1 });

  const recovered = await runSMCCoordinator(
    context.db,
    coordinatorInput(context, scriptedCurator(context, [], { fetch_source_before_proposal: true })),
  );
  if (recovered.kind !== "accepted_projection") throw new Error(JSON.stringify(recovered));
  expect(recovered.kind).toBe("accepted_projection");
});

test("runtime turn reserve requires an explicit additive grant and a higher-epoch attempt resumes", async () => {
  const context = runningAnchor({ job_id: "job-budget-resume", max_turns: 2 });
  let invalidOnce = true;
  const valid = scriptedCurator(context, []);
  const first = await runSMCCoordinator(context.db, coordinatorInput(context, async (request) => {
    if (!invalidOnce) return valid(request);
    invalidOnce = false;
    return {
      action: { action: "invalid" },
      invocation: request.resolvedInvocation,
      tokens_consumed: { input_chars: request.prompt.length, output_chars: 1, is_estimate: true },
    };
  }));
  expect(first).toMatchObject({ kind: "needs_followup", code: "budget_exhausted" });
  if (first.kind !== "needs_followup") throw new Error(JSON.stringify(first));
  recordSMCBudgetGrant(context.db, {
    id: "grant-turns",
    job_id: context.job_id,
    project_key: context.project_key,
    owner_epoch: first.owner_epoch,
    budget_name: "max_turns",
    additive_amount: 20,
    operator_id: "operator-test",
    reason: "complete bounded curator work",
    manifest_digest: context.manifest_digest,
    created_at: "2026-08-11T12:01:00.000Z",
  });
  const resumed = transitionSessionMemoryAnchorJob(context.db, {
    jobId: context.job_id,
    projectKey: context.project_key,
    expectedPhase: "needs_followup",
    expectedOwnerEpoch: first.owner_epoch,
    nextPhase: "running",
    now: "2026-08-11T12:02:00.000Z",
    reasonCode: null,
    resumeAttempt: { id: "attempt-resumed", provider: "codex" },
  });
  if (resumed.kind !== "updated") throw new Error(JSON.stringify(resumed));
  const resumedContext = {
    ...context,
    attempt_id: "attempt-resumed",
    owner_epoch: resumed.anchor.owner_epoch,
  };
  const result = await runSMCCoordinator(
    context.db,
    coordinatorInput(resumedContext, scriptedCurator(resumedContext, [])),
  );
  if (result.kind !== "accepted_projection") throw new Error(JSON.stringify(result));
  expect(result.kind).toBe("accepted_projection");
  expect(context.db.query("SELECT count(*) AS n FROM smc_budget_grants WHERE job_id = ?")
    .get(context.job_id)).toEqual({ n: 1 });
  expect(context.db.query("SELECT count(DISTINCT attempt_id) AS n FROM smc_action_journal WHERE job_id = ?")
    .get(context.job_id)).toEqual({ n: 2 });
});

test("coordinator-owned envelope failures do not consume provider turns", async () => {
  const context = runningAnchor({ job_id: "job-envelope-turn-accounting", max_turns: 2 });
  const batch = context.db.query(
    "SELECT batch_id FROM smc_work_batches WHERE job_id = ? ORDER BY ordinal LIMIT 1",
  ).get(context.job_id) as { batch_id: string };
  const identity = {
    protocol_version: SMC_TOOL_PROTOCOL_VERSION,
    job_id: context.job_id,
    project_key: context.project_key,
    work_batch_id: batch.batch_id,
    attempt_id: context.attempt_id,
    sequence: 0,
    owner_epoch: context.owner_epoch,
    manifest_digest: context.manifest_digest,
    snapshot_token: context.snapshot_token,
    expected_overlay_revision: 0,
  } satisfies SMCActionIdentity;
  const stored = persistJournaledSMCActionResult(context.db, {
    ...identity,
    action_kind: "blocker",
    request: { envelope_error: "provider_envelope_budget_exceeded" },
    result: SMCResultSchema.parse({
      ...identity,
      result_kind: "coordinator_failure",
      code: "provider_envelope_budget_exceeded",
      retryable: true,
      reason: "coordinator-owned pre-provider failure",
    }),
    created_at: SMC_TEST_NOW,
  });
  if (stored.kind === "rejected") throw new Error(stored.code);

  const result = await runSMCCoordinator(
    context.db,
    coordinatorInput(context, scriptedCurator(context, [])),
  );
  if (result.kind !== "accepted_projection") throw new Error(JSON.stringify(result));
  expect(result.kind).toBe("accepted_projection");
});

test("3,219 active memories complete through a 10-target audit partition without corpus serialization", async () => {
  const db = openMemoryDbAt(":memory:"); databases.push(db);
  configureSMCTestContract(db);
  for (let index = 0; index < 3_219; index += 1) {
    seedIndexedMemory(db, { id: `memory-${index}`, summary: `Independent summary ${index}` });
  }
  seedEvidence(db, "evt-scale", "A bounded evidence item");
  const context = runningAnchorFromSeededDb(db, {
    job_id: "job-scale",
    evidence_id: "evt-scale",
    include_audit: true,
    audit_partition_limit: 10,
    workflow: { ...SMC_TEST_WORKFLOW_BUDGETS, max_affected_work_set_size: 4_000, max_turns: 20 },
  });
  const prompts: string[] = [];
  const result = await runSMCCoordinator(context.db, coordinatorInput(
    context,
    scriptedCurator(context, prompts),
  ));
  expect(result.kind).toBe("accepted_projection");
  if (result.kind !== "accepted_projection") throw new Error(JSON.stringify(result));
  expect(prompts).toHaveLength(13);
  const phases = prompts.map((prompt) => envelope(prompt).progress.current_batch.phase);
  expect(phases.filter((phase) => phase === "audit_fetch")).toHaveLength(10);
  expect(new Set(prompts.flatMap((prompt) => {
    const required = envelope(prompt).progress.current_batch.required_action;
    return required ? [required.memory_id] : [];
  })).size).toBe(10);
  expect(prompts.every((prompt) => Buffer.byteLength(prompt, "utf8") <= SMC_TEST_WORKFLOW_BUDGETS.max_provider_envelope_bytes))
    .toBeTrue();
  expect(prompts.every((prompt) => !prompt.includes("memory-3218"))).toBeTrue();
  expect(prompts.every((prompt) => !prompt.includes("smc_memory_snapshot"))).toBeTrue();
  const finalized = await finalizeSessionMaintenance(context.db, {
    jobId: context.job_id,
    ownerEpoch: context.owner_epoch,
    acceptedProjectionDigest: result.projection.projection_digest,
    now: () => new Date(SMC_TEST_NOW),
  });
  expect(finalized.kind).toBe("finalized");
  expect(context.db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?")
    .get(context.job_id)).toEqual({ phase: "completed" });
  expect(context.db.query("SELECT receipt_kind FROM smc_terminal_receipts WHERE job_id = ?")
    .get(context.job_id)).toEqual({ receipt_kind: "finalization" });
  expect(context.db.query("SELECT project_key FROM project_session_mutation_fences WHERE project_key = 'demo'")
    .get()).toBeNull();
  expect(context.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(context.db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
});

test("audit-fetch phase journals insufficient_evidence as invalid and advances through the exact required fetch", async () => {
  const db = openMemoryDbAt(":memory:"); databases.push(db);
  configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-audit" });
  seedEvidence(db, "evt-audit", "bounded audit evidence");
  const context = runningAnchorFromSeededDb(db, {
    job_id: "job-audit-required-action",
    evidence_id: "evt-audit",
    include_audit: true,
    audit_partition_limit: 1,
    workflow: SMC_TEST_WORKFLOW_BUDGETS,
  });
  const prompts: string[] = [];
  const valid = scriptedCurator(context, prompts);
  let sentInvalidBlocker = false;
  const result = await runSMCCoordinator(context.db, coordinatorInput(context, async (request) => {
    const parsed = envelope(request.prompt);
    if (parsed.progress.current_batch.phase === "audit_fetch" && !sentInvalidBlocker) {
      sentInvalidBlocker = true;
      prompts.push(request.prompt);
      return {
        action: {
          ...parsed.authoritative.action_identity,
          action: "blocker",
          request: {
            code: "insufficient_evidence",
            retryable: true,
            explanation: "record has not been fetched",
          },
        },
        invocation: request.resolvedInvocation,
        tokens_consumed: { input_chars: request.prompt.length, output_chars: 1, is_estimate: true },
      };
    }
    return valid(request);
  }));
  expect(result.kind).toBe("accepted_projection");
  expect(sentInvalidBlocker).toBeTrue();
  expect(context.db.query(
    `SELECT count(*) AS n FROM smc_action_journal
     WHERE job_id = ? AND json_extract(result_json, '$.result_kind') = 'action_validation_failed'`,
  ).get(context.job_id)).toEqual({ n: 1 });
});

type TestContext = ReturnType<typeof runningAnchor>;

function runningAnchor(input: { job_id: string; max_turns?: number }): ReturnType<typeof runningAnchorFromSeededDb> {
  const db = openMemoryDbAt(":memory:"); databases.push(db);
  configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-0", summary: "Current session summary" });
  seedEvidence(db, "evt-0", "Review current session behavior session_memories/memory-0");
  return runningAnchorFromSeededDb(db, {
    job_id: input.job_id,
    evidence_id: "evt-0",
    workflow: { ...SMC_TEST_WORKFLOW_BUDGETS, ...(input.max_turns === undefined ? {} : { max_turns: input.max_turns }) },
  });
}

function runningAnchorFromSeededDb(
  db: MemoryDb,
  input: {
    job_id: string;
    evidence_id: string;
    workflow: typeof SMC_TEST_WORKFLOW_BUDGETS;
    include_audit?: boolean;
    audit_partition_limit?: number;
  },
) {
  activateSMCAuthority(db);
  const planned = planSessionMaintenanceEvidence(db, {
    anchor_job_id: input.job_id,
    project_key: "demo",
    trigger_reason: "manual",
    include_audit: input.include_audit,
    audit_partition_limit: input.audit_partition_limit,
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
  const prepared = prepareWithWorkflowBudgets(db, planned.plan, input.workflow);
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const attemptId = `attempt-${input.job_id}`;
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status, details_json, created_at, updated_at)
     VALUES (?, ?, 1, ?, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(attemptId, prepared.manifest.job_id, prepared.manifest.owner_epoch, SMC_TEST_NOW, SMC_TEST_NOW);
  const transitioned = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: prepared.manifest.owner_epoch,
    nextPhase: "running",
    now: SMC_TEST_NOW,
  });
  if (transitioned.kind !== "updated") throw new Error(JSON.stringify(transitioned));
  const documentContract: ActiveEmbeddingContract = {
    provider: prepared.manifest.embedding_provider as ActiveEmbeddingContract["provider"],
    model: prepared.manifest.embedding_model,
    dimensions: prepared.manifest.embedding_dimensions,
    purpose: "retrieval_document",
    formatVersion: prepared.manifest.embedding_format_version,
  };
  return {
    db,
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    attempt_id: attemptId,
    owner_epoch: prepared.manifest.owner_epoch,
    manifest_digest: prepared.manifest.manifest_digest,
    snapshot_token: prepared.manifest.snapshot_token,
    document_contract: documentContract,
    evidence_id: input.evidence_id,
  };
}

function coordinatorInput(context: ReturnType<typeof runningAnchorFromSeededDb>, invoke: SMCTurnInvoker) {
  return {
    job_id: context.job_id,
    project_key: context.project_key,
    attempt_id: context.attempt_id,
    owner_epoch: context.owner_epoch,
    invoke_turn: invoke,
    document_contract: context.document_contract,
    embedding_transport: fixedTransport(),
    now: () => new Date(SMC_TEST_NOW),
  };
}

function scriptedCurator(
  context: ReturnType<typeof runningAnchorFromSeededDb>,
  prompts: string[],
  options: { fetch_source_before_proposal?: boolean } = {},
): SMCTurnInvoker {
  let fetchedSource = false;
  return async (request) => {
    prompts.push(request.prompt);
    const parsed = envelope(request.prompt);
    const identity = parsed.authoritative.action_identity;
    let action: Record<string, unknown>;
    if (parsed.progress.current_batch.phase === "text_formulation") {
      const formulation = parsed.progress.current_batch.text_formulation!;
      action = {
        ...identity,
        action: "query",
        request: {
          plan_revision: formulation.plan_revision,
          plan_digest: formulation.plan_digest,
          text_obligation_id: formulation.id,
          query_text: "current session behavior",
        },
      };
    } else if (options.fetch_source_before_proposal && !fetchedSource) {
      fetchedSource = true;
      const source = context.db.query(
        `SELECT source_id, content_hash FROM smc_evidence_batch_members
         WHERE job_id = ? AND batch_id = ? ORDER BY ordinal LIMIT 1`,
      ).get(context.job_id, identity.work_batch_id) as { source_id: string; content_hash: string };
      action = {
        ...identity,
        action: "fetch_record",
        request: {
          record_kind: "source",
          stable_id: source.source_id,
          expected_source_hash: source.content_hash,
          max_encoded_bytes: SMC_TEST_WORKFLOW_BUDGETS.max_provider_envelope_bytes,
        },
      };
    } else if (parsed.progress.current_batch.phase === "audit_fetch") {
      const required = parsed.progress.current_batch.required_action!;
      action = {
        ...identity,
        action: "fetch_record",
        request: {
          record_kind: "memory",
          stable_id: required.memory_id,
          expected_revision: required.expected_revision,
          max_encoded_bytes: required.max_encoded_bytes,
        },
      };
    } else {
      const workSet = readCuratorAffectedWorkSet(context.db, {
        job_id: context.job_id,
        work_batch_id: identity.work_batch_id,
      });
      const sourceIds = (context.db.query(
        `SELECT source_id FROM smc_evidence_batch_members
         WHERE job_id = ? AND batch_id = ? ORDER BY ordinal`,
      ).all(context.job_id, identity.work_batch_id) as Array<{ source_id: string }>).map((row) => row.source_id);
      action = {
        ...identity,
        action: "submit_proposal",
        request: {
          proposal: parseSMCBatchProposal({
            schema_version: 1,
            work_batch_id: identity.work_batch_id,
            expected_overlay_revision: identity.expected_overlay_revision,
            source_event_dispositions: sourceIds.map((sourceId) => ({
              source_event_id: sourceId,
              disposition: "no_output",
              reason: "no reusable change",
            })),
            memory_dispositions: workSet.map((member) => ({
              memory_id: member.stable_id,
              revision_identity: member.revision_identity,
              disposition: "keep",
              reason: "still current",
              source_event_refs: [],
            })),
            disposition_receipt_reuses: [],
            staged_operations: [],
            checked_output_refs: [],
            terminal_summary: "Current memory remains accurate.",
          }),
        },
      };
    }
    return {
      action,
      invocation: request.resolvedInvocation,
      tokens_consumed: { input_chars: request.prompt.length, output_chars: JSON.stringify(action).length, is_estimate: true },
    };
  };
}

function envelope(prompt: string): {
  authoritative: { action_identity: SMCActionIdentity };
  progress: {
    current_batch: {
      phase: "text_formulation" | "audit_fetch" | "proposal_ready";
      text_formulation?: { id: string; plan_revision: number; plan_digest: string };
      required_action?: {
        kind: "fetch_record";
        batch_id: string;
        memory_id: string;
        expected_revision: { origin: "base"; revision: number; state_digest: string };
        max_encoded_bytes: number;
      };
      coverage: { complete: boolean; missing_count: number; digest: string };
    };
  };
} {
  return {
    authoritative: section(prompt, "BEGIN_AUTHORITATIVE_SMC_PROTOCOL_JSON", "END_AUTHORITATIVE_SMC_PROTOCOL_JSON"),
    progress: section(prompt, "BEGIN_TRUSTED_SMC_PROGRESS_JSON", "END_TRUSTED_SMC_PROGRESS_JSON"),
  };
}

function section<T>(prompt: string, begin: string, end: string): T {
  const start = prompt.indexOf(`${begin}\n`);
  const finish = prompt.indexOf(`\n${end}`, start);
  if (start < 0 || finish < 0) throw new Error(`missing prompt section ${begin}`);
  return JSON.parse(prompt.slice(start + begin.length + 1, finish)) as T;
}

function fixedTransport(): EmbeddingTransport {
  return {
    async embed(request) {
      return {
        embedding: [0.1, 0.2, 0.3],
        model: request.contract.model,
        dimensions: request.contract.dimensions,
      };
    },
  };
}

function canonicalCounts(db: MemoryDb) {
  return {
    memories: (db.query("SELECT count(*) AS n FROM session_memories").get() as { n: number }).n,
    candidates: (db.query("SELECT count(*) AS n FROM memory_candidates").get() as { n: number }).n,
  };
}
