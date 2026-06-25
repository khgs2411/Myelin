// Pseudocode artifact. Non-executable reference shape for planning.
//
// Intended destination: src/project/project-memory-candidate-intake-service.ts
// Owns validated, idempotent conversion from runtime inbox source items into
// normalized project-scoped memory candidates.

import type { Database } from "bun:sqlite";

type IntakeInboxItem = {
  id: string;
  schema_version: 1;
  project_key: string;
  target_layer: "project" | "practice" | "personal";
  target_scope: string | null;
  title: string;
  body: string;
  rationale: string;
  evidence_refs: string[];
  confidence: string;
  risk: string;
  target_hint: string | null;
  created_at: string;
  creator: string;
};

type ProjectInboxIntakeResult =
  | { status: "created"; candidate_id: string; source_ref: string }
  | { status: "existing"; candidate_id: string; source_ref: string; current_status: "pending" | "needs_review" | "processed" | "rejected" }
  | { status: "terminal_duplicate"; candidate_id: string; source_ref: string; current_status: "processed" | "rejected" }
  | { status: "skipped"; source_ref: string; reason: string }
  | { status: "unsupported_layer"; source_ref: string; layer: string }
  | { status: "invalid_item"; source_ref: string; reason: string }
  | { status: "blocked"; reason: string };

export class ProjectMemoryCandidateIntakeService {
  constructor(private readonly root: string) {}

  intakeProjectInbox(projectKey: string, now: Date): Promise<{
    project_key: string;
    created_candidate_ids: string[];
    existing_candidate_ids: string[];
    terminal_duplicate_candidate_ids: string[];
    skipped_source_refs: string[];
    unsupported_source_refs: string[];
    invalid_source_refs: string[];
    degraded: boolean;
    blocking: boolean;
    degraded_reasons: string[];
  }> {
    // Orchestration only:
    // - locate `projects/<key>/sources/inbox/*.json`
    // - validate each item
    // - normalize only project-layer items
    // - dedupe against existing candidate rows
    // - insert or report existing
    // - never call the curator
  }

  intakeInboxItem(
    db: Database,
    projectKey: string,
    item: IntakeInboxItem,
    now: Date,
  ): ProjectInboxIntakeResult {
    const sourceRef = `inbox:${item.id}`;
    const candidateId = this.candidateIdFor(projectKey, item);

    // Validate source record shape and ownership first.
    // Reject any item that is not project-owned in this slice.
    // Return a terminal duplicate if an existing candidate already represents it.
    // Insert a normalized project candidate only once.
  }

  private candidateIdFor(projectKey: string, item: IntakeInboxItem): string {
    // Deterministic id from inbox item identity and project ownership context,
    // not from curator output.
  }

  private buildCandidatePayload(item: IntakeInboxItem): {
    id: string;
    project_key: string;
    scope: "project";
    status: "needs_review";
    candidate_type: "project.inbox";
    title: string | null;
    summary: string;
    source_event_refs: string[];
    evidence: Record<string, unknown>;
    proposed_payload: Record<string, unknown>;
    confidence: string;
    risk: string;
    reason: string;
  } {
    // Preserve the inbox body, rationale, creator, layer, and evidence refs.
    // The normalized candidate should remain untrusted curator input.
  }
}

// Method grammar notes:
// - intakeProjectInbox is the orchestration entrypoint used by both
//   memory inbox intake and project learn.
// - intakeInboxItem is the per-row normalizer and dedupe gate.
// - candidateIdFor is deterministic and pure.
// - buildCandidatePayload is the last step before SQLite insertion.

// Ownership notes:
// - This service owns intake and normalization only.
// - It does not own project shell repair, reconciliation, packet building, or apply.
// - It does not own source-record lifecycle mutation.
// - It does not own source-file parsing beyond the inbox source envelope contract.
