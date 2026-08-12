import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import type { EmbeddingProviderClient } from "../../src/memory/embedding-types.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  requestPendingSessionMemoryIndexing,
  SessionMemoryIndexService,
} from "../../src/memory/session-memory-index-service.ts";
import { createSessionMemory } from "../helpers/session-mutation-authority.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  createSessionMemory(db, {
    id: "mem_service_1",
    project_key: "demo",
    source_event_refs: ["tomb_1"],
    memory_kind: "decision",
    summary: "Index through service boundary.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-15T10:00:00.000Z",
  });
});

afterEach(() => {
  db.close();
});

test("SessionMemoryIndexService delegates pending indexing workflow", async () => {
  const upserts: string[] = [];
  const service = new SessionMemoryIndexService({
    db,
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: fixedProvider(),
    vectorStore: {
      ensure: () => ({ available: true }),
      upsert: (_db, input) => {
        upserts.push(input.memory_id);
      },
    },
  });

  const result = await service.indexPending({
    projectKey: "demo",
    limit: 5,
    batchSize: 5,
    retryFailed: false,
  });

  expect(result).toMatchObject({
    project_key: "demo",
    selected: 1,
    indexed: 1,
    failed: 0,
    degraded: false,
  });
  expect(upserts).toEqual(["mem_service_1"]);
});

test("pending indexing request delegates retry-safe scheduling and does no work without pending rows", async () => {
  const scheduled: string[] = [];
  expect(await requestPendingSessionMemoryIndexing({
    db,
    projectKey: "demo",
    schedule: (projectKey) => { scheduled.push(projectKey); },
  })).toEqual({ kind: "requested", pending: 1 });
  expect(await requestPendingSessionMemoryIndexing({
    db,
    projectKey: "demo",
    schedule: (projectKey) => { scheduled.push(projectKey); },
  })).toEqual({ kind: "requested", pending: 1 });
  expect(scheduled).toEqual(["demo", "demo"]);

  db.query("UPDATE session_memory_embeddings SET status = 'indexed', normalized_text_hash = 'sha256:test'").run();
  expect(await requestPendingSessionMemoryIndexing({
    db,
    projectKey: "demo",
    schedule: (projectKey) => { scheduled.push(projectKey); },
  })).toEqual({ kind: "no_work", pending: 0 });
  expect(scheduled).toEqual(["demo", "demo"]);
});

function fixedProvider(): EmbeddingProviderClient {
  return {
    async embed(request) {
      return {
        embedding: Array.from({ length: request.contract.dimensions }, () => 0.1),
        model: request.contract.model,
        dimensions: request.contract.dimensions,
      };
    },
    async embedBatch(requests) {
      return Promise.all(requests.map((request) => this.embed(request)));
    },
  };
}
