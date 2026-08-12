import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { readActiveEmbeddingContract } from "../memory/embedding-contract-store.ts";
import type {
  SessionMemoryRow,
  SessionMemoryAnchorJobPhase,
  SessionMemoryAnchorJobRow,
  SMCActionJournalRow,
} from "../memory/ingest-types.ts";
import {
  createSessionMemoryCanonicalState,
  sessionMemoryCanonicalStateDigest,
  type SessionMemoryCanonicalState,
} from "../memory/session-memory-revisions.ts";
import {
  normalizeSessionMemoryForEmbedding,
  sessionMemoryNormalizedTextHash,
} from "../memory/session-memory-text.ts";
import { stableJson } from "../runtime/json.ts";
import {
  auditSelectionDigest,
  sessionMemoryAuditMemberDigest,
  stableSessionMemoryAuditBatchId,
  type SMCAuditSelection,
} from "./audit-selection.ts";
import { frozenAuditSelection, type SMCResolvedInvocationIdentity } from "./evidence-selection.ts";
import {
  getSessionMemoryAnchorJob,
  recordSessionMemoryAnchorFollowupReason,
  transitionSessionMemoryAnchorJob,
} from "./job-lifecycle.ts";
import {
  sessionMaintenanceOutputContractIdentity,
  sessionMaintenancePolicyIdentity,
  sessionMaintenanceToolProtocolIdentity,
  SESSION_MAINTENANCE_TOOL_PROTOCOL_VERSION,
} from "./identity.ts";
import { readSMCManifest, type SMCManifest } from "./manifest.ts";
import { reconstructSMCOverlay } from "./overlay-store.ts";
import { readSMCTerminalReceipt, type SMCTerminalReceipt } from "./terminal-receipts.ts";

export type SMCResumeBlockerCode =
  | "smc_resume_anchor_not_found"
  | "smc_resume_wrong_project"
  | "smc_resume_wrong_phase"
  | "smc_resume_fence_mismatch"
  | "smc_resume_legacy_identity_denied"
  | "smc_resume_manifest_missing"
  | "smc_resume_manifest_identity_mismatch"
  | "smc_resume_lease_identity_mismatch"
  | "smc_resume_memory_snapshot_mismatch"
  | "smc_resume_governing_identity_mismatch"
  | "smc_resume_invocation_identity_mismatch"
  | "smc_resume_embedding_identity_mismatch"
  | "smc_resume_overlay_identity_mismatch"
  | "smc_resume_journal_integrity_mismatch"
  | "smc_resume_accepted_batch_identity_mismatch"
  | "smc_resume_finalizing_digest_missing"
  | "smc_budget_grant_required"
  | "smc_coordinator_not_available"
  | "smc_coordinator_launch_failed";

export type ValidateSMCResumeResult =
  | {
      kind: "compatible";
      anchor: SessionMemoryAnchorJobRow;
      manifest: SMCManifest;
      first_incomplete_work_batch_id: string | null;
    }
  | { kind: "blocked"; code: SMCResumeBlockerCode; reason: string };

export type SMCFrozenStateValidationResult =
  | { kind: "valid" }
  | {
      kind: "blocked";
      code:
        | "smc_manifest_identity_mismatch"
        | "smc_lease_identity_mismatch"
        | "smc_memory_snapshot_mismatch"
        | "smc_embedding_identity_mismatch";
      reason: string;
    };

export type BeginSMCResumeResult =
  | {
      kind: "launched";
      anchor: SessionMemoryAnchorJobRow;
      attempt_id: string;
      first_incomplete_work_batch_id: string | null;
    }
  | { kind: "blocked"; code: SMCResumeBlockerCode; reason: string };

export type RecoverStaleSMCAnchorResult =
  | { kind: "not_stale"; anchor: SessionMemoryAnchorJobRow }
  | { kind: "not_recoverable"; code: "smc_anchor_not_found" | "smc_anchor_wrong_project" | "smc_anchor_wrong_phase" }
  | { kind: "completed"; receipt: SMCTerminalReceipt }
  | BeginSMCResumeResult;

export type SMCCoordinatorLauncher = (input: {
  job_id: string;
  project_key: string;
  target_repo: string;
  owner_epoch: number;
  attempt_id: string;
  first_incomplete_work_batch_id: string | null;
}) => void;

export function recoverStaleSessionMaintenanceAnchor(
  db: Database,
  input: {
    job_id: string;
    project_key: string;
    stale_before: string;
    now: string;
    attempt_id: string;
    invocation: SMCResolvedInvocationIdentity;
    coordinator?: SMCCoordinatorLauncher;
    failure_injection?: { after_takeover?: () => void };
  },
): RecoverStaleSMCAnchorResult {
  requireTimestamp(input.stale_before, "stale_before");
  requireTimestamp(input.now, "now");
  const takeover = inImmediateTransaction(db, () => {
    const anchor = getSessionMemoryAnchorJob(db, input.job_id);
    if (!anchor) return { kind: "not_recoverable", code: "smc_anchor_not_found" } as const;
    if (anchor.project_key !== input.project_key) {
      return { kind: "not_recoverable", code: "smc_anchor_wrong_project" } as const;
    }
    if (!isStaleRecoverablePhase(anchor.phase)) {
      return { kind: "not_recoverable", code: "smc_anchor_wrong_phase" } as const;
    }

    if (anchor.phase === "finalizing") {
      const receipt = readSMCTerminalReceipt(db, anchor.job_id);
      if (receipt?.receipt_kind === "finalization") {
        const completed = transitionSessionMemoryAnchorJob(db, {
          jobId: anchor.job_id,
          projectKey: anchor.project_key,
          expectedPhase: "finalizing",
          expectedOwnerEpoch: anchor.owner_epoch,
          nextPhase: "completed",
          now: input.now,
        });
        if (completed.kind !== "updated") {
          throw new Error(`smc_finalization_receipt_reconciliation_failed: ${completed.code}`);
        }
        db.query(
          `DELETE FROM project_session_mutation_fences
           WHERE project_key = ? AND owner_id = ? AND owner_epoch = ? AND phase = 'completed'`,
        ).run(anchor.project_key, anchor.job_id, anchor.owner_epoch);
        return { kind: "completed", receipt } as const;
      }
    }

    if (Date.parse(anchor.heartbeat_at) >= Date.parse(input.stale_before)) {
      return { kind: "not_stale", anchor } as const;
    }
    const transitioned = transitionSessionMemoryAnchorJob(db, {
      jobId: anchor.job_id,
      projectKey: anchor.project_key,
      expectedPhase: anchor.phase,
      expectedOwnerEpoch: anchor.owner_epoch,
      nextPhase: "needs_followup",
      now: input.now,
      reasonCode: anchor.phase === "finalizing"
        ? "stale_receiptless_finalizing"
        : `stale_${anchor.phase}_owner`,
    });
    if (transitioned.kind !== "updated") {
      throw new Error(`smc_stale_takeover_failed: ${transitioned.code}`);
    }
    return { kind: "taken_over", anchor: transitioned.anchor } as const;
  });

  if (takeover.kind !== "taken_over") return takeover;
  input.failure_injection?.after_takeover?.();
  return beginSessionMaintenanceCoordinatorResume(db, {
    job_id: input.job_id,
    project_key: input.project_key,
    expected_owner_epoch: takeover.anchor.owner_epoch,
    attempt_id: input.attempt_id,
    invocation: input.invocation,
    now: input.now,
    coordinator: input.coordinator,
  });
}

