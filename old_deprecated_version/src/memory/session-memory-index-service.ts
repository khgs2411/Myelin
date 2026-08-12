import type { Database } from "bun:sqlite";
import type { EmbeddingTransport } from "./embedding-types.ts";
import {
  indexSessionMemories,
} from "./session-memory-indexer.ts";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type {
  SessionMemoryIndexInput,
  SessionMemoryIndexResult,
  SessionMemoryVectorStore,
} from "./session-memory-index-types.ts";
export type { SessionMemoryIndexInput } from "./session-memory-index-types.ts";

export async function requestPendingSessionMemoryIndexing(input: {
  db: Database;
  projectKey: string;
  schedule?: (projectKey: string) => void | Promise<void>;
}): Promise<{ kind: "no_work" | "requested"; pending: number }> {
  const row = input.db.query(
    `SELECT count(*) AS count FROM session_memory_embeddings
     WHERE project_key = ? AND status = 'pending'`,
  ).get(input.projectKey) as { count: number };
  if (row.count === 0) return { kind: "no_work", pending: 0 };
  await input.schedule?.(input.projectKey);
  return { kind: "requested", pending: row.count };
}

export class SessionMemoryIndexService {
  constructor(
    private readonly deps: {
      db: Database;
      contract: ActiveEmbeddingContract;
      provider: EmbeddingTransport;
      vectorTable?: string;
      vectorStore?: SessionMemoryVectorStore;
    },
  ) {}

  async indexPending(input: SessionMemoryIndexInput): Promise<SessionMemoryIndexResult> {
    return await indexSessionMemories(this.deps.db, {
      project_key: input.projectKey,
      contract: this.deps.contract,
      provider: this.deps.provider,
      vector_table: this.deps.vectorTable,
      limit: input.limit,
      batch_size: input.batchSize,
      retry_failed: input.retryFailed,
      vector_store: this.deps.vectorStore,
    });
  }
}
