import type { SessionMemoryKind } from "./ingest-types.ts";
import type { SessionMemoryContextRow } from "./session-memory-contexts.ts";

export const SESSION_CONTINUITY_REASON_CODES = [
  "no_eligible_anchor_job",
  "content_events_unleased",
  "content_events_leased",
  "ingest_running",
  "mixed_control_content_provenance",
  "newer_ineligible_ingest_job",
  "channel_memory_excluded",
] as const;

export type SessionContinuityReasonCode = (typeof SESSION_CONTINUITY_REASON_CODES)[number];

export type SessionContinuityExclusionReason =
  | "missing_ingest_job_id"
  | "missing_ingest_job"
  | "missing_source_reference"
  | "missing_tombstone"
  | "foreign_project_tombstone"
  | "cross_job_tombstone"
  | "non_output_tombstone"
  | "missing_output_backreference"
  | "malformed_source_metadata"
  | "control_only_provenance";

export type SessionContinuityChannelName =
  | "anchor_job"
  | "current_state"
  | "completed_outcomes"
  | "active_blockers"
  | "next_actions"
  | "recent_decisions";

export type SessionContinuityProvenance = {
  state: "content_only" | "mixed_control_content";
  source_event_refs: string[];
  content_event_refs: string[];
  control_event_refs: string[];
};

export type SessionContinuityItem = {
  id: string;
  memory_kind: SessionMemoryKind;
  title: string | null;
  summary: string;
  confidence: string;
  risk: string;
  created_at: string;
  updated_at: string;
  ingest_job_id: string;
  relation_to_anchor: "anchor_job" | "prior_job";
  provenance: SessionContinuityProvenance;
  contexts: SessionMemoryContextRow[];
};

export type SessionContinuityChannel = {
  selection: "latest_eligible_ingest_job" | "all_eligible_active";
  selected_ingest_job_id: string | null;
  items: SessionContinuityItem[];
};

export type SessionContinuityExclusion = {
  memory_id: string;
  channel: SessionContinuityChannelName;
  reason: SessionContinuityExclusionReason;
};

export type SessionCurrentContinuityV1 = {
  contract_version: "myelin.session_continuity.v1";
  kind: "session_current_continuity";
  state: "ready" | "lagging" | "degraded" | "unavailable";
  reason_codes: SessionContinuityReasonCode[];
  freshness: {
    state: "current" | "lagging";
    queued_content_events: number;
    unleased_content_events: number;
    leased_content_events: number;
    running_ingest_jobs: number;
  };
  integrity: { state: "valid" | "degraded" };
  anchor_job: {
    ingest_job_id: string;
    latest_memory_created_at: string;
    job_status: string;
    provenance_state: "content_only" | "mixed_control_content";
    memory_ids: string[];
  } | null;
  current_state: SessionContinuityChannel;
  completed_outcomes: SessionContinuityChannel;
  active_blockers: SessionContinuityChannel;
  next_actions: SessionContinuityChannel;
  recent_decisions: SessionContinuityChannel;
  exclusions: SessionContinuityExclusion[];
};
