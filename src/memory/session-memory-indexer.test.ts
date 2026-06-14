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
