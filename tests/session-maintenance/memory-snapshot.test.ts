import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { assertLiveSessionMemorySnapshotUnchanged } from "../../src/session-maintenance/memory-snapshot.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  planEvidence,
  prepare,
  seedEvidence,
  seedIndexedMemory,
} from "../helpers/smc-preparation.ts";
import { createSessionMemoryContexts } from "../helpers/session-mutation-authority.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  configureSMCTestContract(db);
});

afterEach(() => db.close());

test("copies every active revision and context in stable order and detects later live drift", () => {
  seedIndexedMemory(db, { id: "memory-b" });
  seedIndexedMemory(db, { id: "memory-a" });
  createSessionMemoryContexts(db, [{
    session_memory_id: "memory-a",
    project_key: "demo",
    repo_path: "/repo",
    git_branch: "feature/smc",
    git_commit: "abc123",
    git_worktree_id: "wt-1",
    source_event_ref: "evt-context",
  }]);
  // Context mutation advances the canonical revision and invalidates its previously indexed hash.
  db.query(
    `UPDATE session_memory_embeddings SET normalized_text_hash = normalized_text_hash
     WHERE session_memory_id = 'memory-a'`,
  ).run();
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);

  const result = prepare(db, planEvidence(db));
  if (result.kind !== "prepared") throw new Error(JSON.stringify(result));
  expect(db.query("SELECT memory_id, ordinal, revision FROM smc_memory_snapshot ORDER BY ordinal").all())
    .toEqual([
      { memory_id: "memory-a", ordinal: 0, revision: 2 },
      { memory_id: "memory-b", ordinal: 1, revision: 1 },
    ]);
  expect(db.query("SELECT memory_id, source_event_ref FROM smc_memory_snapshot_contexts").all())
    .toEqual([{ memory_id: "memory-a", source_event_ref: "evt-context" }]);

  const identities = db.query(
    "SELECT memory_id AS id, revision, state_digest FROM smc_memory_snapshot ORDER BY memory_id",
  ).all() as Array<{ id: string; revision: number; state_digest: string }>;
  expect(() => assertLiveSessionMemorySnapshotUnchanged(db, { project_key: "demo", identities })).not.toThrow();
  const staleExpected = identities.map((identity) => identity.id === "memory-a"
    ? { ...identity, revision: identity.revision - 1 }
    : identity);
  expect(() => assertLiveSessionMemorySnapshotUnchanged(db, { project_key: "demo", identities: staleExpected }))
    .toThrow("session_memory_snapshot_drift");
});
