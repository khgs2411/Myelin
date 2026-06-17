import { test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import { claimExperienceEvents } from "../../src/memory/experience.ts";
import { sessionMemoryEmbeddingId } from "../../src/memory/session-memory-embeddings.ts";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "myelin-db-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("opening creates the session schema and records the migration", () => {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
  const names = tables.map((t) => t.name);
  expect(names).toContain("sessions");
  expect(names).toContain("session_events");
  expect(names).toContain("experience_events");
  expect(names).toContain("hook_errors");
  expect(names).toContain("experience_event_tombstones");
  expect(names).toContain("session_memory_embeddings");
  expect(names).toContain("session_memory_contexts");
  expect(names).toContain("query_embedding_cache");
  expect(names).toContain("schema_migrations");
  const applied = db.query("SELECT version FROM schema_migrations").all() as { version: number }[];
  expect(applied.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  db.close();
});

test("migrations are idempotent across re-opens", () => {
  const path = join(dir, "memory.db");
  openMemoryDbAt(path).close();
  const db = openMemoryDbAt(path);
  const count = db.query("SELECT count(*) AS n FROM schema_migrations").get() as { n: number };
  expect(count.n).toBe(8);
  db.close();
});

test("opening creates ingest, session memory, candidate, handoff, and tombstone schema", () => {
  const db = openMemoryDbAt(":memory:");
  try {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{
      name: string;
    }>;
    const tableNames = tables.map((row) => row.name);
    expect(tableNames).toContain("ingest_jobs");
    expect(tableNames).toContain("session_memories");
    expect(tableNames).toContain("memory_candidates");
    expect(tableNames).toContain("project_handoff_instructions");
    expect(tableNames).toContain("practice_handoff_instructions");
    expect(tableNames).toContain("personal_handoff_instructions");
    expect(tableNames).toContain("session_memory_embeddings");
    expect(tableNames).toContain("session_memory_contexts");
    expect(tableNames).toContain("session_memory_links");
    expect(tableNames).toContain("query_embedding_cache");

    const experienceColumns = db.query("PRAGMA table_info(experience_events)").all() as Array<{ name: string }>;
    expect(experienceColumns.map((column) => column.name)).toContain("git_branch");
    const sessionMemoryColumns = db.query("PRAGMA table_info(session_memories)").all() as Array<{ name: string }>;
    expect(sessionMemoryColumns.map((column) => column.name)).toContain("status");
    expect(sessionMemoryColumns.map((column) => column.name)).toContain("superseded_by");

    const tombstoneColumns = db.query("PRAGMA table_info(experience_event_tombstones)").all() as Array<{
      name: string;
    }>;
    expect(tombstoneColumns.map((column) => column.name)).toEqual([
      "id",
      "original_event_id",
      "dedupe_key",
      "project_key",
      "ingest_job_id",
      "provider",
      "provider_session_id",
      "claimed_at",
      "finalized_at",
      "state",
      "terminal_decision",
      "source_metadata_json",
      "retained_evidence_json",
      "output_references_json",
    ]);
  } finally {
    db.close();
  }
});