export function validateSessionMaintenanceResume(
  db: Database,
  input: {
    job_id: string;
    project_key: string;
    expected_owner_epoch: number;
    invocation: SMCResolvedInvocationIdentity;
  },
): ValidateSMCResumeResult {
  const anchor = getSessionMemoryAnchorJob(db, input.job_id);
  if (!anchor) return blocked("smc_resume_anchor_not_found", "anchor job does not exist");
  if (anchor.project_key !== input.project_key) {
    return blocked("smc_resume_wrong_project", "anchor job belongs to another project");
  }
  if (anchor.phase !== "needs_followup" || anchor.owner_epoch !== input.expected_owner_epoch) {
    return blocked("smc_resume_wrong_phase", "anchor is not resumable under the expected epoch");
  }
  if (db.query("SELECT 1 FROM legacy_session_job_deny_identities WHERE job_id = ?").get(input.job_id)) {
    return blocked("smc_resume_legacy_identity_denied", "anchor identity is permanently denied");
  }
  const fence = db.query(
    `SELECT owner_id, owner_epoch, owner_kind, phase
     FROM project_session_mutation_fences WHERE project_key = ?`,
  ).get(input.project_key) as {
    owner_id: string;
    owner_epoch: number;
    owner_kind: string;
    phase: string;
  } | null;
  if (
    !fence
    || fence.owner_id !== input.job_id
    || fence.owner_epoch !== input.expected_owner_epoch
    || fence.owner_kind !== "anchor_job"
    || fence.phase !== "needs_followup"
  ) {
    return blocked("smc_resume_fence_mismatch", "anchor and project fence identities differ");
  }

  let manifest: SMCManifest;
  try {
    const stored = readSMCManifest(db, input.job_id);
    if (!stored) return blocked("smc_resume_manifest_missing", "complete SMC manifest is absent");
    manifest = stored;
  } catch (error) {
    return blocked("smc_resume_manifest_identity_mismatch", errorMessage(error));
  }
  const frozenState = validateSessionMaintenanceFrozenState(db, manifest);
  if (frozenState.kind === "blocked") {
    return blocked(`smc_resume_${frozenState.code.slice(4)}` as SMCResumeBlockerCode, frozenState.reason);
  }
  if (!validGoverningIdentity(manifest)) {
    return blocked("smc_resume_governing_identity_mismatch", "policy, output, or tool identity changed");
  }
  if (stableJson(manifest.governing_identities.invocation) !== stableJson(input.invocation)) {
    return blocked("smc_resume_invocation_identity_mismatch", "provider/model identity changed");
  }
  try {
    const overlay = reconstructSMCOverlay(db, { job_id: manifest.job_id });
    if (
      overlay.identity.revision !== manifest.current_overlay_identity.revision
      || overlay.identity.digest !== manifest.current_overlay_identity.digest
    ) {
      return blocked("smc_resume_overlay_identity_mismatch", "overlay identity changed during validation");
    }
  } catch (error) {
    return blocked("smc_resume_overlay_identity_mismatch", errorMessage(error));
  }
  if (!validJournal(db, manifest)) {
    return blocked("smc_resume_journal_integrity_mismatch", "journal identity, ordering, or digest is invalid");
  }
  const batchProgress = validateAcceptedBatches(db, manifest);
  if (batchProgress.kind === "invalid") {
    return blocked("smc_resume_accepted_batch_identity_mismatch", batchProgress.reason);
  }
  if (
    (anchor.reason_code === "stale_receiptless_finalizing"
      || anchor.reason_code === "smc_resume_finalizing_digest_missing")
    && !hasFixedProjectionDigest(db, anchor.job_id)
  ) {
    return blocked("smc_resume_finalizing_digest_missing", "receipt-less finalizing state lacks a fixed projection digest");
  }
  if (
    (anchor.reason_code === "budget_exhausted" || anchor.reason_code === "smc_budget_grant_required")
    && !hasBudgetGrant(db, manifest, anchor.owner_epoch)
  ) {
    return blocked("smc_budget_grant_required", "budget exhaustion requires an additive operator grant");
  }
  return {
    kind: "compatible",
    anchor,
    manifest,
    first_incomplete_work_batch_id: batchProgress.firstIncomplete,
  };
}

