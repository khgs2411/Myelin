import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { SessionMemoryRow } from "../memory/ingest-types.ts";
import {
  readSessionMemoryCanonicalState,
  sessionMemoryCanonicalStateDigest,
} from "../memory/session-memory-revisions.ts";
import { stableJson } from "../runtime/json.ts";

export type FrozenSessionMemoryIdentity = {
  id: string;
  revision: number;
  state_digest: string;
};

export type FrozenSessionMemorySnapshot = {
  job_id: string;
  project_key: string;
  count: number;
  digest: `sha256:${string}`;
  identities: FrozenSessionMemoryIdentity[];
};

export function copyActiveSessionMemorySnapshotInOpenTransaction(
  db: Database,
  input: { job_id: string; project_key: string },
): FrozenSessionMemorySnapshot {
  if (!db.inTransaction) throw new Error("Session Memory snapshot copy requires an open transaction");
  const rows = db.query(
    `SELECT * FROM session_memories
     WHERE project_key = ? AND status = 'active'
     ORDER BY id`,
  ).all(input.project_key) as SessionMemoryRow[];

  const insertMemory = db.query(
    `INSERT INTO smc_memory_snapshot
      (job_id, memory_id, ordinal, project_key, provider, provider_session_id, ingest_job_id,
       source_event_refs_json, memory_kind, title, summary, payload_json, confidence, risk, status,
       superseded_by, lifecycle_reason, superseded_at, retracted_at, revision, state_digest,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertContext = db.query(
    `INSERT INTO smc_memory_snapshot_contexts
      (job_id, memory_id, ordinal, repo_path, git_branch, git_commit, git_worktree_id, source_event_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const digestRows: unknown[] = [];

  rows.forEach((row, ordinal) => {
    const canonical = readSessionMemoryCanonicalState(db, row.id);
    const actualDigest = sessionMemoryCanonicalStateDigest(canonical);
    if (actualDigest !== row.state_digest) {
      throw new Error(`session_memory_snapshot_drift: canonical digest mismatch for ${row.id}`);
    }
    insertMemory.run(
      input.job_id,
      row.id,
      ordinal,
      row.project_key,
      row.provider,
      row.provider_session_id,
      row.ingest_job_id,
      row.source_event_refs_json,
      row.memory_kind,
      row.title,
      row.summary,
      row.payload_json,
      row.confidence,
      row.risk,
      row.status,
      row.superseded_by,
      row.lifecycle_reason,
      row.superseded_at,
      row.retracted_at,
      row.revision,
      row.state_digest,
      row.created_at,
      row.updated_at,
    );
    canonical.contexts.forEach((context, contextOrdinal) => {
      insertContext.run(
        input.job_id,
        row.id,
        contextOrdinal,
        context.repo_path,
        context.git_branch,
        context.git_commit,
        context.git_worktree_id,
        context.source_event_ref,
      );
    });
    digestRows.push({
      id: row.id,
      revision: row.revision,
      state_digest: row.state_digest,
      memory: row,
      canonical,
    });
  });

  const activeIds = rows.map((row) => row.id);
  if (activeIds.length > 0) {
    const placeholders = activeIds.map(() => "?").join(", ");
    const links = db.query(
      `SELECT * FROM session_memory_links
       WHERE project_key = ?
         AND (source_memory_id IN (${placeholders}) OR target_memory_id IN (${placeholders}))
       ORDER BY source_memory_id, target_memory_id, relationship, reason, id`,
    ).all(input.project_key, ...activeIds, ...activeIds) as Array<{
      id: number;
      source_memory_id: string;
      target_memory_id: string;
      project_key: string;
      relationship: string;
      reason: string;
      source_event_refs_json: string;
      created_at: string;
    }>;
    const insertLink = db.query(
      `INSERT INTO smc_memory_snapshot_links
        (job_id, link_id, source_memory_id, target_memory_id, project_key, relationship, reason,
         source_event_refs_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const link of links) {
      insertLink.run(
        input.job_id,
        link.id,
        link.source_memory_id,
        link.target_memory_id,
        link.project_key,
        link.relationship,
        link.reason,
        link.source_event_refs_json,
        link.created_at,
      );
    }
  }

  return {
    job_id: input.job_id,
    project_key: input.project_key,
    count: rows.length,
    digest: digest(digestRows),
    identities: rows.map((row) => ({
      id: row.id,
      revision: row.revision,
      state_digest: row.state_digest,
    })),
  };
}

export function assertLiveSessionMemorySnapshotUnchanged(
  db: Database,
  expected: Pick<FrozenSessionMemorySnapshot, "project_key" | "identities">,
): void {
  const actual = db.query(
    `SELECT id, revision, state_digest
     FROM session_memories
     WHERE project_key = ? AND status = 'active'
     ORDER BY id`,
  ).all(expected.project_key) as FrozenSessionMemoryIdentity[];
  if (stableJson(actual) !== stableJson(expected.identities)) {
    throw new Error("session_memory_snapshot_drift: active Session Memory revision identity changed");
  }
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}
