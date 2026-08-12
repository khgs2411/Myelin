import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { EmbeddingTransport } from "./embedding-types.ts";
import type { SessionMemoryKind, SessionMemoryStatus } from "./ingest-types.ts";
import type { SessionMemoryContextRow } from "./session-memory-contexts.ts";
import type { SessionMemoryVectorMatch } from "./sqlite-vec.ts";

export type SessionMemoryQueryFilters = {
  memory_kind?: SessionMemoryKind[];
  git_branch?: string;
  status?: SessionMemoryStatus[];
};

export type SessionMemoryQueryMatch = {
  id: string;
  memory_kind: SessionMemoryKind;
  title: string | null;
  summary: string;
  payload: Record<string, unknown>;
  source_event_refs: string[];
  contexts: SessionMemoryContextRow[];
  created_at: string;
  updated_at: string;
  distance: number;
};

export type SessionMemoryQueryResult = {
  project_key: string;
  question: string;
  query_log_id?: string;
  degraded: boolean;
  degraded_reason?: string;
  degraded_code?: "embedding_provider_unreachable" | "embedding_provider_configuration" | "embedding_provider_unavailable";
  indexed_count: number;
  pending_count: number;
  query_embedding_cache_hit?: boolean;
  query_embedding_cache_id?: string;
  normalized_question?: string;
  matches: SessionMemoryQueryMatch[];
  source_tools: string[];
};

export type SessionMemoryQueryVectorStore = {
  ensure(db: Database, input: { contract: ActiveEmbeddingContract }): { available: boolean; reason?: string };
  search(
    db: Database,
    input: {
      project_key: string;
      contract: ActiveEmbeddingContract;
      embedding: number[];
      limit: number;
    },
  ): SessionMemoryVectorMatch[];
};

export type SessionMemoryQueryInput = {
  project_key: string;
  question: string;
  document_contract: ActiveEmbeddingContract;
  provider: EmbeddingTransport;
  vector_table?: string;
  limit: number;
  filters?: SessionMemoryQueryFilters;
  vector_store?: SessionMemoryQueryVectorStore;
  now?: () => string;
};
