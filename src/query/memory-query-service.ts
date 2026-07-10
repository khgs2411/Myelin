import type { Database } from "bun:sqlite";
import type { EmbeddingProviderClient } from "../memory/embedding-provider.ts";
import {
  querySessionMemory,
  type SessionMemoryQueryMatch,
  type SessionMemoryQueryResult,
} from "../memory/session-memory-query.ts";
import {
  queryProjectMemory,
  type ProjectMemoryQueryMatch,
  type ProjectMemoryQueryResult,
} from "./project-memory-query-service.ts";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import { attachMemoryQueryLogResponse } from "../memory/query-logs.ts";

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
  layer?: "session" | "project" | "auto";
  maxInlineChars?: number;
};

type SessionMemoryQueryRunner = typeof querySessionMemory;
type ProjectMemoryQueryRunner = typeof queryProjectMemory;

export class MemoryQueryService {
  constructor(
    private readonly deps: {
      db: Database;
      documentContract: ActiveEmbeddingContract;
      embeddingProvider: EmbeddingProviderClient;
      responseService?: DeterministicMemoryQueryResponseService;
      sessionMemoryQuery?: SessionMemoryQueryRunner;
      projectMemoryQuery?: ProjectMemoryQueryRunner;
    },
  ) {}

  async query(input: MemoryQueryInput): Promise<QueryResponse> {
    if (input.layer === "project") return await this.queryProject(input);
    return await this.querySession(input);
  }

  private async querySession(input: MemoryQueryInput): Promise<QueryResponse> {
    const sessionMemoryQuery = this.deps.sessionMemoryQuery ?? querySessionMemory;
    const responseService = this.deps.responseService ?? new DeterministicMemoryQueryResponseService();

    try {
      const result = await sessionMemoryQuery(this.deps.db, {
        project_key: input.projectKey,
        question: input.question,
        document_contract: this.deps.documentContract,
        provider: this.deps.embeddingProvider,
        limit: input.limit ?? 5,
        filters: input.gitBranch ? { git_branch: input.gitBranch } : undefined,
      });
      const response = responseService.fromSessionMemoryResult(result, { includeRoute: input.includeRoute ?? false });
      this.attachResponseLog("session", result.query_log_id, response);
      return response;
    } catch (error) {
      return responseService.degraded(error instanceof Error ? error.message : String(error));
    }
  }

  private async queryProject(input: MemoryQueryInput): Promise<QueryResponse> {
    const projectMemoryQuery = this.deps.projectMemoryQuery ?? queryProjectMemory;
    const responseService = this.deps.responseService ?? new DeterministicMemoryQueryResponseService();

    try {
      const result = await projectMemoryQuery(this.deps.db, {
        root: input.root,
        project_key: input.projectKey,
        question: input.question,
        document_contract: this.deps.documentContract,
        provider: this.deps.embeddingProvider,
        limit: input.limit ?? 5,
        max_inline_chars: input.maxInlineChars ?? 4000,
      });
      const response = responseService.fromProjectMemoryResult(result, { includeRoute: input.includeRoute ?? false });
      this.attachResponseLog("project", result.query_log_id, response);
      return response;
    } catch (error) {
      return responseService.degraded(error instanceof Error ? error.message : String(error), "project_memory");
    }
  }

  private attachResponseLog(layer: "session" | "project", queryLogId: string | undefined, response: QueryResponse): void {
    if (!queryLogId) return;
    attachMemoryQueryLogResponse(this.deps.db, {
      layer,
      log_id: queryLogId,
      answer_text: response.answer,
      response,
    });
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
      project_memory_matches: [],
    };
    if (input.includeRoute) response.layers = [this.sessionMemoryDiagnostic(result)];
    return response;
  }

  fromProjectMemoryResult(result: ProjectMemoryQueryResult, input: { includeRoute: boolean }): QueryResponse {
    const response: QueryResponse = {
      answer: this.answerFromProjectMemoryMatches(result.matches),
      confidence: this.confidenceFromProjectMemoryMatches(result.matches, result.degraded),
      memory_scope: result.degraded ? "project_memory_degraded" : "project_memory",
      citations: result.matches.map((match) => match.citation),
      candidate_ids: [],
      degraded: result.degraded,
      degraded_reason: result.degraded_reason ?? null,
      source_tools: result.source_tools,
      matches: [],
      project_memory_matches: result.matches,
    };
    if (input.includeRoute) response.layers = [this.projectMemoryDiagnostic(result)];
    return response;
  }

  degraded(reason: string, layer: "session_memory" | "project_memory" = "session_memory"): QueryResponse {
    return {
      answer: reason,
      confidence: 0,
      memory_scope: "none",
      citations: [],
      candidate_ids: [],
      degraded: true,
      degraded_reason: reason,
      source_tools: [layer === "project_memory" ? "project-memory-vector-index" : "session-memory-vector-index"],
      matches: [],
      project_memory_matches: [],
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
    let score = 0.65;
    if (matches[0].source_event_refs.length > 0) score += 0.05;
    if (matches.length >= 3) score += 0.05;
    score += this.relativeSeparationScore(matches.map((match) => match.distance));
    return Number(Math.min(0.85, score).toFixed(3));
  }

  private answerFromProjectMemoryMatches(matches: ProjectMemoryQueryMatch[]): string {
    if (matches.length === 0) return "No Project Memory matches found.";
    return matches
      .map((match) => {
        const ref = `${match.wiki_path}#${match.section_id}`;
        if (match.return_kind === "inline_content") return `${ref}\n${match.content ?? ""}`;
        return `${ref} (${match.reference_reason ?? "degraded"})`;
      })
      .join("\n\n");
  }

  private confidenceFromProjectMemoryMatches(matches: ProjectMemoryQueryMatch[], degraded: boolean): number {
    if (matches.length === 0) return 0;
    if (degraded && matches.every((match) => match.return_kind !== "inline_content")) return 0;
    const top = matches[0];
    const tokenCoverage = top.query_token_coverage ?? 0;
    const phraseCoverage = top.query_phrase_coverage ?? 0;
    let score = 0.4 + tokenCoverage * 0.25 + phraseCoverage * 0.15;
    if (top.return_kind === "inline_content") score += 0.05;
    if (top.vector_rank !== undefined && top.fts_rank !== undefined) score += 0.05;
    if (top.rerank_reasons?.some((reason) => reason === "section_title_match" || reason === "section_id_match")) {
      score += 0.05;
    }
    if (tokenCoverage < 0.5) score = Math.min(score, 0.55);
    return Number(Math.min(degraded ? 0.55 : 0.9, score).toFixed(3));
  }

  private relativeSeparationScore(distances: number[]): number {
    const sorted = distances.filter(Number.isFinite).sort((left, right) => left - right);
    if (sorted.length < 2) return 0;
    const range = sorted[sorted.length - 1] - sorted[0];
    if (range <= 0) return 0;
    return Math.min(0.1, ((sorted[1] - sorted[0]) / range) * 0.1);
  }

  private sessionMemoryDiagnostic(result: SessionMemoryQueryResult): QueryLayerDiagnostic {
    return {
      layer: "session_memory",
      query_log_id: result.query_log_id ?? null,
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

  private projectMemoryDiagnostic(result: ProjectMemoryQueryResult): QueryLayerDiagnostic {
    return {
      layer: "project_memory",
      query_log_id: result.query_log_id ?? null,
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
