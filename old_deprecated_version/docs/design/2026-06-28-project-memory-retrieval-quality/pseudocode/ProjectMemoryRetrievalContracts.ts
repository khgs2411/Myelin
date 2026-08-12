// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination: src/project/project-memory-retrieval-contracts.ts
// Owns Project Memory retrieval vocabulary shared by lookup, packet, curator validation,
// indexer, and retrieval maintenance. Does not own storage or provider calls.

type ProjectMemoryRetrievalMethod =
  | "indexed_section_retrieval"
  | "fallback_markdown_search"
  | "unavailable";

type ProjectMemoryLookupQuality =
  | "indexed"
  | "fallback"
  | "unavailable";

type ProjectMemoryLookupFreshness =
  | "fresh"
  | "stale"
  | "orphaned"
  | "unknown"
  | "not_applicable";

type ProjectMemoryApplySeverity =
  | "advisory"
  | "proposal_scoped"
  | "blocking";

type ProjectMemoryCanonicalSectionRef = {
  project_key: string;
  wiki_path: string;              // "wiki/architecture/ranking-and-proposal-generation.md"
  category: string | null;        // "architecture", null for wiki/index.md
  page_title: string;
  section_id: string;             // deterministic within page
  heading_path: string[];         // ["Ranking And Proposal Generation", "Impact Ranking"]
  section_hash: string;           // sha256 over normalized section body + heading path
};

type ProjectMemoryLookupResultId = string; // stable per packet lookup result row.

type ProjectMemoryLookupHit = {
  id: string; // stable within lookup result.
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

type ProjectMemoryLookupResult = {
  id: ProjectMemoryLookupResultId;
  query: string;
  source_kind: "project_handoff" | "project_candidate" | "session_memory" | "manual" | "retrieval_maintenance";
  source_id: string;
  retrieval_method: ProjectMemoryRetrievalMethod;
  lookup_quality: ProjectMemoryLookupQuality;
  lookup_freshness: ProjectMemoryLookupFreshness;
  apply_severity: ProjectMemoryApplySeverity;
  degraded_reason?: string;
  hits: ProjectMemoryLookupHit[];
  source_tools: string[];
};

type ProjectMemoryEvidenceDependency = {
  kind: "lookup_result" | "canonical_section" | "project_candidate" | "project_handoff" | "session_memory" | "repo_citation";
  ref: string;
  required_for: "target_selection" | "dedupe" | "supersession" | "conflict_check" | "content_support" | "noop_support";
  minimum_quality?: ProjectMemoryLookupQuality;
  minimum_freshness?: ProjectMemoryLookupFreshness;
};

type ExplicitNoOpDecision = {
  id: string;
  source_packet_refs: ProjectMemoryEvidenceDependency[];
  checked_existing_memory_refs: ProjectMemoryEvidenceDependency[];
  reason: "already_trusted" | "not_durable" | "belongs_to_other_layer" | "insufficient_evidence" | "duplicate_or_superseded";
  explanation: string;
};

type ProjectMemoryLookupQualitySummary = {
  blocking: boolean;
  blocking_reasons: string[];
  advisory_reasons: string[];
  proposal_scoped_result_ids: ProjectMemoryLookupResultId[];
};

// Relationship notes:
// - Packet-level degraded booleans should eventually be replaced or derived from this summary.
// - Validation uses EvidenceDependency records instead of assuming every low-quality lookup affects every proposal.
// - ExplicitNoOpDecision is the only way fallback lookup plus zero proposals can become completed/no-op.
