import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../runtime/config.ts";
import type { EmbeddingProviderClient } from "./embedding-provider.ts";
import { openMemoryDbAt, type MemoryDb } from "./db.ts";
import { markSessionMemoryEmbeddingIndexed } from "./session-memory-embeddings.ts";
import { querySessionMemory, type SessionMemoryQueryVectorStore } from "./session-memory-query.ts";
import { createSessionMemory } from "./session-memories.ts";

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
  expect(result.matches[0]).toMatchObject({
    id: "mem_decision",
    memory_kind: "decision",
    summary: "Session memories need vector embeddings before briefing reads.",
    distance: 0.12,
  });
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
