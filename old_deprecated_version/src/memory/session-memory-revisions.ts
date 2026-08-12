import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { SessionMemoryRow } from "./ingest-types.ts";
import {
  assertProjectSessionMutationAuthority,
  type ProjectSessionMutationAuthority,
} from "./project-session-mutation-fence.ts";
import { withProjectSessionCanonicalWriteAdmission } from "./session-memory-write-firewall.ts";

export const SESSION_MEMORY_CANONICAL_STATE_VERSION = 1 as const;

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

export type SessionMemoryCanonicalState = {
  schema_version: typeof SESSION_MEMORY_CANONICAL_STATE_VERSION;
  memory: {
    memory_kind: string;
    title: string | null;
    summary: string;
    payload: CanonicalJson;
    confidence: string;
    risk: string;
  };
  provenance: {
    provider: string | null;
    provider_session_id: string | null;
    ingest_job_id: string | null;
    source_event_refs: string[];
  };
  lifecycle: {
    status: string;
    superseded_by: string | null;
    lifecycle_reason: string | null;
    superseded_at: string | null;
    retracted_at: string | null;
  };
  contexts: Array<{
    repo_path: string | null;
    git_branch: string | null;
    git_commit: string | null;
    git_worktree_id: string | null;
    source_event_ref: string;
  }>;
  links: Array<{
    direction: "incoming" | "outgoing";
    other_memory_id: string;
    relationship: string;
    reason: string;
    source_event_refs: string[];
  }>;
};

export type SessionMemoryRevisionIdentity = {
  id: string;
  revision: number;
  state_digest: string;
};

export type SessionMemoryRevisionMutation = {
  affectedMemoryIds: Set<string>;
  createdMemoryIds: Set<string>;
};

type CanonicalContextRow = Omit<SessionMemoryCanonicalState["contexts"][number], never>;
type CanonicalLinkRow = SessionMemoryCanonicalState["links"][number];

export function createSessionMemoryRevisionMutation(): SessionMemoryRevisionMutation {
  return { affectedMemoryIds: new Set(), createdMemoryIds: new Set() };
}

export function assertSessionMemoryRevisionTransaction(db: Database): void {
  if (!db.inTransaction) throw new Error("Session Memory revision mutation requires an open transaction");
}

export function markSessionMemoryCreated(mutation: SessionMemoryRevisionMutation, memoryId: string): void {
  mutation.affectedMemoryIds.add(memoryId);
  mutation.createdMemoryIds.add(memoryId);
}

export function markSessionMemoryChanged(mutation: SessionMemoryRevisionMutation, memoryId: string): void {
  mutation.affectedMemoryIds.add(memoryId);
}

