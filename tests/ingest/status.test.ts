import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { INGEST_COMPLETION_LAYERS } from "../../src/memory/ingest-types.ts";
import { leaseExperienceEvents, recordExperienceEvent } from "../../src/memory/experience.ts";
import { createIngestJob, updateIngestJobStatus } from "../../src/ingest/jobs.ts";
import { ingestCompletionLabel, readIngestProjectStatus } from "../../src/ingest/status.ts";
import { AuthorityActivationService } from "../../src/session-maintenance/authority-activation-service.ts";
import { createSessionMemory } from "../helpers/session-mutation-authority.ts";

let dir: string;
let db: MemoryDb;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "myelin-ingest-status-"));
  db = openMemoryDbAt(join(dir, "memory.db"));
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

test("ingest completion labels are mapped from numeric enum values", () => {
  expect(ingestCompletionLabel(INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_COMPLETE)).toBe(
    "Experience Log drain complete",
  );
  expect(ingestCompletionLabel(INGEST_COMPLETION_LAYERS.SESSION_MEMORY_RETRIEVAL_PENDING)).toBe(
    "Session Memory retrieval pending",
  );
});

test("project status reports drain pending when rows, leases, or running jobs remain", () => {
  seedExperienceEvent("evt_1");
  seedExperienceEvent("evt_2");
  leaseExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "demo",
    limit: 1,
    claimed_at: "2026-06-15T10:01:00.000Z",
    tombstone_id_for: (event) => `tomb_${event.id}`,
  });
  createIngestJob(db, {
    id: "job_1",
    project_key: "demo",
    provider: "codex",
    input: {},
    now: "2026-06-15T10:00:00.000Z",
  });
  updateIngestJobStatus(db, {
    id: "job_1",
    status: "running",
    updated_at: "2026-06-15T10:01:00.000Z",
  });
  seedSessionMemoryWithEmbedding("mem_1", "pending");

  const status = readIngestProjectStatus(db, "demo");

  expect(status.completion_layer).toBe(INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_PENDING);
  expect(status.completion_label).toBe("Experience Log drain running");
  expect(status.counts).toMatchObject({
    active_events: 2,
    unleased_events: 1,
    leased_events: 1,
    running_jobs: 1,
    pending_session_memory_embeddings: 1,
  });
});

test("project status reports retry pending when failed leases need recovery", () => {
  seedExperienceEvent("evt_1");
  createIngestJob(db, {
    id: "job_1",
    project_key: "demo",
    provider: "codex",
    input: {},
    now: "2026-06-15T10:00:00.000Z",
  });
  leaseExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "demo",
    limit: 1,
    claimed_at: "2026-06-15T10:01:00.000Z",
    tombstone_id_for: (event) => `tomb_${event.id}`,
  });
  updateIngestJobStatus(db, {
    id: "job_1",
    status: "failed",
    updated_at: "2026-06-15T10:02:00.000Z",
  });

  const status = readIngestProjectStatus(db, "demo");

  expect(status.completion_layer).toBe(INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_PENDING);
  expect(status.completion_label).toBe("Experience Log retry pending");
  expect(status.counts).toMatchObject({
    active_events: 1,
    unleased_events: 0,
    leased_events: 1,
    running_jobs: 0,
    failed_jobs: 1,
  });
});

test("project status reports drain complete when no active work and no outputs exist", () => {
  const status = readIngestProjectStatus(db, "demo");

  expect(status.completion_layer).toBe(INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_COMPLETE);
  expect(status.completion_label).toBe("Experience Log drain complete");
  expect(status.counts.active_events).toBe(0);
});

test("active-mode status uses the companion phase and surfaces quarantined legacy work", () => {
  createIngestJob(db, {
    id: "legacy",
    project_key: "demo",
    provider: "codex",
    input: {},
    now: "2026-08-11T10:00:00.000Z",
  });
  new AuthorityActivationService({ now: () => new Date("2026-08-11T10:01:00.000Z") }).activate(db);

  const status = readIngestProjectStatus(db, "demo");

  expect(status).toMatchObject({
    authority_mode: "smc_v1",
    completion_label: "Legacy Session Memory follow-up required",
    counts: {
      running_jobs: 0,
      needs_followup_jobs: 1,
      quarantined_legacy_jobs: 1,
    },
  });
});

test("project status reports retrieval pending when output exists with pending embeddings", () => {
  seedSessionMemoryWithEmbedding("mem_1", "failed");

  const status = readIngestProjectStatus(db, "demo");

  expect(status.completion_layer).toBe(INGEST_COMPLETION_LAYERS.SESSION_MEMORY_RETRIEVAL_PENDING);
  expect(status.counts.session_memories).toBe(1);
  expect(status.counts.pending_session_memory_embeddings).toBe(1);
});

test("project status reports write complete when output exists with no pending embeddings", () => {
  seedSessionMemoryWithEmbedding("mem_1", "indexed");

  const status = readIngestProjectStatus(db, "demo");

  expect(status.completion_layer).toBe(INGEST_COMPLETION_LAYERS.SESSION_MEMORY_WRITE_COMPLETE);
  expect(status.completion_label).toBe("Session Memory write complete");
  expect(status.counts.session_memories).toBe(1);
  expect(status.counts.pending_session_memory_embeddings).toBe(0);
});

test("project status treats an active memory as retrievable when any embedding contract is indexed", () => {
  seedSessionMemoryWithEmbedding("mem_1", "pending");
  db.query(
    `INSERT INTO session_memory_embeddings
      (id, session_memory_id, project_key, embedding_provider, embedding_model, embedding_dimensions,
       embedding_purpose, format_version, status, retry_count, created_at, updated_at, indexed_at)
     VALUES ('emb_ollama_mem_1', 'mem_1', 'demo', 'ollama', 'qwen3-embedding:4b', 1536,
       'retrieval_document', 1, 'indexed', 0, ?, ?, ?)`,
  ).run(
    "2026-06-15T10:05:00.000Z",
    "2026-06-15T10:05:00.000Z",
    "2026-06-15T10:05:00.000Z",
  );

  const status = readIngestProjectStatus(db, "demo");

  expect(status.completion_layer).toBe(INGEST_COMPLETION_LAYERS.SESSION_MEMORY_WRITE_COMPLETE);
  expect(status.counts.pending_session_memory_embeddings).toBe(0);
});

function seedExperienceEvent(id: string): void {
  recordExperienceEvent(db, {
    id,
    project_key: "demo",
    occurred_at: `2026-06-15T10:00:${id.slice(-1).padStart(2, "0")}.000Z`,
    event_kind: "user.prompt",
    provider: "codex",
    raw_text: `content ${id}`,
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid",
  });
}

function seedSessionMemoryWithEmbedding(id: string, embeddingStatus: "pending" | "indexed" | "failed"): void {
  createSessionMemory(db, {
    id,
    project_key: "demo",
    provider: "codex",
    source_event_refs: [],
    memory_kind: "continuity",
    summary: "Useful continuity.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-15T10:00:00.000Z",
    embedding_contract: null,
  });
  db.query(
    `INSERT INTO session_memory_embeddings
      (id, session_memory_id, project_key, embedding_provider, embedding_model, embedding_dimensions,
       embedding_purpose, format_version, status, retry_count, created_at, updated_at)
     VALUES (?, ?, 'demo', 'gemini', 'gemini-embedding-2', 1536, 'retrieval_document', 1, ?, 0, ?, ?)`,
  ).run(
    `emb_${id}`,
    id,
    embeddingStatus,
    "2026-06-15T10:00:00.000Z",
    "2026-06-15T10:00:00.000Z",
  );
}
