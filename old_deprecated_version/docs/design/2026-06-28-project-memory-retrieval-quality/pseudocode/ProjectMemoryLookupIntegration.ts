// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination: extend src/project/project-memory-lookup.ts and src/project/project-memory-packet.ts
// Owns pre-write Project Memory lookup for curator packets.
// Does not own embedding storage migrations or canonical markdown writes.

type LookupProjectMemoryInput = {
  root: string;
  project_key: string;
  query: string;
  source_kind: "project_handoff" | "project_candidate" | "session_memory";
  source_id: string;
  mode: "create" | "maintain";
  limit: number;
  allow_fallback: boolean;
};

class ProjectMemoryLookupService {
  async lookup(input: LookupProjectMemoryInput): Promise<ProjectMemoryLookupResult> {
    // Try indexed section retrieval first when mode is maintain or index is available.
    // Indexed retrieval:
    // - get/create query embedding with retrieval_query purpose;
    // - search Project Memory section vector table;
    // - hydrate hits by reading current markdown sections;
    // - drop stale/orphaned rows;
    // - return lookup_quality indexed, freshness fresh when all hydrated hits validate.
    //
    // Fallback:
    // - use deterministic markdown scanner over canonical wiki files;
    // - return lookup_quality fallback, freshness not_applicable or unknown;
    // - apply_severity advisory in creation mode;
    // - apply_severity proposal_scoped in maintenance mode unless no canonical markdown exists.
    //
    // Unavailable:
    // - return lookup_quality unavailable;
    // - apply_severity blocking if lookup is required for operation or maintenance target selection.
  }

  async indexedLookup(input): Promise<ProjectMemoryLookupResult> {
    // Uses ProjectMemoryRetrievalStorage + vector store.
    // Hydrates canonical refs and snippets from markdown, not SQLite text.
  }

  async fallbackMarkdownLookup(input): Promise<ProjectMemoryLookupResult> {
    // Adapts current lookupProjectMemory page scoring.
    // Future fallback should score sections if section extraction exists.
    // Do not mark packet-wide degraded solely because fallback was used.
  }
}

type ProjectMemoryPacketLookupBlock = {
  queries: PacketLookupQuery[];
  results: ProjectMemoryLookupResult[];
  quality_summary: ProjectMemoryLookupQualitySummary;
};

class ProjectMemoryPacketBuilderShape {
  async buildProjectMemoryPacket(root, projectKey, options): Promise<ProjectMemoryPacket> {
    // Existing packet inputs stay: project, state, wiki, pending, session_memory.
    // Replace flat degraded reason aggregation from lookup with quality_summary.
    // Packet may still have degraded/degraded_reasons for compatibility, but these should be derived:
    // - blocking lookup quality => packet degraded blocking
    // - advisory fallback => record advisory reason without blocking canApply
    // - proposal_scoped => validation handles item-level dependencies
  }
}

// Compatibility note:
// Existing tests that expect the markdown fallback degraded reason should become tests that expect fallback lookup quality.
