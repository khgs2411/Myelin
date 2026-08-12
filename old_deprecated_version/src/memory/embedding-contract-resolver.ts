import type { Database } from "bun:sqlite";
import {
  selectEmbeddingContract,
  type ActiveEmbeddingContract,
  type MyelinConfig,
} from "../runtime/config.ts";
import { EmbeddingProviderFactory, type ResolvedEmbeddingClient } from "./embedding-provider-factory.ts";
import {
  discoverIndexedEmbeddingContract,
  readActiveEmbeddingContract,
  registerInitialActiveEmbeddingContract,
} from "./embedding-contract-store.ts";
import {
  documentContract,
  embeddingContractIdentity,
  sameEmbeddingContract,
  type EmbeddingContractIdentity,
  type EmbeddingScope,
  type ResolvedEmbeddingContract,
} from "./embedding-contract-types.ts";

type ContractSelectingFactory = Pick<EmbeddingProviderFactory, "initializeLocalAuto">;
type ContractInitializingFactory = Pick<EmbeddingProviderFactory, "initializeContract" | "initializeLocalAuto">;

export type EmbeddingContractPlan = {
  scope: EmbeddingScope;
  active: EmbeddingContractIdentity | null;
  desired: EmbeddingContractIdentity;
  initializationRequired: boolean;
  migrationRequired: boolean;
};

/**
 * Resolves lifecycle intent without registering an active contract. Global
 * lifecycle admission uses this read-only seam before it is allowed to mutate.
 */
export async function planEmbeddingContract(input: {
  db: Database;
  config: MyelinConfig;
  scope: EmbeddingScope;
  factory?: ContractSelectingFactory;
}): Promise<EmbeddingContractPlan> {
  const active = readActiveEmbeddingContract(input.db, input.scope);
  if (active) {
    const desired = desiredContract(input.config, active);
    return {
      scope: input.scope,
      active,
      desired,
      initializationRequired: false,
      migrationRequired: !sameEmbeddingContract(active, desired),
    };
  }

  const discovered = discoverIndexedEmbeddingContract(input.db, input.scope)?.contract ?? null;
  const selected = discovered ?? (input.config.embedding.provider === "auto"
    ? embeddingContractIdentity(
      (await (input.factory ?? new EmbeddingProviderFactory(input.config))
        .initializeLocalAuto("retrieval_document")).contract,
    )
    : embeddingContractIdentity(
      selectEmbeddingContract(input.config, input.config.embedding.provider, "retrieval_document"),
    ));
  const desired = desiredContract(input.config, selected);
  return {
    scope: input.scope,
    active: discovered,
    desired,
    initializationRequired: true,
    migrationRequired: !sameEmbeddingContract(selected, desired),
  };
}

export async function resolveEmbeddingContract(input: {
  db: Database;
  config: MyelinConfig;
  scope: EmbeddingScope;
  factory?: ContractSelectingFactory;
  now?: string;
}): Promise<ResolvedEmbeddingContract> {
  const active = readActiveEmbeddingContract(input.db, input.scope);
  if (active) {
    const desired = desiredContract(input.config, active);
    return {
      scope: input.scope,
      active,
      desired,
      migrationRequired: !sameEmbeddingContract(active, desired),
    };
  }

  const discovered = discoverIndexedEmbeddingContract(input.db, input.scope);
  if (discovered) {
    const registered = registerInitialActiveEmbeddingContract(input.db, {
      scope: input.scope,
      contract: discovered.contract,
      vectorTable: discovered.vectorTable,
      now: input.now,
    });
    const desired = desiredContract(input.config, registered);
    return {
      scope: input.scope,
      active: registered,
      desired,
      migrationRequired: !sameEmbeddingContract(registered, desired),
    };
  }

  const selected = input.config.embedding.provider === "auto"
    ? await (input.factory ?? new EmbeddingProviderFactory(input.config)).initializeLocalAuto("retrieval_document")
    : { contract: selectEmbeddingContract(input.config, input.config.embedding.provider, "retrieval_document") };
  const identity = embeddingContractIdentity(selected.contract);
  const registered = registerInitialActiveEmbeddingContract(input.db, {
    scope: input.scope,
    contract: identity,
    now: input.now,
  });
  return { scope: input.scope, active: registered, desired: identity, migrationRequired: false };
}

export async function resolveEmbeddingRuntime(input: {
  db: Database;
  config: MyelinConfig;
  scope: EmbeddingScope;
  factory?: ContractInitializingFactory;
  now?: string;
}): Promise<ResolvedEmbeddingContract & { runtime: ResolvedEmbeddingClient }> {
  const factory = input.factory ?? new EmbeddingProviderFactory(input.config);
  const resolved = await resolveEmbeddingContract({ ...input, factory });
  const runtime = await factory.initializeContract(documentContract(resolved.active));
  return { ...resolved, runtime };
}

function desiredContract(
  config: MyelinConfig,
  active: EmbeddingContractIdentity,
): EmbeddingContractIdentity {
  if (config.embedding.provider === "auto") return {
    provider: active.provider,
    model: active.model,
    dimensions: active.dimensions,
    formatVersion: active.formatVersion,
  };
  return embeddingContractIdentity(
    selectEmbeddingContract(config, config.embedding.provider, "retrieval_document"),
  );
}

export function activeDocumentContract(resolved: ResolvedEmbeddingContract): ActiveEmbeddingContract {
  return documentContract(resolved.active);
}
