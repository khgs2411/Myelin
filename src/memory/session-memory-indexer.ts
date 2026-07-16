import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { EmbeddingTransport } from "./embedding-types.ts";
import { EmbeddingService } from "./embedding-service.ts";
import { executeEmbeddingBatches } from "./embedding-batch-executor.ts";
import type { SessionMemoryRow } from "./ingest-types.ts";
import {
  ensureActiveSessionMemoryEmbeddings,
  ensureSessionMemoryVectorStorage,
  listPendingSessionMemoryEmbeddings,
  markSessionMemoryEmbeddingFailed,
  markSessionMemoryEmbeddingIndexed,
  type SessionMemoryEmbeddingRow,
} from "./session-memory-embeddings.ts";
import type {
  SessionMemoryIndexFailure,
  SessionMemoryIndexResult,
  SessionMemoryVectorStore,
} from "./session-memory-index-types.ts";
import { normalizeSessionMemoryForEmbedding } from "./session-memory-text.ts";
import {
  createSqliteVecAdapter,
  upsertSessionMemoryVector,
  type SqliteVecAdapter,
} from "./sqlite-vec.ts";
export type {
  SessionMemoryIndexFailure,
  SessionMemoryIndexResult,
  SessionMemoryVectorStore,
} from "./session-memory-index-types.ts";

export async function indexSessionMemories(
  db: Database,
  input: {
    project_key: string;
    contract: ActiveEmbeddingContract;
    provider: EmbeddingTransport;
    vector_table?: string;
    limit: number;
    batch_size?: number;
    retry_failed?: boolean;
    now?: () => string;
    vector_store?: SessionMemoryVectorStore;
  },
): Promise<SessionMemoryIndexResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const batchSize = input.batch_size ?? input.limit;
  if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error(`Invalid embedding batch size: ${batchSize}`);
  const vectorStore = input.vector_store ?? defaultVectorStore(createSqliteVecAdapter(), input.vector_table);
  ensureActiveSessionMemoryEmbeddings(db, {
    project_key: input.project_key,
    contract: input.contract,
    now: now(),
  });
  const rows = listPendingSessionMemoryEmbeddings(db, {
    project_key: input.project_key,
    contract: input.contract,
    limit: input.limit,
    include_failed: input.retry_failed,
  });
  const failures: SessionMemoryIndexFailure[] = [];

  if (rows.length === 0) {
    return {
      project_key: input.project_key,
      selected: 0,
      indexed: 0,
      failed: 0,
      pending_remaining: pendingRemaining(db, input.project_key, input.contract),
      degraded: false,
      batch_size: batchSize,
      failures,
    };
  }

  const availability = vectorStore.ensure(db, { contract: input.contract });
  if (!availability.available) {
    const reason = `sqlite-vec unavailable: ${availability.reason ?? "unknown reason"}`;
    for (const row of rows) {
      markFailed(db, row, reason, now(), failures);
    }
    return {
      project_key: input.project_key,
      selected: rows.length,
      indexed: 0,
      failed: rows.length,
      pending_remaining: pendingRemaining(db, input.project_key, input.contract),
      degraded: true,
      batch_size: batchSize,
      degraded_reason: reason,
      failures,
    };
  }

  const entries: PreparedEmbeddingEntry[] = [];
  for (const row of rows) {
    try {
      const memory = getSessionMemory(db, row.session_memory_id);
      const normalizedText = normalizeSessionMemoryForEmbedding(memory);
      entries.push({ row, memory, normalizedText });
    } catch (error) {
      markFailed(db, row, error instanceof Error ? error.message : String(error), now(), failures);
    }
  }

  const indexed = await executeEmbeddingBatches({
    entries,
    batchSize,
    contract: input.contract,
    provider: EmbeddingService.bind(input.contract, input.provider),
    requestFor: (entry) => ({
      contract: input.contract,
      title: entry.memory.title,
      text: entry.normalizedText,
    }),
    onSuccess: (entry, embedding) => {
        const indexedAt = now();
        db.transaction(() => {
          vectorStore.upsert(db, {
            memory_id: entry.memory.id,
            project_key: entry.memory.project_key,
            embedding_model: input.contract.model,
            embedding_dimensions: input.contract.dimensions,
            embedding_purpose: input.contract.purpose,
            format_version: input.contract.formatVersion,
            embedding: embedding.embedding,
          });
          markSessionMemoryEmbeddingIndexed(db, {
            id: entry.row.id,
            normalized_text_hash: sha256(entry.normalizedText),
            now: indexedAt,
          });
        })();
    },
    onFailure: (entry, reason) => markFailed(db, entry.row, reason, now(), failures),
  });

  return {
    project_key: input.project_key,
    selected: rows.length,
    indexed,
    failed: failures.length,
    pending_remaining: pendingRemaining(db, input.project_key, input.contract),
    degraded: failures.length > 0,
    batch_size: batchSize,
    degraded_reason: failures.length > 0 ? "one or more session memories failed to index" : undefined,
    failures,
  };
}

export function defaultVectorStore(
  adapter: SqliteVecAdapter = createSqliteVecAdapter(),
  vectorTable = "session_memory_vec",
): SessionMemoryVectorStore {
  return {
    ensure(db, input) {
      return ensureSessionMemoryVectorStorage(db, {
        contract: input.contract,
        adapter,
        vector_table: vectorTable,
        rebuild_on_dimension_mismatch: false,
      });
    },
    upsert(db, input) {
      upsertSessionMemoryVector(db, input, vectorTable);
    },
  };
}

function getSessionMemory(db: Database, id: string): SessionMemoryRow {
  const row = db.query("SELECT * FROM session_memories WHERE id = ?").get(id) as SessionMemoryRow | null;
  if (!row) throw new Error(`Session memory not found: ${id}`);
  return row;
}

function pendingRemaining(db: Database, projectKey: string, contract: ActiveEmbeddingContract): number {
  const row = db
    .query(
      `SELECT count(*) AS n
       FROM session_memory_embeddings e
       JOIN session_memories sm ON sm.id = e.session_memory_id
       WHERE e.project_key = ?
         AND sm.status = 'active'
         AND e.embedding_provider = ?
         AND e.embedding_model = ?
         AND e.embedding_dimensions = ?
         AND e.embedding_purpose = ?
         AND e.format_version = ?
         AND e.status = 'pending'`,
    )
    .get(
      projectKey,
      contract.provider,
      contract.model,
      contract.dimensions,
      contract.purpose,
      contract.formatVersion,
    ) as { n: number };
  return row.n;
}

type PreparedEmbeddingEntry = {
  row: SessionMemoryEmbeddingRow;
  memory: SessionMemoryRow;
  normalizedText: string;
};

function markFailed(
  db: Database,
  row: SessionMemoryEmbeddingRow,
  reason: string,
  now: string,
  failures: SessionMemoryIndexFailure[],
): void {
  markSessionMemoryEmbeddingFailed(db, {
    id: row.id,
    failure_reason: reason,
    now,
  });
  failures.push({
    embedding_id: row.id,
    session_memory_id: row.session_memory_id,
    reason,
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
