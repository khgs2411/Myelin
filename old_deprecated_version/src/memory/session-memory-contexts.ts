import type { Database } from "bun:sqlite";
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

export type SessionMemoryContextInput = {
  session_memory_id: string;
  project_key: string;
  repo_path?: string | null;
  git_branch?: string | null;
  git_commit?: string | null;
  git_worktree_id?: string | null;
  source_event_ref: string;
};

export type SessionMemoryContextRow = {
  id: number;
  session_memory_id: string;
  project_key: string;
  repo_path: string | null;
  git_branch: string | null;
  git_commit: string | null;
  git_worktree_id: string | null;
  source_event_ref: string;
};

export function createSessionMemoryContexts(
  db: Database,
  contexts: SessionMemoryContextInput[],
  authority: ProjectSessionMutationAuthority,
  revisionMutation?: SessionMemoryRevisionMutation,
): void {
  if (contexts.length === 0) return;
  const mutation = revisionMutation ?? createSessionMemoryRevisionMutation();
  if (revisionMutation) assertSessionMemoryRevisionTransaction(db);
  const write = (): void => {
    for (const context of contexts) {
      assertProjectSessionMutationAuthority(db, authority, context.project_key);
      const memory = db.query("SELECT project_key FROM session_memories WHERE id = ?").get(context.session_memory_id) as {
        project_key: string;
      } | null;
      if (!memory) throw new Error(`Session Memory not found for context: ${context.session_memory_id}`);
      if (memory.project_key !== context.project_key) {
        throw new Error(
          `Session Memory context project mismatch for ${context.session_memory_id}: ${context.project_key}`,
        );
      }
      assertProjectSessionMutationAuthority(db, authority, memory.project_key);
    }
    const insert = db.query(
      `INSERT INTO session_memory_contexts
        (session_memory_id, project_key, repo_path, git_branch, git_commit, git_worktree_id, source_event_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const context of contexts) {
      insert.run(
        context.session_memory_id,
        context.project_key,
        context.repo_path ?? null,
        context.git_branch ?? null,
        context.git_commit ?? null,
        context.git_worktree_id ?? null,
        context.source_event_ref,
      );
      markSessionMemoryChanged(mutation, context.session_memory_id);
    }
  };
  const admittedWrite = (): void => withProjectSessionCanonicalWriteAdmission(
    db,
    contexts[0]!.project_key,
    authority,
    write,
  );
  if (revisionMutation) {
    admittedWrite();
  } else {
    db.transaction(() => {
      admittedWrite();
      advanceSessionMemoryRevisionInOpenTransaction(db, mutation, authority);
    })();
  }
}

export function listSessionMemoryContexts(db: Database, sessionMemoryId: string): SessionMemoryContextRow[] {
  return db
    .query("SELECT * FROM session_memory_contexts WHERE session_memory_id = ? ORDER BY id")
    .all(sessionMemoryId) as SessionMemoryContextRow[];
}

export function sessionMemoryHasBranchContext(
  db: Database,
  input: { sessionMemoryId: string; gitBranch: string },
): boolean {
  return Boolean(
    db
      .query(
        `SELECT 1
         FROM session_memory_contexts
         WHERE session_memory_id = ?
           AND git_branch = ?
         LIMIT 1`,
      )
      .get(input.sessionMemoryId, input.gitBranch),
  );
}
