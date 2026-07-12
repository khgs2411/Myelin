import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import { loadConfig } from "../runtime/config.ts";
import type { EmbeddingTransport } from "./embedding-types.ts";
import { openMemoryDb } from "./db.ts";
import { EmbeddingProviderFactory } from "./embedding-provider-factory.ts";
import { indexProjectMemoryRetrieval } from "./project-memory-retrieval-indexer.ts";
import type {
  ProjectMemoryRetrievalIndexInput,
  ProjectMemoryRetrievalIndexCoordinatorDependencies,
  ProjectMemoryRetrievalIndexCoordinatorInput,
  ProjectMemoryRetrievalIndexResult,
  ProjectMemoryRetrievalVectorStore,
} from "./project-memory-retrieval-index-types.ts";

export type {
  ProjectMemoryRetrievalIndexCoordinatorDependencies,
  ProjectMemoryRetrievalIndexCoordinatorInput,
  ProjectMemoryRetrievalIndexInput,
} from "./project-memory-retrieval-index-types.ts";

/** Pure application service; all runtime dependencies are injected. */
export class ProjectMemoryRetrievalIndexService {
  constructor(private readonly deps: {
    root: string;
    db: Database;
    contract: ActiveEmbeddingContract;
    provider: EmbeddingTransport;
    vectorStore?: ProjectMemoryRetrievalVectorStore;
  }) {}

  async indexProject(input: ProjectMemoryRetrievalIndexInput): Promise<ProjectMemoryRetrievalIndexResult> {
    return indexProjectMemoryRetrieval(this.deps.db, {
      root: this.deps.root,
      project_key: input.projectKey,
      contract: this.deps.contract,
      provider: this.deps.provider,
      limit: input.limit,
      batch_size: input.batchSize,
      retry_failed: input.retryFailed,
      vector_store: this.deps.vectorStore,
    });
  }
}

/** Composition boundary that owns configuration, provider selection, and the database lifetime. */
export class ProjectMemoryRetrievalIndexCoordinator {
  constructor(private readonly deps: ProjectMemoryRetrievalIndexCoordinatorDependencies) {}

  async indexProject(input: ProjectMemoryRetrievalIndexCoordinatorInput): Promise<ProjectMemoryRetrievalIndexResult> {
    const config = await (this.deps.loadConfig ?? loadConfig)(this.deps.root);
    const selection = await (this.deps.createFactory?.(config) ?? new EmbeddingProviderFactory(config))
      .initialize("retrieval_document");
    const db = (this.deps.openDb ?? openMemoryDb)(this.deps.root);
    try {
      return await new ProjectMemoryRetrievalIndexService({
        root: this.deps.root,
        db,
        contract: selection.contract,
        provider: selection.client,
      }).indexProject({
        ...input,
        batchSize: input.batchSize ?? config.embedding.batchSize,
      });
    } finally {
      db.close();
    }
  }
}
