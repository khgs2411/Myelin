import type { Database } from "bun:sqlite";
import { loadConfig } from "../runtime/config.ts";
import { openMemoryDb } from "./db.ts";
import { EmbeddingProviderFactory } from "./embedding-provider-factory.ts";
import {
  indexProjectMemoryRetrieval,
  type ProjectMemoryRetrievalIndexResult,
  type ProjectMemoryRetrievalVectorStore,
} from "./project-memory-retrieval-indexer.ts";

export type ProjectMemoryRetrievalIndexInput = {
  projectKey: string;
  limit: number;
  batchSize: number;
  retryFailed: boolean;
};

export class ProjectMemoryRetrievalIndexService {
  constructor(
    private readonly deps: {
      root: string;
      db?: Database;
      vectorStore?: ProjectMemoryRetrievalVectorStore;
    },
  ) {}

  async indexProject(input: ProjectMemoryRetrievalIndexInput): Promise<ProjectMemoryRetrievalIndexResult> {
    const config = await loadConfig(this.deps.root);
    const selection = await new EmbeddingProviderFactory(config).initialize("retrieval_document");
    const ownedDb = this.deps.db ? null : openMemoryDb(this.deps.root);
    const db = this.deps.db ?? ownedDb;
    if (!db) throw new Error("Project Memory retrieval index service could not open memory db");
    try {
      return await indexProjectMemoryRetrieval(db, {
        root: this.deps.root,
        project_key: input.projectKey,
        contract: selection.contract,
        provider: selection.client,
        limit: input.limit,
        batch_size: input.batchSize,
        retry_failed: input.retryFailed,
        vector_store: this.deps.vectorStore,
      });
    } finally {
      ownedDb?.close();
    }
  }
}