test("migrations backfill pending session memory embeddings from a version 4 database", () => {
  const path = join(dir, "memory.db");
  const oldDb = new Database(path);
  oldDb.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations (version, applied_at) VALUES
      (1, '2026-06-12T00:00:00.000Z'),
      (2, '2026-06-12T00:00:00.000Z'),
      (3, '2026-06-12T00:00:00.000Z'),
      (4, '2026-06-12T00:00:00.000Z');

    CREATE TABLE ingest_jobs (
      id                  TEXT PRIMARY KEY,
      project_key         TEXT NOT NULL,
      status              TEXT NOT NULL CHECK (status IN ('starting', 'running', 'needs_followup', 'completed', 'failed')),
      provider            TEXT NOT NULL,
      provider_session_id TEXT,
      requested_by        TEXT,
      input_json          TEXT NOT NULL,
      output_counts_json  TEXT NOT NULL,
      terminal_summary    TEXT,
      error_json          TEXT,
      followup_state_json TEXT,
      started_at          TEXT,
      finished_at         TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );
    CREATE TABLE session_memories (
      id                    TEXT PRIMARY KEY,
      project_key            TEXT NOT NULL,
      provider               TEXT,
      provider_session_id    TEXT,
      ingest_job_id          TEXT REFERENCES ingest_jobs(id),
      source_event_refs_json TEXT NOT NULL,
      memory_kind            TEXT NOT NULL CHECK (memory_kind IN ('continuity', 'decision', 'blocker', 'next_action', 'verification')),
      title                  TEXT,
      summary                TEXT NOT NULL,
      payload_json           TEXT NOT NULL,
      confidence             TEXT NOT NULL,
      risk                   TEXT NOT NULL,
      created_at             TEXT NOT NULL,
      updated_at             TEXT NOT NULL
    );
    INSERT INTO session_memories
      (id, project_key, source_event_refs_json, memory_kind, summary, payload_json, confidence, risk, created_at, updated_at)
    VALUES
      ('mem_old', 'class-kit', '[]', 'continuity', 'A prior memory', '{}', 'high', 'low',
       '2026-06-12T10:00:00.000Z', '2026-06-12T10:00:00.000Z');
  `);
  oldDb.close();

  const db = openMemoryDbAt(path);
  try {
    const embeddingId = sessionMemoryEmbeddingId({
      session_memory_id: "mem_old",
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    });
    const row = db.query("SELECT * FROM session_memory_embeddings WHERE id = ?").get(embeddingId) as {
      session_memory_id: string;
      project_key: string;
      embedding_provider: string;
      embedding_model: string;
      embedding_dimensions: number;
      embedding_purpose: string;
      format_version: number;
      status: string;
      retry_count: number;
      created_at: string;
      updated_at: string;
    };
    expect(row).toMatchObject({
      session_memory_id: "mem_old",
      project_key: "class-kit",
      embedding_provider: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.provider,
      embedding_model: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.model,
      embedding_dimensions: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.dimensions,
      embedding_purpose: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.purpose,
      format_version: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.formatVersion,
      status: "pending",
      retry_count: 0,
    });
    expect(row.created_at).toEqual(row.updated_at);
  } finally {
    db.close();
  }
});

test("foreign keys are enforced on the connection", () => {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  const fk = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
  expect(fk.foreign_keys).toBe(1);
  db.close();
});

test("migrations upgrade old terminal tombstones without losing rows", () => {
  const path = join(dir, "memory.db");
  const oldDb = new Database(path);
  oldDb.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations (version, applied_at) VALUES
      (1, '2026-06-12T00:00:00.000Z'),
      (2, '2026-06-12T00:00:00.000Z'),
      (3, '2026-06-12T00:00:00.000Z');

    CREATE TABLE experience_events (
      id                  TEXT PRIMARY KEY,
      project_key         TEXT NOT NULL,
      occurred_at         TEXT NOT NULL,
      hook_event_name     TEXT,
      event_kind          TEXT,
      cwd                 TEXT,
      provider            TEXT NOT NULL,
      provider_session_id TEXT,
      turn_id             TEXT,
      raw_text            TEXT,
      raw_payload_json    TEXT NOT NULL,
      source              TEXT NOT NULL,
      status              TEXT NOT NULL CHECK (status IN ('valid', 'invalid')),
      dedupe_key          TEXT,
      inserted_at         TEXT NOT NULL
    );
    CREATE TABLE experience_event_tombstones (
      id                     TEXT PRIMARY KEY,
      original_event_id      TEXT NOT NULL,
      dedupe_key             TEXT,
      project_key            TEXT NOT NULL,
      processed_at           TEXT NOT NULL,
      terminal_decision      TEXT,
      output_references_json TEXT NOT NULL
    );
    INSERT INTO experience_event_tombstones
      (id, original_event_id, dedupe_key, project_key, processed_at, terminal_decision, output_references_json)
    VALUES
      ('tomb_old', 'evt_old', 'codex:sess_old:turn_old', 'class-kit', '2026-06-12T10:05:00.000Z',
       'session_memory', '["session_memories/mem_old"]');
    INSERT INTO experience_events
      (id, project_key, occurred_at, provider, provider_session_id, turn_id, raw_text, raw_payload_json, source,
       status, dedupe_key, inserted_at)
    VALUES
      ('evt_new', 'class-kit', '2026-06-12T11:00:00.000Z', 'codex', 'sess_new', 'turn_new', 'remember this',
       '{}', 'codex-hook', 'valid', 'codex:sess_new:turn_new', '2026-06-12T11:00:00.000Z');
  `);
  oldDb.close();

  const db = openMemoryDbAt(path);
  try {
    const tombstoneColumns = db.query("PRAGMA table_info(experience_event_tombstones)").all() as Array<{
      name: string;
    }>;
    expect(tombstoneColumns.map((column) => column.name)).toContain("ingest_job_id");
    expect(tombstoneColumns.map((column) => column.name)).toContain("retained_evidence_json");

    const oldTombstone = db
      .query(
        `SELECT original_event_id, ingest_job_id, claimed_at, finalized_at, state, terminal_decision,
                source_metadata_json, retained_evidence_json, output_references_json
         FROM experience_event_tombstones
         WHERE id = ?`,
      )
      .get("tomb_old") as {
      original_event_id: string;
      ingest_job_id: string;
      claimed_at: string;
      finalized_at: string;
      state: string;
      terminal_decision: string;
      source_metadata_json: string;
      retained_evidence_json: string;
      output_references_json: string;
    };
    expect(oldTombstone).toEqual({
      original_event_id: "evt_old",
      ingest_job_id: "legacy-terminal",
      claimed_at: "2026-06-12T10:05:00.000Z",
      finalized_at: "2026-06-12T10:05:00.000Z",
      state: "output",
      terminal_decision: "session_memory",
      source_metadata_json: JSON.stringify({
        original_event_id: "evt_old",
        project_key: "class-kit",
        migrated_from: "terminal_tombstone",
      }),
      retained_evidence_json: JSON.stringify({}),
      output_references_json: '["session_memories/mem_old"]',
    });

    const claimed = claimExperienceEvents(db, {
      ingest_job_id: "job_1",
      project_key: "class-kit",
      limit: 1,
      claimed_at: "2026-06-12T11:05:00.000Z",
      tombstone_id_for: (event) => `tomb_${event.id}`,
    });
    expect(claimed.map((row) => row.original_event_id)).toEqual(["evt_new"]);
  } finally {
    db.close();
  }
});
