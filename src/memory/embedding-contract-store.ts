import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type {
  EmbeddingContractIdentity,
  EmbeddingContractLifecycle,
  EmbeddingScope,
  StoredEmbeddingContract,
} from "./embedding-contract-types.ts";
import {
  withCompatibilitySessionEmbeddingLifecycleAdmission,
  withRegisterSessionEmbeddingContractAdmission,
} from "./session-memory-write-firewall.ts";

type ContractRow = {
  id: string;
  scope: EmbeddingScope;
  embedding_provider: EmbeddingContractIdentity["provider"];
  embedding_model: string;
  embedding_dimensions: number;
  format_version: number;
  lifecycle: EmbeddingContractLifecycle;
  vector_table: string;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
  retired_at: string | null;
  failure_reason: string | null;
};

export function embeddingContractKey(identity: EmbeddingContractIdentity): string {
  return createHash("sha256")
    .update(`${identity.provider}\0${identity.model}\0${identity.dimensions}\0${identity.formatVersion}`)
    .digest("hex")
    .slice(0, 16);
}

export function embeddingContractId(scope: EmbeddingScope, identity: EmbeddingContractIdentity): string {
  return `${scope}:${embeddingContractKey(identity)}`;
}

export function versionedVectorTable(scope: EmbeddingScope, identity: EmbeddingContractIdentity): string {
  const prefix = scope === "session_memory" ? "session_memory_vec" : "project_memory_section_vec";
  return `${prefix}_${embeddingContractKey(identity)}`;
}

export function readActiveEmbeddingContract(db: Database, scope: EmbeddingScope): StoredEmbeddingContract | null {
  return readLifecycleContract(db, scope, "active");
}

export function readPreviousEmbeddingContract(db: Database, scope: EmbeddingScope): StoredEmbeddingContract | null {
  return readLifecycleContract(db, scope, "previous");
}

export function discoverIndexedEmbeddingContract(
  db: Database,
  scope: EmbeddingScope,
): { contract: EmbeddingContractIdentity; vectorTable: string } | null {
  const metadataTable = scope === "session_memory"
    ? "session_memory_embeddings"
    : "project_memory_retrieval_embeddings";
  const vectorTable = scope === "session_memory" ? "session_memory_vec" : "project_memory_section_vec";
  const row = db.query(
    `SELECT embedding_provider, embedding_model, embedding_dimensions, format_version, count(*) AS indexed_count
     FROM ${metadataTable}
     WHERE status = 'indexed'
       AND embedding_purpose = 'retrieval_document'
       AND embedding_provider IN ('ollama_nomic', 'ollama_qwen', 'gemini')
     GROUP BY embedding_provider, embedding_model, embedding_dimensions, format_version
     ORDER BY indexed_count DESC, embedding_provider, embedding_model
     LIMIT 1`,
  ).get() as {
    embedding_provider: EmbeddingContractIdentity["provider"];
    embedding_model: string;
    embedding_dimensions: number;
    format_version: number;
  } | null;
  if (!row) return null;
  return {
    contract: {
      provider: row.embedding_provider,
      model: row.embedding_model,
      dimensions: row.embedding_dimensions,
      formatVersion: row.format_version,
    },
    vectorTable,
  };
}

export function listEmbeddingContracts(db: Database, scope?: EmbeddingScope): StoredEmbeddingContract[] {
  const rows = scope
    ? db.query("SELECT * FROM embedding_contracts WHERE scope = ? ORDER BY created_at, id").all(scope)
    : db.query("SELECT * FROM embedding_contracts ORDER BY scope, created_at, id").all();
  return (rows as ContractRow[]).map(mapRow);
}

