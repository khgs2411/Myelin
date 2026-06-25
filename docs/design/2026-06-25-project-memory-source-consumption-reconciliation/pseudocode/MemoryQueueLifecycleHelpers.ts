// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination:
// - extend src/memory/candidates.ts for candidate lifecycle updates
// - extend src/memory/handoffs.ts for handoff lifecycle updates
//
// Owns narrow SQLite queue status transitions used by deterministic Project
// Memory source-consumption reconciliation.

type QueueLifecycleUpdateResult =
  | { status: "processed"; id: string }
  | { status: "already_terminal"; id: string; current_status: "processed" | "rejected" }
  | { status: "missing"; id: string }
  | { status: "skipped"; id: string; current_status: string; reason: string }

type MarkProcessedInput = {
  project_key: string
  id: string
  now: string
}

// In src/memory/candidates.ts:
function markProjectMemoryCandidateProcessed(db: Database, input: MarkProcessedInput): QueueLifecycleUpdateResult {
  // 1. SELECT row FROM memory_candidates WHERE id = ? AND project_key = ? AND scope = 'project'.
  //
  // 2. If no row:
  //    return { status: "missing", id }.
  //
  // 3. If row.status is "processed" or "rejected":
  //    return { status: "already_terminal", id, current_status: row.status }.
  //    Do not change processed_at or updated_at.
  //
  // 4. If row.status is "pending" or "needs_review":
  //    UPDATE memory_candidates
  //       SET status = 'processed',
  //           processed_at = input.now,
  //           updated_at = input.now
  //     WHERE id = input.id
  //       AND project_key = input.project_key
  //       AND scope = 'project'
  //       AND status IN ('pending', 'needs_review')
  //
  // 5. Return { status: "processed", id } if one row changed.
  //
  // 6. If no row changed after step 4, re-read and classify as already_terminal
  //    or skipped. This keeps repeated reconciliation idempotent.
}

// In src/memory/handoffs.ts:
function markProjectHandoffInstructionProcessed(db: Database, input: MarkProcessedInput): QueueLifecycleUpdateResult {
  // 1. SELECT row FROM project_handoff_instructions WHERE id = ? AND project_key = ?.
  //
  // 2. If no row:
  //    return { status: "missing", id }.
  //
  // 3. If row.status is "processed" or "rejected":
  //    return { status: "already_terminal", id, current_status: row.status }.
  //    Do not change processed_at or updated_at.
  //
  // 4. If row.status is "pending" or "needs_review":
  //    UPDATE project_handoff_instructions
  //       SET status = 'processed',
  //           processed_at = input.now,
  //           updated_at = input.now
  //     WHERE id = input.id
  //       AND project_key = input.project_key
  //       AND status IN ('pending', 'needs_review')
  //
  // 5. Return { status: "processed", id } if one row changed.
  //
  // 6. If no row changed after step 4, re-read and classify as already_terminal
  //    or skipped.
}

// Non-ownership:
// - These helpers do not read project-memory-source-consumptions.json.
// - These helpers do not decide whether a candidate/handoff should be processed.
// - These helpers do not mutate session, practice, or personal queue rows.
// - These helpers do not write audit artifacts; Project Memory Source Consumption
//   state is the audit evidence for this transition.

