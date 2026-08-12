import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract, MyelinConfig } from "../runtime/config.ts";
import type { EmbeddingProviderFactory } from "./embedding-provider-factory.ts";
import type { ProjectMemoryRetrievalVectorInput } from "./sqlite-vec.ts";

export type ProjectMemoryRetrievalIndexFailure = {
  retrieval_row_id: string;
  wiki_path: string;
  section_id: string;
  reason: string;
};

export type ProjectMemoryRetrievalIndexResult = {
  project_key: string;
  structural_sections_seen: number;
  hints_valid: number;
  hints_stale: number;
  hints_orphaned: number;
  selected: number;
  indexed: number;
  failed: number;
  pending_remaining: number;
  degraded: boolean;
  batch_size: number;
  degraded_reason?: string;
  failures: ProjectMemoryRetrievalIndexFailure[];
};

export type ProjectMemoryRetrievalVectorStore = {
  ensure(db: Database, input: { contract: ActiveEmbeddingContract }): {
    available: boolean;
    reason?: string;
  };
  upsert(db: Database, input: ProjectMemoryRetrievalVectorInput): void;
};

export type ProjectMemoryRetrievalIndexInput = {
  projectKey: string;
  limit: number;
  batchSize: number;
  retryFailed: boolean;
};

export type ProjectMemoryRetrievalIndexCoordinatorInput = Omit<ProjectMemoryRetrievalIndexInput, "batchSize"> & {
  batchSize?: number;
};

export type ProjectMemoryRetrievalIndexCoordinatorDependencies = {
  root: string;
  loadConfig?: (root: string) => Promise<MyelinConfig>;
  openDb?: (root: string) => Database;
  createFactory?: (config: MyelinConfig) => Pick<EmbeddingProviderFactory, "initializeContract" | "initializeLocalAuto">;
};
