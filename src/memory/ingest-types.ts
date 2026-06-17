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
