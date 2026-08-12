import type { Database } from "bun:sqlite";
import { countExperienceContentEvents, oldestExperienceContentInsertedAt } from "../memory/experience.ts";
import {
  inspectProjectSessionMutationFence,
  readSessionMemoryMutationAuthorityMode,
} from "../memory/project-session-mutation-fence.ts";
import { inspectSessionEmbeddingLifecycleFence } from "../memory/session-embedding-lifecycle-fence.ts";
import type { EmbeddingConfig, ModelProfile, SMCPlanConfig } from "../runtime/config.ts";
import { inspectEmbeddingRetrievalStatus } from "../status/embedding-retrieval-status.ts";
import { selectDueSessionMemoryAuditPartition } from "./audit-selection.ts";
import { defaultSMCGoverningIdentities } from "./evidence-selection.ts";
import { listCurrentSessionMemoryAuditCoverage } from "./audit-receipts.ts";
import { getSessionMemoryAnchorJob, listSessionMemoryAnchorAttempts } from "./job-lifecycle.ts";
import {
  SMC_STATUS_CONTRACT_VERSION,
  type SMCDiagnosticProcessState,
  type SMCStatusReasonCode,
  type SMCStatusV1,
} from "./status-types.ts";

export function readSessionMemoryCuratorStatus(
  db: Database,
  input: {
    project_key: string;
    generated_at: string;
    embedding_config: EmbeddingConfig;
    ingest_profile: ModelProfile;
    plan_config: SMCPlanConfig | null;
    provider_state?: SMCStatusV1["indexing"]["provider_state"];
    is_process_alive?: (pid: number) => boolean;
  },
): SMCStatusV1 {
  const authorityMode = readSessionMemoryMutationAuthorityMode(db);
  const queuedCount = countExperienceContentEvents(db, input.project_key);
  const oldestInsertedAt = oldestExperienceContentInsertedAt(db, input.project_key);
  const oldestAgeMs = oldestInsertedAt === null
    ? null
    : Math.max(0, Date.parse(input.generated_at) - Date.parse(oldestInsertedAt));
  const projectFence = inspectProjectSessionMutationFence(db, input.project_key);
  const globalFence = inspectSessionEmbeddingLifecycleFence(db);
  const anchor = projectFence?.owner_kind === "anchor_job"
    ? getSessionMemoryAnchorJob(db, projectFence.owner_id)
    : latestNonterminalAnchor(db, input.project_key);
  const attempt = anchor
    ? listSessionMemoryAnchorAttempts(db, anchor.job_id)
      .filter((row) => row.owner_epoch === anchor.owner_epoch)
      .at(-1) ?? null
    : null;
  const deniedCount = scalar(db,
    "SELECT count(*) AS count FROM legacy_session_job_deny_identities WHERE project_key = ?",
    input.project_key);
  const deniedCurrent = anchor
    ? Boolean(db.query("SELECT 1 FROM legacy_session_job_deny_identities WHERE job_id = ?").get(anchor.job_id))
    : false;
  const completed = db.query(
    `SELECT max(updated_at) AS updated_at FROM session_memory_anchor_jobs
     WHERE project_key = ? AND phase = 'completed'`,
  ).get(input.project_key) as { updated_at: string | null };
  const identities = defaultSMCGoverningIdentities({
    provider: input.ingest_profile.provider,
    model: input.ingest_profile.model ?? null,
    reasoning_effort: input.ingest_profile.reasoningEffort ?? null,
  });
  const coveredRevisionCount = listCurrentSessionMemoryAuditCoverage(db, {
    project_key: input.project_key,
    policy: identities.policy,
    output_contract: identities.output_contract,
    tool_protocol: identities.tool_protocol,
  }).length;
  const activeRevisionCount = scalar(db,
    "SELECT count(*) AS count FROM session_memories WHERE project_key = ? AND status = 'active'",
    input.project_key);
  const dueRevisionCount = input.plan_config
    ? selectDueSessionMemoryAuditPartition(db, {
      project_key: input.project_key,
      governing_identities: identities,
      limit: input.plan_config.auditPartitionLimit,
    }).due_count
    : Math.max(0, activeRevisionCount - coveredRevisionCount);
  const retrieval = inspectEmbeddingRetrievalStatus({
    db,
    projectKey: input.project_key,
    scope: "session_memory",
    config: input.embedding_config,
  });
  const providerState = input.provider_state ?? "not_checked";
  const indexingState = providerState === "unreachable" || providerState === "unavailable"
    ? "unavailable"
    : retrieval.failed_count > 0
      ? "degraded"
      : retrieval.pending_count > 0 || retrieval.indexed_count < retrieval.active_memory_count
        ? "pending"
        : "ready";
  const blocked = anchor?.phase === "needs_followup"
    || globalFence !== null
    || (projectFence !== null && projectFence.owner_kind !== "anchor_job");
  const freshnessState = blocked ? "blocked"
    : queuedCount > 0 || Boolean(anchor && ["preparing", "running", "finalizing"].includes(anchor.phase))
      ? "pending"
      : "current";
  const reasonCodes = new Set<SMCStatusReasonCode>();
  if (authorityMode !== "smc_v1") reasonCodes.add("smc_authority_not_activated");
  if (queuedCount > 0) reasonCodes.add("smc_content_pending");
  if (anchor && ["preparing", "running", "finalizing"].includes(anchor.phase)) reasonCodes.add("smc_anchor_active");
  if (anchor?.phase === "needs_followup") reasonCodes.add("smc_followup_required");
  if (dueRevisionCount > 0) reasonCodes.add("smc_audit_due");
  if (indexingState === "pending") reasonCodes.add("smc_index_pending");
  if (retrieval.failed_count > 0) reasonCodes.add("smc_index_failed");
  if (providerState === "unreachable") reasonCodes.add("smc_embedding_provider_unreachable");
  if (providerState === "unavailable") reasonCodes.add("smc_embedding_provider_unavailable");
  if (projectFence) reasonCodes.add("smc_project_fence_busy");
  if (globalFence) reasonCodes.add("smc_global_embedding_fence_busy");
  if (deniedCount > 0) reasonCodes.add("smc_legacy_identity_permanently_denied");

  return {
    contract_version: SMC_STATUS_CONTRACT_VERSION,
    kind: "session_memory_curator_status",
    generated_at: input.generated_at,
    project_key: input.project_key,
    authority_mode: authorityMode,
    queued_content: { count: queuedCount, oldest_inserted_at: oldestInsertedAt, oldest_age_ms: oldestAgeMs },
    current_anchor: anchor ? {
      job_id: anchor.job_id,
      phase: anchor.phase,
      owner_epoch: anchor.owner_epoch,
      reason_code: anchor.reason_code,
      heartbeat_at: anchor.heartbeat_at,
      attempt_id: attempt?.id ?? null,
      provider: attempt?.provider ?? null,
      process: processDiagnostic(attempt?.process_id ?? null, input.is_process_alive),
      permanently_denied_legacy_identity: deniedCurrent,
    } : null,
    project_fence: projectFence ? {
      owner_id: projectFence.owner_id,
      owner_kind: projectFence.owner_kind,
      phase: projectFence.phase,
      owner_epoch: projectFence.owner_epoch,
      heartbeat_at: projectFence.heartbeat_at,
    } : null,
    global_embedding_fence: globalFence ? {
      operation_id: globalFence.operation_id,
      operation_kind: globalFence.operation_kind,
      phase: globalFence.phase,
      owner_epoch: globalFence.owner_epoch,
      heartbeat_at: globalFence.heartbeat_at,
      active_contract_id: globalFence.active_contract_id,
      target_contract_id: globalFence.target_contract_id,
    } : null,
    freshness: {
      state: freshnessState,
      last_completed_at: completed.updated_at,
      queued_content_count: queuedCount,
    },
    audit_coverage: {
      active_revision_count: activeRevisionCount,
      covered_revision_count: coveredRevisionCount,
      due_revision_count: dueRevisionCount,
    },
    indexing: {
      state: indexingState,
      active_memory_count: retrieval.active_memory_count,
      indexed_count: retrieval.indexed_count,
      pending_count: retrieval.pending_count,
      failed_count: retrieval.failed_count,
      provider_state: providerState,
    },
    legacy: { permanently_denied_job_count: deniedCount },
    reason_codes: [...reasonCodes].sort(),
  };
}

