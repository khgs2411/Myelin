import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import type { EmbeddingProviderClient } from "../../src/memory/embedding-provider.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { getOrCreateQueryEmbedding, normalizeQueryQuestion } from "../../src/memory/query-embedding-cache.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
});

afterEach(() => {
  db.close();
});

test("query embedding cache normalizes questions and avoids repeat provider calls", async () => {
  const contract = { ...DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT, purpose: "retrieval_query" as const, dimensions: 3 };
  let providerCalls = 0;
  const provider: EmbeddingProviderClient = {
    async embed() {
      providerCalls += 1;
      return { embedding: [0.1, 0.2, 0.3], model: contract.model, dimensions: contract.dimensions };
    },
  };

  const first = await getOrCreateQueryEmbedding(db, {
    project_key: "class-kit",
    question: "  What did we decide?  ",
    contract,
    provider,
    now: () => "2026-06-15T10:00:00.000Z",
  });
  const second = await getOrCreateQueryEmbedding(db, {
    project_key: "class-kit",
    question: "WHAT   did we decide?",
    contract,
    provider,
    now: () => "2026-06-15T10:05:00.000Z",
  });

  expect(providerCalls).toBe(1);
  expect(first.cache_hit).toBe(false);
  expect(second.cache_hit).toBe(true);
  expect(second.embedding).toEqual([0.1, 0.2, 0.3]);
  expect(second.normalized_question).toBe("what did we decide?");
  const row = db.query("SELECT hit_count, last_used_at FROM query_embedding_cache").get() as {
    hit_count: number;
    last_used_at: string;
  };
  expect(row).toEqual({ hit_count: 2, last_used_at: "2026-06-15T10:05:00.000Z" });
});

test("query embedding cache is isolated by embedding contract", async () => {
  const base = { ...DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT, purpose: "retrieval_query" as const, dimensions: 3 };
  const models: string[] = [];
  const provider: EmbeddingProviderClient = {
    async embed(request) {
      models.push(request.contract.model);
      return { embedding: [0.1, 0.2, 0.3], model: request.contract.model, dimensions: request.contract.dimensions };
    },
  };

  await getOrCreateQueryEmbedding(db, {
    project_key: "class-kit",
    question: "What changed?",
    contract: { ...base, model: "model-a" },
    provider,
  });
  await getOrCreateQueryEmbedding(db, {
    project_key: "class-kit",
    question: "What changed?",
    contract: { ...base, model: "model-b" },
    provider,
  });

  expect(models).toEqual(["model-a", "model-b"]);
  const count = db.query("SELECT count(*) AS n FROM query_embedding_cache").get() as { n: number };
  expect(count.n).toBe(2);
});

test("normalizeQueryQuestion trims collapses whitespace and lowercases", () => {
  expect(normalizeQueryQuestion("  What\nDid\tWe   Decide? ")).toBe("what did we decide?");
});
