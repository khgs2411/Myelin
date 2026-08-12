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