export function beginSessionMaintenanceCoordinatorResume(
  db: Database,
  input: {
    job_id: string;
    project_key: string;
    expected_owner_epoch: number;
    attempt_id: string;
    invocation: SMCResolvedInvocationIdentity;
    now: string;
    coordinator?: SMCCoordinatorLauncher;
  },
): BeginSMCResumeResult {
  const validation = validateSessionMaintenanceResume(db, input);
  if (validation.kind === "blocked") {
    persistFollowupReason(db, input, validation.code);
    return validation;
  }
  if (!input.coordinator) {
    const unavailable = blocked(
      "smc_coordinator_not_available",
      "Session Memory coordinator launcher is not configured",
    );
    persistFollowupReason(db, input, unavailable.code);
    return unavailable;
  }
  const resumed = transitionSessionMemoryAnchorJob(db, {
    jobId: input.job_id,
    projectKey: input.project_key,
    expectedPhase: "needs_followup",
    expectedOwnerEpoch: input.expected_owner_epoch,
    nextPhase: "running",
    now: input.now,
    reasonCode: null,
    resumeAttempt: {
      id: input.attempt_id,
      provider: input.invocation.provider,
      details: {
        model: input.invocation.model,
        reasoning_effort: input.invocation.reasoning_effort,
        resumed_from_epoch: input.expected_owner_epoch,
      },
    },
  });
  if (resumed.kind !== "updated") {
    return blocked("smc_resume_wrong_phase", `resume CAS failed: ${resumed.code}`);
  }
  try {
    input.coordinator({
      job_id: input.job_id,
      project_key: input.project_key,
      target_repo: validation.manifest.target_context.repo_path,
      owner_epoch: resumed.anchor.owner_epoch,
      attempt_id: input.attempt_id,
      first_incomplete_work_batch_id: validation.first_incomplete_work_batch_id,
    });
  } catch (error) {
    const failed = transitionSessionMemoryAnchorJob(db, {
      jobId: input.job_id,
      projectKey: input.project_key,
      expectedPhase: "running",
      expectedOwnerEpoch: resumed.anchor.owner_epoch,
      nextPhase: "needs_followup",
      now: input.now,
      reasonCode: "smc_coordinator_launch_failed",
    });
    if (failed.kind !== "updated") throw error;
    return blocked("smc_coordinator_launch_failed", errorMessage(error));
  }
  return {
    kind: "launched",
    anchor: resumed.anchor,
    attempt_id: input.attempt_id,
    first_incomplete_work_batch_id: validation.first_incomplete_work_batch_id,
  };
}

function persistFollowupReason(
  db: Database,
  input: Pick<Parameters<typeof beginSessionMaintenanceCoordinatorResume>[1],
    "job_id" | "project_key" | "expected_owner_epoch" | "now">,
  reasonCode: SMCResumeBlockerCode,
): void {
  const result = recordSessionMemoryAnchorFollowupReason(db, {
    jobId: input.job_id,
    projectKey: input.project_key,
    expectedOwnerEpoch: input.expected_owner_epoch,
    reasonCode,
    now: input.now,
  });
  if (result.kind === "rejected" && result.code !== "session_memory_anchor_legacy_denied") {
    throw new Error(`smc_resume_reason_persistence_failed: ${result.code}`);
  }
}

/**
 * Recomputes every immutable preparation identity from frozen rows and live
 * lease/canonical state. Callers that mutate canonical state must invoke this
 * while holding their own write transaction.
 */
export function validateSessionMaintenanceFrozenState(
  db: Database,
  manifest: SMCManifest,
): SMCFrozenStateValidationResult {
  if (!validManifestIdentity(db, manifest)) {
    return {
      kind: "blocked",
      code: "smc_manifest_identity_mismatch",
      reason: "manifest digest or frozen counts do not match",
    };
  }
  if (!validLeases(db, manifest)) {
    return {
      kind: "blocked",
      code: "smc_lease_identity_mismatch",
      reason: "selected evidence lease or frozen evidence plan identity changed",
    };
  }
  if (!validMemorySnapshot(db, manifest)) {
    return {
      kind: "blocked",
      code: "smc_memory_snapshot_mismatch",
      reason: "active Session Memory or frozen canonical snapshot identity changed",
    };
  }
  if (!validEmbeddingSnapshot(db, manifest)) {
    return {
      kind: "blocked",
      code: "smc_embedding_identity_mismatch",
      reason: "embedding contract or frozen retrieval snapshot identity changed",
    };
  }
  return { kind: "valid" };
}

