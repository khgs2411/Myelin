import type { Database } from "bun:sqlite";
import type { EmbeddingTransport } from "../memory/embedding-types.ts";
import type { ProjectMemoryRetrievalVectorMatch } from "../memory/sqlite-vec.ts";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";

export type ProjectMemoryQueryMatch = {
  retrieval_row_id: string;
  wiki_path: string;
  section_id: string;
  section_hash: string;
  heading_path: string[];
  page_title: string;
  distance: number;
  return_kind: "inline_content" | "reference";
  content?: string;
  reference_reason?: "too_large" | "stale_hash" | "missing_markdown" | "degraded";
  citation: string;
  vector_rank?: number;
  fts_rank?: number;
  bm25_score?: number;
  rrf_score?: number;
  rerank_score?: number;
  rerank_reasons?: string[];
  query_token_coverage?: number;
  query_phrase_coverage?: number;
};

export type ProjectMemoryQueryResult = {
  project_key: string;
  question: string;
  query_log_id?: string;
  degraded: boolean;
  degraded_reason?: string;
  degraded_code?: "embedding_provider_unreachable" | "embedding_provider_configuration" | "embedding_provider_unavailable";
  indexed_count: number;
  pending_count: number;
  match_count: number;
  query_embedding_cache_hit?: boolean;
  query_embedding_cache_id?: string;
  normalized_question?: string;
  retrieval_debug?: ProjectMemoryRetrievalDebug;
  matches: ProjectMemoryQueryMatch[];
  source_tools: string[];
};

export type ProjectMemoryRetrievalDebug = {
  vector_recall_count: number;
  fts_recall_count: number;
  fused_candidate_count: number;
  rrf_rank_constant: number;
  fts_degraded_reason?: string;
};

export type ProjectMemoryQueryVectorStore = {
  ensure(db: Database, input: { contract: ActiveEmbeddingContract }): { available: boolean; reason?: string };
  search(
    db: Database,
    input: {
      project_key: string;
      contract: ActiveEmbeddingContract;
      embedding: number[];
      limit: number;
    },
  ): ProjectMemoryRetrievalVectorMatch[];
};

export type ProjectMemoryQueryInput = {
  root: string;
  project_key: string;
  question: string;
  document_contract: ActiveEmbeddingContract;
  provider: EmbeddingTransport;
  vector_table?: string;
  limit: number;
  max_inline_chars: number;
  vector_store?: ProjectMemoryQueryVectorStore;
  now?: () => string;
};
