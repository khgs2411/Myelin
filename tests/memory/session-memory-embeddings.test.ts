import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  ensurePendingSessionMemoryEmbedding,
  getSessionMemoryEmbedding,
  listPendingSessionMemoryEmbeddings,
  markSessionMemoryEmbeddingFailed,
  markSessionMemoryEmbeddingIndexed,
  sessionMemoryEmbeddingId,
} from "../../src/memory/session-memory-embeddings.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  db.query(
    `INSERT INTO session_memories
      (id, project_key, source_event_refs_json, memory_kind, summary, payload_json, confidence, risk, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "mem_1",
    "class-kit",
    "[]",
    "decision",
    "Keep local auth open.",
    "{}",
    "high",
    "low",
    "2026-06-13T10:00:00.000Z",
    "2026-06-13T10:00:00.000Z",
  );
});

afterEach(() => {
  db.close();
});

test("creates a deterministic pending embedding row for a session memory", () => {
  const row = ensurePendingSessionMemoryEmbedding(db, {
    session_memory_id: "mem_1",
    project_key: "class-kit",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-13T10:05:00.000Z",
  });

  expect(row.id).toBe(
    sessionMemoryEmbeddingId({
      session_memory_id: "mem_1",
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    }),
  );
  expect(row.status).toBe("pending");
  expect(row.embedding_model).toBe(DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.model);
  expect(row.embedding_dimensions).toBe(DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.dimensions);
});

test("does not reset an already indexed embedding row", () => {
  const pending = ensurePendingSessionMemoryEmbedding(db, {
    session_memory_id: "mem_1",
    project_key: "class-kit",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-13T10:05:00.000Z",
  });
  markSessionMemoryEmbeddingIndexed(db, {
    id: pending.id,
    normalized_text_hash: "hash_1",
    now: "2026-06-13T10:06:00.000Z",
  });

  const row = ensurePendingSessionMemoryEmbedding(db, {
    session_memory_id: "mem_1",
    project_key: "class-kit",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-13T10:07:00.000Z",
  });

  expect(row.status).toBe("indexed");
  expect(row.normalized_text_hash).toBe("hash_1");
  expect(row.updated_at).toBe("2026-06-13T10:06:00.000Z");
});

test("lists pending rows and retries failed rows only when requested", () => {
  const row = ensurePendingSessionMemoryEmbedding(db, {
    session_memory_id: "mem_1",
    project_key: "class-kit",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-13T10:05:00.000Z",
  });
  markSessionMemoryEmbeddingFailed(db, {
    id: row.id,
    failure_reason: "sqlite-vec unavailable",
    now: "2026-06-13T10:06:00.000Z",
  });

  expect(
    listPendingSessionMemoryEmbeddings(db, {
      project_key: "class-kit",
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      limit: 10,
    }),
  ).toEqual([]);
  expect(
    listPendingSessionMemoryEmbeddings(db, {
      project_key: "class-kit",
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      limit: 10,
      include_failed: true,
    }).map((item) => item.id),
  ).toEqual([row.id]);
  expect(getSessionMemoryEmbedding(db, row.id).retry_count).toBe(1);
});