function validManifestIdentity(db: Database, manifest: SMCManifest): boolean {
  const completeness = db.query(
    `SELECT active_memory_count, indexed_metadata_count, vector_count,
            normalized_text_match_count, coverage_digest
     FROM smc_retrieval_snapshot_completeness WHERE job_id = ?`,
  ).get(manifest.job_id) as {
    active_memory_count: number;
    indexed_metadata_count: number;
    vector_count: number;
    normalized_text_match_count: number;
    coverage_digest: string;
  } | null;
  if (!completeness) return false;
  const counts = {
    selected_evidence: count(db, "smc_evidence_snapshot", manifest.job_id),
    no_agent_intents: count(db, "smc_no_agent_intents", manifest.job_id),
    work_batches: count(db, "smc_work_batches", manifest.job_id),
    evidence_batches: countWhere(db, "smc_work_batches", manifest.job_id, "work_kind = 'evidence'"),
    audit_batches: countWhere(db, "smc_work_batches", manifest.job_id, "work_kind = 'audit'"),
    audit_members: count(db, "smc_audit_batch_members", manifest.job_id),
    active_memories: count(db, "smc_memory_snapshot", manifest.job_id),
  };
  if (
    counts.selected_evidence !== manifest.selected_evidence_count
    || counts.no_agent_intents !== manifest.no_agent_intent_count
    || counts.work_batches !== manifest.work_batch_count
    || counts.evidence_batches !== manifest.evidence_batch_count
    || counts.audit_batches !== manifest.audit_batch_count
    || counts.audit_members !== manifest.audit_member_count
    || counts.active_memories !== manifest.active_memory_count
    || completeness.active_memory_count !== manifest.active_memory_count
    || completeness.indexed_metadata_count !== manifest.active_memory_count
    || completeness.vector_count !== manifest.active_memory_count
    || completeness.normalized_text_match_count !== manifest.active_memory_count
  ) return false;
  try {
    readValidatedWorkBatchMembership(db, manifest);
  } catch {
    return false;
  }
  const body = {
    schema_version: 1,
    job_id: manifest.job_id,
    project_key: manifest.project_key,
    owner_epoch: manifest.owner_epoch,
    trigger_reason: manifest.trigger_reason,
    compatibility_selection_limit: manifest.compatibility_selection_limit,
    preparation_plan_identity: manifest.preparation_plan_identity,
    evidence_digest: manifest.evidence_digest,
    memory_snapshot_digest: manifest.memory_snapshot_digest,
    retrieval_snapshot_digest: manifest.retrieval_snapshot_digest,
    snapshot_token: manifest.snapshot_token,
    governing_identities: manifest.governing_identities,
    evidence_budgets: manifest.evidence_budgets,
    workflow_budgets: manifest.workflow_budgets,
    target_context: manifest.target_context,
    embedding: {
      contract_id: manifest.embedding_contract_id,
      provider: manifest.embedding_provider,
      model: manifest.embedding_model,
      dimensions: manifest.embedding_dimensions,
      format_version: manifest.embedding_format_version,
      vector_table: manifest.embedding_vector_table,
      coverage_digest: completeness.coverage_digest,
    },
    audit: {
      selection_digest: manifest.audit_selection_digest,
      algorithm_digest: manifest.audit_algorithm_digest,
    },
    counts: {
      ...counts,
      total_evidence_bytes: manifest.total_evidence_bytes,
    },
    created_at: manifest.created_at,
  };
  return digest(body) === manifest.manifest_digest;
}

function validGoverningIdentity(manifest: SMCManifest): boolean {
  return stableJson({
    policy: sessionMaintenancePolicyIdentity(),
    output_contract: sessionMaintenanceOutputContractIdentity(),
    tool_protocol: sessionMaintenanceToolProtocolIdentity(),
  }) === stableJson({
    policy: manifest.governing_identities.policy,
    output_contract: manifest.governing_identities.output_contract,
    tool_protocol: manifest.governing_identities.tool_protocol,
  });
}

function validLeases(db: Database, manifest: SMCManifest): boolean {
  try {
    const evidence = db.query(
      `SELECT s.* FROM smc_evidence_snapshot s
       JOIN experience_event_tombstones t
         ON t.id = s.tombstone_id AND t.original_event_id = s.source_id
       WHERE s.job_id = ? AND t.ingest_job_id = ? AND t.project_key = ? AND t.state = 'claimed'
       ORDER BY s.ordinal`,
    ).all(manifest.job_id, manifest.job_id, manifest.project_key) as FrozenEvidenceRow[];
    const noAgent = db.query(
      `SELECT s.* FROM smc_no_agent_intents s
       JOIN experience_event_tombstones t
         ON t.id = s.tombstone_id AND t.original_event_id = s.source_id
       WHERE s.job_id = ? AND t.ingest_job_id = ? AND t.project_key = ? AND t.state = 'claimed'
       ORDER BY s.ordinal`,
    ).all(manifest.job_id, manifest.job_id, manifest.project_key) as FrozenNoAgentRow[];
    if (
      evidence.length !== manifest.selected_evidence_count
      || noAgent.length !== manifest.no_agent_intent_count
      || evidence.reduce((total, row) => total + row.encoded_bytes, 0) !== manifest.total_evidence_bytes
    ) return false;

    const selected = evidence.map((row) => {
      const frozen = parseJson(row.evidence_json);
      const live = normalizedEvidenceRow(db, row.source_id, manifest.project_key);
      if (
        row.ordinal < 0
        || !live
        || stableJson(frozen) !== stableJson(live)
        || stableJson(frozen) !== row.evidence_json
        || digest(frozen) !== row.content_hash
        || Buffer.byteLength(row.evidence_json, "utf8") !== row.encoded_bytes
      ) throw new Error("invalid frozen evidence");
      return {
        source_id: row.source_id,
        content_hash: row.content_hash,
        encoded_bytes: row.encoded_bytes,
        evidence: frozen,
      };
    });
    const intents = noAgent.map((row) => {
      const live = normalizedEvidenceRow(db, row.source_id, manifest.project_key);
      if (!live || digest(live) !== row.source_hash) throw new Error("invalid no-agent source");
      return {
        source_id: row.source_id,
        source_hash: row.source_hash,
        reason: row.reason,
        terminal_state: row.terminal_state,
        terminal_decision: row.terminal_decision,
      };
    });
    const ordered = [...evidence, ...noAgent]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((row, ordinal) => {
        if (row.ordinal !== ordinal) throw new Error("invalid evidence ordinal");
        return row.source_id;
      });
    const auditSelection = readValidatedWorkBatchMembership(db, manifest);
    const batches = frozenWorkBatches(db, manifest, selected, auditSelection);
    const planIdentity = digest({
      schema_version: 1,
      anchor_job_id: manifest.job_id,
      project_key: manifest.project_key,
      trigger_reason: manifest.trigger_reason,
      compatibility_selection_limit: manifest.compatibility_selection_limit,
      governing_identities: manifest.governing_identities,
      budgets: manifest.evidence_budgets,
      evidence: selected.map(({ source_id, content_hash, encoded_bytes }) => ({
        source_id,
        content_hash,
        encoded_bytes,
      })),
      no_agent_intents: intents,
      audit_selection: frozenAuditSelection(auditSelection),
    });
    return planIdentity === manifest.preparation_plan_identity
      && digest({
        plan_identity: planIdentity,
        ordered_source_ids: ordered,
        evidence: selected,
        batches,
        audit_selection: frozenAuditSelection(auditSelection),
        no_agent_intents: intents,
      }) === manifest.evidence_digest;
  } catch {
    return false;
  }
}

