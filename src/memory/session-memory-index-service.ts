import type { Database } from "bun:sqlite";
import type { EmbeddingProviderClient } from "./embedding-provider.ts";
import {
  indexSessionMemories,
  type SessionMemoryIndexResult,
  type SessionMemoryVectorStore,
} from "./session-memory-indexer.ts";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";

export type SessionMemoryIndexInput = {
  projectKey: string;
  limit: number;
  batchSize: number;
  retryFailed: boolean;
};

export class SessionMemoryIndexService {
  constructor(
    private readonly deps: {
      db: Database;
      contract: ActiveEmbeddingContract;
      provider: EmbeddingProviderClient;
      vectorStore?: SessionMemoryVectorStore;
    },
  ) {}

  async indexPending(input: SessionMemoryIndexInput): Promise<SessionMemoryIndexResult> {
    return await indexSessionMemories(this.deps.db, {
      project_key: input.projectKey,
      contract: this.deps.contract,
      provider: this.deps.provider,
      limit: input.limit,
      batch_size: input.batchSize,
      retry_failed: input.retryFailed,
      vector_store: this.deps.vectorStore,
    });
  }
}
