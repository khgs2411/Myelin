// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination: src/memory/retrieval-maintenance-queue.ts
// Owns serving-state maintenance work for Project Memory retrieval.
// Does not own canonical memory candidates or Project Memory markdown curation.

type RetrievalMaintenanceQueueStatus =
  | "pending"
  | "claimed"
  | "processed"
  | "rejected"
  | "failed";

type RetrievalMaintenanceKind =
  | "hint_refresh"
  | "index_repair"
  | "poor_retrieval_feedback"
  | "missing_expected_hit";

type RetrievalMaintenanceQueueRow = {
  id: string;
  project_key: string;
  status: RetrievalMaintenanceQueueStatus;
  kind: RetrievalMaintenanceKind;
  target_layer: "project";
  wiki_refs_json: string;           // canonical section refs when known
  query_context_json: string;       // original query, selected hits, expected refs
  feedback_json: string;            // user/agent signal
  reason: string;
  created_by: "mcp_query" | "cli_query" | "project_learn" | "operator";
  created_at: string;
  updated_at: string;
  processed_at: string | null;
  failure_reason: string | null;
};

class RetrievalMaintenanceQueue {
  createFeedbackItem(db, input): RetrievalMaintenanceQueueRow {
    // Create deduped queue item for poor retrieval quality.
    // Do not create MemoryCandidate.
    // Include enough query/hit context for hint generation to improve recall.
  }

  createStructuralRepairItem(db, input): RetrievalMaintenanceQueueRow {
    // For stale/orphaned hints or failed index rows that need repair.
  }

  listPending(db, input): RetrievalMaintenanceQueueRow[] {
    // Filter by project, kind, status pending, limit.
  }

  markProcessed(db, input): RetrievalMaintenanceQueueRow {
    // Terminal successful processing.
  }

  markFailed(db, input): RetrievalMaintenanceQueueRow {
    // Preserve failure for retry/status.
  }
}

// Processing ownership:
// - Hint refresh processor consumes hint_refresh and poor_retrieval_feedback.
// - Indexer consumes index_repair where deterministic re-indexing is enough.
// - Project Memory curator consumes MemoryCandidate, not this queue.

// Deduplication:
// - Same project + kind + query hash + expected/missing ref should collapse while pending.
// - Structural stale hints should dedupe by project + wiki_path + section_id + stale hash.

// Failure posture:
// - Queue failure degrades retrieval serving quality, not canonical Project Memory.
// - Repeated failures should be visible in status/query diagnostics.
