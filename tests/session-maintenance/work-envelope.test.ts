import { afterEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { persistJournaledSMCActionResult } from "../../src/session-maintenance/action-journal.ts";
import type { CuratorBatchChannelPlan } from "../../src/session-maintenance/curator-channel-plan.ts";
import { transitionSessionMemoryAnchorJob } from "../../src/session-maintenance/job-lifecycle.ts";
import { SMCResultSchema, SMC_TOOL_PROTOCOL_VERSION, type SMCAction, type SMCActionIdentity } from "../../src/session-maintenance/protocol.ts";
import { buildSMCWorkEnvelope, readSMCProviderFeedback } from "../../src/session-maintenance/work-envelope.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  planEvidence,
  prepare,
  seedEvidence,
  seedIndexedMemory,
} from "../helpers/smc-preparation.ts";

const digest = `sha256:${"a".repeat(64)}`;
const databases: MemoryDb[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

test("provider envelope exposes only the bounded descriptor for its current phase", () => {
  const db = openMemoryDbAt(":memory:");
  databases.push(db);
  configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-a", summary: "Compact affected summary" });
  seedEvidence(db, "evt-a", "Review the current boundary");
  activateSMCAuthority(db);
  const prepared = prepare(db, planEvidence(db, "job-envelope-v2", {
    includeAudit: true,
    auditPartitionLimit: 1,
  }));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const batches = db.query(
    "SELECT batch_id, work_kind, batch_digest FROM smc_work_batches WHERE job_id = ? ORDER BY ordinal",
  ).all(prepared.manifest.job_id) as Array<{
    batch_id: string;
    work_kind: "evidence" | "audit";
    batch_digest: string;
  }>;
  const evidenceBatch = batches.find((batch) => batch.work_kind === "evidence")!;
  const auditBatch = batches.find((batch) => batch.work_kind === "audit")!;

  const textObligation = {
    id: "text-obligation-a",
    kind: "text" as const,
    required_channels: ["lexical", "semantic"] as const,
    selector: {
      source_id: "evt-a",
      content_hash: digest,
      scope: { repo_path: "/repo", git_branch: "feature/smc", git_commit: "abc123" },
    },
    provenance: ["evidence:evt-a"],
  };
  const textPlan = plan(prepared.manifest, evidenceBatch, [textObligation]);
  const formulation = buildSMCWorkEnvelope(db, {
    manifest: prepared.manifest,
    work_batch_id: evidenceBatch.batch_id,
    action_identity: identity(prepared.manifest, evidenceBatch.batch_id),
    channel_plan: textPlan,
    coverage: { complete: false, missing: [`${textObligation.id}:lexical`, `${textObligation.id}:semantic`] },
    phase: { kind: "text_formulation", obligation: textObligation },
    max_encoded_bytes: 180_000,
  });
  const formulationProgress = section(formulation.prompt, "BEGIN_TRUSTED_SMC_PROGRESS_JSON", "END_TRUSTED_SMC_PROGRESS_JSON");
  expect(formulationProgress.current_batch).toMatchObject({
    phase: "text_formulation",
    plan: { revision: 1, digest, obligation_count: 1 },
    coverage: { complete: false, missing_count: 2 },
    work_set: { count: 0, members: [] },
    text_formulation: {
      id: textObligation.id,
      source_id: "evt-a",
      scope: { repo_path: "/repo", git_branch: "feature/smc", git_commit: "abc123" },
    },
  });
  expect(formulation.prompt).not.toContain("obligations");
  expect(formulation.prompt).not.toContain("missing\":[");
  expect(formulation.prompt).not.toContain("accepted_batches");

  const auditPlan = plan(prepared.manifest, auditBatch, []);
  const proposal = buildSMCWorkEnvelope(db, {
    manifest: prepared.manifest,
    work_batch_id: auditBatch.batch_id,
    action_identity: identity(prepared.manifest, auditBatch.batch_id),
    channel_plan: auditPlan,
    coverage: { complete: true, missing: [] },
    phase: { kind: "proposal_ready" },
    max_encoded_bytes: 180_000,
  });
  const proposalProgress = section(proposal.prompt, "BEGIN_TRUSTED_SMC_PROGRESS_JSON", "END_TRUSTED_SMC_PROGRESS_JSON");
  expect(proposalProgress.current_batch).toMatchObject({
    phase: "proposal_ready",
    coverage: { complete: true, missing_count: 0 },
    work_set: {
      count: 1,
      members: [{ stable_id: "memory-a", summary: "Compact affected summary", memory_kind: "continuity" }],
    },
  });
  expect(proposalProgress.current_batch.text_formulation).toBeUndefined();
  expect(proposal.prompt).not.toContain("payload_json");
  expect(proposal.prompt).not.toContain("source_event_refs_json");
  expect(proposal.prompt).not.toContain("frozen_audit_targets");
});

test("provider feedback accumulates successful fetches and keeps only the latest compact non-fetch result", () => {
  const db = openMemoryDbAt(":memory:");
  databases.push(db);
  configureSMCTestContract(db);
  seedEvidence(db, "evt-a", "First source");
  seedEvidence(db, "evt-b", "Second source");
  activateSMCAuthority(db);
  const prepared = prepare(db, planEvidence(db, "job-feedback-v2"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const batch = db.query(
    "SELECT batch_id, batch_digest FROM smc_work_batches WHERE job_id = ? AND work_kind = 'evidence'",
  ).get(prepared.manifest.job_id) as { batch_id: string; batch_digest: string };
  startAttempt(db, prepared.manifest, "attempt-feedback");

  journalFetch(db, prepared.manifest, batch.batch_id, 0, "evt-a");
  journalFetch(db, prepared.manifest, batch.batch_id, 1, "evt-b");
  journalFetch(db, prepared.manifest, batch.batch_id, 2, "evt-a");
  journalProposalValidationFailure(db, prepared.manifest, batch.batch_id, 3);

  const feedback = readSMCProviderFeedback(db, {
    job_id: prepared.manifest.job_id,
    work_batch_id: batch.batch_id,
  });
  expect(feedback.successful_fetches.map((item) => item.result.record.stable_id)).toEqual(["evt-b", "evt-a"]);
  expect(feedback.latest_status).toEqual({
    action: "submit_proposal",
    result_kind: "submit_proposal_result",
    result: {
      kind: "rejected",
      code: "proposal_validation_failed",
      issues: [{ code: "missing_source_disposition", path: "source_event_dispositions", message: "evt-b is missing" }],
    },
  });

  const envelope = buildSMCWorkEnvelope(db, {
    manifest: prepared.manifest,
    work_batch_id: batch.batch_id,
    action_identity: identity(prepared.manifest, batch.batch_id, "attempt-feedback", 4),
    channel_plan: plan(prepared.manifest, batch, []),
    coverage: { complete: true, missing: [] },
    phase: { kind: "proposal_ready" },
    max_encoded_bytes: 180_000,
  });
  const progress = section(envelope.prompt, "BEGIN_TRUSTED_SMC_PROGRESS_JSON", "END_TRUSTED_SMC_PROGRESS_JSON");
  const untrusted = section(envelope.prompt, "BEGIN_UNTRUSTED_CURRENT_BATCH_JSON", "END_UNTRUSTED_CURRENT_BATCH_JSON");
  expect(progress.current_batch.provider_feedback).toMatchObject({
    successful_fetch_count: 2,
    latest_status: { result_kind: "submit_proposal_result", result: { code: "proposal_validation_failed" } },
  });
  expect(untrusted.prior_successful_fetch_results.map((item: any) => item.result.record.stable_id))
    .toEqual(["evt-b", "evt-a"]);
  expect(envelope.prompt).not.toContain("matches");
  expect(envelope.prompt).not.toContain("diagnostics");
});

test("provider feedback reduces query pages to a terminal summary without replaying matches", () => {
  const db = openMemoryDbAt(":memory:");
  databases.push(db);
  configureSMCTestContract(db);
  seedEvidence(db, "evt-a", "Query source");
  activateSMCAuthority(db);
  const prepared = prepare(db, planEvidence(db, "job-query-feedback"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const batch = db.query(
    "SELECT batch_id, batch_digest FROM smc_work_batches WHERE job_id = ? AND work_kind = 'evidence'",
  ).get(prepared.manifest.job_id) as { batch_id: string; batch_digest: string };
  startAttempt(db, prepared.manifest, "attempt-query");
  journalQueryPage(db, prepared.manifest, batch.batch_id, "attempt-query", 0);

  const feedback = readSMCProviderFeedback(db, {
    job_id: prepared.manifest.job_id,
    work_batch_id: batch.batch_id,
  });
  expect(feedback.latest_status).toEqual({
    action: "query",
    result_kind: "query_result",
    result: {
      kind: "page_summary",
      query_digest: digest,
      plan_revision: 1,
      plan_digest: digest,
      returned_match_count: 1,
      complete: true,
      truncated: false,
    },
  });

  const envelope = buildSMCWorkEnvelope(db, {
    manifest: prepared.manifest,
    work_batch_id: batch.batch_id,
    action_identity: identity(prepared.manifest, batch.batch_id, "attempt-query", 1),
    channel_plan: plan(prepared.manifest, batch, []),
    coverage: { complete: true, missing: [] },
    phase: { kind: "proposal_ready" },
    max_encoded_bytes: 180_000,
  });
  expect(envelope.prompt).toContain("page_summary");
  expect(envelope.prompt).not.toContain("sentinel-query-match");
  expect(envelope.prompt).not.toContain("diagnostics");
});

test("provider feedback fails closed on corrupted durable journal state", () => {
  const db = openMemoryDbAt(":memory:");
  databases.push(db);
  configureSMCTestContract(db);
  seedEvidence(db, "evt-a", "Corruption source");
  activateSMCAuthority(db);
  const prepared = prepare(db, planEvidence(db, "job-feedback-corruption"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const batch = db.query(
    "SELECT batch_id FROM smc_work_batches WHERE job_id = ? AND work_kind = 'evidence'",
  ).get(prepared.manifest.job_id) as { batch_id: string };
  startAttempt(db, prepared.manifest, "attempt-corruption");
  journalFetch(db, prepared.manifest, batch.batch_id, 0, "evt-a", "attempt-corruption");
  db.query(
    "UPDATE smc_action_journal SET result_json = ? WHERE job_id = ? AND work_batch_id = ?",
  ).run('{"tampered":true}', prepared.manifest.job_id, batch.batch_id);

  expect(() => readSMCProviderFeedback(db, {
    job_id: prepared.manifest.job_id,
    work_batch_id: batch.batch_id,
  })).toThrow("SMC provider feedback journal integrity mismatch");
});

test("accumulated provider feedback fails through the frozen envelope budget", () => {
  const db = openMemoryDbAt(":memory:");
  databases.push(db);
  configureSMCTestContract(db);
  seedEvidence(db, "evt-large", "x".repeat(2_000));
  activateSMCAuthority(db);
  const prepared = prepare(db, planEvidence(db, "job-feedback-budget"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const batch = db.query(
    "SELECT batch_id, batch_digest FROM smc_work_batches WHERE job_id = ? AND work_kind = 'evidence'",
  ).get(prepared.manifest.job_id) as { batch_id: string; batch_digest: string };
  startAttempt(db, prepared.manifest, "attempt-budget");
  journalFetch(db, prepared.manifest, batch.batch_id, 0, "evt-large", "attempt-budget");

  const withFeedback = buildSMCWorkEnvelope(db, {
    manifest: prepared.manifest,
    work_batch_id: batch.batch_id,
    action_identity: identity(prepared.manifest, batch.batch_id, "attempt-budget", 1),
    channel_plan: plan(prepared.manifest, batch, []),
    coverage: { complete: true, missing: [] },
    phase: { kind: "proposal_ready" },
    max_encoded_bytes: 180_000,
  });
  db.query("DELETE FROM smc_action_journal WHERE job_id = ? AND work_batch_id = ?")
    .run(prepared.manifest.job_id, batch.batch_id);
  const withoutFeedback = buildSMCWorkEnvelope(db, {
    manifest: prepared.manifest,
    work_batch_id: batch.batch_id,
    action_identity: identity(prepared.manifest, batch.batch_id, "attempt-budget", 1),
    channel_plan: plan(prepared.manifest, batch, []),
    coverage: { complete: true, missing: [] },
    phase: { kind: "proposal_ready" },
    max_encoded_bytes: 180_000,
  });
  expect(withFeedback.encoded_bytes).toBeGreaterThan(withoutFeedback.encoded_bytes);
  journalFetch(db, prepared.manifest, batch.batch_id, 0, "evt-large", "attempt-budget");

  expect(() => buildSMCWorkEnvelope(db, {
    manifest: prepared.manifest,
    work_batch_id: batch.batch_id,
    action_identity: identity(prepared.manifest, batch.batch_id, "attempt-budget", 1),
    channel_plan: plan(prepared.manifest, batch, []),
    coverage: { complete: true, missing: [] },
    phase: { kind: "proposal_ready" },
    max_encoded_bytes: withoutFeedback.encoded_bytes,
  })).toThrow("provider_envelope_budget_exceeded");
});

function identity(
  manifest: Parameters<typeof buildSMCWorkEnvelope>[1]["manifest"],
  workBatchId: string,
  attemptId = "attempt-envelope",
  sequence = 0,
): SMCActionIdentity {
  return {
    protocol_version: SMC_TOOL_PROTOCOL_VERSION,
    job_id: manifest.job_id,
    project_key: manifest.project_key,
    work_batch_id: workBatchId,
    attempt_id: attemptId,
    sequence,
    owner_epoch: manifest.owner_epoch,
    manifest_digest: manifest.manifest_digest,
    snapshot_token: manifest.snapshot_token,
    expected_overlay_revision: manifest.current_overlay_identity.revision,
  };
}

function startAttempt(
  db: MemoryDb,
  manifest: Parameters<typeof buildSMCWorkEnvelope>[1]["manifest"],
  attemptId: string,
): void {
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status, details_json, created_at, updated_at)
     VALUES (?, ?, 1, ?, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(attemptId, manifest.job_id, manifest.owner_epoch, manifest.created_at, manifest.created_at);
  const transitioned = transitionSessionMemoryAnchorJob(db, {
    jobId: manifest.job_id,
    projectKey: manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: manifest.owner_epoch,
    nextPhase: "running",
    now: manifest.created_at,
  });
  if (transitioned.kind !== "updated") throw new Error(JSON.stringify(transitioned));
}

function journalFetch(
  db: MemoryDb,
  manifest: Parameters<typeof buildSMCWorkEnvelope>[1]["manifest"],
  workBatchId: string,
  sequence: number,
  sourceId: string,
  attemptId = "attempt-feedback",
): void {
  const source = db.query(
    `SELECT ordinal, tombstone_id, content_hash, encoded_bytes, evidence_json
     FROM smc_evidence_snapshot WHERE job_id = ? AND source_id = ?`,
  ).get(manifest.job_id, sourceId) as {
    ordinal: number; tombstone_id: string; content_hash: string; encoded_bytes: number; evidence_json: string;
  };
  const action = {
    ...identity(manifest, workBatchId, attemptId, sequence),
    action: "fetch_record",
    request: {
      record_kind: "source",
      stable_id: sourceId,
      expected_source_hash: source.content_hash,
      max_encoded_bytes: 100_000,
    },
  } satisfies SMCAction;
  const result = SMCResultSchema.parse({
    ...identity(manifest, workBatchId, attemptId, sequence),
    result_kind: "fetch_record_result",
    result: {
      kind: "record",
      record: {
        kind: "source",
        stable_id: sourceId,
        ordinal: source.ordinal,
        tombstone_id: source.tombstone_id,
        content_hash: source.content_hash,
        encoded_bytes: source.encoded_bytes,
        evidence: JSON.parse(source.evidence_json),
      },
      encoded_bytes: source.encoded_bytes,
    },
  });
  const stored = persistJournaledSMCActionResult(db, {
    ...identity(manifest, workBatchId, attemptId, sequence),
    action_kind: "fetch_record",
    request: action,
    result,
    created_at: manifest.created_at,
  });
  if (stored.kind === "rejected") throw new Error(stored.code);
}

function journalQueryPage(
  db: MemoryDb,
  manifest: Parameters<typeof buildSMCWorkEnvelope>[1]["manifest"],
  workBatchId: string,
  attemptId: string,
  sequence: number,
): void {
  const action = {
    ...identity(manifest, workBatchId, attemptId, sequence),
    action: "query",
    request: {
      plan_revision: 1,
      plan_digest: digest,
      text_obligation_id: "text-obligation-a",
      query_text: "bounded query",
    },
  } satisfies SMCAction;
  const result = SMCResultSchema.parse({
    ...identity(manifest, workBatchId, attemptId, sequence),
    result_kind: "query_result",
    result: {
      kind: "page",
      receipt_id: "receipt-query",
      receipt_digest: digest,
      query_digest: digest,
      plan_revision: 1,
      plan_digest: digest,
      snapshot_token: manifest.snapshot_token,
      overlay_revision: manifest.current_overlay_identity.revision,
      matches: [{
        stable_id: "sentinel-query-match",
        title: "Must not be replayed",
        summary: "Must not be replayed",
        memory_kind: "continuity",
        revision_identity: { origin: "base", revision: 1, state_digest: digest },
        channels: ["lexical"],
        obligation_ids: ["text-obligation-a"],
      }],
      diagnostics: [{
        obligation_id: "text-obligation-a",
        channel: "lexical",
        applicable: true,
        qualifying_count: 1,
        materialized_count: 1,
        truncated: false,
        complete: true,
      }],
      next_cursor: null,
      complete: true,
      truncated: false,
      affected_work_set_receipt_id: "receipt-work-set",
    },
  });
  const stored = persistJournaledSMCActionResult(db, {
    ...identity(manifest, workBatchId, attemptId, sequence),
    action_kind: "query",
    request: action,
    result,
    created_at: manifest.created_at,
  });
  if (stored.kind === "rejected") throw new Error(stored.code);
}

function journalProposalValidationFailure(
  db: MemoryDb,
  manifest: Parameters<typeof buildSMCWorkEnvelope>[1]["manifest"],
  workBatchId: string,
  sequence: number,
): void {
  const action = {
    ...identity(manifest, workBatchId, "attempt-feedback", sequence),
    action: "submit_proposal",
    request: {
      proposal: {
        schema_version: 1,
        work_batch_id: workBatchId,
        expected_overlay_revision: 0,
        source_event_dispositions: [],
        memory_dispositions: [],
        disposition_receipt_reuses: [],
        staged_operations: [],
        checked_output_refs: [],
        terminal_summary: "Incomplete proposal",
      },
    },
  } satisfies SMCAction;
  const result = SMCResultSchema.parse({
    ...identity(manifest, workBatchId, "attempt-feedback", sequence),
    result_kind: "submit_proposal_result",
    result: {
      kind: "rejected",
      code: "proposal_validation_failed",
      issues: [{ code: "missing_source_disposition", path: "source_event_dispositions", message: "evt-b is missing" }],
    },
  });
  const stored = persistJournaledSMCActionResult(db, {
    ...identity(manifest, workBatchId, "attempt-feedback", sequence),
    action_kind: "submit_proposal",
    request: action,
    result,
    created_at: manifest.created_at,
  });
  if (stored.kind === "rejected") throw new Error(stored.code);
}

function plan(
  manifest: Parameters<typeof buildSMCWorkEnvelope>[1]["manifest"],
  batch: { batch_id: string; batch_digest: string },
  obligations: CuratorBatchChannelPlan["obligations"],
): CuratorBatchChannelPlan {
  return {
    schema_version: 1,
    job_id: manifest.job_id,
    work_batch_id: batch.batch_id,
    plan_revision: 1,
    parent_plan_digest: null,
    manifest_digest: manifest.manifest_digest,
    snapshot_token: manifest.snapshot_token,
    overlay_revision: manifest.current_overlay_identity.revision,
    overlay_digest: manifest.current_overlay_identity.digest,
    work_batch_digest: batch.batch_digest,
    affected_work_set_digest: digest,
    normalization_identity: digest,
    input_digest: digest,
    applicable_channels: obligations.flatMap((obligation) => obligation.required_channels),
    obligations,
    plan_digest: digest,
    created_at: manifest.created_at,
  };
}

function section(prompt: string, begin: string, end: string): any {
  const start = prompt.indexOf(`${begin}\n`);
  const finish = prompt.indexOf(`\n${end}`, start);
  if (start < 0 || finish < 0) throw new Error(`missing prompt section ${begin}`);
  return JSON.parse(prompt.slice(start + begin.length + 1, finish));
}
