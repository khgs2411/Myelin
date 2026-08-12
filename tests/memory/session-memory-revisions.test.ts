import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  createSessionMemoryCanonicalState,
  createSessionMemoryRevisionMutation,
  readSessionMemoryCanonicalState,
  readSessionMemoryRevisionIdentity,
  sessionMemoryCanonicalStateDigest,
} from "../../src/memory/session-memory-revisions.ts";
import {
  advanceSessionMemoryRevisionInOpenTransaction,
  createSessionMemory,
  createSessionMemoryContexts,
  createSessionMemoryLink,
  supersedeSessionMemory,
} from "../helpers/session-mutation-authority.ts";
import { withCompatibilityCanonicalApplyAdmission } from "../../src/memory/session-memory-write-firewall.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
});

afterEach(() => {
  db.close();
});

test("canonical state digest is versioned and stable across equivalent JSON and row order", () => {
  const first = createSessionMemoryCanonicalState({
    memory_kind: "decision",
    title: null,
    summary: "Keep the canonical boundary.",
    payload: { z: [{ b: 2, a: 1 }, 3], a: true },
    confidence: "high",
    risk: "low",
    provider: null,
    provider_session_id: null,
    ingest_job_id: null,
    source_event_refs: ["tomb_2", "tomb_1", "tomb_2"],
    contexts: [
      { repo_path: "/repo", git_branch: "main", git_commit: null, git_worktree_id: null, source_event_ref: "tomb_2" },
      { repo_path: null, git_branch: null, git_commit: null, git_worktree_id: null, source_event_ref: "tomb_1" },
    ],
    links: [{
      direction: "outgoing",
      other_memory_id: "mem_other",
      relationship: "refines",
      reason: "new evidence",
      source_event_refs: ["tomb_2", "tomb_1", "tomb_2"],
    }],
  });
  const second = createSessionMemoryCanonicalState({
    memory_kind: "decision",
    title: null,
    summary: "Keep the canonical boundary.",
    payload: { a: true, z: [{ a: 1, b: 2 }, 3] },
    confidence: "high",
    risk: "low",
    provider: null,
    provider_session_id: null,
    ingest_job_id: null,
    source_event_refs: ["tomb_1", "tomb_2"],
    contexts: [...first.contexts].reverse(),
    links: [{ ...first.links[0], source_event_refs: ["tomb_1", "tomb_2"] }],
  });

  expect(first.schema_version).toBe(1);
  expect(first.memory.payload).toEqual({ a: true, z: [{ a: 1, b: 2 }, 3] });
  expect(first.provenance.source_event_refs).toEqual(["tomb_1", "tomb_2"]);
  expect(sessionMemoryCanonicalStateDigest(first)).toBe(sessionMemoryCanonicalStateDigest(second));
  expect(sessionMemoryCanonicalStateDigest(first)).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(sessionMemoryCanonicalStateDigest(first)).not.toBe(sessionMemoryCanonicalStateDigest(
    { ...second, memory: { ...second.memory, payload: { a: true, z: [3, { a: 1, b: 2 }] } } },
  ));
});

test("payload canonicalization rejects non-JSON and non-finite values", () => {
  expect(() => createMemory("mem_invalid", { value: Number.POSITIVE_INFINITY })).toThrow("non-finite");
  expect(() => createMemory("mem_date", { value: new Date("2026-08-11T00:00:00.000Z") })).toThrow("non-JSON object");
  expect(db.query("SELECT count(*) AS count FROM session_memories").get()).toEqual({ count: 0 });
});

test("canonicalization preserves nested __proto__ JSON keys without prototype semantics", () => {
  const payload = JSON.parse('{"nested":{"safe":1,"__proto__":{"polluted":true}}}') as Record<string, unknown>;
  const state = createSessionMemoryCanonicalState({
    memory_kind: "decision",
    title: null,
    summary: "Prototype key fixture",
    payload,
    confidence: "high",
    risk: "low",
    provider: null,
    provider_session_id: null,
    ingest_job_id: null,
    source_event_refs: [],
  });
  const normalizedPayload = state.memory.payload as Record<string, CanonicalJsonForTest>;
  const nested = normalizedPayload.nested as Record<string, CanonicalJsonForTest>;

  expect(Object.getPrototypeOf(normalizedPayload)).toBeNull();
  expect(Object.getPrototypeOf(nested)).toBeNull();
  expect(Object.hasOwn(nested, "__proto__")).toBeTrue();
  expect(nested.__proto__).toEqual({ polluted: true });
  expect(sessionMemoryCanonicalStateDigest(state)).toMatch(/^sha256:[0-9a-f]{64}$/);
});

test("canonicalization rejects arrays with non-index own properties", () => {
  const values = ["first", "second"] as string[] & { metadata?: string };
  values.metadata = "not JSON array content";

  expect(() => createMemory("mem_array_property", { values })).toThrow("non-index array property");
  expect(db.query("SELECT count(*) AS count FROM session_memories").get()).toEqual({ count: 0 });
});

