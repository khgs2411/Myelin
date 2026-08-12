import type { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import type { EmbeddingContractIdentity, EmbeddingScope } from "./embedding-contract-types.ts";

export type SqliteVecAvailability = { available: true } | { available: false; reason: string };

export type SqliteVecAdapter = {
  load: (db: Database) => void;
};

export type SessionMemoryVectorInput = {
  memory_id: string;
  project_key: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_purpose: string;
  format_version: number;
  embedding: number[];
};

export type SessionMemoryVectorMatch = {
  memory_id: string;
  distance: number;
};

export function decodeFloat32Vector(bytes: Uint8Array, dimensions: number): number[] {
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0 || bytes.byteLength !== dimensions * 4) {
    throw new Error(`Invalid float32 vector byte length: expected ${dimensions * 4}, got ${bytes.byteLength}`);
  }
  const copy = bytes.slice();
  return Array.from(new Float32Array(copy.buffer, copy.byteOffset, dimensions));
}

export function cosineDistance(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error(`Vector dimensions do not match: ${left.length} versus ${right.length}`);
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      throw new Error("Vector contains a non-finite value");
    }
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 1;
  return 1 - dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export type ProjectMemoryRetrievalVectorInput = {
  retrieval_row_id: string;
  project_key: string;
  wiki_path: string;
  section_id: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_purpose: "retrieval_document";
  format_version: number;
  embedding: number[];
};

export type ProjectMemoryRetrievalVectorMatch = {
  retrieval_row_id: string;
  distance: number;
};

export function createSqliteVecAdapter(adapter: Partial<SqliteVecAdapter> = {}): SqliteVecAdapter {
  return {
    load: adapter.load ?? ((db) => sqliteVec.load(db)),
  };
}

