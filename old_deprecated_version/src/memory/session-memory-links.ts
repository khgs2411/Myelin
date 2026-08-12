import type { Database } from "bun:sqlite";
import type { SessionMemoryLinkRelationship } from "./ingest-types.ts";
import {
  advanceSessionMemoryRevisionInOpenTransaction,
  assertSessionMemoryRevisionTransaction,
  createSessionMemoryRevisionMutation,
  markSessionMemoryChanged,
  type SessionMemoryRevisionMutation,
} from "./session-memory-revisions.ts";
import {
  assertProjectSessionMutationAuthority,
  type ProjectSessionMutationAuthority,
} from "./project-session-mutation-fence.ts";
import { withProjectSessionCanonicalWriteAdmission } from "./session-memory-write-firewall.ts";

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

export function createSessionMemoryLink(
  db: Database,
  input: SessionMemoryLinkInput,
  authority: ProjectSessionMutationAuthority,
  revisionMutation?: SessionMemoryRevisionMutation,
): SessionMemoryLinkRow {
  const mutation = revisionMutation ?? createSessionMemoryRevisionMutation();
  if (revisionMutation) assertSessionMemoryRevisionTransaction(db);
  const write = (): void => {
    assertProjectSessionMutationAuthority(db, authority, input.project_key);
    const endpoints = db.query(
      "SELECT id, project_key FROM session_memories WHERE id IN (?, ?) ORDER BY id",
    ).all(input.source_memory_id, input.target_memory_id) as Array<{ id: string; project_key: string }>;
    const projects = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint.project_key]));
    for (const memoryId of [input.source_memory_id, input.target_memory_id]) {
      const projectKey = projects.get(memoryId);
      if (!projectKey) throw new Error(`Session Memory link endpoint not found: ${memoryId}`);
      if (projectKey !== input.project_key) {
        throw new Error(`Session Memory link project mismatch for ${memoryId}: ${input.project_key}`);
      }
      assertProjectSessionMutationAuthority(db, authority, projectKey);
    }
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
    markSessionMemoryChanged(mutation, input.source_memory_id);
    markSessionMemoryChanged(mutation, input.target_memory_id);
  };
  const admittedWrite = (): void => withProjectSessionCanonicalWriteAdmission(db, input.project_key, authority, write);
  if (revisionMutation) {
    admittedWrite();
  } else {
    db.transaction(() => {
      admittedWrite();
      advanceSessionMemoryRevisionInOpenTransaction(db, mutation, authority);
    })();
  }
  return db
    .query(
      `SELECT id, source_memory_id, target_memory_id, project_key, relationship, reason,
              source_event_refs_json, created_at
       FROM session_memory_links
       WHERE rowid = last_insert_rowid()`,
    )
    .get() as SessionMemoryLinkRow;
}
