import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { listSessionMemories } from "../../src/memory/session-memories.ts";
import { createSessionMemory } from "../helpers/session-mutation-authority.ts";
import { sessionMemoryEmbeddingId } from "../../src/memory/session-memory-embeddings.ts";
import { createIngestJob, updateIngestJobStatus } from "../../src/ingest/jobs.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
});

afterEach(() => {
  db.close();
});

test("creates trusted session memory separate from manual session tables", () => {
  createIngestJob(db, {
    id: "job_1",
    project_key: "class-kit",
    provider: "codex",
    input: {},
    now: "2026-06-13T09:59:00.000Z",
  });
  updateIngestJobStatus(db, {
    id: "job_1",
    status: "running",
    started_at: "2026-06-13T09:59:00.000Z",
    updated_at: "2026-06-13T09:59:00.000Z",
  });

  const row = createSessionMemory(db, {
    id: "mem_1",
    project_key: "class-kit",
    provider: "codex",
    ingest_job_id: "job_1",
    source_event_refs: ["tomb_1"],
    memory_kind: "decision",
    summary: "Decided to keep auth open for local demo.",
    payload: { source: "ingest" },
    confidence: "high",
    risk: "low",
    now: "2026-06-13T10:00:00.000Z",
  });

  expect(row.id).toBe("mem_1");
  expect(row.provider).toBe("codex");
  expect(row.ingest_job_id).toBe("job_1");
  expect(row.revision).toBe(1);
  expect(row.state_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(JSON.parse(row.source_event_refs_json)).toEqual(["tomb_1"]);
  expect(listSessionMemories(db, "class-kit").map((item) => item.id)).toEqual(["mem_1"]);

  const embedding = db.query("SELECT * FROM session_memory_embeddings WHERE session_memory_id = ?").get("mem_1") as {
    id: string;
    status: string;
    embedding_model: string;
    embedding_dimensions: number;
  };
  expect(embedding).toMatchObject({
    id: sessionMemoryEmbeddingId({
      session_memory_id: "mem_1",
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    }),
    status: "pending",
    embedding_model: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.model,
    embedding_dimensions: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.dimensions,
  });
});

test("can create session memory without queuing embedding metadata", () => {
  createSessionMemory(db, {
    id: "mem_no_embedding",
    project_key: "class-kit",
    source_event_refs: [],
    memory_kind: "continuity",
    summary: "A memory reserved for explicit non-indexed writes.",
    payload: {},
    confidence: "medium",
    risk: "low",
    now: "2026-06-13T10:00:00.000Z",
    embedding_contract: null,
  });

  const count = db.query("SELECT count(*) AS n FROM session_memory_embeddings").get() as { n: number };
  expect(count.n).toBe(0);
});
