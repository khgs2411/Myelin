import type { ActiveEmbeddingContract, EmbeddingProvider } from "../runtime/config.ts";

export const EMBEDDING_SCOPES = ["session_memory", "project_memory"] as const;
export type EmbeddingScope = (typeof EMBEDDING_SCOPES)[number];

export const EMBEDDING_CONTRACT_LIFECYCLES = ["active", "previous", "staging", "retired", "failed"] as const;
export type EmbeddingContractLifecycle = (typeof EMBEDDING_CONTRACT_LIFECYCLES)[number];

export type EmbeddingContractIdentity = {
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
  formatVersion: number;
};

export type StoredEmbeddingContract = EmbeddingContractIdentity & {
  id: string;
  scope: EmbeddingScope;
  lifecycle: EmbeddingContractLifecycle;
  vectorTable: string;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
  failureReason: string | null;
};

export type ResolvedEmbeddingContract = {
  scope: EmbeddingScope;
  active: StoredEmbeddingContract;
  desired: EmbeddingContractIdentity;
  migrationRequired: boolean;
};

export function documentContract(identity: EmbeddingContractIdentity): ActiveEmbeddingContract {
  return { ...identity, purpose: "retrieval_document" };
}

export function queryContract(identity: EmbeddingContractIdentity): ActiveEmbeddingContract {
  return { ...identity, purpose: "retrieval_query" };
}

export function embeddingContractIdentity(contract: ActiveEmbeddingContract): EmbeddingContractIdentity {
  return {
    provider: contract.provider,
    model: contract.model,
    dimensions: contract.dimensions,
    formatVersion: contract.formatVersion,
  };
}

export function sameEmbeddingContract(
  left: EmbeddingContractIdentity,
  right: EmbeddingContractIdentity,
): boolean {
  return left.provider === right.provider
    && left.model === right.model
    && left.dimensions === right.dimensions
    && left.formatVersion === right.formatVersion;
}