function validMemorySnapshot(db: Database, manifest: SMCManifest): boolean {
  const frozen = db.query(
    `SELECT * FROM smc_memory_snapshot WHERE job_id = ? ORDER BY ordinal`,
  ).all(manifest.job_id) as FrozenMemoryRow[];
  const live = db.query(
    `SELECT id, revision, state_digest
     FROM session_memories WHERE project_key = ? AND status = 'active' ORDER BY id`,
  ).all(manifest.project_key);
  try {
    const digestRows = frozen.map((row, ordinal) => {
      if (row.ordinal !== ordinal || row.project_key !== manifest.project_key) {
        throw new Error("invalid frozen memory ordinal");
      }
      const memory = frozenMemoryAsSessionRow(row);
      const canonical = frozenCanonicalState(db, manifest.job_id, memory);
      if (sessionMemoryCanonicalStateDigest(canonical) !== row.state_digest) {
        throw new Error("invalid frozen memory state digest");
      }
      return {
        id: row.memory_id,
        revision: row.revision,
        state_digest: row.state_digest,
        memory,
        canonical,
      };
    });
    const identities = digestRows.map(({ id, revision, state_digest }) => ({ id, revision, state_digest }));
    return stableJson(identities) === stableJson(live)
      && digest(digestRows) === manifest.memory_snapshot_digest;
  } catch {
    return false;
  }
}

function validEmbeddingSnapshot(db: Database, manifest: SMCManifest): boolean {
  const active = readActiveEmbeddingContract(db, "session_memory");
  if (
    !active
    || active.id !== manifest.embedding_contract_id
    || active.provider !== manifest.embedding_provider
    || active.model !== manifest.embedding_model
    || active.dimensions !== manifest.embedding_dimensions
    || active.formatVersion !== manifest.embedding_format_version
    || active.vectorTable !== manifest.embedding_vector_table
  ) return false;
  const memories = db.query(
    `SELECT * FROM smc_memory_snapshot WHERE job_id = ? ORDER BY ordinal`,
  ).all(manifest.job_id) as FrozenMemoryRow[];
  const completeness = db.query(
    `SELECT * FROM smc_retrieval_snapshot_completeness WHERE job_id = ?`,
  ).get(manifest.job_id) as RetrievalCompletenessRow | null;
  if (!completeness || memories.length !== manifest.active_memory_count) return false;
  try {
    const rows = memories.map((memory) => {
      const text = db.query(
        `SELECT normalized_text, normalized_text_hash FROM smc_memory_snapshot_search_texts
         WHERE job_id = ? AND memory_id = ?`,
      ).get(manifest.job_id, memory.memory_id) as FrozenSearchTextRow | null;
      const vector = db.query(
        `SELECT * FROM smc_memory_snapshot_vectors WHERE job_id = ? AND memory_id = ?`,
      ).get(manifest.job_id, memory.memory_id) as FrozenVectorRow | null;
      if (!text || !vector) throw new Error("incomplete retrieval snapshot");
      const normalized = normalizeSessionMemoryForEmbedding(frozenMemoryAsSessionRow(memory));
      const normalizedHash = sessionMemoryNormalizedTextHash(normalized);
      if (
        text.normalized_text !== normalized
        || text.normalized_text_hash !== normalizedHash
        || vector.embedding_contract_id !== manifest.embedding_contract_id
        || vector.embedding_provider !== manifest.embedding_provider
        || vector.embedding_model !== manifest.embedding_model
        || vector.embedding_dimensions !== manifest.embedding_dimensions
        || vector.embedding_purpose !== "retrieval_document"
        || vector.embedding_format_version !== manifest.embedding_format_version
        || vector.normalized_text_hash !== normalizedHash
        || vector.vector_bytes.byteLength !== manifest.embedding_dimensions * Float32Array.BYTES_PER_ELEMENT
        || digestBytes(vector.vector_bytes) !== vector.vector_digest
      ) throw new Error("invalid retrieval snapshot row");
      return {
        memory_id: memory.memory_id,
        normalized_text: normalized,
        normalized_text_hash: normalizedHash,
        embedding_row_id: vector.embedding_row_id,
        vector_digest: vector.vector_digest,
      };
    });
    const coverageDigest = digest({
      contract: manifest.embedding_contract_id,
      memories: rows.map(({ memory_id, normalized_text_hash, vector_digest }) => ({
        memory_id,
        normalized_text_hash,
        vector_digest,
      })),
    });
    const retrievalDigest = digest({
      contract: {
        id: manifest.embedding_contract_id,
        provider: manifest.embedding_provider,
        model: manifest.embedding_model,
        dimensions: manifest.embedding_dimensions,
        format_version: manifest.embedding_format_version,
        vector_table: manifest.embedding_vector_table,
      },
      rows,
    });
    return completeness.embedding_contract_id === manifest.embedding_contract_id
      && completeness.active_memory_count === memories.length
      && completeness.indexed_metadata_count === memories.length
      && completeness.vector_count === memories.length
      && completeness.normalized_text_match_count === memories.length
      && completeness.coverage_digest === coverageDigest
      && retrievalDigest === manifest.retrieval_snapshot_digest
      && digest({
        memory_snapshot_digest: manifest.memory_snapshot_digest,
        retrieval_snapshot_digest: retrievalDigest,
        embedding_contract_id: manifest.embedding_contract_id,
      }) === manifest.snapshot_token;
  } catch {
    return false;
  }
}

type FrozenEvidenceRow = {
  job_id: string;
  source_id: string;
  ordinal: number;
  tombstone_id: string;
  content_hash: string;
  encoded_bytes: number;
  evidence_json: string;
};

type FrozenNoAgentRow = {
  job_id: string;
  source_id: string;
  ordinal: number;
  tombstone_id: string;
  source_hash: string;
  reason: string;
  terminal_state: string;
  terminal_decision: string;
};

