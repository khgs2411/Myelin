import type { Database } from "bun:sqlite";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { discoverProjects } from "../runtime/projects.ts";
import {
  EMBEDDING_FORMAT_VERSION,
  loadConfig,
  type MyelinConfig,
} from "../runtime/config.ts";
import type { EmbeddingContractStatus } from "../status/contracts.ts";
import { openMemoryDb } from "./db.ts";
import { resolveEmbeddingContract } from "./embedding-contract-resolver.ts";
import {
  activateEmbeddingContract,
  embeddingContractId,
  listEmbeddingContracts,
  markEmbeddingContractFailed,
  readActiveEmbeddingContract,
  readPreviousEmbeddingContract,
  removeEmbeddingContract,
  rollbackEmbeddingContract,
  upsertStagingEmbeddingContract,
} from "./embedding-contract-store.ts";
import {
  sameEmbeddingContract,
  type EmbeddingContractIdentity,
  type EmbeddingScope,
} from "./embedding-contract-types.ts";
import { EmbeddingProviderFactory } from "./embedding-provider-factory.ts";
import type {
  EmbeddingMigrationResult,
  EmbeddingMigrationScopePlan,
  EmbeddingPruneCandidate,
  EmbeddingPruneResult,
  EmbeddingRollbackResult,
} from "./embedding-contract-lifecycle-types.ts";
import { ProjectMemoryRetrievalIndexService } from "./project-memory-retrieval-index-service.ts";
import { SessionMemoryIndexService } from "./session-memory-index-service.ts";
import { extractProjectMemorySections } from "../project/project-memory-markdown-sections.ts";
import {
  deleteOwnedVectorRows,
  countOwnedIndexedVectorRows,
  dropOwnedVectorTable,
  ensureProjectMemoryRetrievalVectorTable,
  ensureSessionMemoryVectorTable,
  smokeOwnedVectorQuery,
} from "./sqlite-vec.ts";

export class EmbeddingContractLifecycleService {
  constructor(private readonly root: string) {}

  async migrate(input: { apply: boolean }): Promise<EmbeddingMigrationResult> {
    const config = await loadConfig(this.root);
    const db = openMemoryDb(this.root);
    try {
      const scopes = await Promise.all([
        this.migrationPlan(db, config, "session_memory"),
        this.migrationPlan(db, config, "project_memory"),
      ]);
      if (!input.apply) return { mode: "preview", scopes };
      for (const plan of scopes) {
        if (plan.action === "none" || !plan.desired_contract) continue;
        try {
          await this.applyScopeMigration(db, config, plan);
        } catch (error) {
          plan.error = error instanceof Error ? error.message : String(error);
          if (plan.desired_contract) {
            markEmbeddingContractFailed(
              db,
              embeddingContractId(plan.scope, identityFromStatus(plan.desired_contract)),
              plan.error,
            );
          }
        }
      }
      return { mode: "apply", scopes };
    } finally {
      db.close();
    }
  }

  async rollback(input: { apply: boolean }): Promise<EmbeddingRollbackResult> {
    const db = openMemoryDb(this.root);
    try {
      const scopes = (["session_memory", "project_memory"] as const).map((scope) => {
        const active = readActiveEmbeddingContract(db, scope);
        const previous = readPreviousEmbeddingContract(db, scope);
        return {
          scope,
          active_contract: active ? statusContract(active) : null,
          previous_contract: previous ? statusContract(previous) : null,
          action: previous ? "rollback" as const : "none" as const,
          rolled_back: false,
        };
      });
      if (input.apply) {
        for (const plan of scopes) {
          if (plan.action !== "rollback") continue;
          rollbackEmbeddingContract(db, plan.scope);
          plan.rolled_back = true;
        }
      }
      return { mode: input.apply ? "apply" : "preview", scopes };
    } finally {
      db.close();
    }
  }

