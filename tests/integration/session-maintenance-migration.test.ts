import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import { runMigrations } from "../../src/memory/migrations.ts";
import { configureBunSQLite } from "../../src/memory/sqlite-runtime.ts";
import { AuthorityActivationService } from "../../src/session-maintenance/authority-activation-service.ts";
import {
  readSessionMemoryCanonicalState,
  sessionMemoryCanonicalStateDigest,
} from "../../src/memory/session-memory-revisions.ts";

const directories: string[] = [];
afterEach(async () => { while (directories.length > 0) await rm(directories.pop()!, { recursive: true, force: true }); });

test("a populated version-15 database cuts over through the full SMC schema without losing identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smc-migration-integrated-"));
  directories.push(dir);
  const path = join(dir, "memory.db");
  configureBunSQLite();
  const legacy = new Database(path);
  legacy.exec("PRAGMA foreign_keys = ON");
  expect(() => runMigrations(legacy, new Date("2026-08-11T00:00:00.000Z"), {
    beforeMigration(version) { if (version === 16) throw new Error("version-15-fixture"); },
  })).toThrow("version-15-fixture");
  legacy.query(
    `INSERT INTO ingest_jobs
      (id, project_key, status, provider, input_json, output_counts_json, created_at, updated_at)
     VALUES ('legacy-job', 'demo', 'completed', 'codex', '{}', '{}', '2026-08-10', '2026-08-10')`,
  ).run();
  legacy.query(
    `INSERT INTO session_memories
      (id, project_key, provider, ingest_job_id, source_event_refs_json, memory_kind, title,
       summary, payload_json, confidence, risk, status, created_at, updated_at)
     VALUES ('legacy-memory', 'demo', 'codex', 'legacy-job', '["source-1"]', 'decision', NULL,
       'Keep populated continuity', '{"b":2,"a":1}', 'high', 'low', 'active', '2026-08-10', '2026-08-10')`,
  ).run();
  legacy.close();

  const current = openMemoryDbAt(path);
  const row = current.query("SELECT revision, state_digest FROM session_memories WHERE id = 'legacy-memory'").get() as {
    revision: number; state_digest: string;
  };
  expect(row.revision).toBe(1);
  expect(row.state_digest).toBe(sessionMemoryCanonicalStateDigest(
    readSessionMemoryCanonicalState(current, "legacy-memory"),
  ));
  expect(current.query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get())
    .toEqual({ version: 24 });
  expect(new AuthorityActivationService({ now: () => new Date("2026-08-11T12:00:00.000Z") }).activate(current).kind)
    .toBe("activated");
  expect(current.query("SELECT reason_code FROM legacy_session_job_deny_identities WHERE job_id = 'legacy-job'").get())
    .toEqual({ reason_code: "pre_smc_job_identity" });
  expect(current.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(current.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  current.close();
});
