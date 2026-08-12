// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination: src/memory/project-memory-retrieval-storage.ts
// Owns root SQLite metadata for Project Memory retrieval serving state.
// Does not own canonical markdown, project-local state JSON, or hint generation provider calls.

type ProjectMemoryRetrievalRowStatus =
  | "pending"
  | "indexed"
  | "failed"
  | "stale"
  | "orphaned";

type ProjectMemoryRetrievalEmbeddingRow = {
  id: string;
  project_key: string;
  wiki_path: string;
  section_id: string;
  section_hash: string;
  hint_hash: string | null;
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_purpose: "retrieval_document";
  format_version: number;
  normalized_text_hash: string | null;
  status: ProjectMemoryRetrievalRowStatus;
  failure_reason: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  indexed_at: string | null;
};

type ProjectMemoryRetrievalVectorInput = {
  retrieval_row_id: string;
  project_key: string;
  wiki_path: string;
  section_id: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_purpose: "retrieval_document";
  format_version: number;
  embedding: number[];
};

class ProjectMemoryRetrievalStorage {
  ensurePendingSectionEmbedding(db, input): ProjectMemoryRetrievalEmbeddingRow {
    // Compute id from project_key, wiki_path, section_id, section_hash, hint_hash, active embedding contract.
    // If existing indexed row has same section_hash + hint_hash + contract, return it.
    // Otherwise upsert pending row and leave old vector replace to indexer transaction.
  }

  markIndexed(db, input): ProjectMemoryRetrievalEmbeddingRow {
    // Set status indexed, normalized_text_hash, indexed_at.
  }

  markFailed(db, input): ProjectMemoryRetrievalEmbeddingRow {
    // Set status failed, increment retry_count, preserve failure_reason.
  }

  markStaleOrOrphaned(db, input): void {
    // Used when structural refresh finds section missing or hash mismatch.
    // Do not delete immediately; preserve diagnostics for status/query output.
  }

  listPending(db, input): ProjectMemoryRetrievalEmbeddingRow[] {
    // Filter by project, active embedding contract, status pending or failed when retry requested.
  }

  counts(db, input): {
    indexed_count: number;
    pending_count: number;
    failed_count: number;
    stale_count: number;
    orphaned_count: number;
  } {
    // Used by query/status output and project learn packet quality summary.
  }
}

type ProjectMemoryRetrievalVectorStore = {
  ensure(db, input: { dimensions: number }): { available: boolean; reason?: string };
  upsert(db, input: ProjectMemoryRetrievalVectorInput): void;
  search(db, input): Array<{ retrieval_row_id: string; distance: number }>;
};

// Migration shape:
// - project_memory_retrieval_embeddings metadata table.
// - project_memory_retrieval_maintenance_queue table, or separate module migration.
// - project_memory_section_vec sqlite-vec virtual table with project_key partition key.
// - Indexes by project/status/updated_at and project/wiki_path/section_id.

// Failure posture:
// - sqlite-vec unavailable marks selected rows failed/degraded, not canonical memory invalid.
// - stale/orphaned rows are excluded from search hydration.
