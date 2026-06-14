import type { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

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
  input: { dimensions: number; adapter?: SqliteVecAdapter },
): { created: boolean; available: boolean; reason?: string } {
  const availability = getSqliteVecAvailability(db, input.adapter);
  if (!availability.available) return { created: false, available: false, reason: availability.reason };

  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS session_memory_vec USING vec0(
      embedding float[${input.dimensions}],
      memory_id TEXT,
      project_key TEXT partition key,
      embedding_model TEXT,
      embedding_dimensions INTEGER,
      embedding_purpose TEXT,
      format_version INTEGER
    );`,
  );
  return { created: true, available: true };
}

export function upsertSessionMemoryVector(db: Database, input: SessionMemoryVectorInput): void {
  db.transaction(() => {
    db.query(
      `DELETE FROM session_memory_vec
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
      `INSERT INTO session_memory_vec
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
): SessionMemoryVectorMatch[] {
  return db
    .query(
      `SELECT memory_id, distance
       FROM session_memory_vec
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

function toFloat32Vector(values: number[]): Float32Array {
  return new Float32Array(values);
}
