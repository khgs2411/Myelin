import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";

export type ProjectMemoryRetrievalRowStatus = "pending" | "indexed" | "failed" | "stale" | "orphaned";

export type ProjectMemoryRetrievalEmbeddingRow = {
  id: string;
  project_key: string;
  wiki_path: string;
  section_id: string;
  section_hash: string;
  hint_hash: string | null;
  hint_hash_key: string;
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

export function projectMemoryRetrievalEmbeddingId(input: {
  project_key: string;
  wiki_path: string;
  section_id: string;
  section_hash: string;
  hint_hash: string | null;
  contract: ActiveEmbeddingContract;
}): string {
  const hash = createHash("sha256")
    .update(
      [
        input.project_key,
        input.wiki_path,
        input.section_id,
        input.section_hash,
        input.hint_hash ?? "",
        input.contract.provider,
        input.contract.model,
        input.contract.dimensions,
        "retrieval_document",
        input.contract.formatVersion,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 24);
  return `pmr_${hash}`;
}

export function ensurePendingProjectMemoryRetrievalEmbedding(
  db: Database,
  input: {
    project_key: string;
    wiki_path: string;
    section_id: string;
    section_hash: string;
    hint_hash: string | null;
    contract: ActiveEmbeddingContract;
    now: string;
  },
): ProjectMemoryRetrievalEmbeddingRow {
  const id = projectMemoryRetrievalEmbeddingId(input);
  const existing = getProjectMemoryRetrievalEmbeddingOrNull(db, id);
  if (existing?.status === "indexed") return existing;

  db.query(
    `INSERT INTO project_memory_retrieval_embeddings
      (id, project_key, wiki_path, section_id, section_hash, hint_hash, hint_hash_key,
       embedding_provider, embedding_model, embedding_dimensions, embedding_purpose, format_version,
       normalized_text_hash, status, failure_reason, retry_count, created_at, updated_at, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'retrieval_document', ?, NULL, 'pending', NULL, 0, ?, ?, NULL)
     ON CONFLICT(project_key, wiki_path, section_id, section_hash, hint_hash_key, embedding_provider,
       embedding_model, embedding_dimensions, embedding_purpose, format_version)
     DO UPDATE SET
       status = 'pending',
       failure_reason = NULL,
       updated_at = excluded.updated_at`,
  ).run(
    id,
    input.project_key,
    input.wiki_path,
    input.section_id,
    input.section_hash,
    input.hint_hash,
    hintHashKey(input.hint_hash),
    input.contract.provider,
    input.contract.model,
    input.contract.dimensions,
    input.contract.formatVersion,
    input.now,
    input.now,
  );

  return getProjectMemoryRetrievalEmbedding(db, id);
}

export function listPendingProjectMemoryRetrievalEmbeddings(
  db: Database,
  input: {
    project_key: string;
    contract: ActiveEmbeddingContract;
    limit: number;
    include_failed?: boolean;
  },
): ProjectMemoryRetrievalEmbeddingRow[] {
  const statuses = input.include_failed ? ["pending", "failed"] : ["pending"];
  const placeholders = statuses.map(() => "?").join(", ");
  return db
    .query(
      `SELECT *
       FROM project_memory_retrieval_embeddings
       WHERE project_key = ?
         AND embedding_provider = ?
         AND embedding_model = ?
         AND embedding_dimensions = ?
         AND embedding_purpose = 'retrieval_document'
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
      input.contract.formatVersion,
      ...statuses,
      input.limit,
    ) as ProjectMemoryRetrievalEmbeddingRow[];
}

export function markProjectMemoryRetrievalEmbeddingIndexed(
  db: Database,
  input: {
    id: string;
    normalized_text_hash: string;
    now: string;
  },
): ProjectMemoryRetrievalEmbeddingRow {
  db.query(
    `UPDATE project_memory_retrieval_embeddings
     SET status = 'indexed',
         normalized_text_hash = ?,
         failure_reason = NULL,
         updated_at = ?,
         indexed_at = ?
     WHERE id = ?`,
  ).run(input.normalized_text_hash, input.now, input.now, input.id);
  return getProjectMemoryRetrievalEmbedding(db, input.id);
}

export function markProjectMemoryRetrievalEmbeddingFailed(
  db: Database,
  input: {
    id: string;
    failure_reason: string;
    now: string;
  },
): ProjectMemoryRetrievalEmbeddingRow {
  db.query(
    `UPDATE project_memory_retrieval_embeddings
     SET status = 'failed',
         failure_reason = ?,
         retry_count = retry_count + 1,
         updated_at = ?
     WHERE id = ?`,
  ).run(input.failure_reason, input.now, input.id);
  return getProjectMemoryRetrievalEmbedding(db, input.id);
}

export function markProjectMemoryRetrievalEmbeddingStaleOrOrphaned(
  db: Database,
  input: {
    id: string;
    status: "stale" | "orphaned";
    failure_reason: string;
    now: string;
  },
): ProjectMemoryRetrievalEmbeddingRow {
  db.query(
    `UPDATE project_memory_retrieval_embeddings
     SET status = ?,
         failure_reason = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(input.status, input.failure_reason, input.now, input.id);
  return getProjectMemoryRetrievalEmbedding(db, input.id);
}

export function getProjectMemoryRetrievalEmbedding(db: Database, id: string): ProjectMemoryRetrievalEmbeddingRow {
  const row = getProjectMemoryRetrievalEmbeddingOrNull(db, id);
  if (!row) throw new Error(`Project Memory retrieval embedding not found: ${id}`);
  return row;
}

function getProjectMemoryRetrievalEmbeddingOrNull(db: Database, id: string): ProjectMemoryRetrievalEmbeddingRow | null {
  return db.query("SELECT * FROM project_memory_retrieval_embeddings WHERE id = ?").get(id) as
    | ProjectMemoryRetrievalEmbeddingRow
    | null;
}

function hintHashKey(hintHash: string | null): string {
  return hintHash ?? "";
}