type FrozenMemoryRow = Omit<SessionMemoryRow, "id"> & {
  job_id: string;
  memory_id: string;
  ordinal: number;
};

type FrozenSearchTextRow = {
  normalized_text: string;
  normalized_text_hash: string;
};

type FrozenVectorRow = {
  embedding_row_id: string;
  embedding_contract_id: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_purpose: string;
  embedding_format_version: number;
  normalized_text_hash: string;
  vector_bytes: Uint8Array;
  vector_digest: string;
};

type RetrievalCompletenessRow = {
  embedding_contract_id: string;
  active_memory_count: number;
  indexed_metadata_count: number;
  vector_count: number;
  normalized_text_match_count: number;
  coverage_digest: string;
};

function normalizedEvidenceRow(db: Database, sourceId: string, projectKey: string): unknown | null {
  const row = db.query(
    `SELECT id AS source_id, project_key, inserted_at, occurred_at, hook_event_name,
            event_kind, cwd, provider, provider_session_id, turn_id, raw_text,
            raw_payload_json, source, status, repo_path, git_branch, git_commit,
            git_worktree_id, dedupe_key
     FROM experience_events WHERE id = ? AND project_key = ?`,
  ).get(sourceId, projectKey);
  return row ?? null;
}

function frozenWorkBatches(
  db: Database,
  manifest: SMCManifest,
  evidence: Array<{ source_id: string; content_hash: string; encoded_bytes: number }>,
  auditSelection: SMCAuditSelection,
) {
  const jobId = manifest.job_id;
  const batches = db.query(
    `SELECT * FROM smc_work_batches WHERE job_id = ? ORDER BY ordinal`,
  ).all(jobId) as Array<{
    job_id: string;
    batch_id: string;
    ordinal: number;
    item_count: number;
    encoded_bytes: number;
    batch_digest: string;
    work_kind: "evidence" | "audit";
  }>;
  const seen = new Set<string>();
  const reconstructed = batches.map((batch, ordinal) => {
    if (batch.ordinal !== ordinal) throw new Error("invalid batch ordinal");
    if (batch.work_kind === "audit") {
      if (ordinal !== batches.length - 1 || auditSelection.members.length === 0) throw new Error("invalid audit batch order");
      if (batch.batch_id !== auditSelection.work_batch_id || batch.batch_id !== stableSessionMemoryAuditBatchId({
        anchor_job_id: jobId,
        algorithm_digest: auditSelection.algorithm_digest,
        members: auditSelection.members,
      })) throw new Error("invalid audit batch identity");
      const identity = {
        anchor_job_id: jobId,
        preparation_plan_identity: manifest.preparation_plan_identity,
        ordinal: batch.ordinal,
        work_kind: "audit" as const,
        members: auditSelection.members,
      };
      const value = {
        id: auditSelection.work_batch_id,
        ordinal: batch.ordinal,
        work_kind: "audit" as const,
        source_ids: [],
        content_hashes: [],
        item_count: auditSelection.members.length,
        encoded_bytes: Buffer.byteLength(stableJson(identity), "utf8"),
      };
      if (
        value.id !== batch.batch_id || value.item_count !== batch.item_count
        || value.encoded_bytes !== batch.encoded_bytes || digest(value) !== batch.batch_digest
      ) throw new Error("invalid frozen audit batch");
      return value;
    }
    const members = db.query(
      `SELECT source_id, ordinal, content_hash FROM smc_evidence_batch_members
       WHERE job_id = ? AND batch_id = ? ORDER BY ordinal`,
    ).all(jobId, batch.batch_id) as Array<{ source_id: string; ordinal: number; content_hash: string }>;
    let encodedBytes = 0;
    members.forEach((member, memberOrdinal) => {
      if (member.ordinal !== memberOrdinal || seen.has(member.source_id)) {
        throw new Error("invalid batch member ordinal");
      }
      const selected = evidence.find((row) => row.source_id === member.source_id);
      if (!selected || selected.content_hash !== member.content_hash) throw new Error("invalid batch member identity");
      seen.add(member.source_id);
      encodedBytes += selected.encoded_bytes;
    });
    const reconstructed = {
      id: batch.batch_id,
      ordinal: batch.ordinal,
      work_kind: "evidence" as const,
      source_ids: members.map((row) => row.source_id),
      content_hashes: members.map((row) => row.content_hash),
      item_count: members.length,
      encoded_bytes: encodedBytes,
    };
    if (
      batch.batch_id !== stableEvidenceBatchId(jobId, manifest.preparation_plan_identity, reconstructed)
      ||
      batch.item_count !== reconstructed.item_count
      || batch.encoded_bytes !== reconstructed.encoded_bytes
      || digest(reconstructed) !== batch.batch_digest
    ) throw new Error("invalid frozen batch");
    return reconstructed;
  });
  if (seen.size !== evidence.length) throw new Error("unbatched evidence");
  return reconstructed;
}