export function getSqliteVecAvailability(
  db: Database,
  adapter: SqliteVecAdapter = createSqliteVecAdapter(),
): SqliteVecAvailability {
  try {
    adapter.load(db);
    return { available: true };
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function ensureSessionMemoryVectorTable(
  db: Database,
  input: { dimensions: number; table?: string; adapter?: SqliteVecAdapter; rebuildOnDimensionMismatch?: boolean },
): { created: boolean; available: boolean; reason?: string; rebuilt?: boolean } {
  const availability = getSqliteVecAvailability(db, input.adapter);
  if (!availability.available) return { created: false, available: false, reason: availability.reason };
  const table = safeVectorTable(input.table ?? "session_memory_vec", "session_memory_vec");

  const migration = prepareVectorTable(db, {
    table,
    dimensions: input.dimensions,
    rebuild: input.rebuildOnDimensionMismatch ?? false,
    resetMetadata: () => db.query(
      `UPDATE session_memory_embeddings
       SET status = 'pending', normalized_text_hash = NULL, failure_reason = NULL, indexed_at = NULL
       WHERE status = 'indexed'`,
    ).run(),
  });
  if (!migration.available) return { created: false, available: false, reason: migration.reason };

  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(
      embedding float[${input.dimensions}],
      memory_id TEXT,
      project_key TEXT partition key,
      embedding_model TEXT,
      embedding_dimensions INTEGER,
      embedding_purpose TEXT,
      format_version INTEGER
    );`,
  );
  return { created: true, available: true, ...(migration.rebuilt ? { rebuilt: true } : {}) };
}

export function ensureProjectMemoryRetrievalVectorTable(
  db: Database,
  input: { dimensions: number; table?: string; adapter?: SqliteVecAdapter; rebuildOnDimensionMismatch?: boolean },
): { created: boolean; available: boolean; reason?: string; rebuilt?: boolean } {
  const availability = getSqliteVecAvailability(db, input.adapter);
  if (!availability.available) return { created: false, available: false, reason: availability.reason };
  const table = safeVectorTable(input.table ?? "project_memory_section_vec", "project_memory_section_vec");

  const migration = prepareVectorTable(db, {
    table,
    dimensions: input.dimensions,
    rebuild: input.rebuildOnDimensionMismatch ?? false,
    resetMetadata: () => db.query(
      `UPDATE project_memory_retrieval_embeddings
       SET status = 'pending', normalized_text_hash = NULL, failure_reason = NULL, indexed_at = NULL
       WHERE status = 'indexed'`,
    ).run(),
  });
  if (!migration.available) return { created: false, available: false, reason: migration.reason };

  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(
      embedding float[${input.dimensions}],
      retrieval_row_id TEXT,
      project_key TEXT partition key,
      wiki_path TEXT,
      section_id TEXT,
      embedding_model TEXT,
      embedding_dimensions INTEGER,
      embedding_purpose TEXT,
      format_version INTEGER
    );`,
  );
  return { created: true, available: true, ...(migration.rebuilt ? { rebuilt: true } : {}) };
}

function prepareVectorTable(
  db: Database,
  input: { table: string; dimensions: number; rebuild: boolean; resetMetadata: () => void },
): { available: true; rebuilt: boolean } | { available: false; reason: string } {
  const existingDimensions = vectorTableDimensions(db, input.table);
  if (existingDimensions === null || existingDimensions === input.dimensions) {
    return { available: true, rebuilt: false };
  }
  if (!input.rebuild) {
    return {
      available: false,
      reason: `${input.table} uses ${existingDimensions} dimensions; run the matching memory index command to rebuild it for ${input.dimensions}`,
    };
  }

  db.transaction(() => {
    db.exec(`DROP TABLE ${input.table}`);
    input.resetMetadata();
  })();
  return { available: true, rebuilt: true };
}

function vectorTableDimensions(db: Database, table: string): number | null {
  const row = db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as
    | { sql: string | null }
    | null;
  if (!row?.sql) return null;
  const match = row.sql.match(/embedding\s+float\[(\d+)\]/i);
  return match ? Number(match[1]) : null;
}

export function upsertSessionMemoryVector(db: Database, input: SessionMemoryVectorInput, vectorTable = "session_memory_vec"): void {
  const table = safeVectorTable(vectorTable, "session_memory_vec");
  db.transaction(() => {
    db.query(
      `DELETE FROM ${table}
       WHERE memory_id = ?
         AND project_key = ?
         AND embedding_model = ?
         AND embedding_dimensions = ?
         AND embedding_purpose = ?
         AND format_version = ?`,
    ).run(
      input.memory_id,
      input.project_key,
      input.embedding_model,
      input.embedding_dimensions,
      input.embedding_purpose,
      input.format_version,
    );

    db.query(
      `INSERT INTO ${table}
        (embedding, memory_id, project_key, embedding_model, embedding_dimensions, embedding_purpose, format_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      toFloat32Vector(input.embedding),
      input.memory_id,
      input.project_key,
      input.embedding_model,
      input.embedding_dimensions,
      input.embedding_purpose,
      input.format_version,
    );
  })();
}

export function searchSessionMemoryVectors(
  db: Database,
  input: {
    project_key: string;
    embedding_model: string;
    embedding_dimensions: number;
    embedding_purpose: string;
    format_version: number;
    embedding: number[];
    limit: number;
  },
  vectorTable = "session_memory_vec",
): SessionMemoryVectorMatch[] {
  const table = safeVectorTable(vectorTable, "session_memory_vec");
  return db
    .query(
      `SELECT memory_id, distance
       FROM ${table}
       WHERE embedding MATCH ?
         AND k = ?
         AND project_key = ?
         AND embedding_model = ?
         AND embedding_dimensions = ?
         AND embedding_purpose = ?
         AND format_version = ?
       ORDER BY distance ASC`,
    )
    .all(
      toFloat32Vector(input.embedding),
      input.limit,
      input.project_key,
      input.embedding_model,
      input.embedding_dimensions,
      input.embedding_purpose,
      input.format_version,
    ) as SessionMemoryVectorMatch[];
}

export function upsertProjectMemoryRetrievalVector(
  db: Database,
  input: ProjectMemoryRetrievalVectorInput,
  vectorTable = "project_memory_section_vec",
): void {
  const table = safeVectorTable(vectorTable, "project_memory_section_vec");
  db.transaction(() => {
    db.query(
      `DELETE FROM ${table}
       WHERE retrieval_row_id = ?
         AND project_key = ?
         AND embedding_model = ?
         AND embedding_dimensions = ?
         AND embedding_purpose = ?
         AND format_version = ?`,
    ).run(
      input.retrieval_row_id,
      input.project_key,
      input.embedding_model,
      input.embedding_dimensions,
      input.embedding_purpose,
      input.format_version,
    );

    db.query(
      `INSERT INTO ${table}
        (embedding, retrieval_row_id, project_key, wiki_path, section_id, embedding_model,
         embedding_dimensions, embedding_purpose, format_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      toFloat32Vector(input.embedding),
      input.retrieval_row_id,
      input.project_key,
      input.wiki_path,
      input.section_id,
      input.embedding_model,
      input.embedding_dimensions,
      input.embedding_purpose,
      input.format_version,
    );
  })();
}

export function searchProjectMemoryRetrievalVectors(
  db: Database,
  input: {
    project_key: string;
    embedding_model: string;
    embedding_dimensions: number;
    embedding_purpose: "retrieval_document";
    format_version: number;
    embedding: number[];
    limit: number;
  },
  vectorTable = "project_memory_section_vec",
): ProjectMemoryRetrievalVectorMatch[] {
  const table = safeVectorTable(vectorTable, "project_memory_section_vec");
  return db
    .query(
      `SELECT retrieval_row_id, distance
       FROM ${table}
       WHERE embedding MATCH ?
         AND k = ?
         AND project_key = ?
         AND embedding_model = ?
         AND embedding_dimensions = ?
         AND embedding_purpose = ?
         AND format_version = ?
         AND retrieval_row_id IN (
           SELECT id
           FROM project_memory_retrieval_embeddings
           WHERE project_key = ?
             AND embedding_model = ?
             AND embedding_dimensions = ?
             AND embedding_purpose = ?
             AND format_version = ?
             AND status = 'indexed'
         )
       ORDER BY distance ASC`,
    )
    .all(
      toFloat32Vector(input.embedding),
      input.limit,
      input.project_key,
      input.embedding_model,
      input.embedding_dimensions,
      input.embedding_purpose,
      input.format_version,
      input.project_key,
      input.embedding_model,
      input.embedding_dimensions,
      input.embedding_purpose,
      input.format_version,
    ) as ProjectMemoryRetrievalVectorMatch[];
}

export function dropOwnedVectorTable(db: Database, table: string): void {
  const safe = safeAnyOwnedVectorTable(table);
  const availability = getSqliteVecAvailability(db);
  if (!availability.available) throw new Error(availability.reason);
  db.exec(`DROP TABLE IF EXISTS ${safe}`);
}

export function countOwnedVectorRows(db: Database, table: string): number {
  const safe = safeAnyOwnedVectorTable(table);
  const availability = getSqliteVecAvailability(db);
  if (!availability.available) throw new Error(availability.reason);
  const exists = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(safe);
  if (!exists) return 0;
  return (db.query(`SELECT count(*) AS count FROM ${safe}`).get() as { count: number }).count;
}

export function smokeOwnedVectorQuery(
  db: Database,
  input: {
    scope: EmbeddingScope;
    table: string;
    contract: EmbeddingContractIdentity;
  },
): number {
  const count = countOwnedVectorRows(db, input.table);
  if (count === 0) return 0;
  const table = safeAnyOwnedVectorTable(input.table);
  if (input.scope === "session_memory") {
    const sample = db.query(
      `SELECT memory_id, project_key, vec_to_json(embedding) AS embedding
       FROM ${table} LIMIT 1`,
    ).get() as { memory_id: string; project_key: string; embedding: string };
    const matches = searchSessionMemoryVectors(db, {
      project_key: sample.project_key,
      embedding_model: input.contract.model,
      embedding_dimensions: input.contract.dimensions,
      embedding_purpose: "retrieval_document",
      format_version: input.contract.formatVersion,
      embedding: parseStoredVector(sample.embedding),
      limit: 1,
    }, table);
    if (matches.length === 0) {
      throw new Error(`Staged Session Memory query smoke failed for ${table}`);
    }
    return count;
  }
  const sample = db.query(
    `SELECT retrieval_row_id, project_key, vec_to_json(embedding) AS embedding
     FROM ${table} LIMIT 1`,
  ).get() as { retrieval_row_id: string; project_key: string; embedding: string };
  const matches = searchProjectMemoryRetrievalVectors(db, {
    project_key: sample.project_key,
    embedding_model: input.contract.model,
    embedding_dimensions: input.contract.dimensions,
    embedding_purpose: "retrieval_document",
    format_version: input.contract.formatVersion,
    embedding: parseStoredVector(sample.embedding),
    limit: 1,
  }, table);
  if (matches.length === 0) {
    throw new Error(`Staged Project Memory query smoke failed for ${table}`);
  }
  return count;
}

export function countOwnedIndexedVectorRows(
  db: Database,
  input: {
    scope: EmbeddingScope;
    table: string;
    contract: EmbeddingContractIdentity;
  },
): number {
  const table = safeAnyOwnedVectorTable(input.table);
  const availability = getSqliteVecAvailability(db);
  if (!availability.available) throw new Error(availability.reason);
  const exists = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) return 0;
  const idColumn = input.scope === "session_memory" ? "memory_id" : "retrieval_row_id";
  const metadataIdColumn = input.scope === "session_memory" ? "session_memory_id" : "id";
  const metadataTable = input.scope === "session_memory"
    ? "session_memory_embeddings"
    : "project_memory_retrieval_embeddings";
  const activeMemoryClause = input.scope === "session_memory"
    ? "AND session_memory_id IN (SELECT id FROM session_memories WHERE status = 'active')"
    : "";
  return (db.query(
    `SELECT count(*) AS count FROM ${table}
     WHERE ${idColumn} IN (
       SELECT ${metadataIdColumn} FROM ${metadataTable}
       WHERE embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ?
         AND embedding_purpose = 'retrieval_document' AND format_version = ? AND status = 'indexed'
         ${activeMemoryClause}
     )
       AND embedding_model = ? AND embedding_dimensions = ?
       AND embedding_purpose = 'retrieval_document' AND format_version = ?`,
  ).get(
    input.contract.provider,
    input.contract.model,
    input.contract.dimensions,
    input.contract.formatVersion,
    input.contract.model,
    input.contract.dimensions,
    input.contract.formatVersion,
  ) as { count: number }).count;
}

export function deleteOwnedVectorRows(
  db: Database,
  input: {
    table: string;
    idColumn: "memory_id" | "retrieval_row_id";
    ids: string[];
    model: string;
    dimensions: number;
    formatVersion: number;
  },
): number {
  if (input.ids.length === 0) return 0;
  const table = safeAnyOwnedVectorTable(input.table);
  const availability = getSqliteVecAvailability(db);
  if (!availability.available) throw new Error(availability.reason);
  const exists = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) return 0;
  const statement = db.query(
    `DELETE FROM ${table}
     WHERE ${input.idColumn} = ?
       AND embedding_model = ?
       AND embedding_dimensions = ?
       AND embedding_purpose = 'retrieval_document'
       AND format_version = ?`,
  );
  let removed = 0;
  db.transaction(() => {
    for (const id of input.ids) {
      removed += statement.run(id, input.model, input.dimensions, input.formatVersion).changes;
    }
  })();
  return removed;
}

function safeVectorTable(table: string, prefix: "session_memory_vec" | "project_memory_section_vec"): string {
  if (table === prefix || new RegExp(`^${prefix}_[a-f0-9]{16}$`).test(table)) return table;
  throw new Error(`Invalid ${prefix} table: ${table}`);
}

function safeAnyOwnedVectorTable(table: string): string {
  if (
    table === "session_memory_vec"
    || table === "project_memory_section_vec"
    || /^session_memory_vec_[a-f0-9]{16}$/.test(table)
    || /^project_memory_section_vec_[a-f0-9]{16}$/.test(table)
  ) return table;
  throw new Error(`Invalid owned vector table: ${table}`);
}

function toFloat32Vector(values: number[]): Float32Array {
  return new Float32Array(values);
}

function parseStoredVector(value: string): number[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "number")) {
    throw new Error("sqlite-vec returned an invalid stored vector");
  }
  return parsed as number[];
}
