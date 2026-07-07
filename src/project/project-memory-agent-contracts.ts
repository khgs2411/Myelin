export const PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS = [
  "applied_to_project_memory",
  "already_covered",
  "insufficient_evidence",
  "not_durable",
  "belongs_to_other_layer",
  "deferred_unsafe_change",
  "blocked_by_runner_failure",
] as const;

export type ProjectMemoryAgentCandidateDisposition =
  (typeof PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS)[number];

export const PROJECT_MEMORY_LEGACY_CANDIDATE_DISPOSITION_ALIASES = {
  already_trusted: "already_covered",
} as const satisfies Record<string, ProjectMemoryAgentCandidateDisposition>;

export function normalizeProjectMemoryAgentCandidateDisposition(
  value: unknown,
): ProjectMemoryAgentCandidateDisposition | null {
  if (typeof value !== "string") return null;
  if (isProjectMemoryAgentCandidateDisposition(value)) return value;
  return PROJECT_MEMORY_LEGACY_CANDIDATE_DISPOSITION_ALIASES[
    value as keyof typeof PROJECT_MEMORY_LEGACY_CANDIDATE_DISPOSITION_ALIASES
  ] ?? null;
}

export function isProjectMemoryAgentCandidateDisposition(
  value: unknown,
): value is ProjectMemoryAgentCandidateDisposition {
  return (
    typeof value === "string" &&
    PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS.includes(value as ProjectMemoryAgentCandidateDisposition)
  );
}

export type ProjectMemoryAgentProviderMode = "live" | "stub" | "test";
export type ProjectMemoryAgentCurationKind = "agent_authored" | "human_reviewed";
export type ProjectMemoryAgentRunKind = "create" | "maintenance" | "create_then_maintenance" | "recreate";
export type ProjectMemoryAgentRunStatus = "completed" | "completed_with_pending_index" | "degraded" | "failed";

export type ProjectMemorySubjectManifest = {
  schema_version: 1;
  project_key: string;
  subjects: ProjectMemorySubjectManifestEntry[];
};

export type ProjectMemorySubjectManifestEntry = {
  subject_id: string;
  wiki_path: string;
  title: string;
  purpose: string;
  suggested_repo_paths: string[];
  depends_on_subject_ids?: string[];
};

export type ProjectMemorySubjectReport = {
  schema_version: 1;
  project_key: string;
  subject_id: string;
  wiki_path: string;
  status: "completed" | "failed";
  evidence_paths: string[];
  touched_paths: string[];
  known_gaps: string[];
  error?: string;
};

export type ProjectMemoryMaintenanceDisposition = {
  source_kind: "project_candidate" | "project_handoff";
  source_ref: string;
  disposition: ProjectMemoryAgentCandidateDisposition;
  reason: string;
  output_refs: string[];
};

export type ProjectMemoryMaintenanceReport = {
  schema_version: 1;
  project_key: string;
  status: "completed" | "degraded" | "failed";
  dispositions: ProjectMemoryMaintenanceDisposition[];
  touched_paths: string[];
  evidence_paths: string[];
  known_gaps: string[];
};

export type ProjectMemoryAgentStateV2 = {
  schema_version: 2;
  project_key: string;
  status: "curated" | "degraded" | "failed";
  source_run_dir: string;
  updated_at: string;
  provider_mode: ProjectMemoryAgentProviderMode;
  curation_kind: ProjectMemoryAgentCurationKind;
  run_kind: ProjectMemoryAgentRunKind;
  create?: {
    status: "completed" | "failed" | "skipped";
    planner_status: "completed" | "failed";
    subject_writer_status: "completed" | "failed" | "partial_failed";
    subject_count: number;
    subject_writer_concurrency_limit: number;
    subject_writer_retry_limit: number;
    manifest_ref?: string;
    planner_report_ref?: string;
    subject_report_refs: string[];
    pre_maintenance_wiki_ref?: string;
  };
  maintenance?: {
    status: "completed" | "noop" | "degraded" | "skipped" | "failed";
    report_ref?: string;
    dispositions_count: number;
    applied_count: number;
    already_covered_count: number;
    degraded_reason?: string;
    degraded_reasons: string[];
  };
  retrieval_readiness: {
    status: "ready" | "pending" | "degraded" | "not_applicable";
    checked_at: string;
    reason?: string;
  };
  content_quality?: {
    status: "not_evaluated";
    reason: "agent_authored_documentation_has_no_schema_quality_gate";
  };
};
