import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";

export type MemoryQueryLogLayer = "project" | "session" | "practice" | "personal";

type QueryEmbeddingCacheSnapshot = {
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_purpose: string;
  format_version: number;
  embedding_json: string;
};

const QUERY_LOG_TABLES: Record<MemoryQueryLogLayer, string> = {
  project: "project_memory_query_logs",
  session: "session_memory_query_logs",
  practice: "practice_memory_query_logs",
  personal: "personal_memory_query_logs",
};

export function recordMemoryQueryLog(
  db: Database,
  input: {
    layer: MemoryQueryLogLayer;
    project_key: string;
    question: string;
    normalized_question?: string;
    query_embedding_cache_id?: string;
    result: unknown;
    match_count: number;
    degraded: boolean;
    degraded_reason?: string;
    now?: () => string;
  },
): string {
  const table = QUERY_LOG_TABLES[input.layer];
  const embedding = input.query_embedding_cache_id ? readQueryEmbeddingCacheSnapshot(db, input.query_embedding_cache_id) : null;
  const now = input.now ?? (() => new Date().toISOString());
  const id = randomUUID();

  db.query(
    `INSERT INTO ${table}
      (id, project_key, question, normalized_question, query_embedding_cache_id,
       query_embedding_provider, query_embedding_model, query_embedding_dimensions,
       query_embedding_purpose, query_embedding_format_version, query_embedding_json,
       result_json, match_count, degraded, degraded_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.project_key,
    input.question,
    input.normalized_question ?? null,
    input.query_embedding_cache_id ?? null,
    embedding?.embedding_provider ?? null,
    embedding?.embedding_model ?? null,
    embedding?.embedding_dimensions ?? null,
    embedding?.embedding_purpose ?? null,
    embedding?.format_version ?? null,
    embedding?.embedding_json ?? null,
    JSON.stringify(input.result),
    input.match_count,
    input.degraded ? 1 : 0,
    input.degraded_reason ?? null,
    now(),
  );
  return id;
}

export function attachMemoryQueryLogResponse(
  db: Database,
  input: {
    layer: MemoryQueryLogLayer;
    log_id: string;
    answer_text: string;
    response: unknown;
  },
): void {
  const table = QUERY_LOG_TABLES[input.layer];
  db.query(
    `UPDATE ${table}
     SET answer_text = ?,
         response_json = ?
     WHERE id = ?`,
  ).run(input.answer_text, JSON.stringify(input.response), input.log_id);
}

export function attachMemoryQueryLogEval(
  db: Database,
  input: {
    layer: MemoryQueryLogLayer;
    log_id: string;
    eval_run_id: string;
    eval_result: unknown;
  },
): void {
  const table = QUERY_LOG_TABLES[input.layer];
  db.query(
    `UPDATE ${table}
     SET eval_run_id = ?,
         eval_json = ?
     WHERE id = ?`,
  ).run(input.eval_run_id, JSON.stringify(input.eval_result), input.log_id);
}

function readQueryEmbeddingCacheSnapshot(db: Database, id: string): QueryEmbeddingCacheSnapshot | null {
  return db
    .query(
      `SELECT embedding_provider, embedding_model, embedding_dimensions, embedding_purpose,
              format_version, embedding_json
       FROM query_embedding_cache
       WHERE id = ?`,
    )
    .get(id) as QueryEmbeddingCacheSnapshot | null;
}
