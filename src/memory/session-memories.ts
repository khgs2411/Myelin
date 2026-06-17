import type { Database } from "bun:sqlite";
import {
  DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
  type ActiveEmbeddingContract,
} from "../runtime/config.ts";
import type { SessionMemoryKind, SessionMemoryRow } from "./ingest-types.ts";
import { ensurePendingSessionMemoryEmbedding } from "./session-memory-embeddings.ts";

export type CreateSessionMemoryInput = {
  id: string;
  project_key: string;
  provider?: string | null;
  provider_session_id?: string | null;
  ingest_job_id?: string | null;
  source_event_refs: string[];
  memory_kind: SessionMemoryKind;
  title?: string | null;
  summary: string;
  payload: Record<string, unknown>;
  confidence: string;
  risk: string;
  now: string;
  embedding_contract?: ActiveEmbeddingContract | null;
};

export function createSessionMemory(db: Database, input: CreateSessionMemoryInput): SessionMemoryRow {
  const create = db.transaction(() => {
    db.query(
      `INSERT INTO session_memories
        (id, project_key, provider, provider_session_id, ingest_job_id, source_event_refs_json,
         memory_kind, title, summary, payload_json, confidence, risk, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      input.id,
      input.project_key,
      input.provider ?? null,
      input.provider_session_id ?? null,
      input.ingest_job_id ?? null,
      JSON.stringify(input.source_event_refs),
      input.memory_kind,
      input.title ?? null,
      input.summary,
      JSON.stringify(input.payload),
      input.confidence,
      input.risk,
      input.now,
      input.now,
    );

    const embeddingContract =
      input.embedding_contract === undefined ? DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT : input.embedding_contract;
    if (embeddingContract) {
      ensurePendingSessionMemoryEmbedding(db, {
        session_memory_id: input.id,
        project_key: input.project_key,
        contract: embeddingContract,
        now: input.now,
      });
    }
  });
  create();

  return db.query("SELECT * FROM session_memories WHERE id = ?").get(input.id) as SessionMemoryRow;
}

export function listSessionMemories(db: Database, projectKey: string, limit = 20): SessionMemoryRow[] {
  return db
    .query("SELECT * FROM session_memories WHERE project_key = ? AND status = 'active' ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(projectKey, limit) as SessionMemoryRow[];
}

export function getActiveSessionMemory(db: Database, input: { id: string; projectKey: string }): SessionMemoryRow | null {
  return (db
    .query("SELECT * FROM session_memories WHERE id = ? AND project_key = ? AND status = 'active'")
    .get(input.id, input.projectKey) as SessionMemoryRow | null) ?? null;
}

export function supersedeSessionMemory(
  db: Database,
  input: { id: string; projectKey: string; supersededBy: string; reason: string; now: string },
): SessionMemoryRow {
  db.query(
    `UPDATE session_memories
     SET status = 'superseded',
         superseded_by = ?,
         lifecycle_reason = ?,
         superseded_at = ?,
         updated_at = ?
     WHERE id = ?
       AND project_key = ?
       AND status = 'active'`,
  ).run(input.supersededBy, input.reason, input.now, input.now, input.id, input.projectKey);
  const row = db.query("SELECT * FROM session_memories WHERE id = ? AND project_key = ?").get(input.id, input.projectKey) as
    | SessionMemoryRow
    | null;
  if (!row || row.status !== "superseded") throw new Error(`Active session memory not found for supersession: ${input.id}`);
  return row;
}

export function retractSessionMemory(
  db: Database,
  input: { id: string; projectKey: string; reason: string; now: string },
): SessionMemoryRow {
  db.query(
    `UPDATE session_memories
     SET status = 'retracted',
         lifecycle_reason = ?,
         retracted_at = ?,
         updated_at = ?
     WHERE id = ?
       AND project_key = ?
       AND status = 'active'`,
  ).run(input.reason, input.now, input.now, input.id, input.projectKey);
  const row = db.query("SELECT * FROM session_memories WHERE id = ? AND project_key = ?").get(input.id, input.projectKey) as
    | SessionMemoryRow
    | null;
  if (!row || row.status !== "retracted") throw new Error(`Active session memory not found for retraction: ${input.id}`);
  return row;
}
