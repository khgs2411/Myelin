export const INGEST_JOB_STATUSES = ["starting", "running", "needs_followup", "completed", "failed"] as const;
export type IngestJobStatus = (typeof INGEST_JOB_STATUSES)[number];

export const INGEST_COMPLETION_LAYERS = {
  EXPERIENCE_LOG_DRAIN_PENDING: 10,
  EXPERIENCE_LOG_DRAIN_COMPLETE: 20,
  SESSION_MEMORY_WRITE_COMPLETE: 30,
  SESSION_MEMORY_RETRIEVAL_PENDING: 40,
} as const;
export type IngestCompletionLayer = (typeof INGEST_COMPLETION_LAYERS)[keyof typeof INGEST_COMPLETION_LAYERS];

export const MEMORY_SCOPES = ["session", "project", "practice", "personal"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const HANDOFF_SCOPES = ["project", "practice", "personal"] as const;
export type HandoffScope = (typeof HANDOFF_SCOPES)[number];

export const MEMORY_CANDIDATE_STATUSES = ["pending", "needs_review", "processed", "rejected"] as const;
export type MemoryCandidateStatus = (typeof MEMORY_CANDIDATE_STATUSES)[number];

export const SESSION_MEMORY_KINDS = ["continuity", "decision", "blocker", "next_action", "verification"] as const;
export type SessionMemoryKind = (typeof SESSION_MEMORY_KINDS)[number];

export const SESSION_MEMORY_STATUSES = ["active", "superseded", "retracted"] as const;
export type SessionMemoryStatus = (typeof SESSION_MEMORY_STATUSES)[number];

export const SESSION_MEMORY_MUTATION_AUTHORITY_MODES = ["legacy_compatibility", "smc_v1"] as const;
export type SessionMemoryMutationAuthorityMode = (typeof SESSION_MEMORY_MUTATION_AUTHORITY_MODES)[number];

export const SESSION_MEMORY_ANCHOR_JOB_PHASES = [
  "preparing",
  "running",
  "needs_followup",
  "finalizing",
  "completed",
  "abandoned",
] as const;
export type SessionMemoryAnchorJobPhase = (typeof SESSION_MEMORY_ANCHOR_JOB_PHASES)[number];

export const SESSION_MEMORY_ANCHOR_REASON_CODES = [
  "legacy_state_missing_smc_manifest",
  "stale_receiptless_finalizing",
  "stale_preparing_owner",
  "stale_running_owner",
  "stale_needs_followup_owner",
  "stale_finalizing_owner",
  "budget_exhausted",
  "budget_state_invalid",
  "smc_budget_grant_required",
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
  "smc_coordinator_not_available",
  "smc_coordinator_launch_failed",
  "smc_internal_error",
  "smc_abandoned_by_operator",
  "companion_worker_failed",
  "provider_identity_invalid",
  "provider_envelope_invalid",
  "provider_envelope_budget_exceeded",
  "provider_interrupted",
  "provider_transport_error",
  "curator_identity_mismatch",
  "curator_work_set_budget_exceeded",
  "curator_budget_exceeded",
  "curator_budget_overflow",
  "embedding_provider_configuration",
  "embedding_provider_unreachable",
  "embedding_provider_unavailable",
  "overlay_batch_conflict",
  "overlay_identity_mismatch",
  "overlay_search_index_incomplete",
  "insufficient_evidence",
  "proposal_incomplete",
  "repository_verification_failed",
  "retrieval_unavailable",
] as const;
export type SessionMemoryAnchorReasonCode = (typeof SESSION_MEMORY_ANCHOR_REASON_CODES)[number];

export type SessionMemoryAnchorJobRow = {
  job_id: string;
  project_key: string;
  phase: SessionMemoryAnchorJobPhase;
  owner_epoch: number;
  reason_code: SessionMemoryAnchorReasonCode | null;
  heartbeat_at: string;
  created_at: string;
  updated_at: string;
};

export type SessionMemoryAnchorAttemptRow = {
  id: string;
  job_id: string;
  attempt_number: number;
  owner_epoch: number;
  attempt_kind: "legacy" | "smc";
  provider: string;
  provider_session_id: string | null;
  process_id: number | null;
  status: "running" | "needs_followup" | "completed" | "failed" | "abandoned";
  started_at: string | null;
  finished_at: string | null;
  details_json: string;
  created_at: string;
  updated_at: string;
};

export type LegacySessionJobDenyIdentityRow = {
  job_id: string;
  project_key: string;
  reason_code: "pre_smc_job_identity";
  source_status: IngestJobStatus;
  denied_at: string;
};

export const SMC_OVERLAY_RECORD_KINDS = [
  "memory",
  "memory_disposition",
  "candidate",
  "handoff",
  "source_disposition",
] as const;
export type SMCOverlayRecordKind = (typeof SMC_OVERLAY_RECORD_KINDS)[number];

export type SMCOverlayStateRow = {
  job_id: string;
  current_revision: number;
  current_digest: string;
  updated_at: string;
};

export type SMCOverlayRecordRow = {
  job_id: string;
  revision: number;
  record_kind: SMCOverlayRecordKind;
  staged_id: string;
  stable_key: string;
  operation: "upsert" | "discard";
  base_memory_id: string | null;
  final_id: string | null;
  payload_json: string | null;
  payload_digest: string | null;
  created_at: string;
};

export type SMCJournalActionKind = "query" | "fetch_record" | "submit_proposal" | "blocker";

export type SMCActionJournalRow = {
  job_id: string;
  work_batch_id: string;
  attempt_id: string;
  sequence: number;
  owner_epoch: number;
  protocol_version: string;
  manifest_digest: string;
  snapshot_token: string;
  expected_overlay_revision: number;
  action_kind: SMCJournalActionKind;
  request_json: string;
  request_digest: string;
  result_json: string;
  result_digest: string;
  created_at: string;
};

export type SMCTerminalReceiptKind = "finalization" | "abandonment";
export type SMCTerminalBasisKind = "smc_manifest" | "legacy_quarantine";

export type SMCTerminalReceiptRow = {
  job_id: string;
  id: string;
  schema_version: 1;
  receipt_kind: SMCTerminalReceiptKind;
  terminal_basis_kind: SMCTerminalBasisKind;
  terminal_basis_digest: string;
  target_owner_epoch: number;
  result_json: string;
  result_digest: string;
  receipt_digest: string;
  created_at: string;
};

export const PROJECT_SESSION_MUTATION_FENCE_PHASES = [
  "preparing",
  "running",
  "needs_followup",
  "finalizing",
  "completed",
  "abandoned",
] as const;
export type ProjectSessionMutationFencePhase = (typeof PROJECT_SESSION_MUTATION_FENCE_PHASES)[number];

export const PROJECT_SESSION_MUTATION_FENCE_OWNER_KINDS = ["anchor_job", "repair"] as const;
export type ProjectSessionMutationFenceOwnerKind = (typeof PROJECT_SESSION_MUTATION_FENCE_OWNER_KINDS)[number];

export type ProjectSessionMutationFenceRow = {
  project_key: string;
  owner_id: string;
  owner_kind: ProjectSessionMutationFenceOwnerKind;
  phase: ProjectSessionMutationFencePhase;
  owner_epoch: number;
  heartbeat_at: string;
  acquired_at: string;
  terminal_receipt_id: string | null;
};

export const SESSION_MEMORY_LINK_RELATIONSHIPS = ["supersedes", "refines", "contradicts", "duplicates"] as const;
export type SessionMemoryLinkRelationship = (typeof SESSION_MEMORY_LINK_RELATIONSHIPS)[number];

export const TOMBSTONE_STATES = ["claimed", "output", "no_output", "failed", "unfinished"] as const;
export type TombstoneState = (typeof TOMBSTONE_STATES)[number];

export type IngestJobRow = {
  id: string;
  project_key: string;
  status: IngestJobStatus;
  provider: string;
  provider_session_id: string | null;
  requested_by: string | null;
  input_json: string;
  output_counts_json: string;
  terminal_summary: string | null;
  error_json: string | null;
  followup_state_json: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SessionMemoryRow = {
  id: string;
  project_key: string;
  provider: string | null;
  provider_session_id: string | null;
  ingest_job_id: string | null;
  source_event_refs_json: string;
  memory_kind: SessionMemoryKind;
  title: string | null;
  summary: string;
  payload_json: string;
  confidence: string;
  risk: string;
  status: SessionMemoryStatus;
  superseded_by: string | null;
  lifecycle_reason: string | null;
  superseded_at: string | null;
  retracted_at: string | null;
  revision: number;
  state_digest: string;
  created_at: string;
  updated_at: string;
};

export type MemoryCandidateRow = {
  id: string;
  project_key: string;
  scope: MemoryScope;
  status: MemoryCandidateStatus;
  candidate_type: string;
  title: string | null;
  summary: string;
  source_event_refs_json: string;
  evidence_json: string;
  proposed_payload_json: string;
  confidence: string;
  risk: string;
  reason: string;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
};

export type HandoffInstructionRow = {
  id: string;
  project_key: string;
  status: MemoryCandidateStatus;
  objective: string;
  prompt_text: string;
  source_session_memory_ids_json: string;
  source_event_refs_json: string;
  suggested_actions_json: string;
  reason: string;
  confidence: string;
  risk: string;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
};

export type ExperienceEventTombstoneRow = {
  id: string;
  original_event_id: string;
  dedupe_key: string | null;
  project_key: string;
  ingest_job_id: string | null;
  provider: string | null;
  provider_session_id: string | null;
  claimed_at: string;
  finalized_at: string | null;
  state: TombstoneState;
  terminal_decision: string | null;
  source_metadata_json: string;
  retained_evidence_json: string;
  output_references_json: string;
};
