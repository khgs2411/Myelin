import { expect, test } from "bun:test";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import type { EmbeddingProviderClient } from "../../src/memory/embedding-provider.ts";
import { DeterministicMemoryQueryResponseService, MemoryQueryService } from "../../src/query/memory-query-service.ts";

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
              contexts: [],
              created_at: "2026-06-15T10:00:00.000Z",
              updated_at: "2026-06-15T10:00:00.000Z",
              distance: 0.2,
            },
          ],
        };
      },
    });

    const response = await service.query({
      root: "/repo",
      projectKey: "demo",
      question: "What changed?",
      includeRoute: true,
    });

    expect(response).toMatchObject({
      answer: "mem_1 [decision] Boundary: Query logic belongs behind a service boundary.",
      confidence: 0.7,
      memory_scope: "session_memory",
      citations: ["session_memory:mem_1"],
      degraded: false,
      source_tools: ["query-embedding-cache", "session-memory-vector-index"],
      project_memory_matches: [],
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

test("MemoryQueryService keeps project memory results separate from session matches", async () => {
  const db = openMemoryDbAt(":memory:");
  try {
    const service = new MemoryQueryService({
      db,
      documentContract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      embeddingProvider: fixedProvider(),
      async projectMemoryQuery(_db, input) {
        return {
          project_key: input.project_key,
          question: input.question,
          degraded: false,
          indexed_count: 1,
          pending_count: 0,
          match_count: 1,
          query_embedding_cache_hit: true,
          query_embedding_cache_id: "qemb_project",
          normalized_question: "setup?",
          source_tools: ["query-embedding-cache", "project-memory-vector-index", "project-memory-markdown-sections"],
          matches: [
            {
              retrieval_row_id: "pmr_1",
              wiki_path: "wiki/setup/index.md",
              section_id: "setup",
              section_hash: "sha256:setup",
              heading_path: ["Setup"],
              page_title: "Setup",
              distance: 0.1,
              return_kind: "inline_content",
              content: "Setup guidance.",
              citation: "project_memory:wiki/setup/index.md#setup",
              vector_rank: 1,
              fts_rank: 1,
              rerank_reasons: ["section_title_match"],
              query_token_coverage: 1,
              query_phrase_coverage: 1,
            },
          ],
        };
      },
    });

    const response = await service.query({
      root: "/repo",
      projectKey: "demo",
      question: "Setup?",
      layer: "project",
      includeRoute: true,
    });

    expect(response.matches).toEqual([]);
    expect(response.project_memory_matches).toHaveLength(1);
    expect(response.project_memory_matches[0]).toMatchObject({
      wiki_path: "wiki/setup/index.md",
      section_id: "setup",
      return_kind: "inline_content",
      content: "Setup guidance.",
      citation: "project_memory:wiki/setup/index.md#setup",
    });
    expect(response.confidence).toBe(0.9);
    expect(response.layers?.[0]).toMatchObject({
      layer: "project_memory",
      indexed_count: 1,
      match_count: 1,
      query_embedding_cache_id: "qemb_project",
    });
  } finally {
    db.close();
  }
});

test("query confidence is evidence-based instead of treating embedding distance as probability", async () => {
  const db = openMemoryDbAt(":memory:");
  try {
    const query = async (distance: number) => await new MemoryQueryService({
      db,
      documentContract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      embeddingProvider: fixedProvider(),
      async sessionMemoryQuery(_db, input) {
        return {
          project_key: input.project_key,
          question: input.question,
          degraded: false,
          indexed_count: 1,
          pending_count: 0,
          source_tools: ["session-memory-vector-index"],
          matches: [{
            id: "mem_1",
            memory_kind: "verification" as const,
            title: "Verified",
            summary: "The evidence is unchanged.",
            payload: {},
            source_event_refs: ["tomb_1"],
            contexts: [],
            created_at: "2026-07-10T10:00:00.000Z",
            updated_at: "2026-07-10T10:00:00.000Z",
            distance,
          }],
        };
      },
    }).query({ root: "/repo", projectKey: "demo", question: "What is verified?" });

    expect((await query(0.1)).confidence).toBe(0.7);
    expect((await query(0.85)).confidence).toBe(0.7);
  } finally {
    db.close();
  }
});

test("project confidence is capped when the top match has poor query coverage", async () => {
  const db = openMemoryDbAt(":memory:");
  try {
    const response = new DeterministicMemoryQueryResponseService().fromProjectMemoryResult({
      project_key: "demo",
      question: "What does memory review show?",
      degraded: false,
      indexed_count: 1,
      pending_count: 0,
      match_count: 1,
      source_tools: ["project-memory-vector-index"],
      matches: [{
        retrieval_row_id: "pmr_1",
        wiki_path: "wiki/unrelated.md",
        section_id: "unrelated",
        section_hash: "sha256:unrelated",
        heading_path: ["Unrelated"],
        page_title: "Unrelated",
        distance: 0.1,
        return_kind: "inline_content",
        content: "General project notes.",
        citation: "project_memory:wiki/unrelated.md#unrelated",
        vector_rank: 1,
        fts_rank: 1,
        query_token_coverage: 0.25,
        query_phrase_coverage: 0,
      }],
    }, { includeRoute: false });

    expect(response.confidence).toBeLessThanOrEqual(0.55);
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

    const response = await service.query({ root: "/repo", projectKey: "demo", question: "What changed?" });

    expect(response).toMatchObject({
      answer: "retrieval failed",
      confidence: 0,
      memory_scope: "none",
      degraded: true,
      degraded_reason: "retrieval failed",
      matches: [],
      project_memory_matches: [],
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