function readValidatedWorkBatchMembership(db: Database, manifest: SMCManifest): SMCAuditSelection {
  const batches = db.query(
    `SELECT batch_id, ordinal, work_kind, item_count FROM smc_work_batches
     WHERE job_id = ? ORDER BY ordinal`,
  ).all(manifest.job_id) as Array<{
    batch_id: string; ordinal: number; work_kind: "evidence" | "audit"; item_count: number;
  }>;
  const evidenceMembers = db.query(
    `SELECT e.batch_id, e.work_kind, b.work_kind AS batch_work_kind
     FROM smc_evidence_batch_members e
     LEFT JOIN smc_work_batches b ON b.job_id = e.job_id AND b.batch_id = e.batch_id
     WHERE e.job_id = ?`,
  ).all(manifest.job_id) as Array<{
    batch_id: string; work_kind: string; batch_work_kind: string | null;
  }>;
  const auditRows = db.query(
    `SELECT a.batch_id, a.work_kind, b.work_kind AS batch_work_kind,
            a.memory_id, a.revision, a.state_digest, a.ordinal, a.selection_basis,
            a.prior_audit_at, a.member_digest
     FROM smc_audit_batch_members a
     LEFT JOIN smc_work_batches b ON b.job_id = a.job_id AND b.batch_id = a.batch_id
     WHERE a.job_id = ? ORDER BY a.ordinal`,
  ).all(manifest.job_id) as Array<{
    batch_id: string; work_kind: string; batch_work_kind: string | null;
    memory_id: string; revision: number; state_digest: string; ordinal: number;
    selection_basis: "never_audited" | "least_recent_audit" | "identity_invalidated";
    prior_audit_at: string | null; member_digest: `sha256:${string}`;
  }>;
  if (batches.some((batch, ordinal) => batch.ordinal !== ordinal)) throw new Error("invalid work batch ordinal");
  if (evidenceMembers.some((member) => member.work_kind !== "evidence" || member.batch_work_kind !== "evidence")) {
    throw new Error("cross-kind evidence batch member");
  }
  if (auditRows.some((member) => member.work_kind !== "audit" || member.batch_work_kind !== "audit")) {
    throw new Error("cross-kind audit batch member");
  }
  for (const batch of batches) {
    const evidenceCount = evidenceMembers.filter((member) => member.batch_id === batch.batch_id).length;
    const auditCount = auditRows.filter((member) => member.batch_id === batch.batch_id).length;
    const expected = batch.work_kind === "evidence" ? evidenceCount : auditCount;
    const wrongKind = batch.work_kind === "evidence" ? auditCount : evidenceCount;
    if (expected !== batch.item_count || wrongKind !== 0) throw new Error("work batch member count mismatch");
  }
  if (evidenceMembers.length !== manifest.selected_evidence_count
    || auditRows.length !== manifest.audit_member_count) throw new Error("manifest member count mismatch");
  const auditBatches = batches.filter((batch) => batch.work_kind === "audit");
  if (auditBatches.length !== manifest.audit_batch_count
    || (auditRows.length > 0 && auditBatches.length !== 1)
    || (auditBatches.length === 1 && auditBatches[0]!.ordinal !== batches.length - 1)) {
    throw new Error("invalid audit batch cardinality");
  }
  const workBatchId = auditBatches[0]?.batch_id ?? null;
  const members = auditRows.map((member, ordinal) => {
    if (member.ordinal !== ordinal || member.batch_id !== workBatchId) throw new Error("invalid audit member order");
    const value = {
      memory_id: member.memory_id,
      revision: member.revision,
      state_digest: member.state_digest,
      ordinal: member.ordinal,
      selection_basis: member.selection_basis,
      prior_audit_at: member.prior_audit_at,
      member_digest: member.member_digest,
    };
    if (sessionMemoryAuditMemberDigest({
      job_id: manifest.job_id,
      batch_id: member.batch_id,
      work_kind: "audit",
      ...value,
    }) !== member.member_digest) throw new Error("invalid audit member digest");
    return value;
  });
  const selectionDigest = auditSelectionDigest({
    algorithm_digest: manifest.audit_algorithm_digest,
    work_batch_id: workBatchId,
    members,
  });
  if (selectionDigest !== manifest.audit_selection_digest) throw new Error("invalid audit selection digest");
  return {
    algorithm_digest: manifest.audit_algorithm_digest as `sha256:${string}`,
    selection_digest: selectionDigest,
    work_batch_id: workBatchId,
    work_kind: "audit",
    due_count: members.length,
    members,
  };
}

function stableEvidenceBatchId(
  jobId: string,
  planIdentity: string,
  batch: { ordinal: number; source_ids: string[]; content_hashes: string[] },
): string {
  const identity = {
    anchor_job_id: jobId,
    preparation_plan_identity: planIdentity,
    ordinal: batch.ordinal,
    source_ids: batch.source_ids,
    content_hashes: batch.content_hashes,
  };
  return `smc_batch_${createHash("sha256").update(stableJson(identity), "utf8").digest("hex")}`;
}

function frozenMemoryAsSessionRow(row: FrozenMemoryRow): SessionMemoryRow {
  const { job_id: _jobId, memory_id, ordinal: _ordinal, ...memory } = row;
  return { id: memory_id, ...memory };
}

function frozenCanonicalState(
  db: Database,
  jobId: string,
  memory: SessionMemoryRow,
): SessionMemoryCanonicalState {
  const contexts = db.query(
    `SELECT ordinal, repo_path, git_branch, git_commit, git_worktree_id, source_event_ref
     FROM smc_memory_snapshot_contexts WHERE job_id = ? AND memory_id = ? ORDER BY ordinal`,
  ).all(jobId, memory.id) as Array<SessionMemoryCanonicalState["contexts"][number] & { ordinal: number }>;
  contexts.forEach((row, ordinal) => {
    if (row.ordinal !== ordinal) throw new Error("invalid frozen context ordinal");
  });
  const links = db.query(
    `SELECT 'outgoing' AS direction, target_memory_id AS other_memory_id,
            relationship, reason, source_event_refs_json
     FROM smc_memory_snapshot_links
     WHERE job_id = ? AND source_memory_id = ?
     UNION ALL
     SELECT 'incoming' AS direction, source_memory_id AS other_memory_id,
            relationship, reason, source_event_refs_json
     FROM smc_memory_snapshot_links
     WHERE job_id = ? AND target_memory_id = ?`,
  ).all(jobId, memory.id, jobId, memory.id) as Array<{
    direction: "incoming" | "outgoing";
    other_memory_id: string;
    relationship: string;
    reason: string;
    source_event_refs_json: string;
  }>;
  return createSessionMemoryCanonicalState({
    memory_kind: memory.memory_kind,
    title: memory.title,
    summary: memory.summary,
    payload: parseJson(memory.payload_json),
    confidence: memory.confidence,
    risk: memory.risk,
    provider: memory.provider,
    provider_session_id: memory.provider_session_id,
    ingest_job_id: memory.ingest_job_id,
    source_event_refs: parseStringArray(memory.source_event_refs_json),
    status: memory.status,
    superseded_by: memory.superseded_by,
    lifecycle_reason: memory.lifecycle_reason,
    superseded_at: memory.superseded_at,
    retracted_at: memory.retracted_at,
    contexts: contexts.map(({ ordinal: _ordinal, ...context }) => context),
    links: links.map(({ source_event_refs_json, ...link }) => ({
      ...link,
      source_event_refs: parseStringArray(source_event_refs_json),
    })),
  });
}

