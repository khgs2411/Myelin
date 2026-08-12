export const PROJECT_MEMORY_RETRIEVAL_METHODS = [
  "indexed_section_retrieval",
  "fallback_markdown_search",
  "unavailable",
] as const;

export const PROJECT_MEMORY_LOOKUP_QUALITIES = ["indexed", "fallback", "unavailable"] as const;

export const PROJECT_MEMORY_LOOKUP_FRESHNESS_VALUES = [
  "fresh",
  "stale",
  "orphaned",
  "unknown",
  "not_applicable",
] as const;

export const PROJECT_MEMORY_APPLY_SEVERITIES = ["advisory", "proposal_scoped", "blocking"] as const;

export type ProjectMemoryRetrievalMethod = (typeof PROJECT_MEMORY_RETRIEVAL_METHODS)[number];
export type ProjectMemoryLookupQuality = (typeof PROJECT_MEMORY_LOOKUP_QUALITIES)[number];
export type ProjectMemoryLookupFreshness = (typeof PROJECT_MEMORY_LOOKUP_FRESHNESS_VALUES)[number];
export type ProjectMemoryApplySeverity = (typeof PROJECT_MEMORY_APPLY_SEVERITIES)[number];

export type ProjectMemoryCanonicalSectionRef = {
  project_key: string;
  wiki_path: string;
  category: string | null;
  page_title: string;
  section_id: string;
  heading_path: string[];
  section_hash: string;
};

export type ProjectMemoryLookupResultId = string;

export type ProjectMemoryLookupHit = {
  id: string;
  canonical_ref: ProjectMemoryCanonicalSectionRef | null;
  score: number;
  distance?: number;
  snippet: string;
  matched_terms?: string[];
  source_components: {
    structural_text: boolean;
    retrieval_hints: boolean;
    fallback_text: boolean;
  };
  freshness: ProjectMemoryLookupFreshness;
  stale_reason?: string;
};

export type ProjectMemoryLookupSourceKind =
  | "project_handoff"
  | "project_candidate"
  | "session_memory"
  | "manual"
  | "retrieval_maintenance";

export type ProjectMemoryLookupResult = {
  id: ProjectMemoryLookupResultId;
  query: string;
  source_kind: ProjectMemoryLookupSourceKind;
  source_id: string;
  retrieval_method: ProjectMemoryRetrievalMethod;
  lookup_quality: ProjectMemoryLookupQuality;
  lookup_freshness: ProjectMemoryLookupFreshness;
  apply_severity: ProjectMemoryApplySeverity;
  degraded_reason?: string;
  hits: ProjectMemoryLookupHit[];
  source_tools: string[];
};

export type ProjectMemoryEvidenceDependencyKind =
  | "lookup_result"
  | "canonical_section"
  | "project_candidate"
  | "project_handoff"
  | "session_memory"
  | "repo_citation";

export type ProjectMemoryEvidenceDependency = {
  kind: ProjectMemoryEvidenceDependencyKind;
  ref: string;
  required_for:
    | "target_selection"
    | "dedupe"
    | "supersession"
    | "conflict_check"
    | "content_support"
    | "noop_support";
  minimum_quality?: ProjectMemoryLookupQuality;
  minimum_freshness?: ProjectMemoryLookupFreshness;
};

export type ExplicitNoOpDecision = {
  id: string;
  source_packet_refs: ProjectMemoryEvidenceDependency[];
  checked_existing_memory_refs: ProjectMemoryEvidenceDependency[];
  reason: ProjectMemoryExplicitNoOpDisposition;
  explanation: string;
};

export type ProjectMemoryExplicitNoOpDisposition = Extract<
  ProjectMemoryAgentCandidateDisposition,
  "already_covered" | "not_durable" | "belongs_to_other_layer" | "insufficient_evidence"
>;

export type ProjectMemoryLookupQualitySummary = {
  blocking: boolean;
  blocking_reasons: string[];
  advisory_reasons: string[];
  proposal_scoped_result_ids: ProjectMemoryLookupResultId[];
};
import type { ProjectMemoryAgentCandidateDisposition } from "./project-memory-agent-contracts.ts";