  async prune(input: { apply: boolean }): Promise<EmbeddingPruneResult> {
    const db = openMemoryDb(this.root);
    try {
      const candidates = this.pruneCandidates(db);
      const result: EmbeddingPruneResult = {
        mode: input.apply ? "apply" : "preview",
        candidates,
        removed_metadata_rows: 0,
        removed_query_cache_rows: 0,
        removed_vector_rows: 0,
        removed_vector_tables: [],
      };
      if (!input.apply) return result;
      await this.assertPruneCoverage(db, candidates);
      db.transaction(() => {
        for (const candidate of candidates) this.applyPruneCandidate(db, candidate, result);
      })();
      return result;
    } finally {
      db.close();
    }
  }

  private async assertPruneCoverage(db: Database, candidates: EmbeddingPruneCandidate[]): Promise<void> {
    const scopes = new Set(candidates.map((candidate) => candidate.scope));
    if (scopes.has("session_memory")) {
      const active = readActiveEmbeddingContract(db, "session_memory");
      if (!active) throw new Error("Cannot prune Session Memory embeddings without an active contract");
      const missing = (db.query(
        `SELECT count(*) AS count
         FROM session_memories sm
         WHERE sm.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM session_memory_embeddings e
             WHERE e.session_memory_id = sm.id
               AND e.embedding_provider = ? AND e.embedding_model = ? AND e.embedding_dimensions = ?
               AND e.embedding_purpose = 'retrieval_document' AND e.format_version = ?
               AND e.status = 'indexed'
           )`,
      ).get(active.provider, active.model, active.dimensions, active.formatVersion) as { count: number }).count;
      if (missing > 0) {
        throw new Error(
          `Cannot prune historical Session Memory embeddings: ${missing} active memories lack the active contract index`,
        );
      }
    }
    if (scopes.has("project_memory")) {
      const active = readActiveEmbeddingContract(db, "project_memory");
      if (!active) throw new Error("Cannot prune Project Memory embeddings without an active contract");
      let missing = 0;
      for (const projectKey of await projectMemoryProjectKeys(this.root)) {
        const manifest = await extractProjectMemorySections(this.root, projectKey);
        const indexed = new Set((db.query(
          `SELECT wiki_path, section_id, section_hash
           FROM project_memory_retrieval_embeddings
           WHERE project_key = ?
             AND embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ?
             AND embedding_purpose = 'retrieval_document' AND format_version = ?
             AND status = 'indexed'`,
        ).all(projectKey, active.provider, active.model, active.dimensions, active.formatVersion) as Array<{
          wiki_path: string;
          section_id: string;
          section_hash: string;
        }>).map((row) => `${row.wiki_path}\0${row.section_id}\0${row.section_hash}`));
        missing += manifest.sections.filter((section) =>
          section.heading_level > 1
          && !indexed.has(`${section.wiki_path}\0${section.section_id}\0${section.section_hash}`)
        ).length;
      }
      if (missing > 0) {
        throw new Error(
          `Cannot prune historical Project Memory embeddings: ${missing} canonical sections lack the active contract index`,
        );
      }
    }
  }

  private async migrationPlan(
    db: Database,
    config: MyelinConfig,
    scope: EmbeddingScope,
  ): Promise<EmbeddingMigrationScopePlan> {
    const resolved = await resolveEmbeddingContract({ db, config, scope });
    return {
      scope,
      active_contract: statusContract(resolved.active),
      desired_contract: statusContract(resolved.desired),
      action: resolved.migrationRequired ? "migrate" : "none",
      indexed: 0,
      failed: 0,
      pending_remaining: 0,
      activated: false,
    };
  }

