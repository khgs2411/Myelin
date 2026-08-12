import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { stableJson } from "../runtime/json.ts";

export type RetrievalMaintenanceQueueStatus = "pending" | "claimed" | "processed" | "rejected" | "failed";
export type RetrievalMaintenanceKind = "hint_refresh" | "index_repair" | "poor_retrieval_feedback" | "missing_expected_hit";
export type RetrievalMaintenanceCreatedBy = "mcp_query" | "cli_query" | "project_learn" | "operator";

export type RetrievalMaintenanceQueueRow = {
  id: string;
  project_key: string;
  status: RetrievalMaintenanceQueueStatus;
  kind: RetrievalMaintenanceKind;
  target_layer: "project";
  wiki_refs_json: string;
  query_context_json: string;
  feedback_json: string;
  reason: string;
  dedupe_key: string;
  created_by: RetrievalMaintenanceCreatedBy;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
  failure_reason: string | null;
};

export function createRetrievalMaintenanceFeedbackItem(
  db: Database,
  input: {
    project_key: string;
    kind: "poor_retrieval_feedback" | "missing_expected_hit";
    wiki_refs: string[];
    query_context: Record<string, unknown>;
    feedback: Record<string, unknown>;
    reason: string;
    created_by: RetrievalMaintenanceCreatedBy;
    now: string;
  },
): RetrievalMaintenanceQueueRow {
  return createRetrievalMaintenanceItem(db, {
    ...input,
    query_context: input.query_context,
    feedback: input.feedback,
  });
}

export function createRetrievalMaintenanceStructuralRepairItem(
  db: Database,
  input: {
    project_key: string;
    kind: "hint_refresh" | "index_repair";
    wiki_refs: string[];
    reason: string;
    created_by: "project_learn" | "operator";
    now: string;
  },
): RetrievalMaintenanceQueueRow {
  return createRetrievalMaintenanceItem(db, {
    ...input,
    query_context: {},
    feedback: {},
  });
}

export function listPendingRetrievalMaintenanceItems(
  db: Database,
  input: {
    project_key: string;
    kind?: RetrievalMaintenanceKind;
    limit: number;
  },
): RetrievalMaintenanceQueueRow[] {
  if (input.kind) {
    return db
      .query(
        `SELECT *
         FROM retrieval_maintenance_queue
         WHERE project_key = ?
           AND kind = ?
           AND status = 'pending'
         ORDER BY created_at ASC, id ASC
         LIMIT ?`,
      )
      .all(input.project_key, input.kind, input.limit) as RetrievalMaintenanceQueueRow[];
  }
  return db
    .query(
      `SELECT *
       FROM retrieval_maintenance_queue
       WHERE project_key = ?
         AND status = 'pending'
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
    )
    .all(input.project_key, input.limit) as RetrievalMaintenanceQueueRow[];
}

export function markRetrievalMaintenanceProcessed(
  db: Database,
  input: { id: string; now: string },
): RetrievalMaintenanceQueueRow {
  db.query(
    `UPDATE retrieval_maintenance_queue
     SET status = 'processed',
         processed_at = ?,
         updated_at = ?,
         failure_reason = NULL
     WHERE id = ?`,
  ).run(input.now, input.now, input.id);
  return getRetrievalMaintenanceItem(db, input.id);
}

export function markRetrievalMaintenanceFailed(
  db: Database,
  input: { id: string; failure_reason: string; now: string },
): RetrievalMaintenanceQueueRow {
  db.query(
    `UPDATE retrieval_maintenance_queue
     SET status = 'failed',
         failure_reason = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(input.failure_reason, input.now, input.id);
  return getRetrievalMaintenanceItem(db, input.id);
}

function createRetrievalMaintenanceItem(
  db: Database,
  input: {
    project_key: string;
    kind: RetrievalMaintenanceKind;
    wiki_refs: string[];
    query_context: Record<string, unknown>;
    feedback: Record<string, unknown>;
    reason: string;
    created_by: RetrievalMaintenanceCreatedBy;
    now: string;
  },
): RetrievalMaintenanceQueueRow {
  const dedupe_key = dedupeKey(input);
  const existing = db
    .query(
      `SELECT *
       FROM retrieval_maintenance_queue
       WHERE project_key = ?
         AND dedupe_key = ?
         AND status IN ('pending', 'claimed', 'failed')
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
    .get(input.project_key, dedupe_key) as RetrievalMaintenanceQueueRow | null;
  if (existing) return existing;

  const id = queueId({ project_key: input.project_key, dedupe_key });
  db.query(
    `INSERT INTO retrieval_maintenance_queue
      (id, project_key, status, kind, target_layer, wiki_refs_json, query_context_json, feedback_json,
       reason, dedupe_key, created_by, created_at, updated_at, processed_at, failure_reason)
     VALUES (?, ?, 'pending', ?, 'project', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(
    id,
    input.project_key,
    input.kind,
    stableJson([...input.wiki_refs].sort()),
    stableJson(input.query_context),
    stableJson(input.feedback),
    input.reason,
    dedupe_key,
    input.created_by,
    input.now,
    input.now,
  );
  return getRetrievalMaintenanceItem(db, id);
}

function getRetrievalMaintenanceItem(db: Database, id: string): RetrievalMaintenanceQueueRow {
  const row = db.query("SELECT * FROM retrieval_maintenance_queue WHERE id = ?").get(id) as
    | RetrievalMaintenanceQueueRow
    | null;
  if (!row) throw new Error(`Retrieval maintenance queue item not found: ${id}`);
  return row;
}

function queueId(input: { project_key: string; dedupe_key: string }): string {
  return `rmq_${sha256(`${input.project_key}|${input.dedupe_key}`).slice(0, 24)}`;
}

function dedupeKey(input: {
  kind: RetrievalMaintenanceKind;
  wiki_refs: string[];
  query_context?: Record<string, unknown>;
  feedback?: Record<string, unknown>;
}): string {
  return sha256(
    stableJson({
      kind: input.kind,
      wiki_refs: [...input.wiki_refs].sort(),
      query_context: input.query_context ?? {},
      feedback: input.feedback ?? {},
    }),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
