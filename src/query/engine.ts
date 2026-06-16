import { openMemoryDb } from "../memory/db.ts";
import { EmbeddingProviderFactory } from "../memory/embedding-provider-factory.ts";
import { loadConfig, selectActiveEmbeddingContract } from "../runtime/config.ts";
import { MemoryQueryService, type QueryResponse } from "./memory-query-service.ts";

export type { FacadeResponse, QueryLayerDiagnostic, QueryResponse } from "./memory-query-service.ts";

export async function queryMemory(options: {
  root: string;
  projectKey: string;
  question: string;
  limit?: number;
  includeRoute?: boolean;
}): Promise<QueryResponse> {
  let db: ReturnType<typeof openMemoryDb> | undefined;
  try {
    const config = await loadConfig(options.root);
    const documentContract = selectActiveEmbeddingContract(config, "retrieval_document");
    const provider = new EmbeddingProviderFactory(config).create();
    db = openMemoryDb(options.root);
    const service = new MemoryQueryService({
      db,
      documentContract,
      embeddingProvider: provider,
    });
    return await service.query({
      projectKey: options.projectKey,
      question: options.question,
      limit: options.limit,
      includeRoute: options.includeRoute,
    });
  } catch (error) {
    return degradedResponse(error instanceof Error ? error.message : String(error));
  } finally {
    db?.close();
  }
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
  };
}
