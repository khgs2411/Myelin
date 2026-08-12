import type {
  ProjectSessionMutationFenceOwnerKind,
  ProjectSessionMutationFencePhase,
  SessionMemoryAnchorReasonCode,
  SessionMemoryAnchorJobPhase,
} from "../memory/ingest-types.ts";

export const SMC_STATUS_CONTRACT_VERSION = "myelin.smc.status.v1" as const;
export const SMC_CLI_CONTRACT_VERSION = "myelin.smc.cli.v1" as const;

export const SMC_CLI_REASON_CODES = [
  "smc_cli_invalid_arguments",
  "smc_internal_error",
  "smc_status_unavailable",
  "smc_manifest_not_found",
  "smc_anchor_not_found",
  "smc_page_limit_invalid",
  "smc_budget_grant_identity_mismatch",
  "smc_budget_grant_conflict",
  "smc_budget_grant_overflow",
  "invalid_smc_budget_grant_digest",
  "proposal_validation_failed",
  "curator_request_invalid",
  "curator_identity_mismatch",
  "curator_channel_plan_missing",
  "curator_channel_plan_stale",
  "curator_channel_plan_conflict",
  "curator_channel_plan_input_drift",
  "curator_query_obligation_invalid",
  "curator_query_value_not_admitted",
  "curator_channel_coverage_incomplete",
  "curator_cursor_invalid",
  "curator_cursor_stale",
  "curator_overlay_unsearchable",
  "curator_result_ceiling_exceeded",
  "curator_work_set_budget_exceeded",
  "curator_action_charge_conflict",
  "curator_action_charge_missing",
  "curator_action_charge_invalid",
  "curator_budget_exceeded",
  "curator_budget_overflow",
  "curator_record_request_invalid",
  "curator_record_not_found",
  "curator_record_revision_mismatch",
  "curator_record_too_large",
  "embedding_provider_configuration",
  "embedding_provider_unreachable",
  "embedding_provider_unavailable",
  "smc_resume_anchor_not_found",
  "smc_resume_wrong_project",
  "smc_resume_wrong_phase",
  "smc_resume_fence_mismatch",
  "smc_resume_legacy_identity_denied",
  "smc_resume_manifest_missing",
  "smc_resume_manifest_identity_mismatch",
  "smc_resume_lease_identity_mismatch",
  "smc_resume_memory_snapshot_mismatch",
  "smc_resume_governing_identity_mismatch",
  "smc_resume_invocation_identity_mismatch",
  "smc_resume_embedding_identity_mismatch",
  "smc_resume_overlay_identity_mismatch",
  "smc_resume_journal_integrity_mismatch",
  "smc_resume_accepted_batch_identity_mismatch",
  "smc_resume_finalizing_digest_missing",
  "smc_budget_grant_required",
  "smc_coordinator_not_available",
  "smc_coordinator_launch_failed",
  "smc_abandon_anchor_not_found",
  "smc_abandon_wrong_project",
  "smc_abandon_stale_epoch",
  "smc_abandon_wrong_phase",
  "smc_abandon_fence_mismatch",
  "smc_abandon_terminal_conflict",
  "smc_abandon_basis_invalid",
  "smc_abandon_request_conflict",
  "smc_forensic_cleanup_retention_not_configured",
  "smc_forensic_cleanup_invalid_retention",
  "smc_forensic_cleanup_anchor_not_found",
  "smc_forensic_cleanup_wrong_project",
  "smc_forensic_cleanup_stale_epoch",
  "smc_forensic_cleanup_receipt_missing",
  "smc_forensic_cleanup_receipt_mismatch",
  "smc_forensic_cleanup_receipt_invalid",
  "smc_forensic_cleanup_not_eligible",
  "finalization_anchor_not_found",
  "finalization_authority_mismatch",
  "finalization_manifest_mismatch",
  "finalization_manifest_identity_mismatch",
  "finalization_lease_identity_mismatch",
  "finalization_memory_snapshot_mismatch",
  "finalization_embedding_identity_mismatch",
  "finalization_projection_mismatch",
  "finalization_projection_drift",
  "finalization_cas_rejected",
  "finalization_audit_coverage_invalid",
  "finalization_governing_identity_drift",
  "finalization_source_coverage_invalid",
  "finalization_terminal_conflict",
  "finalization_projection_conflict",
  "finalization_receipt_invalid",
] as const;