export function canonicalizeJson(value: unknown, path = "payload"): CanonicalJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !isArrayIndex(key, value.length)) {
        throw new Error(`${path} contains a non-index array property`);
      }
    }
    return Array.from({ length: value.length }, (_, index) => {
      if (!(index in value)) throw new Error(`${path} contains a sparse array`);
      return canonicalizeJson(value[index], `${path}[${index}]`);
    });
  }
  if (typeof value !== "object") throw new Error(`${path} contains a non-JSON value`);

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} contains a non-JSON object`);
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.some((key) => typeof key !== "string")) throw new Error(`${path} contains a non-string object key`);
  const normalized = Object.create(null) as Record<string, CanonicalJson>;
  for (const key of (keys as string[]).sort(compareStrings)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new Error(`${path}.${key} is not a JSON data property`);
    }
    Object.defineProperty(normalized, key, {
      value: canonicalizeJson(descriptor.value, `${path}.${key}`),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return normalized;
}

export function createSessionMemoryCanonicalState(input: {
  memory_kind: string;
  title: string | null;
  summary: string;
  payload: unknown;
  confidence: string;
  risk: string;
  provider: string | null;
  provider_session_id: string | null;
  ingest_job_id: string | null;
  source_event_refs: readonly string[];
  status?: string;
  superseded_by?: string | null;
  lifecycle_reason?: string | null;
  superseded_at?: string | null;
  retracted_at?: string | null;
  contexts?: SessionMemoryCanonicalState["contexts"];
  links?: SessionMemoryCanonicalState["links"];
}): SessionMemoryCanonicalState {
  return {
    schema_version: SESSION_MEMORY_CANONICAL_STATE_VERSION,
    memory: {
      memory_kind: input.memory_kind,
      title: input.title,
      summary: input.summary,
      payload: canonicalizeJson(input.payload),
      confidence: input.confidence,
      risk: input.risk,
    },
    provenance: {
      provider: input.provider,
      provider_session_id: input.provider_session_id,
      ingest_job_id: input.ingest_job_id,
      source_event_refs: sortedUniqueStrings(input.source_event_refs, "source_event_refs"),
    },
    lifecycle: {
      status: input.status ?? "active",
      superseded_by: input.superseded_by ?? null,
      lifecycle_reason: input.lifecycle_reason ?? null,
      superseded_at: input.superseded_at ?? null,
      retracted_at: input.retracted_at ?? null,
    },
    contexts: [...(input.contexts ?? [])].sort(compareContexts),
    links: [...(input.links ?? [])].map((link) => ({
      ...link,
      source_event_refs: sortedUniqueStrings(link.source_event_refs, "link.source_event_refs"),
    })).sort(compareLinks),
  };
}

export function sessionMemoryCanonicalStateDigest(state: SessionMemoryCanonicalState): string {
  const canonical = canonicalizeJson(state, "session_memory_state");
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

export function readSessionMemoryCanonicalState(db: Database, memoryId: string): SessionMemoryCanonicalState {
  const row = db.query(
    `SELECT id, memory_kind, title, summary, payload_json, confidence, risk,
            provider, provider_session_id, ingest_job_id, source_event_refs_json,
            status, superseded_by, lifecycle_reason, superseded_at, retracted_at
     FROM session_memories
     WHERE id = ?`,
  ).get(memoryId) as SessionMemoryRow | null;
  if (!row) throw new Error(`Session Memory not found for canonical state: ${memoryId}`);

  const contexts = db.query(
    `SELECT repo_path, git_branch, git_commit, git_worktree_id, source_event_ref
     FROM session_memory_contexts
     WHERE session_memory_id = ?`,
  ).all(memoryId) as CanonicalContextRow[];
  const links = db.query(
    `SELECT 'outgoing' AS direction, target_memory_id AS other_memory_id,
            relationship, reason, source_event_refs_json
     FROM session_memory_links
     WHERE source_memory_id = ?
     UNION ALL
     SELECT 'incoming' AS direction, source_memory_id AS other_memory_id,
            relationship, reason, source_event_refs_json
     FROM session_memory_links
     WHERE target_memory_id = ?`,
  ).all(memoryId, memoryId) as Array<Omit<CanonicalLinkRow, "source_event_refs"> & { source_event_refs_json: string }>;

  return createSessionMemoryCanonicalState({
    memory_kind: row.memory_kind,
    title: row.title,
    summary: row.summary,
    payload: parseJson(row.payload_json, `session_memories/${memoryId}/payload_json`),
    confidence: row.confidence,
    risk: row.risk,
    provider: row.provider,
    provider_session_id: row.provider_session_id,
    ingest_job_id: row.ingest_job_id,
    source_event_refs: parseStringArray(
      row.source_event_refs_json,
      `session_memories/${memoryId}/source_event_refs_json`,
    ),
    status: row.status,
    superseded_by: row.superseded_by,
    lifecycle_reason: row.lifecycle_reason,
    superseded_at: row.superseded_at,
    retracted_at: row.retracted_at,
    contexts,
    links: links.map((link) => ({
      direction: link.direction,
      other_memory_id: link.other_memory_id,
      relationship: link.relationship,
      reason: link.reason,
      source_event_refs: parseStringArray(
        link.source_event_refs_json,
        `session_memory_links/${memoryId}/source_event_refs_json`,
      ),
    })),
  });
}

export function readSessionMemoryRevisionIdentity(
  db: Database,
  memoryId: string,
): SessionMemoryRevisionIdentity {
  const row = db.query("SELECT id, revision, state_digest FROM session_memories WHERE id = ?").get(memoryId) as
    | SessionMemoryRevisionIdentity
    | null;
  if (!row) throw new Error(`Session Memory not found for revision identity: ${memoryId}`);
  return row;
}

export function advanceSessionMemoryRevisionInOpenTransaction(
  db: Database,
  mutation: SessionMemoryRevisionMutation,
  authority: ProjectSessionMutationAuthority,
): SessionMemoryRevisionIdentity[] {
  assertSessionMemoryRevisionTransaction(db);
  const identities: SessionMemoryRevisionIdentity[] = [];
  for (const memoryId of [...mutation.affectedMemoryIds].sort(compareStrings)) {
    const project = db.query("SELECT project_key FROM session_memories WHERE id = ?").get(memoryId) as {
      project_key: string;
    } | null;
    if (!project) throw new Error(`Session Memory not found for revision identity: ${memoryId}`);
    assertProjectSessionMutationAuthority(db, authority, project.project_key);
    const current = readSessionMemoryRevisionIdentity(db, memoryId);
    const stateDigest = sessionMemoryCanonicalStateDigest(readSessionMemoryCanonicalState(db, memoryId));
    if (mutation.createdMemoryIds.has(memoryId)) {
      if (current.revision !== 1) {
        throw new Error(`New Session Memory must begin at revision 1: ${memoryId}`);
      }
      const result = withProjectSessionCanonicalWriteAdmission(db, project.project_key, authority, () =>
        db.query("UPDATE session_memories SET state_digest = ? WHERE id = ? AND revision = 1")
          .run(stateDigest, memoryId));
      if (result.changes !== 1) throw new Error(`Session Memory revision changed during creation: ${memoryId}`);
      identities.push({ id: memoryId, revision: 1, state_digest: stateDigest });
      continue;
    }
    const nextRevision = current.revision + 1;
    const result = withProjectSessionCanonicalWriteAdmission(db, project.project_key, authority, () => db.query(
      "UPDATE session_memories SET revision = ?, state_digest = ? WHERE id = ? AND revision = ?",
    ).run(nextRevision, stateDigest, memoryId, current.revision));
    if (result.changes !== 1) throw new Error(`Session Memory revision changed during mutation: ${memoryId}`);
    identities.push({ id: memoryId, revision: nextRevision, state_digest: stateDigest });
  }
  mutation.affectedMemoryIds.clear();
  mutation.createdMemoryIds.clear();
  return identities;
}

function parseJson(value: string, path: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${path} must contain valid JSON`);
  }
}

