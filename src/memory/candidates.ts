import type { Database } from "bun:sqlite";
import type { MemoryCandidateRow, MemoryCandidateStatus, MemoryScope } from "./ingest-types.ts";

export type CreateMemoryCandidateInput = {
  id: string;
  project_key: string;
  scope: MemoryScope;
  status: MemoryCandidateStatus;
  candidate_type: string;
  title?: string | null;
  summary: string;
  source_event_refs: string[];
  evidence: Record<string, unknown>;
  proposed_payload: Record<string, unknown>;
  confidence: string;
  risk: string;
  reason: string;
  now: string;
};

export type QueueLifecycleUpdateResult =
  | { status: "processed"; id: string }
  | { status: "already_terminal"; id: string; current_status: "processed" | "rejected" }
  | { status: "missing"; id: string }
  | { status: "skipped"; id: string; current_status: string; reason: string };

export function normalizeCandidateStatus(input: string): MemoryCandidateStatus {
  const normalized = input.replace(/-/g, "_");
  if (normalized === "pending" || normalized === "needs_review" || normalized === "processed" || normalized === "rejected") {
    return normalized;
  }
  throw new Error(`Unknown candidate status: ${input}`);
}

export function createMemoryCandidate(db: Database, input: CreateMemoryCandidateInput): MemoryCandidateRow {
  db.query(
    `INSERT INTO memory_candidates
      (id, project_key, scope, status, candidate_type, title, summary, source_event_refs_json,
       evidence_json, proposed_payload_json, confidence, risk, reason, created_at, updated_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    input.id,
    input.project_key,
    input.scope,
    input.status,
    input.candidate_type,
    input.title ?? null,
    input.summary,
    JSON.stringify(input.source_event_refs),
    JSON.stringify(input.evidence),
    JSON.stringify(input.proposed_payload),
    input.confidence,
    input.risk,
    input.reason,
    input.now,
    input.now,
  );

  return getMemoryCandidate(db, input.id) as MemoryCandidateRow;
}

export function getMemoryCandidate(db: Database, id: string): MemoryCandidateRow | null {
  return (db.query("SELECT * FROM memory_candidates WHERE id = ?").get(id) as MemoryCandidateRow | null) ?? null;
}

export function listMemoryCandidates(
  db: Database,
  input: { project_key: string; status?: string; scope?: MemoryScope },
): MemoryCandidateRow[] {
  const status = input.status ? normalizeCandidateStatus(input.status) : null;
  if (status && input.scope) {
    return db
      .query(
        "SELECT * FROM memory_candidates WHERE project_key = ? AND status = ? AND scope = ? ORDER BY created_at DESC, id DESC",
      )
      .all(input.project_key, status, input.scope) as MemoryCandidateRow[];
  }
  if (status) {
    return db
      .query("SELECT * FROM memory_candidates WHERE project_key = ? AND status = ? ORDER BY created_at DESC, id DESC")
      .all(input.project_key, status) as MemoryCandidateRow[];
  }
  if (input.scope) {
    return db
      .query("SELECT * FROM memory_candidates WHERE project_key = ? AND scope = ? ORDER BY created_at DESC, id DESC")
      .all(input.project_key, input.scope) as MemoryCandidateRow[];
  }
  return db
    .query("SELECT * FROM memory_candidates WHERE project_key = ? ORDER BY created_at DESC, id DESC")
    .all(input.project_key) as MemoryCandidateRow[];
}

export function markProjectMemoryCandidateProcessed(
  db: Database,
  input: { project_key: string; id: string; now: string },
): QueueLifecycleUpdateResult {
  const row = db
    .query("SELECT * FROM memory_candidates WHERE id = ? AND project_key = ? AND scope = 'project'")
    .get(input.id, input.project_key) as MemoryCandidateRow | null;
  if (!row) return { status: "missing", id: input.id };
  if (row.status === "processed" || row.status === "rejected") {
    return { status: "already_terminal", id: input.id, current_status: row.status };
  }
  if (row.status !== "pending" && row.status !== "needs_review") {
    return { status: "skipped", id: input.id, current_status: row.status, reason: "unsupported candidate status" };
  }

  const result = db
    .query(
      `UPDATE memory_candidates
       SET status = 'processed',
           processed_at = ?,
           updated_at = ?
       WHERE id = ?
         AND project_key = ?
         AND scope = 'project'
         AND status IN ('pending', 'needs_review')`,
    )
    .run(input.now, input.now, input.id, input.project_key);

  if (result.changes > 0) return { status: "processed", id: input.id };

  const current = db
    .query("SELECT status FROM memory_candidates WHERE id = ? AND project_key = ? AND scope = 'project'")
    .get(input.id, input.project_key) as { status: string } | null;
  if (!current) return { status: "missing", id: input.id };
  if (current.status === "processed" || current.status === "rejected") {
    return { status: "already_terminal", id: input.id, current_status: current.status };
  }
  return { status: "skipped", id: input.id, current_status: current.status, reason: "candidate status changed before update" };
}
