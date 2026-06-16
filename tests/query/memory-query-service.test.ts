import { expect, test } from "bun:test";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import type { EmbeddingProviderClient } from "../../src/memory/embedding-provider.ts";
import { MemoryQueryService } from "../../src/query/memory-query-service.ts";

test("MemoryQueryService delegates retrieval and builds deterministic query response", async () => {
  const db = openMemoryDbAt(":memory:");
  try {
    const service = new MemoryQueryService({
      db,
      documentContract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      embeddingProvider: fixedProvider(),
      async sessionMemoryQuery(_db, input) {
        return {
          project_key: input.project_key,
          question: input.question,
          degraded: false,
          indexed_count: 2,
          pending_count: 0,
          query_embedding_cache_hit: true,
          query_embedding_cache_id: "qemb_1",
          normalized_question: "what changed?",
          source_tools: ["query-embedding-cache", "session-memory-vector-index"],
          matches: [
            {
              id: "mem_1",
              memory_kind: "decision",
              title: "Boundary",
              summary: "Query logic belongs behind a service boundary.",
              payload: {},
              source_event_refs: ["tomb_1"],
              created_at: "2026-06-15T10:00:00.000Z",
              updated_at: "2026-06-15T10:00:00.000Z",
              distance: 0.2,
            },
          ],
        };
      },
    });

    const response = await service.query({
      projectKey: "demo",
      question: "What changed?",
      includeRoute: true,
    });

    expect(response).toMatchObject({
      answer: "mem_1 [decision] Boundary: Query logic belongs behind a service boundary.",
      confidence: 0.8,
      memory_scope: "session_memory",
      citations: ["session_memory:mem_1"],
      degraded: false,
      source_tools: ["query-embedding-cache", "session-memory-vector-index"],
    });
    expect(response.layers?.[0]).toMatchObject({
      layer: "session_memory",
      indexed_count: 2,
      pending_count: 0,
      query_embedding_cache_hit: true,
      query_embedding_cache_id: "qemb_1",
      normalized_question: "what changed?",
    });
  } finally {
    db.close();
  }
});

test("MemoryQueryService turns retrieval exceptions into degraded responses", async () => {
  const db = openMemoryDbAt(":memory:");
  try {
    const service = new MemoryQueryService({
      db,
      documentContract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      embeddingProvider: fixedProvider(),
      async sessionMemoryQuery() {
        throw new Error("retrieval failed");
      },
    });

    const response = await service.query({ projectKey: "demo", question: "What changed?" });

    expect(response).toMatchObject({
      answer: "retrieval failed",
      confidence: 0,
      memory_scope: "none",
      degraded: true,
      degraded_reason: "retrieval failed",
      matches: [],
    });
  } finally {
    db.close();
  }
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