export function withSMCProviderState(
  status: SMCStatusV1,
  providerState: SMCStatusV1["indexing"]["provider_state"],
): SMCStatusV1 {
  const reasons = new Set(status.reason_codes);
  reasons.delete("smc_embedding_provider_unreachable");
  reasons.delete("smc_embedding_provider_unavailable");
  if (providerState === "unreachable") reasons.add("smc_embedding_provider_unreachable");
  if (providerState === "unavailable") reasons.add("smc_embedding_provider_unavailable");
  const state = providerState === "unreachable" || providerState === "unavailable"
    ? "unavailable"
    : status.indexing.failed_count > 0
      ? "degraded"
      : status.indexing.pending_count > 0
        || status.indexing.indexed_count < status.indexing.active_memory_count
        ? "pending"
        : "ready";
  return {
    ...status,
    indexing: { ...status.indexing, state, provider_state: providerState },
    reason_codes: [...reasons].sort(),
  };
}

function latestNonterminalAnchor(db: Database, projectKey: string) {
  return db.query(
    `SELECT * FROM session_memory_anchor_jobs
     WHERE project_key = ? AND phase IN ('preparing','running','needs_followup','finalizing')
     ORDER BY updated_at DESC, job_id DESC LIMIT 1`,
  ).get(projectKey) as ReturnType<typeof getSessionMemoryAnchorJob>;
}

function processDiagnostic(
  pid: number | null,
  isAlive: ((pid: number) => boolean) | undefined,
): SMCDiagnosticProcessState {
  if (pid === null) return { authority: "diagnostic_only", process_id: null, liveness: "not_recorded" };
  if (!isAlive) return { authority: "diagnostic_only", process_id: pid, liveness: "not_checked" };
  return {
    authority: "diagnostic_only",
    process_id: pid,
    liveness: isAlive(pid) ? "alive" : "not_alive",
  };
}

function scalar(db: Database, sql: string, value: string): number {
  return (db.query(sql).get(value) as { count: number }).count;
}
