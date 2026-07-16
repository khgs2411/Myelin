import type { Database } from "bun:sqlite";
import {
  EMBEDDING_FORMAT_VERSION,
  type EmbeddingConfig,
} from "../runtime/config.ts";
import {
  discoverIndexedEmbeddingContract,
  readActiveEmbeddingContract,
} from "../memory/embedding-contract-store.ts";
import {
  sameEmbeddingContract,
  type EmbeddingContractIdentity,
  type EmbeddingScope,
} from "../memory/embedding-contract-types.ts";
import type { RetrievalStatus } from "./contracts.ts";

export function inspectEmbeddingRetrievalStatus(input: {
  db: Database;
  projectKey: string;
  scope: EmbeddingScope;
  config: EmbeddingConfig;
}): RetrievalStatus & { active_memory_count: number } {
  const stored = readActiveEmbeddingContract(input.db, input.scope);
  const discovered = stored ? null : discoverIndexedEmbeddingContract(input.db, input.scope);
  const active: EmbeddingContractIdentity | null = stored ?? discovered?.contract ?? null;
  const desired = desiredIdentity(input.config, active);
  const counts = active ? activeCounts(input.db, input.scope, input.projectKey, active) : {
    active_memory_count: activeMemoryCount(input.db, input.scope, input.projectKey),
    indexed_count: 0,
    pending_count: 0,
    failed_count: 0,
  };
  const historical = historicalCounts(input.db, input.scope, input.projectKey, active);
  return {
    active_contract: active ? statusContract(active) : null,
    desired_contract: desired ? statusContract(desired) : null,
    migration_required: Boolean(active && desired && !sameEmbeddingContract(active, desired)),
    provider_state: "not_checked",
    indexed_count: counts.indexed_count,
    pending_count: counts.pending_count,
    failed_count: counts.failed_count,
    historical,
    active_memory_count: counts.active_memory_count,
  };
}

function desiredIdentity(config: EmbeddingConfig, active: EmbeddingContractIdentity | null): EmbeddingContractIdentity | null {
  if (config.provider === "auto") return active;
  const selected = config.providers[config.provider];
  return {
    provider: config.provider,
    model: selected.model,
    dimensions: selected.dimensions,
    formatVersion: EMBEDDING_FORMAT_VERSION,
  };
}

function activeCounts(
  db: Database,
  scope: EmbeddingScope,
  projectKey: string,
  contract: EmbeddingContractIdentity,
): { active_memory_count: number; indexed_count: number; pending_count: number; failed_count: number } {
  if (scope === "session_memory") {
    const row = db.query(
      `SELECT
         count(DISTINCT sm.id) AS active_memory_count,
         count(DISTINCT CASE WHEN e.status = 'indexed' THEN sm.id END) AS indexed_count,
         sum(CASE WHEN e.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
         sum(CASE WHEN e.status = 'failed' THEN 1 ELSE 0 END) AS failed_count
       FROM session_memories sm
       LEFT JOIN session_memory_embeddings e
         ON e.session_memory_id = sm.id
        AND e.embedding_provider = ?
        AND e.embedding_model = ?
        AND e.embedding_dimensions = ?
        AND e.embedding_purpose = 'retrieval_document'
        AND e.format_version = ?
       WHERE sm.project_key = ? AND sm.status = 'active'`,
    ).get(contract.provider, contract.model, contract.dimensions, contract.formatVersion, projectKey) as CountRow;
    return normalizedCounts(row);
  }
  const row = db.query(
    `SELECT
       count(*) AS active_memory_count,
       sum(CASE WHEN status = 'indexed' THEN 1 ELSE 0 END) AS indexed_count,
       sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
       sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
     FROM project_memory_retrieval_embeddings
     WHERE project_key = ?
       AND embedding_provider = ?
       AND embedding_model = ?
       AND embedding_dimensions = ?
       AND embedding_purpose = 'retrieval_document'
       AND format_version = ?
       AND status IN ('pending', 'indexed', 'failed')`,
  ).get(projectKey, contract.provider, contract.model, contract.dimensions, contract.formatVersion) as CountRow;
  return normalizedCounts(row);
}

function historicalCounts(
  db: Database,
  scope: EmbeddingScope,
  projectKey: string,
  active: EmbeddingContractIdentity | null,
): { contract_count: number; row_count: number } {
  const table = scope === "session_memory" ? "session_memory_embeddings" : "project_memory_retrieval_embeddings";
  if (!active) {
    const row = db.query(
      `SELECT count(DISTINCT embedding_provider || char(0) || embedding_model || char(0) || embedding_dimensions || char(0) || format_version) AS contract_count,
              count(*) AS row_count
       FROM ${table} WHERE project_key = ?`,
    ).get(projectKey) as { contract_count: number; row_count: number };
    return row;
  }
  const row = db.query(
    `SELECT count(DISTINCT embedding_provider || char(0) || embedding_model || char(0) || embedding_dimensions || char(0) || format_version) AS contract_count,
            count(*) AS row_count
     FROM ${table}
     WHERE project_key = ?
       AND NOT (
         embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ?
         AND embedding_purpose = 'retrieval_document' AND format_version = ?
       )`,
  ).get(projectKey, active.provider, active.model, active.dimensions, active.formatVersion) as {
    contract_count: number;
    row_count: number;
  };
  return row;
}

function activeMemoryCount(db: Database, scope: EmbeddingScope, projectKey: string): number {
  const sql = scope === "session_memory"
    ? "SELECT count(*) AS count FROM session_memories WHERE project_key = ? AND status = 'active'"
    : "SELECT count(*) AS count FROM project_memory_retrieval_embeddings WHERE project_key = ? AND status = 'indexed'";
  return (db.query(sql).get(projectKey) as { count: number }).count;
}

function statusContract(contract: EmbeddingContractIdentity): NonNullable<RetrievalStatus["active_contract"]> {
  return {
    provider: contract.provider,
    model: contract.model,
    dimensions: contract.dimensions,
    format_version: contract.formatVersion,
  };
}

type CountRow = {
  active_memory_count: number | null;
  indexed_count: number | null;
  pending_count: number | null;
  failed_count: number | null;
};

function normalizedCounts(row: CountRow): {
  active_memory_count: number;
  indexed_count: number;
  pending_count: number;
  failed_count: number;
} {
  return {
    active_memory_count: row.active_memory_count ?? 0,
    indexed_count: row.indexed_count ?? 0,
    pending_count: row.pending_count ?? 0,
    failed_count: row.failed_count ?? 0,
  };
}
