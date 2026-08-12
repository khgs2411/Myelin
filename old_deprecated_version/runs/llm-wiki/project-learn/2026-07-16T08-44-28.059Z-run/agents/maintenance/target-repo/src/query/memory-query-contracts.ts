import type { SessionMemoryQueryMatch } from "../memory/session-memory-query-types.ts";
import type { ProjectMemoryQueryMatch } from "./project-memory-query-types.ts";

export type FacadeResponse = {
  answer: string;
  confidence: number;
  memory_scope: string;
  citations: string[];
  candidate_ids: string[];
  degraded: boolean;
  degraded_reason: string | null;
  source_tools: string[];
};

export type QueryLayerDiagnostic = {
  layer: "session_memory" | "project_memory";
  query_log_id: string | null;
  degraded: boolean;
  degraded_reason: string | null;
  indexed_count: number;
  pending_count: number;
  match_count: number;
  query_embedding_cache_hit: boolean | null;
  query_embedding_cache_id: string | null;
  normalized_question: string | null;
};

export type QueryResponse = FacadeResponse & {
  matches: SessionMemoryQueryMatch[];
  project_memory_matches: ProjectMemoryQueryMatch[];
  layers?: QueryLayerDiagnostic[];
};

export type MemoryQueryInput = {
  root: string;
  projectKey: string;
  question: string;
  limit?: number;
  includeRoute?: boolean;
  gitBranch?: string;
  layer?: "session" | "project";
  maxInlineChars?: number;
};