function parseStringArray(value: string, path: string): string[] {
  const parsed = parseJson(value, path);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(`${path} must contain a JSON array of strings`);
  }
  return parsed as string[];
}

function sortedUniqueStrings(values: readonly string[], path: string): string[] {
  if (values.some((value) => typeof value !== "string")) throw new Error(`${path} must contain only strings`);
  return [...new Set(values)].sort(compareStrings);
}

function compareContexts(left: CanonicalContextRow, right: CanonicalContextRow): number {
  return compareTuples(
    [left.repo_path, left.git_branch, left.git_commit, left.git_worktree_id, left.source_event_ref],
    [right.repo_path, right.git_branch, right.git_commit, right.git_worktree_id, right.source_event_ref],
  );
}

function compareLinks(left: CanonicalLinkRow, right: CanonicalLinkRow): number {
  return compareTuples(
    [left.direction, left.other_memory_id, left.relationship, left.reason, JSON.stringify(left.source_event_refs)],
    [right.direction, right.other_memory_id, right.relationship, right.reason, JSON.stringify(right.source_event_refs)],
  );
}

function compareTuples(left: Array<string | null>, right: Array<string | null>): number {
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === rightValue) continue;
    if (leftValue === null) return -1;
    if (rightValue === null) return 1;
    return compareStrings(leftValue, rightValue);
  }
  return 0;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}
