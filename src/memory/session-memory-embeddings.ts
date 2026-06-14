import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import { ensureSessionMemoryVectorTable, type SqliteVecAdapter } from "./sqlite-vec.ts";

export type SessionMemoryEmbeddingStatus = "pending" | "indexed" | "failed";

export type SessionMemoryEmbeddingRow = {
  id: string;
  session_memory_id: string;
  project_key: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_purpose: string;
  format_version: number;
  normalized_text_hash: string | null;
  status: SessionMemoryEmbeddingStatus;
  failure_reason: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  indexed_at: string | null;
};

export function sessionMemoryEmbeddingId(input: {
  session_memory_id: string;
  contract: ActiveEmbeddingContract;
}): string {
  const hash = createHash("sha256")
    .update(
      [
        input.session_memory_id,
        input.contract.provider,
        input.contract.model,
        input.contract.dimensions,
        input.contract.purpose,
        input.contract.formatVersion,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 24);
  return `emb_${hash}`;
}

export function ensurePendingSessionMemoryEmbedding(
  db: Database,
  input: {
    session_memory_id: string;
    project_key: string;
    contract: ActiveEmbeddingContract;
    now: string;
  },
): SessionMemoryEmbeddingRow {
  const id = sessionMemoryEmbeddingId(input);
  const existing = getSessionMemoryEmbeddingOrNull(db, id);
  if (existing?.status === "indexed") return existing;

  db.query(
    `INSERT INTO session_memory_embeddings
      (id, session_memory_id, project_key, embedding_provider, embedding_model, embedding_dimensions,
       embedding_purpose, format_version, status, failure_reason, retry_count, created_at, updated_at, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 0, ?, ?, NULL)
     ON CONFLICT(session_memory_id, embedding_provider, embedding_model, embedding_dimensions, embedding_purpose, format_version)
     DO UPDATE SET
       project_key = excluded.project_key,
       status = 'pending',
       failure_reason = NULL,
       updated_at = excluded.updated_at`,
  ).run(
    id,
    input.session_memory_id,
    input.project_key,
    input.contract.provider,
    input.contract.model,
    input.contract.dimensions,
    input.contract.purpose,
    input.contract.formatVersion,
    input.now,
    input.now,
  );

  return getSessionMemoryEmbedding(db, id);
}

export function listPendingSessionMemoryEmbeddings(
  db: Database,
  input: {
    project_key: string;
    contract: ActiveEmbeddingContract;
    limit: number;
    include_failed?: boolean;
  },
): SessionMemoryEmbeddingRow[] {
  const statuses = input.include_failed ? ["pending", "failed"] : ["pending"];
  const placeholders = statuses.map(() => "?").join(", ");
  return db
    .query(
      `SELECT *
       FROM session_memory_embeddings
       WHERE project_key = ?
         AND embedding_provider = ?
         AND embedding_model = ?
         AND embedding_dimensions = ?
         AND embedding_purpose = ?
         AND format_version = ?
         AND status IN (${placeholders})
       ORDER BY updated_at ASC, id ASC
       LIMIT ?`,
    )
    .all(
      input.project_key,
      input.contract.provider,
      input.contract.model,
      input.contract.dimensions,
      input.contract.purpose,
      input.contract.formatVersion,
      ...statuses,
      input.limit,
    ) as SessionMemoryEmbeddingRow[];
}

export function markSessionMemoryEmbeddingIndexed(
  db: Database,
  input: {
    id: string;
    normalized_text_hash: string;
    now: string;
  },
): SessionMemoryEmbeddingRow {
  db.query(
    `UPDATE session_memory_embeddings
     SET status = 'indexed',
         normalized_text_hash = ?,
         failure_reason = NULL,
         updated_at = ?,
         indexed_at = ?
     WHERE id = ?`,
  ).run(input.normalized_text_hash, input.now, input.now, input.id);
  return getSessionMemoryEmbedding(db, input.id);
}

export function markSessionMemoryEmbeddingFailed(
  db: Database,
  input: {
    id: string;
    failure_reason: string;
    now: string;
  },
): SessionMemoryEmbeddingRow {
  db.query(
    `UPDATE session_memory_embeddings
     SET status = 'failed',
         failure_reason = ?,
         retry_count = retry_count + 1,
         updated_at = ?
     WHERE id = ?`,
  ).run(input.failure_reason, input.now, input.id);
  return getSessionMemoryEmbedding(db, input.id);
}

export function ensureSessionMemoryVectorStorage(
  db: Database,
  input: {
    contract: ActiveEmbeddingContract;
    adapter: SqliteVecAdapter;
  },
): { created: boolean; available: boolean; reason?: string } {
  return ensureSessionMemoryVectorTable(db, {
    dimensions: input.contract.dimensions,
    adapter: input.adapter,
  });
}

export function getSessionMemoryEmbedding(db: Database, id: string): SessionMemoryEmbeddingRow {
  const row = getSessionMemoryEmbeddingOrNull(db, id);
  if (!row) throw new Error(`Session memory embedding not found: ${id}`);
  return row;
}

function getSessionMemoryEmbeddingOrNull(db: Database, id: string): SessionMemoryEmbeddingRow | null {
  return db.query("SELECT * FROM session_memory_embeddings WHERE id = ?").get(id) as
    | SessionMemoryEmbeddingRow
    | null;
}
