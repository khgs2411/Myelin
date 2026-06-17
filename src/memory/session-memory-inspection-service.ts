import type { Database } from "bun:sqlite";
import { openMemoryDb, type MemoryDb } from "./db.ts";
import type { SessionMemoryRow, SessionMemoryStatus } from "./ingest-types.ts";
import { listSessionMemoryContexts, type SessionMemoryContextRow } from "./session-memory-contexts.ts";
import type { SessionMemoryLinkRow } from "./session-memory-links.ts";

export type SessionMemoryInspectRow = SessionMemoryRow & {
  contexts: SessionMemoryContextRow[];
};

export type SessionMemoryInspectionServiceDeps = {
  db?: Database;
};

export class SessionMemoryInspectionService {
  constructor(private readonly root: string, private readonly deps: SessionMemoryInspectionServiceDeps = {}) {}

  list(input: { projectKey: string; status?: SessionMemoryStatus; limit?: number }): { memories: SessionMemoryInspectRow[] } {
    return this.withDb((db) => {
      const limit = input.limit ?? 50;
      const rows = input.status
        ? (db
            .query(
              `SELECT *
               FROM session_memories
               WHERE project_key = ?
                 AND status = ?
               ORDER BY updated_at DESC, id DESC
               LIMIT ?`,
            )
            .all(input.projectKey, input.status, limit) as SessionMemoryRow[])
        : (db
            .query(
              `SELECT *
               FROM session_memories
               WHERE project_key = ?
               ORDER BY updated_at DESC, id DESC
               LIMIT ?`,
            )
            .all(input.projectKey, limit) as SessionMemoryRow[]);
      return { memories: rows.map((row) => this.hydrate(db, row)) };
    });
  }

  show(id: string): { memory: SessionMemoryInspectRow } {
    return this.withDb((db) => {
      const row = db.query("SELECT * FROM session_memories WHERE id = ?").get(id) as SessionMemoryRow | null;
      if (!row) throw new Error(`Session memory not found: ${id}`);
      return { memory: this.hydrate(db, row) };
    });
  }

  links(input: { projectKey: string; memoryId?: string; limit?: number }): { links: SessionMemoryLinkRow[] } {
    return this.withDb((db) => {
      const limit = input.limit ?? 100;
      const rows = input.memoryId
        ? (db
            .query(
              `SELECT *
               FROM session_memory_links
               WHERE project_key = ?
                 AND (source_memory_id = ? OR target_memory_id = ?)
               ORDER BY created_at DESC, id DESC
               LIMIT ?`,
            )
            .all(input.projectKey, input.memoryId, input.memoryId, limit) as SessionMemoryLinkRow[])
        : (db
            .query(
              `SELECT *
               FROM session_memory_links
               WHERE project_key = ?
               ORDER BY created_at DESC, id DESC
               LIMIT ?`,
            )
            .all(input.projectKey, limit) as SessionMemoryLinkRow[]);
      return { links: rows };
    });
  }

  private hydrate(db: Database, row: SessionMemoryRow): SessionMemoryInspectRow {
    return {
      ...row,
      contexts: listSessionMemoryContexts(db, row.id),
    };
  }

  private withDb<T>(fn: (db: MemoryDb | Database) => T): T {
    if (this.deps.db) return fn(this.deps.db);
    const db = openMemoryDb(this.root);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }
}

