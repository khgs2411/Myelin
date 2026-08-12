import { test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import { runMigrations } from "../../src/memory/migrations.ts";
import { claimExperienceEvents } from "../../src/memory/experience.ts";
import { sessionMemoryEmbeddingId } from "../../src/memory/session-memory-embeddings.ts";
import {
  readSessionMemoryCanonicalState,
  sessionMemoryCanonicalStateDigest,
} from "../../src/memory/session-memory-revisions.ts";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "myelin-db-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const MIGRATION_20_TABLES = [
  "smc_manifests",
  "smc_evidence_snapshot",
  "smc_work_batches",
  "smc_evidence_batch_members",
  "smc_audit_batch_members",
  "smc_no_agent_intents",
  "smc_memory_snapshot",
  "smc_memory_snapshot_contexts",
  "smc_memory_snapshot_links",
  "smc_memory_snapshot_search_texts",
  "smc_memory_snapshot_vectors",
  "smc_retrieval_snapshot_completeness",
] as const;

const MIGRATION_21_TABLES = [
  "smc_overlay_state",
  "smc_overlay_revisions",
  "smc_overlay_records",
  "smc_overlay_search_indexes",
  "smc_curator_batch_channel_plans",
  "smc_curator_fetch_receipts",
  "smc_curator_action_charges",
  "smc_action_journal",
  "smc_coverage_receipts",
  "smc_budget_grants",
  "smc_terminal_receipts",
] as const;

const MIGRATION_22_TABLES = ["session_memory_audit_receipts"] as const;

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
  expect(names).toContain("project_memory_retrieval_embeddings");
  expect(names).toContain("retrieval_maintenance_queue");
  expect(names).toContain("project_memory_hint_jobs");
  expect(names).toContain("project_memory_query_logs");
  expect(names).toContain("session_memory_query_logs");
  expect(names).toContain("practice_memory_query_logs");
  expect(names).toContain("personal_memory_query_logs");
  expect(names).toContain("project_memory_section_fts");
  expect(names).toContain("project_session_mutation_fences");
  expect(names).toContain("session_memory_mutation_authority");
  expect(names).toContain("session_embedding_lifecycle_fence");
  expect(names).toContain("session_embedding_lifecycle_receipts");
  expect(names).toContain("session_embedding_lifecycle_generation");
  expect(names).toContain("legacy_session_job_deny_identities");
  expect(names).toContain("session_memory_anchor_jobs");
  expect(names).toContain("session_memory_anchor_attempts");
  for (const table of MIGRATION_20_TABLES) expect(names).toContain(table);
  for (const table of MIGRATION_21_TABLES) expect(names).toContain(table);
  for (const table of MIGRATION_22_TABLES) expect(names).toContain(table);
  expect(names).toContain("schema_migrations");
  const applied = db.query("SELECT version FROM schema_migrations").all() as { version: number }[];
  expect(applied.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  expect(db.query("SELECT mode FROM session_memory_mutation_authority WHERE singleton_id = 1").get())
    .toEqual({ mode: "legacy_compatibility" });
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  db.close();
});

