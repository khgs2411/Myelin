import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import type { EmbeddingProviderClient } from "../../src/memory/embedding-provider.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { markSessionMemoryEmbeddingIndexed } from "../../src/memory/session-memory-embeddings.ts";
import { querySessionMemory, type SessionMemoryQueryVectorStore } from "../../src/memory/session-memory-query.ts";
import { createSessionMemory } from "../../src/memory/session-memories.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  createSessionMemory(db, {
    id: "mem_decision",
    project_key: "class-kit",
    source_event_refs: ["tomb_1"],
    memory_kind: "decision",
    title: "Embedding index",
    summary: "Session memories need vector embeddings before briefing reads.",
    payload: { decision: "use sqlite-vec" },
    confidence: "high",
    risk: "low",
    now: "2026-06-13T10:00:00.000Z",
  });
});

afterEach(() => {
  db.close();
});

test("returns degraded instead of dumping rows when indexed vectors are unavailable", async () => {
  const result = await querySessionMemory(db, {
    project_key: "class-kit",
    question: "What did we decide about embeddings?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: fixedProvider(),
    limit: 5,
    vector_store: {
      ensure: () => ({ available: false, reason: "extension loading disabled" }),
      search: () => {
        throw new Error("search should not run");
      },
    },
  });

  expect(result.degraded).toBe(true);
  expect(result.degraded_reason).toContain("sqlite-vec unavailable");
  expect(result.matches).toEqual([]);
  expect(result.pending_count).toBe(1);
});

test("embeds the question as retrieval query and hydrates vector matches", async () => {
  const row = db.query("SELECT id FROM session_memory_embeddings").get() as { id: string };
  markSessionMemoryEmbeddingIndexed(db, {
    id: row.id,
    normalized_text_hash: "hash_1",
    now: "2026-06-13T10:05:00.000Z",
  });
  const requestedPurposes: string[] = [];
  const provider: EmbeddingProviderClient = {
    async embed(request) {
      requestedPurposes.push(request.contract.purpose);
      return {
        embedding: Array.from({ length: request.contract.dimensions }, () => 0.5),
        model: request.contract.model,
        dimensions: request.contract.dimensions,
      };
    },
  };
  const vectorStore: SessionMemoryQueryVectorStore = {
    ensure: () => ({ available: true }),
    search: () => [{ memory_id: "mem_decision", distance: 0.12 }],
  };

  const result = await querySessionMemory(db, {
    project_key: "class-kit",
    question: "What did we decide about embeddings?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider,
    limit: 5,
    vector_store: vectorStore,
  });

  expect(result.degraded).toBe(false);
  expect(requestedPurposes).toEqual(["retrieval_query"]);
  expect(result.matches).toHaveLength(1);
  expect(result.query_embedding_cache_hit).toBe(false);
  expect(result.source_tools).toEqual(["query-embedding-cache", "session-memory-vector-index"]);
  expect(result.matches[0]).toMatchObject({
    id: "mem_decision",
    memory_kind: "decision",
    summary: "Session memories need vector embeddings before briefing reads.",
    distance: 0.12,
  });
});

test("reuses cached question embeddings on repeated queries", async () => {
  const row = db.query("SELECT id FROM session_memory_embeddings").get() as { id: string };
  markSessionMemoryEmbeddingIndexed(db, {
    id: row.id,
    normalized_text_hash: "hash_1",
    now: "2026-06-13T10:05:00.000Z",
  });
  let providerCalls = 0;
  const provider: EmbeddingProviderClient = {
    async embed(request) {
      providerCalls += 1;
      return {
        embedding: Array.from({ length: request.contract.dimensions }, () => 0.5),
        model: request.contract.model,
        dimensions: request.contract.dimensions,
      };
    },
  };
  const vectorStore: SessionMemoryQueryVectorStore = {
    ensure: () => ({ available: true }),
    search: () => [{ memory_id: "mem_decision", distance: 0.12 }],
  };

  const first = await querySessionMemory(db, {
    project_key: "class-kit",
    question: "What did we decide about embeddings?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider,
    limit: 5,
    vector_store: vectorStore,
    now: () => "2026-06-13T10:06:00.000Z",
  });
  const second = await querySessionMemory(db, {
    project_key: "class-kit",
    question: " what   did we decide about EMBEDDINGS? ",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider,
    limit: 5,
    vector_store: vectorStore,
    now: () => "2026-06-13T10:07:00.000Z",
  });

  expect(providerCalls).toBe(1);
  expect(first.query_embedding_cache_hit).toBe(false);
  expect(second.query_embedding_cache_hit).toBe(true);
  expect(second.normalized_question).toBe("what did we decide about embeddings?");
  const cache = db.query("SELECT hit_count, last_used_at FROM query_embedding_cache").get() as {
    hit_count: number;
    last_used_at: string;
  };
  expect(cache).toEqual({ hit_count: 2, last_used_at: "2026-06-13T10:07:00.000Z" });
});

test("degrades when query embedding provider fails on a cache miss", async () => {
  const row = db.query("SELECT id FROM session_memory_embeddings").get() as { id: string };
  markSessionMemoryEmbeddingIndexed(db, {
    id: row.id,
    normalized_text_hash: "hash_1",
    now: "2026-06-13T10:05:00.000Z",
  });

  const result = await querySessionMemory(db, {
    project_key: "class-kit",
    question: "What did we decide about embeddings?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: {
      async embed() {
        throw new Error("provider unavailable");
      },
    },
    limit: 5,
    vector_store: {
      ensure: () => ({ available: true }),
      search: () => {
        throw new Error("search should not run");
      },
    },
  });

  expect(result.degraded).toBe(true);
  expect(result.degraded_reason).toBe("provider unavailable");
  expect(result.matches).toEqual([]);
});

function fixedProvider(): EmbeddingProviderClient {
  return {
    async embed(request) {
      return {
        embedding: Array.from({ length: request.contract.dimensions }, () => 0),
        model: request.contract.model,
        dimensions: request.contract.dimensions,
      };
    },
  };
}