  private async applyScopeMigration(
    db: Database,
    config: MyelinConfig,
    plan: EmbeddingMigrationScopePlan,
  ): Promise<void> {
    const desired = identityFromStatus(plan.desired_contract!);
    const staging = upsertStagingEmbeddingContract(db, { scope: plan.scope, contract: desired });
    const runtime = await new EmbeddingProviderFactory(config).initializeContract({
      ...desired,
      purpose: "retrieval_document",
    });
    if (plan.scope === "session_memory") {
      const table = ensureSessionMemoryVectorTable(db, {
        dimensions: runtime.contract.dimensions,
        table: staging.vectorTable,
      });
      if (!table.available) throw new Error(table.reason);
      for (const projectKey of sessionProjectKeys(db)) {
        const result = await indexSessionProject(db, {
          projectKey,
          contract: runtime.contract,
          provider: runtime.client,
          vectorTable: staging.vectorTable,
          batchSize: config.embedding.batchSize,
        });
        plan.indexed += result.indexed;
        plan.failed += result.failed;
        plan.pending_remaining += result.pending_remaining;
      }
    } else {
      const table = ensureProjectMemoryRetrievalVectorTable(db, {
        dimensions: runtime.contract.dimensions,
        table: staging.vectorTable,
      });
      if (!table.available) throw new Error(table.reason);
      for (const projectKey of await projectMemoryProjectKeys(this.root)) {
        const result = await indexProjectMemory(db, {
          root: this.root,
          projectKey,
          contract: runtime.contract,
          provider: runtime.client,
          vectorTable: staging.vectorTable,
          batchSize: config.embedding.batchSize,
        });
        plan.indexed += result.indexed;
        plan.failed += result.failed;
        plan.pending_remaining += result.pending_remaining;
      }
    }
    if (plan.failed > 0 || plan.pending_remaining > 0) {
      throw new Error(
        `${plan.scope} embedding migration incomplete: ${plan.failed} failed, ${plan.pending_remaining} pending`,
      );
    }
    const indexedMetadata = indexedActiveMetadataCount(db, plan.scope, desired);
    const vectorRows = countOwnedIndexedVectorRows(db, {
      scope: plan.scope,
      table: staging.vectorTable,
      contract: desired,
    });
    if (vectorRows !== indexedMetadata) {
      throw new Error(
        `${plan.scope} embedding migration verification failed: ${indexedMetadata} active indexed metadata rows, ${vectorRows} matching vector rows`,
      );
    }
    smokeOwnedVectorQuery(db, {
      scope: plan.scope,
      table: staging.vectorTable,
      contract: desired,
    });
    activateEmbeddingContract(db, { scope: plan.scope, contractId: staging.id });
    plan.activated = true;
  }

  private pruneCandidates(db: Database): EmbeddingPruneCandidate[] {
    const candidates: EmbeddingPruneCandidate[] = [];
    for (const scope of ["session_memory", "project_memory"] as const) {
      const protectedIds = new Set([
        readActiveEmbeddingContract(db, scope)?.id,
        readPreviousEmbeddingContract(db, scope)?.id,
      ].filter((id): id is string => Boolean(id)));
      const registered = listEmbeddingContracts(db, scope);
      for (const contract of registered) {
        if (protectedIds.has(contract.id)) continue;
        candidates.push(this.pruneCandidate(db, scope, contract, contract.lifecycle, contract.vectorTable));
      }
      for (const row of historicalMetadataContracts(db, scope)) {
        const id = embeddingContractId(scope, normalizeHistoricalIdentity(row));
        if (protectedIds.has(id) || registered.some((contract) => contract.id === id)) continue;
        candidates.push({
          scope,
          contract: statusContract(row),
          metadata_rows: row.metadata_rows,
          query_cache_rows: queryCacheCount(db, row),
          lifecycle: "historical",
          vector_table: null,
        });
      }
    }
    return candidates;
  }

  private pruneCandidate(
    db: Database,
    scope: EmbeddingScope,
    contract: EmbeddingContractIdentity,
    lifecycle: string,
    vectorTable: string,
  ): EmbeddingPruneCandidate {
    return {
      scope,
      contract: statusContract(contract),
      metadata_rows: metadataCount(db, scope, contract),
      query_cache_rows: queryCacheCount(db, contract),
      lifecycle,
      vector_table: vectorTable,
    };
  }

