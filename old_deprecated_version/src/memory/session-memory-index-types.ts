import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { SessionMemoryVectorInput } from "./sqlite-vec.ts";

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
  ensure(db: Database, input: { contract: ActiveEmbeddingContract }): {
    available: boolean;
    reason?: string;
  };
  upsert(db: Database, input: SessionMemoryVectorInput): void;
};

export type SessionMemoryIndexInput = {
  projectKey: string;
  limit: number;
  batchSize: number;
  retryFailed: boolean;
};
