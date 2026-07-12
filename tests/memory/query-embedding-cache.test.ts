import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import type { EmbeddingProviderClient } from "../../src/memory/embedding-types.ts";
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
  const providerTexts: string[] = [];
  const provider: EmbeddingProviderClient = {
    async embed(request) {
      providerCalls += 1;
      providerTexts.push(request.text);
      return { embedding: [0.1, 0.2, 0.3], model: contract.model, dimensions: contract.dimensions };
    },
    async embedBatch(requests) {
      return Promise.all(requests.map((request) => this.embed(request)));
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
  expect(providerTexts).toEqual(["what did we decide?"]);
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
    async embedBatch(requests) {
      return Promise.all(requests.map((request) => this.embed(request)));
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
  expect(normalizeQueryQuestion("ＡＢＣ")).toBe("abc");
});

test("query embedding cache rejects malformed cached vectors", async () => {
  const contract = {
    ...DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    purpose: "retrieval_query" as const,
    dimensions: 3,
  };
  const provider: EmbeddingProviderClient = {
    async embed() {
      return { embedding: [0.1, 0.2, 0.3], model: contract.model, dimensions: 3 };
    },
    async embedBatch(requests) {
      return Promise.all(requests.map((request) => this.embed(request)));
    },
  };
  await getOrCreateQueryEmbedding(db, {
    project_key: "class-kit",
    question: "What changed?",
    contract,
    provider,
  });
  db.query("UPDATE query_embedding_cache SET embedding_json = ?").run(JSON.stringify([0.1, "0.2", 0.3]));

  await expect(getOrCreateQueryEmbedding(db, {
    project_key: "class-kit",
    question: "WHAT CHANGED?",
    contract,
    provider,
  })).rejects.toThrow("finite numbers");
});