  private applyPruneCandidate(db: Database, candidate: EmbeddingPruneCandidate, result: EmbeddingPruneResult): void {
    const table = candidate.scope === "session_memory" ? "session_memory_embeddings" : "project_memory_retrieval_embeddings";
    if (candidate.vector_table && candidate.vector_table.includes("_vec_")) {
      dropOwnedVectorTable(db, candidate.vector_table);
      result.removed_vector_tables.push(candidate.vector_table);
    } else {
      const metadataIdColumn = candidate.scope === "session_memory" ? "session_memory_id" : "id";
      const vectorIdColumn = candidate.scope === "session_memory" ? "memory_id" : "retrieval_row_id";
      const vectorTable = candidate.scope === "session_memory" ? "session_memory_vec" : "project_memory_section_vec";
      const ids = (db.query(
        `SELECT ${metadataIdColumn} AS id FROM ${table}
         WHERE embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ?
           AND format_version = ?`,
      ).all(
        candidate.contract.provider,
        candidate.contract.model,
        candidate.contract.dimensions,
        candidate.contract.format_version,
      ) as Array<{ id: string }>).map((row) => row.id);
      result.removed_vector_rows += deleteOwnedVectorRows(db, {
        table: vectorTable,
        idColumn: vectorIdColumn,
        ids,
        model: candidate.contract.model,
        dimensions: candidate.contract.dimensions,
        formatVersion: candidate.contract.format_version,
      });
    }
    const metadata = db.query(
      `DELETE FROM ${table}
       WHERE embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ?
         AND format_version = ?`,
    ).run(candidate.contract.provider, candidate.contract.model, candidate.contract.dimensions, candidate.contract.format_version);
    result.removed_metadata_rows += metadata.changes;
    const cache = db.query(
      `DELETE FROM query_embedding_cache
       WHERE embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ?
         AND format_version = ?`,
    ).run(candidate.contract.provider, candidate.contract.model, candidate.contract.dimensions, candidate.contract.format_version);
    result.removed_query_cache_rows += cache.changes;
    if (isEmbeddingProvider(candidate.contract.provider)) {
      const contract = identityFromStatus(candidate.contract);
      const registered = listEmbeddingContracts(db, candidate.scope).find((item) => sameEmbeddingContract(item, contract));
      if (registered) removeEmbeddingContract(db, registered.id);
    }
  }
}

async function indexSessionProject(
  db: Database,
  input: {
    projectKey: string;
    contract: Parameters<EmbeddingProviderFactory["initializeContract"]>[0];
    provider: Awaited<ReturnType<EmbeddingProviderFactory["initializeContract"]>>["client"];
    vectorTable: string;
    batchSize: number;
  },
) {
  let total = { indexed: 0, failed: 0, pending_remaining: 0 };
  while (true) {
    const result = await new SessionMemoryIndexService({
      db,
      contract: input.contract,
      provider: input.provider,
      vectorTable: input.vectorTable,
    }).indexPending({
      projectKey: input.projectKey,
      limit: 500,
      batchSize: input.batchSize,
      retryFailed: false,
    });
    total = {
      indexed: total.indexed + result.indexed,
      failed: total.failed + result.failed,
      pending_remaining: result.pending_remaining,
    };
    if (result.failed > 0 || result.pending_remaining === 0 || result.indexed === 0) return total;
  }
}

async function indexProjectMemory(
  db: Database,
  input: {
    root: string;
    projectKey: string;
    contract: Parameters<EmbeddingProviderFactory["initializeContract"]>[0];
    provider: Awaited<ReturnType<EmbeddingProviderFactory["initializeContract"]>>["client"];
    vectorTable: string;
    batchSize: number;
  },
) {
  let total = { indexed: 0, failed: 0, pending_remaining: 0 };
  while (true) {
    const result = await new ProjectMemoryRetrievalIndexService({
      root: input.root,
      db,
      contract: input.contract,
      provider: input.provider,
      vectorTable: input.vectorTable,
    }).indexProject({
      projectKey: input.projectKey,
      limit: 500,
      batchSize: input.batchSize,
      retryFailed: false,
    });
    total = {
      indexed: total.indexed + result.indexed,
      failed: total.failed + result.failed,
      pending_remaining: result.pending_remaining,
    };
    if (result.failed > 0 || result.pending_remaining === 0 || result.indexed === 0) return total;
  }
}