function validJournal(db: Database, manifest: SMCManifest): boolean {
  const rows = db.query(
    `SELECT * FROM smc_action_journal
     WHERE job_id = ? ORDER BY attempt_id, work_batch_id, sequence`,
  ).all(manifest.job_id) as SMCActionJournalRow[];
  const nextSequence = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.attempt_id}\u0000${row.work_batch_id}`;
    if (row.sequence !== (nextSequence.get(key) ?? 0)) return false;
    nextSequence.set(key, row.sequence + 1);
    if (
      row.protocol_version !== SESSION_MAINTENANCE_TOOL_PROTOCOL_VERSION
      || row.manifest_digest !== manifest.manifest_digest
      || row.snapshot_token !== manifest.snapshot_token
      || digest({
        job_id: row.job_id,
        project_key: manifest.project_key,
        work_batch_id: row.work_batch_id,
        attempt_id: row.attempt_id,
        sequence: row.sequence,
        owner_epoch: row.owner_epoch,
        protocol_version: row.protocol_version,
        manifest_digest: row.manifest_digest,
        snapshot_token: row.snapshot_token,
        expected_overlay_revision: row.expected_overlay_revision,
        action_kind: row.action_kind,
        request: parseJson(row.request_json),
      }) !== row.request_digest
      || digestJson(row.result_json) !== row.result_digest
      || !canonicalJsonString(row.request_json)
      || !canonicalJsonString(row.result_json)
    ) return false;
    const identity = db.query(
      `SELECT 1 FROM session_memory_anchor_attempts t
       JOIN smc_work_batches b ON b.job_id = t.job_id
       WHERE t.job_id = ? AND t.id = ? AND t.owner_epoch = ? AND b.batch_id = ?`,
    ).get(row.job_id, row.attempt_id, row.owner_epoch, row.work_batch_id);
    if (!identity) return false;
  }
  return true;
}

function validateAcceptedBatches(
  db: Database,
  manifest: SMCManifest,
): { kind: "valid"; firstIncomplete: string | null } | { kind: "invalid"; reason: string } {
  const batches = db.query(
    `SELECT batch_id FROM smc_work_batches WHERE job_id = ? ORDER BY ordinal`,
  ).all(manifest.job_id) as Array<{ batch_id: string }>;
  const accepted = db.query(
    `SELECT revision, parent_revision, work_batch_id, response_digest
     FROM smc_overlay_revisions WHERE job_id = ? ORDER BY revision`,
  ).all(manifest.job_id) as Array<{
    revision: number;
    parent_revision: number;
    work_batch_id: string;
    response_digest: string;
  }>;
  for (let index = 0; index < accepted.length; index += 1) {
    const row = accepted[index]!;
    if (
      row.revision !== index + 1
      || row.parent_revision !== index
      || row.work_batch_id !== batches[index]?.batch_id
      || !validDigest(row.response_digest)
    ) return { kind: "invalid", reason: "accepted work-batch sequence or digest changed" };
  }
  if (accepted.length > batches.length) {
    return { kind: "invalid", reason: "accepted work-batch count exceeds the manifest" };
  }
  return { kind: "valid", firstIncomplete: batches[accepted.length]?.batch_id ?? null };
}

function hasFixedProjectionDigest(db: Database, jobId: string): boolean {
  const row = db.query("SELECT followup_state_json FROM ingest_jobs WHERE id = ?").get(jobId) as {
    followup_state_json: string | null;
  } | null;
  if (!row?.followup_state_json) return false;
  try {
    const value = JSON.parse(row.followup_state_json) as { accepted_projection_digest?: unknown };
    return typeof value.accepted_projection_digest === "string" && validDigest(value.accepted_projection_digest);
  } catch {
    return false;
  }
}

function hasBudgetGrant(db: Database, manifest: SMCManifest, ownerEpoch: number): boolean {
  return Boolean(db.query(
    `SELECT 1 FROM smc_budget_grants
     WHERE job_id = ? AND owner_epoch = ? AND manifest_digest = ? LIMIT 1`,
  ).get(manifest.job_id, ownerEpoch, manifest.manifest_digest));
}

function count(db: Database, table: string, jobId: string): number {
  const row = db.query(`SELECT count(*) AS count FROM ${table} WHERE job_id = ?`).get(jobId) as { count: number };
  return row.count;
}

function countWhere(db: Database, table: string, jobId: string, predicate: string): number {
  return (db.query(`SELECT count(*) AS count FROM ${table} WHERE job_id = ? AND ${predicate}`).get(jobId) as {
    count: number;
  }).count;
}

function blocked(code: SMCResumeBlockerCode, reason: string): Extract<ValidateSMCResumeResult, { kind: "blocked" }> {
  return { kind: "blocked", code, reason };
}

function isStaleRecoverablePhase(phase: SessionMemoryAnchorJobPhase): phase is "preparing" | "running" | "finalizing" {
  return phase === "preparing" || phase === "running" || phase === "finalizing";
}

function requireTimestamp(value: string, label: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function canonicalJsonString(value: string): boolean {
  try {
    return stableJson(JSON.parse(value)) === value;
  } catch {
    return false;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseStringArray(value: string): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("expected a JSON string array");
  }
  return parsed;
}

function validDigest(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

function digestJson(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function digestBytes(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digest(value: unknown): `sha256:${string}` {
  return digestJson(stableJson(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inImmediateTransaction<T>(db: Database, callback: () => T): T {
  return db.inTransaction ? callback() : db.transaction(callback).immediate();
}
