import { openMemoryDb } from "../memory/db.ts";
import { resolveEmbeddingRuntime } from "../memory/embedding-contract-resolver.ts";
import { loadConfig } from "../runtime/config.ts";
import { currentGitBranch, resolveIngestTargetRepo } from "../ingest/runtime.ts";
import { MemoryQueryService } from "./memory-query-service.ts";
import type { QueryResponse } from "./memory-query-contracts.ts";
import { embeddingProviderFailureCode } from "../memory/embedding-provider-errors.ts";

export type { FacadeResponse, QueryLayerDiagnostic, QueryResponse } from "./memory-query-contracts.ts";

export async function queryMemory(options: {
  root: string;
  projectKey: string;
  question: string;
  limit?: number;
  includeRoute?: boolean;
  branch?: string | "current";
  layer?: "session" | "project";
  maxInlineChars?: number;
}): Promise<QueryResponse> {
  let db: ReturnType<typeof openMemoryDb> | undefined;
  try {
    const config = await loadConfig(options.root);
    const gitBranch = await resolveQueryBranch(options);
    db = openMemoryDb(options.root);
    const selection = await resolveEmbeddingRuntime({
      db,
      config,
      scope: options.layer === "project" ? "project_memory" : "session_memory",
    });
    const service = new MemoryQueryService({
      db,
      documentContract: selection.runtime.contract,
      embeddingProvider: selection.runtime.client,
      vectorTable: selection.active.vectorTable,
    });
    return await service.query({
      root: options.root,
      projectKey: options.projectKey,
      question: options.question,
      limit: options.limit,
      includeRoute: options.includeRoute,
      gitBranch,
      layer: options.layer,
      maxInlineChars: options.maxInlineChars,
    });
  } catch (error) {
    return degradedResponse(
      error instanceof Error ? error.message : String(error),
      embeddingProviderFailureCode(error),
    );
  } finally {
    db?.close();
  }
}

async function resolveQueryBranch(options: { root: string; projectKey: string; branch?: string | "current" }): Promise<string | undefined> {
  if (!options.branch) return undefined;
  if (options.branch !== "current") return options.branch;
  const targetRepo = await resolveIngestTargetRepo(options.root, options.projectKey);
  const branch = await currentGitBranch(targetRepo);
  return branch.trim() === "" ? undefined : branch;
}

function degradedResponse(reason: string, code?: QueryResponse["degraded_code"]): QueryResponse {
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
    project_memory_matches: [],
    ...(code ? { degraded_code: code } : {}),
  };
}