function sessionProjectKeys(db: Database): string[] {
  return (db.query("SELECT DISTINCT project_key FROM session_memories ORDER BY project_key").all() as Array<{ project_key: string }>)
    .map((row) => row.project_key);
}

async function projectMemoryProjectKeys(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const project of await discoverProjects(root)) {
    try {
      if ((await readdir(join(project.dir, "wiki"))).some((entry) => entry.endsWith(".md"))) result.push(project.key);
    } catch {
      // Projects without canonical markdown have no Project Memory index to migrate.
    }
  }
  return result.sort();
}

function historicalMetadataContracts(db: Database, scope: EmbeddingScope): Array<EmbeddingContractIdentity & { metadata_rows: number }> {
  const table = scope === "session_memory" ? "session_memory_embeddings" : "project_memory_retrieval_embeddings";
  return db.query(
    `SELECT embedding_provider AS provider, embedding_model AS model, embedding_dimensions AS dimensions,
            format_version AS formatVersion, count(*) AS metadata_rows
     FROM ${table}
     WHERE embedding_purpose = 'retrieval_document'
     GROUP BY embedding_provider, embedding_model, embedding_dimensions, format_version
     ORDER BY embedding_provider, embedding_model, embedding_dimensions, format_version`,
  ).all() as Array<EmbeddingContractIdentity & { metadata_rows: number }>;
}

function normalizeHistoricalIdentity(identity: EmbeddingContractIdentity): EmbeddingContractIdentity {
  if ((identity.provider as string) === "ollama") {
    return { ...identity, provider: identity.model.includes("qwen") ? "ollama_qwen" : "ollama_nomic" };
  }
  return identity;
}

function metadataCount(db: Database, scope: EmbeddingScope, contract: EmbeddingContractIdentity): number {
  const table = scope === "session_memory" ? "session_memory_embeddings" : "project_memory_retrieval_embeddings";
  return (db.query(
    `SELECT count(*) AS count FROM ${table}
     WHERE embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ? AND format_version = ?`,
  ).get(contract.provider, contract.model, contract.dimensions, contract.formatVersion) as { count: number }).count;
}

function indexedActiveMetadataCount(
  db: Database,
  scope: EmbeddingScope,
  contract: EmbeddingContractIdentity,
): number {
  const table = scope === "session_memory" ? "session_memory_embeddings" : "project_memory_retrieval_embeddings";
  const activeClause = scope === "session_memory"
    ? "AND session_memory_id IN (SELECT id FROM session_memories WHERE status = 'active')"
    : "";
  return (db.query(
    `SELECT count(*) AS count FROM ${table}
     WHERE embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ?
       AND format_version = ? AND status = 'indexed' ${activeClause}`,
  ).get(contract.provider, contract.model, contract.dimensions, contract.formatVersion) as { count: number }).count;
}

function queryCacheCount(db: Database, contract: EmbeddingContractIdentity): number {
  return (db.query(
    `SELECT count(*) AS count FROM query_embedding_cache
     WHERE embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ? AND format_version = ?`,
  ).get(contract.provider, contract.model, contract.dimensions, contract.formatVersion) as { count: number }).count;
}

function statusContract(contract: EmbeddingContractIdentity): EmbeddingContractStatus {
  return {
    provider: contract.provider,
    model: contract.model,
    dimensions: contract.dimensions,
    format_version: contract.formatVersion,
  };
}

function identityFromStatus(contract: EmbeddingContractStatus): EmbeddingContractIdentity {
  if (!isEmbeddingProvider(contract.provider)) {
    throw new Error(`Unsupported embedding provider in lifecycle state: ${contract.provider}`);
  }
  return {
    provider: contract.provider,
    model: contract.model,
    dimensions: contract.dimensions,
    formatVersion: contract.format_version,
  };
}

function isEmbeddingProvider(provider: string): provider is EmbeddingContractIdentity["provider"] {
  return provider === "ollama_nomic" || provider === "ollama_qwen" || provider === "gemini";
}