export type SMCCliReasonCode = (typeof SMC_CLI_REASON_CODES)[number];

export type SMCCliSuccessKind =
  | "status"
  | "manifest"
  | "progress"
  | "batches"
  | "overlay"
  | "journal"
  | "query"
  | "record"
  | "proposal_validation"
  | "finalization"
  | "resume"
  | "abandonment"
  | "budget_grant"
  | "forensic_cleanup";

export type SMCCliSuccess<T = unknown> = Readonly<{
  contract_version: typeof SMC_CLI_CONTRACT_VERSION;
  ok: true;
  kind: SMCCliSuccessKind;
  result: T;
}>;

export type SMCCliFailure = Readonly<{
  contract_version: typeof SMC_CLI_CONTRACT_VERSION;
  ok: false;
  kind: "blocked";
  reason_code: SMCCliReasonCode;
  detail: string;
  retryable?: boolean;
  result?: unknown;
}>;

export type SMCCliResult<T = unknown> = SMCCliSuccess<T> | SMCCliFailure;

export type SMCStatusReasonCode =
  | "smc_authority_not_activated"
  | "smc_content_pending"
  | "smc_anchor_active"
  | "smc_followup_required"
  | "smc_audit_due"
  | "smc_index_pending"
  | "smc_index_failed"
  | "smc_embedding_provider_unreachable"
  | "smc_embedding_provider_unavailable"
  | "smc_project_fence_busy"
  | "smc_global_embedding_fence_busy"
  | "smc_legacy_identity_permanently_denied";

export type SMCDiagnosticProcessState = Readonly<{
  authority: "diagnostic_only";
  process_id: number | null;
  liveness: "alive" | "not_alive" | "not_recorded" | "not_checked";
}>;

export type SMCStatusV1 = Readonly<{
  contract_version: typeof SMC_STATUS_CONTRACT_VERSION;
  kind: "session_memory_curator_status";
  generated_at: string;
  project_key: string;
  authority_mode: "legacy_compatibility" | "smc_v1";
  queued_content: Readonly<{
    count: number;
    oldest_inserted_at: string | null;
    oldest_age_ms: number | null;
  }>;
  current_anchor: Readonly<{
    job_id: string;
    phase: SessionMemoryAnchorJobPhase;
    owner_epoch: number;
    reason_code: SessionMemoryAnchorReasonCode | null;
    heartbeat_at: string;
    attempt_id: string | null;
    provider: string | null;
    process: SMCDiagnosticProcessState;
    permanently_denied_legacy_identity: boolean;
  }> | null;
  project_fence: Readonly<{
    owner_id: string;
    owner_kind: ProjectSessionMutationFenceOwnerKind;
    phase: ProjectSessionMutationFencePhase;
    owner_epoch: number;
    heartbeat_at: string;
  }> | null;
  global_embedding_fence: Readonly<{
    operation_id: string;
    operation_kind: string;
    phase: string;
    owner_epoch: number;
    heartbeat_at: string;
    active_contract_id: string | null;
    target_contract_id: string | null;
  }> | null;
  freshness: Readonly<{
    state: "current" | "pending" | "blocked";
    last_completed_at: string | null;
    queued_content_count: number;
  }>;
  audit_coverage: Readonly<{
    active_revision_count: number;
    covered_revision_count: number;
    due_revision_count: number;
  }>;
  indexing: Readonly<{
    state: "ready" | "pending" | "degraded" | "unavailable";
    active_memory_count: number;
    indexed_count: number;
    pending_count: number;
    failed_count: number;
    provider_state: "not_checked" | "available" | "unreachable" | "unavailable";
  }>;
  legacy: Readonly<{
    permanently_denied_job_count: number;
  }>;
  reason_codes: readonly SMCStatusReasonCode[];
}>;