export function registerInitialActiveEmbeddingContract(
  db: Database,
  input: { scope: EmbeddingScope; contract: EmbeddingContractIdentity; vectorTable?: string; now?: string },
): StoredEmbeddingContract {
  const existing = readActiveEmbeddingContract(db, input.scope);
  if (existing) return existing;
  const now = input.now ?? new Date().toISOString();
  const id = embeddingContractId(input.scope, input.contract);
  const insert = (): void => {
    db.query(
      `INSERT INTO embedding_contracts
      (id, scope, embedding_provider, embedding_model, embedding_dimensions, format_version,
       lifecycle, vector_table, created_at, updated_at, activated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    ).run(
      id,
      input.scope,
      input.contract.provider,
      input.contract.model,
      input.contract.dimensions,
      input.contract.formatVersion,
      input.vectorTable ?? versionedVectorTable(input.scope, input.contract),
      now,
      now,
      now,
    );
  };
  if (input.scope === "session_memory") withRegisterSessionEmbeddingContractAdmission(db, insert);
  else insert();
  return readActiveEmbeddingContract(db, input.scope)!;
}

export function upsertStagingEmbeddingContract(
  db: Database,
  input: { scope: EmbeddingScope; contract: EmbeddingContractIdentity; now?: string },
): StoredEmbeddingContract {
  const now = input.now ?? new Date().toISOString();
  const id = embeddingContractId(input.scope, input.contract);
  const upsert = (): void => {
    db.query(
      `INSERT INTO embedding_contracts
      (id, scope, embedding_provider, embedding_model, embedding_dimensions, format_version,
       lifecycle, vector_table, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'staging', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       lifecycle = CASE WHEN embedding_contracts.lifecycle = 'active' THEN 'active' ELSE 'staging' END,
       updated_at = excluded.updated_at,
       retired_at = NULL,
       failure_reason = NULL`,
    ).run(
      id,
      input.scope,
      input.contract.provider,
      input.contract.model,
      input.contract.dimensions,
      input.contract.formatVersion,
      versionedVectorTable(input.scope, input.contract),
      now,
      now,
    );
  };
  if (input.scope === "session_memory") withCompatibilitySessionEmbeddingLifecycleAdmission(db, upsert);
  else upsert();
  return readEmbeddingContract(db, id)!;
}

export function activateEmbeddingContract(
  db: Database,
  input: { scope: EmbeddingScope; contractId: string; now?: string },
): StoredEmbeddingContract {
  const target = readEmbeddingContract(db, input.contractId);
  if (!target || target.scope !== input.scope) throw new Error(`Embedding contract not found for ${input.scope}: ${input.contractId}`);
  if (target.lifecycle === "failed" || target.lifecycle === "retired") {
    throw new Error(`Embedding contract is not activatable: ${target.id} (${target.lifecycle})`);
  }
  const now = input.now ?? new Date().toISOString();
  db.transaction(() => {
    const activate = (): void => {
      db.query(
      `UPDATE embedding_contracts
       SET lifecycle = 'retired', retired_at = ?, updated_at = ?
       WHERE scope = ? AND lifecycle = 'previous'`,
      ).run(now, now, input.scope);
      db.query(
      `UPDATE embedding_contracts
       SET lifecycle = 'previous', updated_at = ?
       WHERE scope = ? AND lifecycle = 'active' AND id <> ?`,
      ).run(now, input.scope, target.id);
      db.query(
      `UPDATE embedding_contracts
       SET lifecycle = 'active', activated_at = ?, retired_at = NULL, failure_reason = NULL, updated_at = ?
       WHERE id = ?`,
      ).run(now, now, target.id);
    };
    if (input.scope === "session_memory") withCompatibilitySessionEmbeddingLifecycleAdmission(db, activate);
    else activate();
  })();
  return readActiveEmbeddingContract(db, input.scope)!;
}

export function rollbackEmbeddingContract(db: Database, scope: EmbeddingScope, now = new Date().toISOString()): StoredEmbeddingContract {
  const previous = readPreviousEmbeddingContract(db, scope);
  if (!previous) throw new Error(`No previous embedding contract is available for ${scope}`);
  const active = readActiveEmbeddingContract(db, scope);
  db.transaction(() => {
    const rollback = (): void => {
      if (active) {
        db.query("UPDATE embedding_contracts SET lifecycle = 'staging', updated_at = ? WHERE id = ?").run(now, active.id);
      }
      db.query(
      `UPDATE embedding_contracts
       SET lifecycle = 'active', activated_at = ?, retired_at = NULL, updated_at = ?
       WHERE id = ?`,
      ).run(now, now, previous.id);
      if (active) {
        db.query(
        `UPDATE embedding_contracts
         SET lifecycle = 'previous', retired_at = NULL, updated_at = ?
         WHERE id = ?`,
        ).run(now, active.id);
      }
    };
    if (scope === "session_memory") withCompatibilitySessionEmbeddingLifecycleAdmission(db, rollback);
    else rollback();
  })();
  return readActiveEmbeddingContract(db, scope)!;
}

export function markEmbeddingContractFailed(db: Database, id: string, reason: string, now = new Date().toISOString()): void {
  const contract = readEmbeddingContract(db, id);
  if (!contract) return;
  const mark = (): void => {
    db.query(
    `UPDATE embedding_contracts
     SET lifecycle = 'failed', failure_reason = ?, updated_at = ?
     WHERE id = ? AND lifecycle <> 'active'`,
    ).run(reason, now, id);
  };
  if (contract.scope === "session_memory") withCompatibilitySessionEmbeddingLifecycleAdmission(db, mark);
  else mark();
}

export function removeEmbeddingContract(db: Database, id: string): void {
  const contract = readEmbeddingContract(db, id);
  if (!contract) return;
  if (contract.lifecycle === "active" || contract.lifecycle === "previous") {
    throw new Error(`Cannot remove ${contract.lifecycle} embedding contract: ${id}`);
  }
  const remove = (): void => { db.query("DELETE FROM embedding_contracts WHERE id = ?").run(id); };
  if (contract.scope === "session_memory") withCompatibilitySessionEmbeddingLifecycleAdmission(db, remove);
  else remove();
}

function readLifecycleContract(
  db: Database,
  scope: EmbeddingScope,
  lifecycle: "active" | "previous",
): StoredEmbeddingContract | null {
  const row = db.query("SELECT * FROM embedding_contracts WHERE scope = ? AND lifecycle = ?").get(scope, lifecycle) as ContractRow | null;
  return row ? mapRow(row) : null;
}

function readEmbeddingContract(db: Database, id: string): StoredEmbeddingContract | null {
  const row = db.query("SELECT * FROM embedding_contracts WHERE id = ?").get(id) as ContractRow | null;
  return row ? mapRow(row) : null;
}

function mapRow(row: ContractRow): StoredEmbeddingContract {
  return {
    id: row.id,
    scope: row.scope,
    provider: row.embedding_provider,
    model: row.embedding_model,
    dimensions: row.embedding_dimensions,
    formatVersion: row.format_version,
    lifecycle: row.lifecycle,
    vectorTable: row.vector_table,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at,
    retiredAt: row.retired_at,
    failureReason: row.failure_reason,
  };
}
