import type { Database } from "bun:sqlite";
import type { IngestJobRow, IngestJobStatus } from "../memory/ingest-types.ts";

export type CreateIngestJobInput = {
  id: string;
  project_key: string;
  provider: string;
  requested_by?: string | null;
  input: Record<string, unknown>;
  now: string;
};

export type UpdateIngestJobStatusInput = {
  id: string;
  status: IngestJobStatus;
  updated_at: string;
  provider_session_id?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  output_counts?: Record<string, unknown>;
  terminal_summary?: string | null;
  error?: Record<string, unknown> | null;
  followup_state?: Record<string, unknown> | null;
};

export function createIngestJob(db: Database, input: CreateIngestJobInput): IngestJobRow {
  db.query(
    `INSERT INTO ingest_jobs
      (id, project_key, status, provider, provider_session_id, requested_by, input_json,
       output_counts_json, terminal_summary, error_json, followup_state_json, started_at,
       finished_at, created_at, updated_at)
     VALUES (?, ?, 'starting', ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(
    input.id,
    input.project_key,
    input.provider,
    input.requested_by ?? null,
    JSON.stringify(input.input),
    JSON.stringify({}),
    input.now,
    input.now,
  );
  return requireIngestJob(db, input.id);
}

export function getIngestJob(db: Database, id: string): IngestJobRow | null {
  return (db.query("SELECT * FROM ingest_jobs WHERE id = ?").get(id) as IngestJobRow | null) ?? null;
}

export function updateIngestJobStatus(db: Database, input: UpdateIngestJobStatusInput): IngestJobRow {
  const existing = requireIngestJob(db, input.id);

  db.query(
    `UPDATE ingest_jobs
     SET status = ?,
         provider_session_id = ?,
         started_at = ?,
         finished_at = ?,
         output_counts_json = ?,
         terminal_summary = ?,
         error_json = ?,
         followup_state_json = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    input.status,
    input.provider_session_id === undefined ? existing.provider_session_id : input.provider_session_id,
    input.started_at === undefined ? existing.started_at : input.started_at,
    input.finished_at === undefined ? existing.finished_at : input.finished_at,
    input.output_counts === undefined ? existing.output_counts_json : JSON.stringify(input.output_counts),
    input.terminal_summary === undefined ? existing.terminal_summary : input.terminal_summary,
    input.error === undefined ? existing.error_json : JSON.stringify(input.error),
    input.followup_state === undefined ? existing.followup_state_json : JSON.stringify(input.followup_state),
    input.updated_at,
    input.id,
  );

  return requireIngestJob(db, input.id);
}

function requireIngestJob(db: Database, id: string): IngestJobRow {
  const job = getIngestJob(db, id);
  if (!job) throw new Error(`Unknown ingest job: ${id}`);
  return job;
}
