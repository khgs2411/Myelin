import { openMemoryDb } from "../memory/db.ts";
import { EmbeddingProviderFactory } from "../memory/embedding-provider-factory.ts";
import { loadConfig } from "../runtime/config.ts";
import { currentGitBranch, resolveIngestTargetRepo } from "../ingest/runtime.ts";
import { MemoryQueryService, type QueryResponse } from "./memory-query-service.ts";

export type { FacadeResponse, QueryLayerDiagnostic, QueryResponse } from "./memory-query-service.ts";

export async function queryMemory(options: {
  root: string;
  projectKey: string;
  question: string;
  limit?: number;
  includeRoute?: boolean;
  branch?: string | "current";
  layer?: "session" | "project" | "auto";
  maxInlineChars?: number;
}): Promise<QueryResponse> {
  let db: ReturnType<typeof openMemoryDb> | undefined;
  try {
    const config = await loadConfig(options.root);
    const selection = await new EmbeddingProviderFactory(config).initialize("retrieval_document");
    const gitBranch = await resolveQueryBranch(options);
    db = openMemoryDb(options.root);
    const service = new MemoryQueryService({
      db,
      documentContract: selection.contract,
      embeddingProvider: selection.client,
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
    return degradedResponse(error instanceof Error ? error.message : String(error));
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

function degradedResponse(reason: string): QueryResponse {
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
  };
}