test("canonical writers advance each affected memory once and exclude derived embedding changes", () => {
  const created = createMemory("mem_old", { order: ["first", "second"] });
  const replacement = createMemory("mem_new", {});
  expect(created.revision).toBe(1);
  expect(replacement.revision).toBe(1);

  createSessionMemoryContexts(db, [
    context("mem_old", "tomb_2", "feature"),
    context("mem_old", "tomb_1", null),
  ]);
  expect(readSessionMemoryRevisionIdentity(db, "mem_old").revision).toBe(2);

  createSessionMemoryLink(db, {
    source_memory_id: "mem_new",
    target_memory_id: "mem_old",
    project_key: "demo",
    relationship: "refines",
    reason: "replacement",
    source_event_refs: ["tomb_2", "tomb_1"],
    created_at: "2026-08-11T10:02:00.000Z",
  });
  expect(readSessionMemoryRevisionIdentity(db, "mem_old").revision).toBe(3);
  expect(readSessionMemoryRevisionIdentity(db, "mem_new").revision).toBe(2);

  const mutation = createSessionMemoryRevisionMutation();
  db.transaction(() => {
    supersedeSessionMemory(db, {
      id: "mem_old",
      projectKey: "demo",
      supersededBy: "mem_new",
      reason: "replacement",
      now: "2026-08-11T10:03:00.000Z",
    }, mutation);
    createSessionMemoryLink(db, {
      source_memory_id: "mem_new",
      target_memory_id: "mem_old",
      project_key: "demo",
      relationship: "supersedes",
      reason: "replacement",
      source_event_refs: ["tomb_2"],
      created_at: "2026-08-11T10:03:00.000Z",
    }, mutation);
    advanceSessionMemoryRevisionInOpenTransaction(db, mutation);
  })();
  expect(readSessionMemoryRevisionIdentity(db, "mem_old").revision).toBe(4);
  expect(readSessionMemoryRevisionIdentity(db, "mem_new").revision).toBe(3);

  const beforeEmbedding = readSessionMemoryRevisionIdentity(db, "mem_new");
  db.query(
    `UPDATE session_memory_embeddings
     SET status = 'failed', failure_reason = 'fixture', retry_count = retry_count + 1
     WHERE session_memory_id = ?`,
  ).run("mem_new");
  expect(readSessionMemoryRevisionIdentity(db, "mem_new")).toEqual(beforeEmbedding);
});

test("create with contexts uses one transaction and remains at revision 1", () => {
  const mutation = createSessionMemoryRevisionMutation();
  db.transaction(() => {
    createSessionMemory(db, memoryInput("mem_graph", { stable: true }), mutation);
    createSessionMemoryContexts(db, [context("mem_graph", "tomb_1", "main")], mutation);
    advanceSessionMemoryRevisionInOpenTransaction(db, mutation);
  })();

  const identity = readSessionMemoryRevisionIdentity(db, "mem_graph");
  expect(identity.revision).toBe(1);
  expect(identity.state_digest).toBe(sessionMemoryCanonicalStateDigest(readSessionMemoryCanonicalState(db, "mem_graph")));
});

test("generated row identities and timestamps are excluded from canonical state", () => {
  createMemory("mem_left", {});
  createMemory("mem_right", {});
  createSessionMemoryContexts(db, [context("mem_left", "tomb_1", "main")]);
  createSessionMemoryLink(db, {
    source_memory_id: "mem_left",
    target_memory_id: "mem_right",
    project_key: "demo",
    relationship: "refines",
    reason: "evidence",
    source_event_refs: ["tomb_1"],
    created_at: "2026-08-11T10:00:00.000Z",
  });
  const before = sessionMemoryCanonicalStateDigest(readSessionMemoryCanonicalState(db, "mem_left"));

  withCompatibilityCanonicalApplyAdmission(db, "demo", () => {
    db.query("UPDATE session_memory_contexts SET id = id + 100 WHERE session_memory_id = 'mem_left'").run();
    db.query(
      "UPDATE session_memory_links SET id = id + 100, created_at = '2030-01-01T00:00:00.000Z' WHERE source_memory_id = 'mem_left'",
    ).run();
    db.query(
      "UPDATE session_memories SET created_at = '2030-01-01T00:00:00.000Z', updated_at = '2030-01-01T00:00:00.000Z' WHERE id = 'mem_left'",
    ).run();
  });

  expect(sessionMemoryCanonicalStateDigest(readSessionMemoryCanonicalState(db, "mem_left"))).toBe(before);
});

test("a failed logical mutation rolls back canonical rows and revision identity", () => {
  createMemory("mem_rollback", {});
  const before = readSessionMemoryRevisionIdentity(db, "mem_rollback");

  expect(() => createSessionMemoryContexts(db, [
    context("mem_rollback", "tomb_ok", "main"),
    context("missing", "tomb_bad", "main"),
  ])).toThrow();

  expect(db.query("SELECT count(*) AS count FROM session_memory_contexts").get()).toEqual({ count: 0 });
  expect(readSessionMemoryRevisionIdentity(db, "mem_rollback")).toEqual(before);
});

function createMemory(id: string, payload: Record<string, unknown>) {
  return createSessionMemory(db, memoryInput(id, payload));
}

function memoryInput(id: string, payload: Record<string, unknown>) {
  return {
    id,
    project_key: "demo",
    source_event_refs: ["tomb_2", "tomb_1"],
    memory_kind: "decision" as const,
    title: null,
    summary: `Memory ${id}`,
    payload,
    confidence: "high",
    risk: "low",
    now: "2026-08-11T10:00:00.000Z",
  };
}

function context(sessionMemoryId: string, sourceEventRef: string, gitBranch: string | null) {
  return {
    session_memory_id: sessionMemoryId,
    project_key: "demo",
    repo_path: "/repo",
    git_branch: gitBranch,
    git_commit: null,
    git_worktree_id: null,
    source_event_ref: sourceEventRef,
  };
}

type CanonicalJsonForTest = null | boolean | number | string | CanonicalJsonForTest[] | {
  [key: string]: CanonicalJsonForTest;
};
