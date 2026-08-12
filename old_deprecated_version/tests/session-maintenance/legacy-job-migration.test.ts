import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIngestJob } from "../../src/ingest/jobs.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { withMigrateLegacyAnchorAdmission } from "../../src/memory/session-memory-write-firewall.ts";
import {
  insertLegacyJobDenyIdentitiesInOpenTransaction,
  readLegacyJobs,
  readLegacySessionJobDenyIdentity,
} from "../../src/session-maintenance/legacy-job-migration.ts";

let dir: string;
let db: MemoryDb;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "myelin-legacy-migration-"));
  db = openMemoryDbAt(join(dir, "memory.db"));
});

test("migration admission is bound to the exact denied target identity", () => {
  for (const id of ["target", "other"]) {
    createIngestJob(db, { id, project_key: "demo", provider: "codex", input: {}, now: "now" });
  }
  const jobs = readLegacyJobs(db);
  expect(() => db.transaction(() => {
    insertLegacyJobDenyIdentitiesInOpenTransaction(db, { jobs, now: "now" });
    withMigrateLegacyAnchorAdmission(db, { projectKey: "demo", targetJobId: "target" }, () => {
      db.query("UPDATE ingest_jobs SET updated_at = 'changed' WHERE id = 'other'").run();
    });
  }).immediate()).toThrow("session_memory_legacy_write_denied:target_mismatch");
  expect(db.query("SELECT count(*) AS count FROM legacy_session_job_deny_identities").get()).toEqual({ count: 0 });
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

test("deny assignment requires its caller-owned transaction and preserves source identity", () => {
  createIngestJob(db, {
    id: "legacy",
    project_key: "demo",
    provider: "claude",
    input: {},
    now: "2026-08-11T10:00:00.000Z",
  });
  const jobs = readLegacyJobs(db);
  expect(() => insertLegacyJobDenyIdentitiesInOpenTransaction(db, { jobs, now: "now" }))
    .toThrow("legacy_activation_transaction_required");

  db.transaction(() => insertLegacyJobDenyIdentitiesInOpenTransaction(db, { jobs, now: "now" })).immediate();
  expect(readLegacySessionJobDenyIdentity(db, "legacy")).toEqual({
    job_id: "legacy",
    project_key: "demo",
    reason_code: "pre_smc_job_identity",
    source_status: "starting",
    denied_at: "now",
  });
});
