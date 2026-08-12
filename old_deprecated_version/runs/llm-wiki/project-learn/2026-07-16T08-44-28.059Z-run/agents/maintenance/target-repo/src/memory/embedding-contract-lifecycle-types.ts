import type { EmbeddingContractStatus } from "../status/contracts.ts";
import type { EmbeddingScope } from "./embedding-contract-types.ts";

export type EmbeddingMigrationScopePlan = {
  scope: EmbeddingScope;
  active_contract: EmbeddingContractStatus | null;
  desired_contract: EmbeddingContractStatus | null;
  action: "initialize" | "migrate" | "none";
  indexed: number;
  failed: number;
  pending_remaining: number;
  activated: boolean;
  error?: string;
};

export type EmbeddingMigrationResult = {
  mode: "preview" | "apply";
  scopes: EmbeddingMigrationScopePlan[];
};

export type EmbeddingRollbackScopePlan = {
  scope: EmbeddingScope;
  active_contract: EmbeddingContractStatus | null;
  previous_contract: EmbeddingContractStatus | null;
  action: "rollback" | "none";
  rolled_back: boolean;
};

export type EmbeddingRollbackResult = {
  mode: "preview" | "apply";
  scopes: EmbeddingRollbackScopePlan[];
};

export type EmbeddingPruneCandidate = {
  scope: EmbeddingScope;
  contract: EmbeddingContractStatus & { provider: string };
  metadata_rows: number;
  query_cache_rows: number;
  lifecycle: string;
  vector_table: string | null;
};

export type EmbeddingPruneResult = {
  mode: "preview" | "apply";
  candidates: EmbeddingPruneCandidate[];
  removed_metadata_rows: number;
  removed_query_cache_rows: number;
  removed_vector_rows: number;
  removed_vector_tables: string[];
};
