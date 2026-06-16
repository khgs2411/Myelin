import type { Database } from "bun:sqlite";
import type { EmbeddingProviderClient } from "../memory/embedding-provider.ts";
import {
  querySessionMemory,
  type SessionMemoryQueryMatch,
  type SessionMemoryQueryResult,
} from "../memory/session-memory-query.ts";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";

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
  layer: "session_memory";
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
  layers?: QueryLayerDiagnostic[];
};

export type MemoryQueryInput = {
  projectKey: string;
  question: string;
  limit?: number;
  includeRoute?: boolean;
};

type SessionMemoryQueryRunner = typeof querySessionMemory;

export class MemoryQueryService {
  constructor(
    private readonly deps: {
      db: Database;
      documentContract: ActiveEmbeddingContract;
      embeddingProvider: EmbeddingProviderClient;
      responseService?: DeterministicMemoryQueryResponseService;
      sessionMemoryQuery?: SessionMemoryQueryRunner;
    },
  ) {}

  async query(input: MemoryQueryInput): Promise<QueryResponse> {
    const sessionMemoryQuery = this.deps.sessionMemoryQuery ?? querySessionMemory;
    const responseService = this.deps.responseService ?? new DeterministicMemoryQueryResponseService();

    try {
      const result = await sessionMemoryQuery(this.deps.db, {
        project_key: input.projectKey,
        question: input.question,
        document_contract: this.deps.documentContract,
        provider: this.deps.embeddingProvider,
        limit: input.limit ?? 5,
      });
      return responseService.fromSessionMemoryResult(result, { includeRoute: input.includeRoute ?? false });
    } catch (error) {
      return responseService.degraded(error instanceof Error ? error.message : String(error));
    }
  }
}

export class DeterministicMemoryQueryResponseService {
  fromSessionMemoryResult(result: SessionMemoryQueryResult, input: { includeRoute: boolean }): QueryResponse {
    const response: QueryResponse = {
      answer: this.answerFromMatches(result.matches),
      confidence: this.confidenceFromMatches(result.matches, result.degraded),
      memory_scope: result.degraded ? "none" : "session_memory",
      citations: result.matches.map((match) => `session_memory:${match.id}`),
      candidate_ids: [],
      degraded: result.degraded,
      degraded_reason: result.degraded_reason ?? null,
      source_tools: result.source_tools,
      matches: result.matches,
    };
    if (input.includeRoute) response.layers = [this.sessionMemoryDiagnostic(result)];
    return response;
  }

  degraded(reason: string): QueryResponse {
    return {
      answer: reason,
      confidence: 0,
      memory_scope: "none",
      citations: [],
      candidate_ids: [],
      degraded: true,
      degraded_reason: reason,
      source_tools: ["session-memory-vector-index"],
      matches: [],
    };
  }

  private answerFromMatches(matches: SessionMemoryQueryMatch[]): string {
    if (matches.length === 0) return "No Session Memory matches found.";
    return matches
      .map((match) => {
        const title = match.title ? `${match.title}: ` : "";
        return `${match.id} [${match.memory_kind}] ${title}${match.summary}`;
      })
      .join("\n\n");
  }

  private confidenceFromMatches(matches: SessionMemoryQueryMatch[], degraded: boolean): number {
    if (degraded || matches.length === 0) return 0;
    const distance = matches[0].distance;
    if (!Number.isFinite(distance)) return 0.75;
    return Number(Math.max(0.1, Math.min(0.95, 1 - distance)).toFixed(3));
  }

  private sessionMemoryDiagnostic(result: SessionMemoryQueryResult): QueryLayerDiagnostic {
    return {
      layer: "session_memory",
      degraded: result.degraded,
      degraded_reason: result.degraded_reason ?? null,
      indexed_count: result.indexed_count,
      pending_count: result.pending_count,
      match_count: result.matches.length,
      query_embedding_cache_hit: result.query_embedding_cache_hit ?? null,
      query_embedding_cache_id: result.query_embedding_cache_id ?? null,
      normalized_question: result.normalized_question ?? null,
    };
  }
}
