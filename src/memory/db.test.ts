import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt } from "./db.ts";

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
  expect(applied.map((r) => r.version)).toEqual([1, 2, 3]);
  db.close();
});

test("migrations are idempotent across re-opens", () => {
  const path = join(dir, "memory.db");
  openMemoryDbAt(path).close();
  const db = openMemoryDbAt(path);
  const count = db.query("SELECT count(*) AS n FROM schema_migrations").get() as { n: number };
  expect(count.n).toBe(3);
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
