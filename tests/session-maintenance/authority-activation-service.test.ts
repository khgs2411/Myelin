import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIngestJob, updateIngestJobStatus } from "../../src/ingest/jobs.ts";
import { IngestJobAdminService } from "../../src/ingest/job-admin-service.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { readSessionMemoryMutationAuthorityMode } from "../../src/memory/project-session-mutation-fence.ts";
import { acquireProjectSessionMutationFence } from "../../src/memory/project-session-mutation-fence.ts";
import { createSessionMemory } from "../../src/memory/session-memories.ts";
import { withAnchorLifecycleAdmission } from "../../src/memory/session-memory-write-firewall.ts";
import { AuthorityActivationService } from "../../src/session-maintenance/authority-activation-service.ts";

let dir: string;
let db: MemoryDb;
const now = "2026-08-11T10:00:00.000Z";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "myelin-authority-activation-"));
  db = openMemoryDbAt(join(dir, "memory.db"));
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

test("activation permanently denies every old identity and quarantines nonterminal jobs atomically", () => {
  legacyJob("historical", "completed", "history");
  legacyJob("live", "running", "demo", { pid: 4242 });

  const result = new AuthorityActivationService({
    now: () => new Date(now),
    isProcessAlive: () => true,
  }).activate(db);

  expect(result).toEqual({
    kind: "activated",
    authority_mode: "smc_v1",
    quarantined_job_ids: ["live"],
  });
  expect(readSessionMemoryMutationAuthorityMode(db)).toBe("smc_v1");
  expect(db.query("SELECT job_id FROM legacy_session_job_deny_identities ORDER BY job_id").all())
    .toEqual([{ job_id: "historical" }, { job_id: "live" }]);
  expect(db.query("SELECT phase, owner_epoch, reason_code FROM session_memory_anchor_jobs WHERE job_id = 'live'").get())
    .toEqual({ phase: "needs_followup", owner_epoch: 1, reason_code: "legacy_state_missing_smc_manifest" });
  const details = db.query("SELECT details_json FROM session_memory_anchor_attempts WHERE job_id = 'live'").get() as { details_json: string };
  expect(JSON.parse(details.details_json)).toMatchObject({ process_liveness_diagnostic: true, migrated_from_status: "running" });
  expect(db.query("SELECT owner_id, phase FROM project_session_mutation_fences WHERE project_key = 'demo'").get())
    .toEqual({ owner_id: "live", phase: "needs_followup" });
  expect(() => db.query("DELETE FROM legacy_session_job_deny_identities WHERE job_id = 'live'").run())
    .toThrow("legacy_session_job_deny_identity_immutable");
});

test("multiple nonterminal jobs in one project return a stable blocker without partial writes", () => {
  legacyJob("first", "starting", "demo");
  legacyJob("second", "running", "demo");

  const result = new AuthorityActivationService({ now: () => new Date(now) }).activate(db);

  expect(result).toMatchObject({
    kind: "blocked",
    code: "legacy_project_multiple_nonterminal_jobs",
    project_key: "demo",
    job_ids: ["first", "second"],
  });
  expect(readSessionMemoryMutationAuthorityMode(db)).toBe("legacy_compatibility");
  expect(db.query("SELECT count(*) AS count FROM legacy_session_job_deny_identities").get()).toEqual({ count: 0 });
  expect(db.query("SELECT count(*) AS count FROM session_memory_anchor_jobs").get()).toEqual({ count: 0 });
  expect(db.query("SELECT count(*) AS count FROM project_session_mutation_fences").get()).toEqual({ count: 0 });
});

test("generic failed-job cleanup cannot release a permanently denied legacy identity", () => {
  legacyJob("failed", "failed", "demo");
  new AuthorityActivationService({ now: () => new Date(now) }).activate(db);
  const admin = new IngestJobAdminService(dir, { db, now: () => new Date(now) });

  expect(admin.list({ projectKey: "demo" }).jobs[0]).toMatchObject({
    id: "failed",
    permanently_denied_legacy_identity: true,
    anchor: null,
  });
  expect(admin.resolveFailed({ projectKey: "demo", ids: ["failed"], reason: "unsafe" }).resolved).toEqual([]);
  expect(db.query("SELECT status FROM ingest_jobs WHERE id = 'failed'").get()).toEqual({ status: "failed" });
});

test("permanent deny survives test-owned release while a fresh reassigned owner succeeds", () => {
  legacyJob("denied", "running", "demo");
  new AuthorityActivationService({ now: () => new Date(now) }).activate(db);

  // Chunk 08 owns the real admitted abandonment/release transaction. This deletion is deliberately
  // test-owned so Chunk 04 can prove the permanent identity boundary without implementing it early.
  db.query("DELETE FROM project_session_mutation_fences WHERE project_key = 'demo'").run();

  expect(() => acquireProjectSessionMutationFence(db, {
    projectKey: "demo",
    ownerId: "denied",
    ownerKind: "repair",
    phase: "running",
    now: "2026-08-11T10:01:00.000Z",
  })).toThrow("session_memory_legacy_authority_rejected");
  expect(db.query("SELECT * FROM project_session_mutation_fences WHERE project_key = 'demo'").get()).toBeNull();

  db.query(`INSERT INTO project_session_mutation_fences
    (project_key, owner_id, owner_kind, phase, owner_epoch, heartbeat_at, acquired_at, terminal_receipt_id)
    VALUES ('demo', 'denied', 'anchor_job', 'running', 2, 'now', 'now', NULL)`).run();
  expect(() => withAnchorLifecycleAdmission(db, {
    operation: "anchor_resume",
    projectKey: "demo",
    ownerId: "denied",
    ownerEpoch: 2,
    phase: "running",
  }, () => undefined)).toThrow("session_memory_legacy_write_denied:authority_mismatch");
  db.query("DELETE FROM project_session_mutation_fences WHERE project_key = 'demo'").run();

  const fresh = acquireProjectSessionMutationFence(db, {
    projectKey: "demo",
    ownerId: "fresh_repair_owner",
    ownerKind: "repair",
    phase: "running",
    now: "2026-08-11T10:02:00.000Z",
  });
  if (fresh.kind !== "acquired") throw new Error("fresh reassigned owner did not acquire authority");
  createSessionMemory(db, {
    id: "fresh_memory",
    project_key: "demo",
    ingest_job_id: null,
    source_event_refs: [],
    memory_kind: "continuity",
    summary: "Fresh owner write",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-08-11T10:02:00.000Z",
    embedding_contract: null,
  }, fresh.authority);

  expect(db.query("SELECT id FROM session_memories WHERE id = 'fresh_memory'").get())
    .toEqual({ id: "fresh_memory" });
  expect(db.query("SELECT job_id FROM legacy_session_job_deny_identities WHERE job_id = 'denied'").get())
    .toEqual({ job_id: "denied" });
});

function legacyJob(
  id: string,
  status: "starting" | "running" | "completed" | "failed",
  projectKey: string,
  followupState?: Record<string, unknown>,
): void {
  createIngestJob(db, { id, project_key: projectKey, provider: "codex", input: {}, now });
  if (status !== "starting") {
    updateIngestJobStatus(db, {
      id,
      status,
      started_at: status === "running" ? now : undefined,
      finished_at: status === "completed" || status === "failed" ? now : undefined,
      followup_state: followupState,
      updated_at: now,
    });
  }
}
