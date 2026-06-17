import type { Database } from "bun:sqlite";
import type { SessionMemoryLinkRelationship } from "./ingest-types.ts";

export type SessionMemoryLinkInput = {
  source_memory_id: string;
  target_memory_id: string;
  project_key: string;
  relationship: SessionMemoryLinkRelationship;
  reason: string;
  source_event_refs: string[];
  created_at: string;
};

export type SessionMemoryLinkRow = Omit<SessionMemoryLinkInput, "source_event_refs"> & {
  id: number;
  source_event_refs_json: string;
};

export function createSessionMemoryLink(db: Database, input: SessionMemoryLinkInput): SessionMemoryLinkRow {
  db.query(
    `INSERT INTO session_memory_links
      (source_memory_id, target_memory_id, project_key, relationship, reason, source_event_refs_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.source_memory_id,
    input.target_memory_id,
    input.project_key,
    input.relationship,
    input.reason,
    JSON.stringify(input.source_event_refs),
    input.created_at,
  );
  return db
    .query(
      `SELECT id, source_memory_id, target_memory_id, project_key, relationship, reason,
              source_event_refs_json, created_at
       FROM session_memory_links
       WHERE rowid = last_insert_rowid()`,
    )
    .get() as SessionMemoryLinkRow;
}
