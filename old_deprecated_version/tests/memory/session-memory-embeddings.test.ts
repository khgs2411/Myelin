import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  ensureActiveSessionMemoryEmbeddings,
  ensurePendingSessionMemoryEmbedding,
  getSessionMemoryEmbedding,
  listPendingSessionMemoryEmbeddings,
  markSessionMemoryEmbeddingFailed,
  markSessionMemoryEmbeddingIndexed,
  readExactActiveSessionMemoryEmbeddings,
  sessionMemoryEmbeddingId,
} from "../../src/memory/session-memory-embeddings.ts";
import { createSessionMemory, retractSessionMemory } from "../helpers/session-mutation-authority.ts";
import {
  configureSMCTestContract,
  seedIndexedMemory,
} from "../helpers/smc-preparation.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  createSessionMemory(db, {
    id: "mem_1",
    project_key: "class-kit",
    source_event_refs: [],
    memory_kind: "decision",
    summary: "Keep local auth open.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-13T10:00:00.000Z",
    embedding_contract: null,
  });
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

test("backfills a new embedding contract for active memories only", () => {
  const old = ensurePendingSessionMemoryEmbedding(db, {
    session_memory_id: "mem_1",
    project_key: "class-kit",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-13T10:05:00.000Z",
  });
  markSessionMemoryEmbeddingFailed(db, {
    id: old.id,
    failure_reason: "old provider unavailable",
    now: "2026-06-13T10:06:00.000Z",
  });
  createSessionMemory(db, {
    id: "mem_2",
    project_key: "class-kit",
    source_event_refs: [],
    memory_kind: "continuity",
    summary: "Active memory.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-13T10:01:00.000Z",
    embedding_contract: null,
  });
  createSessionMemory(db, {
    id: "mem_3",
    project_key: "class-kit",
    source_event_refs: [],
    memory_kind: "continuity",
    summary: "Retracted memory.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-13T10:02:00.000Z",
    embedding_contract: null,
  });
  retractSessionMemory(db, {
    id: "mem_3",
    projectKey: "class-kit",
    reason: "fixture",
    now: "2026-06-13T10:02:00.000Z",
  });
  const ollamaContract = {
    ...DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: "ollama_qwen" as const,
    model: "qwen3-embedding:4b",
  };

  expect(ensureActiveSessionMemoryEmbeddings(db, {
    project_key: "class-kit",
    contract: ollamaContract,
    now: "2026-06-13T10:10:00.000Z",
  })).toBe(2);
  expect(ensureActiveSessionMemoryEmbeddings(db, {
    project_key: "class-kit",
    contract: ollamaContract,
    now: "2026-06-13T10:11:00.000Z",
  })).toBe(0);

  const rows = db
    .query("SELECT session_memory_id, status FROM session_memory_embeddings WHERE embedding_provider = 'ollama_qwen' ORDER BY session_memory_id")
    .all() as Array<{ session_memory_id: string; status: string }>;
  expect(rows).toEqual([
    { session_memory_id: "mem_1", status: "pending" },
    { session_memory_id: "mem_2", status: "pending" },
  ]);
  expect(getSessionMemoryEmbedding(db, old.id).status).toBe("failed");
});

test("reads exact raw vector bytes only for the active Session embedding contract", () => {
  const contract = configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "mem_exact", project_key: "class-kit" });

  const rows = readExactActiveSessionMemoryEmbeddings(db, {
    project_key: "class-kit",
    contract,
  });

  expect(rows).toHaveLength(1);
  expect(rows[0]?.session_memory_id).toBe("mem_exact");
  expect(rows[0]?.embedding_contract_id).toBe(contract.id);
  expect(Array.from(new Float32Array(rows[0]!.vector_bytes.buffer))).toEqual([
    0.10000000149011612,
    0.20000000298023224,
    0.30000001192092896,
  ]);
});
