import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  planEvidence,
  prepare,
  seedEvidence,
  seedIndexedMemory,
} from "../helpers/smc-preparation.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  configureSMCTestContract(db);
});

afterEach(() => db.close());

test("freezes normalized search text and exact vector bytes under the active contract", () => {
  seedIndexedMemory(db, { id: "memory-1" });
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);

  const result = prepare(db, planEvidence(db));
  if (result.kind !== "prepared") throw new Error(JSON.stringify(result));
  const vector = db.query(
    "SELECT embedding_dimensions, length(vector_bytes) AS bytes, vector_digest FROM smc_memory_snapshot_vectors",
  ).get();
  expect(vector).toMatchObject({ embedding_dimensions: 3, bytes: 12 });
  expect((vector as { vector_digest: string }).vector_digest).toStartWith("sha256:");
  expect(db.query("SELECT active_memory_count, vector_count, normalized_text_match_count FROM smc_retrieval_snapshot_completeness").get())
    .toEqual({ active_memory_count: 1, vector_count: 1, normalized_text_match_count: 1 });
});

test("missing or hash-mismatched coverage blocks before any durable anchor state", () => {
  seedIndexedMemory(db, { id: "memory-1" });
  db.query("UPDATE session_memory_embeddings SET normalized_text_hash = 'wrong' WHERE session_memory_id = 'memory-1'").run();
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);

  expect(prepare(db, planEvidence(db))).toMatchObject({
    kind: "blocked",
    code: "session_retrieval_snapshot_incomplete",
    memory_ids: ["memory-1"],
  });
  expect(db.query("SELECT count(*) AS n FROM smc_manifests").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM ingest_jobs").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM experience_event_tombstones").get()).toEqual({ n: 0 });
});

test("an unavailable active vector table returns a typed provider blocker and rolls back", () => {
  seedIndexedMemory(db, { id: "memory-1" });
  const vectorTable = db.query(
    "SELECT vector_table FROM embedding_contracts WHERE scope = 'session_memory' AND lifecycle = 'active'",
  ).get() as { vector_table: string };
  db.query(`DROP TABLE ${vectorTable.vector_table}`).run();
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);

  expect(prepare(db, planEvidence(db))).toMatchObject({
    kind: "blocked",
    code: "session_retrieval_provider_unavailable",
  });
  expect(db.query("SELECT count(*) AS n FROM smc_manifests").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM ingest_jobs").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM experience_event_tombstones").get()).toEqual({ n: 0 });
});
