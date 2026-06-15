import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../runtime/config.ts";
import type { EmbeddingProviderClient } from "./embedding-provider.ts";
import { openMemoryDbAt, type MemoryDb } from "./db.ts";
import { indexSessionMemories, type SessionMemoryVectorStore } from "./session-memory-indexer.ts";
import { createSessionMemory } from "./session-memories.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  createSessionMemory(db, {
    id: "mem_1",
    project_key: "class-kit",
    source_event_refs: ["tomb_1"],
    memory_kind: "decision",
    title: "Auth mode",
    summary: "Keep local auth open.",
    payload: { decision: "open auth", raw_transcript: "do not embed" },
    confidence: "high",
    risk: "low",
    now: "2026-06-13T10:00:00.000Z",
  });
});

afterEach(() => {
  db.close();
});

test("indexes pending session memories with normalized text and vector upsert", async () => {
  const embeddedTexts: string[] = [];
  const upserts: unknown[] = [];
  const provider: EmbeddingProviderClient = {
    async embed(request) {
      embeddedTexts.push(request.text);
      return {
        embedding: Array.from({ length: request.contract.dimensions }, (_, index) => index / 1000),
        model: request.contract.model,
        dimensions: request.contract.dimensions,
      };
    },
  };
  const vectorStore: SessionMemoryVectorStore = {
    ensure: () => ({ available: true }),
    upsert: (_db, input) => {
      upserts.push(input);
    },
  };

  const result = await indexSessionMemories(db, {
    project_key: "class-kit",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider,
    limit: 10,
    now: () => "2026-06-13T10:05:00.000Z",
    vector_store: vectorStore,
  });

  expect(result).toMatchObject({
    selected: 1,
    indexed: 1,
    failed: 0,
    degraded: false,
  });
  expect(embeddedTexts[0]).toContain("summary: Keep local auth open.");
  expect(embeddedTexts[0]).toContain("decision: open auth");
  expect(embeddedTexts[0]).not.toContain("raw_transcript");
  expect(upserts).toHaveLength(1);

  const row = db.query("SELECT status, normalized_text_hash, indexed_at FROM session_memory_embeddings").get() as {
    status: string;
    normalized_text_hash: string | null;
    indexed_at: string | null;
  };
  expect(row.status).toBe("indexed");
  expect(row.normalized_text_hash).toBeTruthy();
  expect(row.indexed_at).toBe("2026-06-13T10:05:00.000Z");
});

test("indexes session memories in provider batches mapped by row order", async () => {
  const contract = { ...DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT, model: "test-embedding", dimensions: 3 };
  for (let index = 1; index <= 4; index += 1) {
    createSessionMemory(db, {
      id: `batch_mem_${index}`,
      project_key: "class-kit",
      source_event_refs: [`batch_tomb_${index}`],
      memory_kind: "continuity",
      title: `Batch ${index}`,
      summary: `Batch summary ${index}.`,
      payload: { index },
      confidence: "high",
      risk: "low",
      now: `2026-06-13T10:00:0${index}.000Z`,
      embedding_contract: contract,
    });
  }

  const batches: string[][] = [];
  const upserts: Array<{ memory_id: string; embedding: number[] }> = [];
  const provider: EmbeddingProviderClient = {
    async embed() {
      throw new Error("single embed should not be called for two-row chunks");
    },
    async embedBatch(requests) {
      batches.push(requests.map((request) => request.title ?? ""));
      return requests.map((request, index) => ({
        embedding: [index, index + 0.1, index + 0.2],
        model: request.contract.model,
        dimensions: request.contract.dimensions,
      }));
    },
  };

  const result = await indexSessionMemories(db, {
    project_key: "class-kit",
    contract,
    provider,
    limit: 10,
    batch_size: 2,
    now: () => "2026-06-13T10:05:00.000Z",
    vector_store: {
      ensure: () => ({ available: true }),
      upsert: (_db, input) => {
        upserts.push({ memory_id: input.memory_id, embedding: input.embedding });
      },
    },
  });

  expect(result).toMatchObject({
    selected: 4,
    indexed: 4,
    failed: 0,
    batch_size: 2,
  });
  expect(batches).toEqual([
    ["Batch 1", "Batch 2"],
    ["Batch 3", "Batch 4"],
  ]);
  expect(upserts.map((input) => input.memory_id)).toEqual(["batch_mem_1", "batch_mem_2", "batch_mem_3", "batch_mem_4"]);
});

test("marks a failed provider batch retryable without deleting pending rows", async () => {
  const contract = { ...DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT, model: "test-embedding", dimensions: 3 };
  for (let index = 1; index <= 2; index += 1) {
    createSessionMemory(db, {
      id: `failed_batch_mem_${index}`,
      project_key: "class-kit",
      source_event_refs: [`failed_batch_tomb_${index}`],
      memory_kind: "continuity",
      summary: `Failed batch summary ${index}.`,
      payload: {},
      confidence: "high",
      risk: "low",
      now: `2026-06-13T10:00:0${index}.000Z`,
      embedding_contract: contract,
    });
  }

  const result = await indexSessionMemories(db, {
    project_key: "class-kit",
    contract,
    provider: {
      async embed() {
        throw new Error("single embed should not be called for two-row chunks");
      },
      async embedBatch() {
        throw new Error("provider batch unavailable");
      },
    },
    limit: 10,
    batch_size: 2,
    now: () => "2026-06-13T10:05:00.000Z",
    vector_store: {
      ensure: () => ({ available: true }),
      upsert: () => {
        throw new Error("upsert should not be called");
      },
    },
  });

  expect(result).toMatchObject({
    selected: 2,
    indexed: 0,
    failed: 2,
    degraded: true,
  });
  expect(result.failures.map((failure) => failure.reason)).toEqual([
    "provider batch unavailable",
    "provider batch unavailable",
  ]);
  const rows = db
    .query(
      `SELECT status, retry_count, failure_reason
       FROM session_memory_embeddings
       WHERE embedding_model = ?
       ORDER BY session_memory_id`,
    )
    .all(contract.model) as Array<{ status: string; retry_count: number; failure_reason: string | null }>;
  expect(rows).toEqual([
    { status: "failed", retry_count: 1, failure_reason: "provider batch unavailable" },
    { status: "failed", retry_count: 1, failure_reason: "provider batch unavailable" },
  ]);
});

test("marks selected rows failed when sqlite-vec is unavailable", async () => {
  const result = await indexSessionMemories(db, {
    project_key: "class-kit",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: {
      async embed() {
        throw new Error("provider should not be called");
      },
    },
    limit: 10,
    now: () => "2026-06-13T10:05:00.000Z",
    vector_store: {
      ensure: () => ({ available: false, reason: "extension loading disabled" }),
      upsert: () => {
        throw new Error("upsert should not be called");
      },
    },
  });

  expect(result.degraded).toBe(true);
  expect(result.failed).toBe(1);
  expect(result.failures[0].reason).toContain("sqlite-vec unavailable");
  const row = db.query("SELECT status, failure_reason, retry_count FROM session_memory_embeddings").get() as {
    status: string;
    failure_reason: string | null;
    retry_count: number;
  };
  expect(row.status).toBe("failed");
  expect(row.retry_count).toBe(1);
  expect(row.failure_reason).toContain("extension loading disabled");
});
