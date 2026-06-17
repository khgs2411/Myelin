import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { EmbeddingProviderClient, EmbeddingResult } from "./embedding-provider.ts";
import type { SessionMemoryRow } from "./ingest-types.ts";
import {
  ensureSessionMemoryVectorStorage,
  listPendingSessionMemoryEmbeddings,
  markSessionMemoryEmbeddingFailed,
  markSessionMemoryEmbeddingIndexed,
  type SessionMemoryEmbeddingRow,
} from "./session-memory-embeddings.ts";
import { normalizeSessionMemoryForEmbedding } from "./session-memory-text.ts";
import {
  createSqliteVecAdapter,
  upsertSessionMemoryVector,
  type SessionMemoryVectorInput,
  type SqliteVecAdapter,
} from "./sqlite-vec.ts";

export type SessionMemoryIndexFailure = {
  embedding_id: string;
  session_memory_id: string;
  reason: string;
};

export type SessionMemoryIndexResult = {
  project_key: string;
  selected: number;
  indexed: number;
  failed: number;
  pending_remaining: number;
  degraded: boolean;
  batch_size: number;
  degraded_reason?: string;
  failures: SessionMemoryIndexFailure[];
};

export type SessionMemoryVectorStore = {
  ensure: (
    db: Database,
    input: { contract: ActiveEmbeddingContract },
  ) => { available: boolean; reason?: string };
  upsert: (db: Database, input: SessionMemoryVectorInput) => void;
};

export async function indexSessionMemories(
  db: Database,
  input: {
    project_key: string;
    contract: ActiveEmbeddingContract;
    provider: EmbeddingProviderClient;
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
  const vectorStore = input.vector_store ?? defaultVectorStore(createSqliteVecAdapter());
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

  let indexed = 0;
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

  for (const chunk of chunks(entries, batchSize)) {
    let embeddings: EmbeddingResult[];
    try {
      embeddings =
        input.provider.embedBatch && chunk.length > 1
          ? await input.provider.embedBatch(
              chunk.map((entry) => ({
                contract: input.contract,
                title: entry.memory.title,
                text: entry.normalizedText,
              })),
            )
          : await Promise.all(
              chunk.map((entry) =>
                input.provider.embed({
                  contract: input.contract,
                  title: entry.memory.title,
                  text: entry.normalizedText,
                }),
              ),
            );
      if (embeddings.length !== chunk.length) {
        throw new Error(`Embedding batch result count mismatch: expected ${chunk.length}, got ${embeddings.length}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const entry of chunk) {
        markFailed(db, entry.row, reason, now(), failures);
      }
      continue;
    }

    for (let index = 0; index < chunk.length; index += 1) {
      const entry = chunk[index];
      const embedding = embeddings[index];
      try {
        if (embedding.dimensions !== input.contract.dimensions) {
          throw new Error(
            `Embedding dimensions mismatch: expected ${input.contract.dimensions}, got ${embedding.dimensions}`,
          );
        }

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
        indexed += 1;
      } catch (error) {
        markFailed(db, entry.row, error instanceof Error ? error.message : String(error), now(), failures);
      }
    }
  }

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

export function defaultVectorStore(adapter: SqliteVecAdapter = createSqliteVecAdapter()): SessionMemoryVectorStore {
  return {
    ensure(db, input) {
      return ensureSessionMemoryVectorStorage(db, {
        contract: input.contract,
        adapter,
      });
    },
    upsert(db, input) {
      upsertSessionMemoryVector(db, input);
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

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

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