test("migrations are idempotent across re-opens", () => {
  const path = join(dir, "memory.db");
  openMemoryDbAt(path).close();
  const db = openMemoryDbAt(path);
  const count = db.query("SELECT count(*) AS n FROM schema_migrations").get() as { n: number };
  expect(count.n).toBe(24);
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
    expect(tableNames).toContain("project_memory_retrieval_embeddings");
    expect(tableNames).toContain("retrieval_maintenance_queue");
    expect(tableNames).toContain("project_memory_hint_jobs");
    expect(tableNames).toContain("project_memory_query_logs");
    expect(tableNames).toContain("session_memory_query_logs");
    expect(tableNames).toContain("practice_memory_query_logs");
    expect(tableNames).toContain("personal_memory_query_logs");
    expect(tableNames).toContain("project_memory_section_fts");
    expect(tableNames).toContain("project_session_mutation_fences");
    expect(tableNames).toContain("session_memory_mutation_authority");
    expect(tableNames).toContain("session_embedding_lifecycle_fence");
    expect(tableNames).toContain("session_embedding_lifecycle_receipts");
    expect(tableNames).toContain("session_embedding_lifecycle_generation");

    expect(db.query("SELECT mode FROM session_memory_mutation_authority WHERE singleton_id = 1").get())
      .toEqual({ mode: "legacy_compatibility" });

    const experienceColumns = db.query("PRAGMA table_info(experience_events)").all() as Array<{ name: string }>;
    expect(experienceColumns.map((column) => column.name)).toContain("git_branch");
    const sessionMemoryColumns = db.query("PRAGMA table_info(session_memories)").all() as Array<{ name: string }>;
    expect(sessionMemoryColumns.map((column) => column.name)).toContain("status");
    expect(sessionMemoryColumns.map((column) => column.name)).toContain("superseded_by");
    expect(sessionMemoryColumns.map((column) => column.name)).toContain("revision");
    expect(sessionMemoryColumns.map((column) => column.name)).toContain("state_digest");
    const projectQueryLogColumns = db.query("PRAGMA table_info(project_memory_query_logs)").all() as Array<{ name: string }>;
    expect(projectQueryLogColumns.map((column) => column.name)).toContain("answer_text");
    expect(projectQueryLogColumns.map((column) => column.name)).toContain("response_json");
    expect(projectQueryLogColumns.map((column) => column.name)).toContain("eval_json");

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

test("migration 16 backfills populated canonical Session Memory identity and preserves integrity", () => {
  const path = join(dir, "memory.db");
  const oldDb = new Database(path);
  seedVersion15SessionMemorySchema(oldDb, '{"z":2,"a":[3,1]}');
  oldDb.close();

  const db = openMemoryDbAt(path);
  try {
    const row = db.query("SELECT revision, state_digest FROM session_memories WHERE id = 'mem_old'").get() as {
      revision: number;
      state_digest: string;
    };
    expect(row.revision).toBe(1);
    expect(row.state_digest).toBe(
      sessionMemoryCanonicalStateDigest(readSessionMemoryCanonicalState(db, "mem_old")),
    );
    expect(row.state_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(db.query("SELECT version FROM schema_migrations WHERE version = 16").get()).toEqual({ version: 16 });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.query("SELECT count(*) AS count FROM session_memory_contexts").get()).toEqual({ count: 1 });
    expect(db.query("SELECT count(*) AS count FROM session_memory_links").get()).toEqual({ count: 1 });
    expect(db.query(
      "SELECT state FROM session_memory_legacy_write_firewall WHERE singleton_id = 1",
    ).get()).toEqual({ state: "closed" });
    expect(db.query("SELECT count(*) AS count FROM session_memory_write_admissions").get())
      .toEqual({ count: 0 });
    expect((db.query(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'smwf_session_memories_%' ORDER BY name",
    ).all() as Array<{ name: string }>).map((row) => row.name)).toEqual([
      "smwf_session_memories_delete",
      "smwf_session_memories_insert",
      "smwf_session_memories_update",
    ]);
  } finally {
    db.close();
  }
});

test("migration 16 failure leaves version 15 schema authoritative", () => {
  const path = join(dir, "memory.db");
  const oldDb = new Database(path);
  seedVersion15SessionMemorySchema(oldDb, "not-json");
  oldDb.close();

  expect(() => openMemoryDbAt(path)).toThrow("payload_json must contain valid JSON");

  const db = new Database(path);
  try {
    const columns = db.query("PRAGMA table_info(session_memories)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain("revision");
    expect(columns.map((column) => column.name)).not.toContain("state_digest");
    expect(db.query("SELECT version FROM schema_migrations WHERE version = 16").get()).toBeNull();
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'session_memories_v16'").get()).toBeNull();
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'session_memory_legacy_write_firewall'").get()).toBeNull();
    expect(db.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'smwf_%'").get()).toBeNull();
    expect(db.query("SELECT payload_json FROM session_memories WHERE id = 'mem_old'").get()).toEqual({
      payload_json: "not-json",
    });
  } finally {
    db.close();
  }
});

test("migration 17 creates dormant authority without claiming a project fence", () => {
  const path = join(dir, "memory.db");
  const db = openMemoryDbAt(path);
  try {
    expect(db.query("SELECT version FROM schema_migrations WHERE version = 17").get()).toEqual({ version: 17 });
    expect(db.query("SELECT mode FROM session_memory_mutation_authority WHERE singleton_id = 1").get())
      .toEqual({ mode: "legacy_compatibility" });
    expect(db.query("SELECT count(*) AS count FROM project_session_mutation_fences").get())
      .toEqual({ count: 0 });
    expect((db.query(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'smwf_admission_validate_%' ORDER BY name",
    ).all() as Array<{ name: string }>).map((row) => row.name)).toEqual(expect.arrayContaining([
      "smwf_admission_validate_legacy",
      "smwf_admission_validate_project_fence",
    ]));
    expect(() => db.query(
      `INSERT INTO project_session_mutation_fences
        (project_key, owner_id, owner_kind, phase, owner_epoch, heartbeat_at, acquired_at)
       VALUES ('demo', 'owner', 'unbounded_writer', 'running', 1, 'now', 'now')`,
    ).run()).toThrow();
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
  }
});

test("migration 17 failure leaves no version row or partial fence schema", () => {
  const path = join(dir, "memory.db");
  const oldDb = new Database(path);
  oldDb.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations (version, applied_at) VALUES (16, '2026-08-11T00:00:00.000Z');
    CREATE TABLE session_memory_mutation_authority (conflicting_column TEXT);
  `);
  oldDb.close();

  expect(() => openMemoryDbAt(path)).toThrow("already exists");

  const db = new Database(path);
  try {
    expect(db.query("SELECT version FROM schema_migrations WHERE version = 17").get()).toBeNull();
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'project_session_mutation_fences'").get())
      .toBeNull();
    expect(db.query("PRAGMA table_info(session_memory_mutation_authority)").all())
      .toMatchObject([{ name: "conflicting_column" }]);
  } finally {
    db.close();
  }
});

test("migration 18 creates dormant global lifecycle storage without changing authority", () => {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  try {
    expect(db.query("SELECT version FROM schema_migrations WHERE version = 18").get()).toEqual({ version: 18 });
    expect(db.query("SELECT mode FROM session_memory_mutation_authority WHERE singleton_id = 1").get())
      .toEqual({ mode: "legacy_compatibility" });
    expect(db.query("SELECT count(*) AS count FROM session_embedding_lifecycle_fence").get())
      .toEqual({ count: 0 });
    expect(db.query("SELECT count(*) AS count FROM session_embedding_lifecycle_receipts").get())
      .toEqual({ count: 0 });
    expect(db.query(
      "SELECT last_generation, last_receipt_id FROM session_embedding_lifecycle_generation WHERE singleton_id = 1",
    ).get()).toEqual({ last_generation: 0, last_receipt_id: null });
    expect((db.query("PRAGMA table_info(session_embedding_lifecycle_fence)").all() as Array<{ name: string }>)
      .map((column) => column.name)).toEqual(expect.arrayContaining([
        "operation_plan_json",
        "operation_plan_digest",
      ]));
    expect((db.query("PRAGMA table_info(session_embedding_lifecycle_receipts)").all() as Array<{ name: string }>)
      .map((column) => column.name)).toEqual(expect.arrayContaining([
        "operation_plan_json",
        "operation_plan_digest",
      ]));
    expect(db.query(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'smwf_admission_validate_session_embedding_lifecycle'",
    ).get()).toEqual({ name: "smwf_admission_validate_session_embedding_lifecycle" });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
  }
});

test("migration 18 failure leaves no version row or partial global lifecycle schema", () => {
  const path = join(dir, "memory.db");
  const db = openMemoryDbAt(path);
  db.query("DELETE FROM schema_migrations WHERE version = 24").run();
  db.query("DELETE FROM schema_migrations WHERE version = 23").run();
  dropMigration22Tables(db);
  db.query("DELETE FROM schema_migrations WHERE version = 22").run();
  dropMigration21Tables(db);
  db.query("DELETE FROM schema_migrations WHERE version = 21").run();
  dropMigration20Tables(db);
  db.query("DELETE FROM schema_migrations WHERE version = 20").run();
  db.query("DELETE FROM schema_migrations WHERE version = 19").run();
  db.query("DROP TABLE session_memory_anchor_attempts").run();
  db.query("DROP TABLE session_memory_anchor_jobs").run();
  db.query("DELETE FROM schema_migrations WHERE version = 18").run();
  db.query("DROP TABLE session_embedding_lifecycle_receipts").run();
  db.query("DROP TABLE session_embedding_lifecycle_fence").run();
  db.query("DROP TABLE session_embedding_lifecycle_generation").run();
  db.query("CREATE TABLE session_embedding_lifecycle_receipts (conflicting_column TEXT)").run();
  db.close();

  expect(() => openMemoryDbAt(path)).toThrow("already exists");

  const inspected = new Database(path);
  try {
    expect(inspected.query("SELECT version FROM schema_migrations WHERE version = 18").get()).toBeNull();
    expect(inspected.query("SELECT name FROM sqlite_master WHERE name = 'session_embedding_lifecycle_fence'").get())
      .toBeNull();
    expect(inspected.query("SELECT name FROM sqlite_master WHERE name = 'session_embedding_lifecycle_generation'").get())
      .toBeNull();
    expect(inspected.query("PRAGMA table_info(session_embedding_lifecycle_receipts)").all())
      .toMatchObject([{ name: "conflicting_column" }]);
    expect(inspected.query("SELECT mode FROM session_memory_mutation_authority WHERE singleton_id = 1").get())
      .toEqual({ mode: "legacy_compatibility" });
  } finally {
    inspected.close();
  }
});

test("migration 19 apply failure restores the exact version 18 schema", () => {
  const path = join(dir, "memory.db");
  const inspected = new Database(path);
  try {
    inspected.exec("PRAGMA foreign_keys = ON;");
    expect(() => runMigrations(inspected, new Date("2026-08-11T00:00:00.000Z"), {
      beforeMigration(version) {
        if (version === 19) throw new Error("stop_at_version_18");
      },
    })).toThrow("stop_at_version_18");
    const version18Schema = schemaSnapshot(inspected);
    expect((inspected.query("PRAGMA table_info(session_memory_write_admissions)").all() as Array<{ name: string }>)
      .map((column) => column.name)).not.toContain("target_id");

    expect(() => runMigrations(inspected, new Date("2026-08-11T00:01:00.000Z"), {
      afterMigrationApply(version) {
        if (version === 19) throw new Error("injected_after_migration_19_apply");
      },
    })).toThrow("injected_after_migration_19_apply");

    expect(inspected.query("SELECT version FROM schema_migrations WHERE version = 19").get()).toBeNull();
    expect(inspected.query("SELECT name FROM sqlite_master WHERE name = 'session_memory_anchor_jobs'").get()).toBeNull();
    expect(inspected.query("SELECT name FROM sqlite_master WHERE name = 'session_memory_anchor_attempts'").get()).toBeNull();
    expect(inspected.query("SELECT name FROM sqlite_master WHERE name = 'legacy_session_job_deny_identities'").get()).toBeNull();
    expect(inspected.query("SELECT name FROM sqlite_master WHERE name = 'smwf_migrate_legacy_anchor_exact_target'").get()).toBeNull();
    expect((inspected.query("PRAGMA table_info(session_memory_write_admissions)").all() as Array<{ name: string }>)
      .map((column) => column.name)).not.toContain("target_id");
    expect(inspected.query("SELECT mode FROM session_memory_mutation_authority WHERE singleton_id = 1").get())
      .toEqual({ mode: "legacy_compatibility" });
    expect(schemaSnapshot(inspected)).toEqual(version18Schema);
    expect(inspected.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(inspected.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    inspected.close();
  }
});

test("migration 20 creates complete SMC preparation storage and preserves integrity", () => {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  try {
    expect(db.query("SELECT version FROM schema_migrations WHERE version = 20").get()).toEqual({ version: 20 });
    for (const table of MIGRATION_20_TABLES) {
      expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), table)
        .toEqual({ name: table });
    }
    const manifestColumns = db.query("PRAGMA table_info(smc_manifests)").all() as Array<{ name: string }>;
    expect(manifestColumns.map((column) => column.name)).toContain("compatibility_selection_limit");
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
  }
});

test("migration 20 apply failure restores the exact version 19 schema", () => {
  const path = join(dir, "memory.db");
  const inspected = new Database(path);
  try {
    inspected.exec("PRAGMA foreign_keys = ON;");
    expect(() => runMigrations(inspected, new Date("2026-08-11T00:00:00.000Z"), {
      beforeMigration(version) {
        if (version === 20) throw new Error("stop_at_version_19");
      },
    })).toThrow("stop_at_version_19");
    const version19Schema = schemaSnapshot(inspected);

    expect(() => runMigrations(inspected, new Date("2026-08-11T00:01:00.000Z"), {
      afterMigrationApply(version) {
        if (version === 20) throw new Error("injected_after_migration_20_apply");
      },
    })).toThrow("injected_after_migration_20_apply");

    expect(inspected.query("SELECT version FROM schema_migrations WHERE version = 20").get()).toBeNull();
    for (const table of MIGRATION_20_TABLES) {
      expect(inspected.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), table)
        .toBeNull();
    }
    expect(schemaSnapshot(inspected)).toEqual(version19Schema);
    expect(inspected.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(inspected.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    inspected.close();
  }
});

test("migration 21 creates normalized SMC persistence and preserves integrity", () => {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  try {
    expect(db.query("SELECT version FROM schema_migrations WHERE version = 21").get()).toEqual({ version: 21 });
    for (const table of MIGRATION_21_TABLES) {
      expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), table)
        .toEqual({ name: table });
    }
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
  }
});

test("migration 21 apply failure restores the exact version 20 schema", () => {
  const db = new Database(join(dir, "memory.db"));
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    expect(() => runMigrations(db, new Date("2026-08-11T00:00:00.000Z"), {
      beforeMigration(version) {
        if (version === 21) throw new Error("stop_at_version_20");
      },
    })).toThrow("stop_at_version_20");
    const version20Schema = schemaSnapshot(db);

    expect(() => runMigrations(db, new Date("2026-08-11T00:01:00.000Z"), {
      afterMigrationApply(version) {
        if (version === 21) throw new Error("injected_after_migration_21_apply");
      },
    })).toThrow("injected_after_migration_21_apply");

    expect(db.query("SELECT version FROM schema_migrations WHERE version = 21").get()).toBeNull();
    for (const table of MIGRATION_21_TABLES) {
      expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), table)
        .toBeNull();
    }
    expect(schemaSnapshot(db)).toEqual(version20Schema);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
  }
});

test("migration 22 creates immutable per-revision audit receipts and preserves integrity", () => {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  try {
    expect(db.query("SELECT version FROM schema_migrations WHERE version = 22").get()).toEqual({ version: 22 });
    for (const table of MIGRATION_22_TABLES) {
      expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
        .toEqual({ name: table });
    }
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
  }
});

test("migration 22 apply failure restores the exact version 21 schema", () => {
  const db = new Database(join(dir, "memory.db"));
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    expect(() => runMigrations(db, new Date("2026-08-11T00:00:00.000Z"), {
      beforeMigration(version) {
        if (version === 22) throw new Error("stop_at_version_21");
      },
    })).toThrow("stop_at_version_21");
    const version21Schema = schemaSnapshot(db);
    expect(() => runMigrations(db, new Date("2026-08-11T00:01:00.000Z"), {
      afterMigrationApply(version) {
        if (version === 22) throw new Error("injected_after_migration_22_apply");
      },
    })).toThrow("injected_after_migration_22_apply");
    expect(db.query("SELECT version FROM schema_migrations WHERE version = 22").get()).toBeNull();
    for (const table of MIGRATION_22_TABLES) {
      expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toBeNull();
    }
    expect(schemaSnapshot(db)).toEqual(version21Schema);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
  }
});

test("migration 23 charges query allowance per materialization while permitting continuation rows", () => {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  try {
    expect(db.query("SELECT version FROM schema_migrations WHERE version = 23").get()).toEqual({ version: 23 });
    const table = db.query(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'smc_curator_action_charges'",
    ).get() as { sql: string };
    expect(table.sql).toContain("query_count IN (0, 1)");
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
  }
});

test("migration 23 apply failure restores the exact version 22 schema", () => {
  const db = new Database(join(dir, "memory.db"));
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    expect(() => runMigrations(db, new Date("2026-08-11T00:00:00.000Z"), {
      beforeMigration(version) {
        if (version === 23) throw new Error("stop_at_version_22");
      },
    })).toThrow("stop_at_version_22");
    const version22Schema = schemaSnapshot(db);
    expect(() => runMigrations(db, new Date("2026-08-11T00:01:00.000Z"), {
      afterMigrationApply(version) {
        if (version === 23) throw new Error("injected_after_migration_23_apply");
      },
    })).toThrow("injected_after_migration_23_apply");
    expect(db.query("SELECT version FROM schema_migrations WHERE version = 23").get()).toBeNull();
    expect(schemaSnapshot(db)).toEqual(version22Schema);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
  }
});

test("migration 24 excludes coordinator-owned query pages from provider-result byte charges", () => {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  try {
    expect(db.query("SELECT version FROM schema_migrations WHERE version = 24").get()).toEqual({ version: 24 });
    const table = db.query(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'smc_curator_action_charges'",
    ).get() as { sql: string };
    expect(table.sql).toContain("action_kind = 'query' AND result_bytes = 0");
    expect(table.sql).toContain("action_kind = 'fetch_record' AND result_bytes BETWEEN 1");
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
  }
});

test("migration 24 apply failure restores the exact version 23 schema", () => {
  const db = new Database(join(dir, "memory.db"));
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    expect(() => runMigrations(db, new Date("2026-08-11T00:00:00.000Z"), {
      beforeMigration(version) {
        if (version === 24) throw new Error("stop_at_version_23");
      },
    })).toThrow("stop_at_version_23");
    const version23Schema = schemaSnapshot(db);
    expect(() => runMigrations(db, new Date("2026-08-11T00:01:00.000Z"), {
      afterMigrationApply(version) {
        if (version === 24) throw new Error("injected_after_migration_24_apply");
      },
    })).toThrow("injected_after_migration_24_apply");
    expect(db.query("SELECT version FROM schema_migrations WHERE version = 24").get()).toBeNull();
    expect(schemaSnapshot(db)).toEqual(version23Schema);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
  }
});

function schemaSnapshot(db: Database): unknown[] {
  return db.query(
    `SELECT type, name, tbl_name, sql
     FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
  ).all();
}

function dropMigration20Tables(db: Database): void {
  for (const table of [...MIGRATION_20_TABLES].reverse()) db.query(`DROP TABLE ${table}`).run();
}

function dropMigration21Tables(db: Database): void {
  for (const table of [...MIGRATION_21_TABLES].reverse()) db.query(`DROP TABLE ${table}`).run();
  db.query("DROP INDEX session_memory_anchor_attempts_job_id_id").run();
}

function dropMigration22Tables(db: Database): void {
  for (const table of [...MIGRATION_22_TABLES].reverse()) db.query(`DROP TABLE ${table}`).run();
}

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

function seedVersion15SessionMemorySchema(db: Database, payloadJson: string): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations (version, applied_at) VALUES (15, '2026-08-10T00:00:00.000Z');
    CREATE TABLE ingest_jobs (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      input_json TEXT NOT NULL,
      output_counts_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO ingest_jobs VALUES ('job_old', 'demo', 'completed', 'codex', '{}', '{}',
      '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z');
    CREATE TABLE session_memories (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      provider TEXT,
      provider_session_id TEXT,
      ingest_job_id TEXT REFERENCES ingest_jobs(id),
      source_event_refs_json TEXT NOT NULL,
      memory_kind TEXT NOT NULL,
      title TEXT,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      confidence TEXT NOT NULL,
      risk TEXT NOT NULL,
      status TEXT NOT NULL,
      superseded_by TEXT,
      lifecycle_reason TEXT,
      superseded_at TEXT,
      retracted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX session_memories_project_created ON session_memories(project_key, created_at);
    CREATE INDEX session_memories_project_kind_created ON session_memories(project_key, memory_kind, created_at);
    CREATE INDEX session_memories_project_status_created ON session_memories(project_key, status, created_at);
    CREATE TABLE session_memory_contexts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_memory_id TEXT NOT NULL REFERENCES session_memories(id),
      project_key TEXT NOT NULL,
      repo_path TEXT,
      git_branch TEXT,
      git_commit TEXT,
      git_worktree_id TEXT,
      source_event_ref TEXT NOT NULL
    );
    CREATE TABLE session_memory_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_memory_id TEXT NOT NULL REFERENCES session_memories(id),
      target_memory_id TEXT NOT NULL REFERENCES session_memories(id),
      project_key TEXT NOT NULL,
      relationship TEXT NOT NULL,
      reason TEXT NOT NULL,
      source_event_refs_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const insert = db.query(
    `INSERT INTO session_memories
      (id, project_key, provider, provider_session_id, ingest_job_id, source_event_refs_json,
       memory_kind, title, summary, payload_json, confidence, risk, status, superseded_by,
       lifecycle_reason, superseded_at, retracted_at, created_at, updated_at)
     VALUES (?, 'demo', 'codex', 'session_old', 'job_old', '["tomb_2","tomb_1","tomb_2"]',
       'decision', NULL, 'Legacy populated memory', ?, 'high', 'low', 'active', NULL, NULL, NULL, NULL,
       '2026-08-10T10:00:00.000Z', '2026-08-10T10:00:00.000Z')`,
  );
  insert.run("mem_old", payloadJson);
  insert.run("mem_other", "{}");
  db.query(
    `INSERT INTO session_memory_contexts
      (session_memory_id, project_key, repo_path, git_branch, git_commit, git_worktree_id, source_event_ref)
     VALUES ('mem_old', 'demo', '/repo', 'main', NULL, NULL, 'tomb_1')`,
  ).run();
  db.query(
    `INSERT INTO session_memory_links
      (source_memory_id, target_memory_id, project_key, relationship, reason, source_event_refs_json, created_at)
     VALUES ('mem_other', 'mem_old', 'demo', 'refines', 'legacy relation', '["tomb_2","tomb_1"]',
       '2026-08-10T10:01:00.000Z')`,
  ).run();
}
