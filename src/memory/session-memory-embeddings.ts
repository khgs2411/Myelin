import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { StoredEmbeddingContract } from "./embedding-contract-types.ts";
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

export type ExactActiveSessionMemoryEmbeddingRow = SessionMemoryEmbeddingRow & {
  embedding_contract_id: string;
  vector_bytes: Uint8Array;
};

export class SessionMemoryRetrievalSnapshotUnavailableError extends Error {
  readonly code = "session_retrieval_provider_unavailable" as const;

  constructor(message: string) {
    super(`${"session_retrieval_provider_unavailable"}: ${message}`);
    this.name = "SessionMemoryRetrievalSnapshotUnavailableError";
  }
}

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

export function ensureActiveSessionMemoryEmbeddings(
  db: Database,
  input: {
    project_key: string;
    contract: ActiveEmbeddingContract;
    now: string;
  },
): number {
  const rows = db
    .query(
      `SELECT sm.id
       FROM session_memories sm
       WHERE sm.project_key = ?
         AND sm.status = 'active'
         AND NOT EXISTS (
           SELECT 1
           FROM session_memory_embeddings e
           WHERE e.session_memory_id = sm.id
             AND e.embedding_provider = ?
             AND e.embedding_model = ?
             AND e.embedding_dimensions = ?
             AND e.embedding_purpose = ?
             AND e.format_version = ?
         )
       ORDER BY sm.created_at, sm.id`,
    )
    .all(
      input.project_key,
      input.contract.provider,
      input.contract.model,
      input.contract.dimensions,
      input.contract.purpose,
      input.contract.formatVersion,
    ) as Array<{ id: string }>;

  db.transaction(() => {
    for (const row of rows) {
      ensurePendingSessionMemoryEmbedding(db, {
        session_memory_id: row.id,
        project_key: input.project_key,
        contract: input.contract,
        now: input.now,
      });
    }
  })();
  return rows.length;
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
      `SELECT e.*
       FROM session_memory_embeddings e
       JOIN session_memories sm ON sm.id = e.session_memory_id
       WHERE e.project_key = ?
         AND sm.status = 'active'
         AND e.embedding_provider = ?
         AND e.embedding_model = ?
         AND e.embedding_dimensions = ?
         AND e.embedding_purpose = ?
         AND e.format_version = ?
         AND e.status IN (${placeholders})
       ORDER BY e.updated_at ASC, e.id ASC
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
    vector_table?: string;
    rebuild_on_dimension_mismatch?: boolean;
  },
): { created: boolean; available: boolean; reason?: string; rebuilt?: boolean } {
  return ensureSessionMemoryVectorTable(db, {
    dimensions: input.contract.dimensions,
    table: input.vector_table,
    adapter: input.adapter,
    rebuildOnDimensionMismatch: input.rebuild_on_dimension_mismatch,
  });
}

export function readExactActiveSessionMemoryEmbeddings(
  db: Database,
  input: {
    project_key: string;
    contract: StoredEmbeddingContract;
  },
): ExactActiveSessionMemoryEmbeddingRow[] {
  const table = sessionVectorTable(input.contract.vectorTable);
  const exists = db.query(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table);
  if (!exists) {
    throw new SessionMemoryRetrievalSnapshotUnavailableError(
      `active Session Memory vector table is missing: ${table}`,
    );
  }

  try {
    const rows = db.query(
      `SELECT e.*, v.embedding AS vector_bytes
       FROM session_memory_embeddings e
       JOIN session_memories sm
         ON sm.id = e.session_memory_id
        AND sm.project_key = e.project_key
        AND sm.status = 'active'
       JOIN ${table} v
         ON v.memory_id = e.session_memory_id
        AND v.project_key = e.project_key
        AND v.embedding_model = e.embedding_model
        AND v.embedding_dimensions = e.embedding_dimensions
        AND v.embedding_purpose = e.embedding_purpose
        AND v.format_version = e.format_version
       WHERE e.project_key = ?
         AND e.embedding_provider = ?
         AND e.embedding_model = ?
         AND e.embedding_dimensions = ?
         AND e.embedding_purpose = 'retrieval_document'
         AND e.format_version = ?
         AND e.status = 'indexed'
       ORDER BY e.session_memory_id, e.id`,
    ).all(
      input.project_key,
      input.contract.provider,
      input.contract.model,
      input.contract.dimensions,
      input.contract.formatVersion,
    ) as Array<SessionMemoryEmbeddingRow & { vector_bytes: Uint8Array }>;
    return rows.map((row) => ({
      ...row,
      embedding_contract_id: input.contract.id,
      vector_bytes: new Uint8Array(row.vector_bytes),
    }));
  } catch (error) {
    if (error instanceof SessionMemoryRetrievalSnapshotUnavailableError) throw error;
    throw new SessionMemoryRetrievalSnapshotUnavailableError(
      `active Session Memory vectors could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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

function sessionVectorTable(value: string): string {
  if (!/^session_memory_vec(?:_[a-f0-9]{16})?$/.test(value)) {
    throw new SessionMemoryRetrievalSnapshotUnavailableError(
      `active Session Memory vector table is not owned by Myelin: ${value}`,
    );
  }
  return value;
}
