import { test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt } from "./db.ts";
import { claimExperienceEvents } from "./experience.ts";

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
  expect(names).toContain("schema_migrations");
  const applied = db.query("SELECT version FROM schema_migrations").all() as { version: number }[];
  expect(applied.map((r) => r.version)).toEqual([1, 2, 3, 4]);
  db.close();
});

test("migrations are idempotent across re-opens", () => {
  const path = join(dir, "memory.db");
  openMemoryDbAt(path).close();
  const db = openMemoryDbAt(path);
  const count = db.query("SELECT count(*) AS n FROM schema_migrations").get() as { n: number };
  expect(count.n).toBe(4);
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
