import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { readActiveEmbeddingContract } from "../memory/embedding-contract-store.ts";
import {
  readExactActiveSessionMemoryEmbeddings,
  SessionMemoryRetrievalSnapshotUnavailableError,
} from "../memory/session-memory-embeddings.ts";
import {
  normalizeSessionMemoryForEmbedding,
  sessionMemoryNormalizedTextHash,
} from "../memory/session-memory-text.ts";
import type { SessionMemoryRow } from "../memory/ingest-types.ts";
import { getSqliteVecAvailability } from "../memory/sqlite-vec.ts";
import { stableJson } from "../runtime/json.ts";

export type FrozenSessionRetrievalSnapshot = {
  kind: "complete";
  contract_id: string;
  provider: string;
  model: string;
  dimensions: number;
  format_version: number;
  vector_table: string;
  count: number;
  digest: `sha256:${string}`;
  coverage_digest: `sha256:${string}`;
};

export type FrozenSessionRetrievalSnapshotBlocked = {
  kind: "blocked";
  code: "session_retrieval_snapshot_incomplete" | "session_retrieval_provider_unavailable";
  reason: string;
  memory_ids?: string[];
};

export function copyCompleteSessionRetrievalSnapshotInOpenTransaction(
  db: Database,
  input: { job_id: string; project_key: string },
): FrozenSessionRetrievalSnapshot | FrozenSessionRetrievalSnapshotBlocked {
  if (!db.inTransaction) throw new Error("Session retrieval snapshot copy requires an open transaction");
  const contract = readActiveEmbeddingContract(db, "session_memory");
  if (!contract) {
    return {
      kind: "blocked",
      code: "session_retrieval_provider_unavailable",
      reason: "no active Session Memory embedding contract is registered",
    };
  }
  const sqliteVec = getSqliteVecAvailability(db);
  if (!sqliteVec.available) {
    return {
      kind: "blocked",
      code: "session_retrieval_provider_unavailable",
      reason: `Session Memory vector runtime could not be loaded: ${sqliteVec.reason}`,
    };
  }

  const memories = db.query(
    `SELECT sm.*
     FROM smc_memory_snapshot snapshot
     JOIN session_memories sm ON sm.id = snapshot.memory_id
     WHERE snapshot.job_id = ? AND snapshot.project_key = ?
     ORDER BY snapshot.ordinal`,
  ).all(input.job_id, input.project_key) as SessionMemoryRow[];

  let embeddings;
  try {
    embeddings = readExactActiveSessionMemoryEmbeddings(db, {
      project_key: input.project_key,
      contract,
    });
  } catch (error) {
    if (error instanceof SessionMemoryRetrievalSnapshotUnavailableError) {
      return { kind: "blocked", code: error.code, reason: error.message };
    }
    throw error;
  }
  const byMemory = new Map<string, typeof embeddings>();
  for (const row of embeddings) {
    const existing = byMemory.get(row.session_memory_id) ?? [];
    existing.push(row);
    byMemory.set(row.session_memory_id, existing);
  }

  const prepared: Array<{
    memory: SessionMemoryRow;
    normalized_text: string;
    normalized_text_hash: string;
    embedding: (typeof embeddings)[number];
    vector_digest: `sha256:${string}`;
  }> = [];
  const incomplete: string[] = [];
  for (const memory of memories) {
    const normalizedText = normalizeSessionMemoryForEmbedding(memory);
    const normalizedTextHash = sessionMemoryNormalizedTextHash(normalizedText);
    const matches = byMemory.get(memory.id) ?? [];
    if (
      matches.length !== 1
      || matches[0]!.normalized_text_hash !== normalizedTextHash
      || matches[0]!.vector_bytes.byteLength !== contract.dimensions * Float32Array.BYTES_PER_ELEMENT
    ) {
      incomplete.push(memory.id);
      continue;
    }
    prepared.push({
      memory,
      normalized_text: normalizedText,
      normalized_text_hash: normalizedTextHash,
      embedding: matches[0]!,
      vector_digest: digestBytes(matches[0]!.vector_bytes),
    });
  }
  if (incomplete.length > 0 || embeddings.length !== memories.length) {
    return {
      kind: "blocked",
      code: "session_retrieval_snapshot_incomplete",
      reason: "active Session Memory does not have exact one-to-one vector coverage under the frozen contract",
      memory_ids: incomplete,
    };
  }

  const insertText = db.query(
    `INSERT INTO smc_memory_snapshot_search_texts
      (job_id, memory_id, normalized_text, normalized_text_hash)
     VALUES (?, ?, ?, ?)`,
  );
  const insertVector = db.query(
    `INSERT INTO smc_memory_snapshot_vectors
      (job_id, memory_id, embedding_row_id, embedding_contract_id, embedding_provider,
       embedding_model, embedding_dimensions, embedding_purpose, embedding_format_version,
       normalized_text_hash, vector_bytes, vector_digest)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'retrieval_document', ?, ?, ?, ?)`,
  );
  for (const row of prepared) {
    insertText.run(input.job_id, row.memory.id, row.normalized_text, row.normalized_text_hash);
    insertVector.run(
      input.job_id,
      row.memory.id,
      row.embedding.id,
      contract.id,
      contract.provider,
      contract.model,
      contract.dimensions,
      contract.formatVersion,
      row.normalized_text_hash,
      row.embedding.vector_bytes,
      row.vector_digest,
    );
  }

  const coverageDigest = digest({
    contract: contract.id,
    memories: prepared.map((row) => ({
      memory_id: row.memory.id,
      normalized_text_hash: row.normalized_text_hash,
      vector_digest: row.vector_digest,
    })),
  });
  db.query(
    `INSERT INTO smc_retrieval_snapshot_completeness
      (job_id, embedding_contract_id, active_memory_count, indexed_metadata_count, vector_count,
       normalized_text_match_count, coverage_digest)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.job_id,
    contract.id,
    memories.length,
    embeddings.length,
    prepared.length,
    prepared.length,
    coverageDigest,
  );

  return {
    kind: "complete",
    contract_id: contract.id,
    provider: contract.provider,
    model: contract.model,
    dimensions: contract.dimensions,
    format_version: contract.formatVersion,
    vector_table: contract.vectorTable,
    count: prepared.length,
    coverage_digest: coverageDigest,
    digest: digest({
      contract: {
        id: contract.id,
        provider: contract.provider,
        model: contract.model,
        dimensions: contract.dimensions,
        format_version: contract.formatVersion,
        vector_table: contract.vectorTable,
      },
      rows: prepared.map((row) => ({
        memory_id: row.memory.id,
        normalized_text: row.normalized_text,
        normalized_text_hash: row.normalized_text_hash,
        embedding_row_id: row.embedding.id,
        vector_digest: row.vector_digest,
      })),
    }),
  };
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function digestBytes(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
