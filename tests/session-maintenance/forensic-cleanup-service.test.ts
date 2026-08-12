import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { abandonSessionMaintenanceAnchor } from "../../src/session-maintenance/abandonment-service.ts";
import { cleanupSessionMaintenanceForensics } from "../../src/session-maintenance/forensic-cleanup-service.ts";
import { finalizeSessionMaintenance } from "../../src/session-maintenance/finalization-service.ts";
import { createAcceptedFinalizationContext } from "../helpers/smc-finalization.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  planEvidence,
  prepare,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_NOW,
} from "../helpers/smc-preparation.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-base" });
  seedEvidence(db, "evt-cleanup");
  activateSMCAuthority(db);
});

afterEach(() => db.close());

test("cleanup is disabled without configured retention and blocks before the receipt age elapses", () => {
  const context = abandonPrepared("job-cleanup-gated");
  expect(cleanupSessionMaintenanceForensics(db, {
    job_id: context.job_id,
    ...cleanupIdentity(context),
    now: new Date("2027-08-11T12:00:00.000Z"),
    forensic_retention_ms: null,
  })).toEqual({ kind: "disabled", code: "smc_forensic_cleanup_retention_not_configured" });
  expect(cleanupSessionMaintenanceForensics(db, {
    job_id: context.job_id,
    ...cleanupIdentity(context),
    now: new Date("2026-08-11T13:04:59.999Z"),
    forensic_retention_ms: 60 * 60 * 1_000,
  })).toEqual({ kind: "blocked", code: "smc_forensic_cleanup_not_eligible" });
  expect(db.query("SELECT 1 FROM smc_manifests WHERE job_id = ?").get(context.job_id)).not.toBeNull();
});

test("elapsed cleanup removes only job-owned forensic detail and terminal replay remains independent of the manifest", () => {
  const context = abandonPrepared("job-cleanup");
  const batch = db.query("SELECT batch_id FROM smc_work_batches WHERE job_id = ? ORDER BY ordinal LIMIT 1")
    .get(context.job_id) as { batch_id: string };
  const actionKey = `curator_action_${"a".repeat(64)}`;
  const requestDigest = `sha256:${"b".repeat(64)}`;
  const resultDigest = `sha256:${"c".repeat(64)}`;
  const manifest = db.query("SELECT manifest_digest FROM smc_manifests WHERE job_id = ?")
    .get(context.job_id) as { manifest_digest: string };
  db.query(
    `INSERT INTO smc_curator_action_charges
      (job_id, action_key, action_kind, request_digest, result_digest, query_count,
       result_bytes, manifest_digest, created_at)
     VALUES (?, ?, 'fetch_record', ?, ?, 0, 1, ?, ?)`,
  ).run(context.job_id, actionKey, requestDigest, resultDigest, manifest.manifest_digest, SMC_TEST_NOW);
  db.query(
    `INSERT INTO smc_curator_fetch_receipts
      (job_id, work_batch_id, action_key, request_json, request_digest, result_json,
       result_digest, result_bytes, manifest_digest, created_at)
     VALUES (?, ?, ?, '{}', ?, '{}', ?, 1, ?, ?)`,
  ).run(context.job_id, batch.batch_id, actionKey, requestDigest, resultDigest, manifest.manifest_digest, SMC_TEST_NOW);
  const cleaned = cleanupSessionMaintenanceForensics(db, {
    job_id: context.job_id,
    ...cleanupIdentity(context),
    now: new Date("2026-08-11T13:05:00.000Z"),
    forensic_retention_ms: 60 * 60 * 1_000,
  });
  expect(cleaned.kind).toBe("cleaned");
  expect(db.query("SELECT 1 FROM smc_manifests WHERE job_id = ?").get(context.job_id)).toBeNull();
  expect(db.query("SELECT 1 FROM smc_overlay_state WHERE job_id = ?").get(context.job_id)).toBeNull();
  expect(db.query("SELECT 1 FROM smc_curator_fetch_receipts WHERE job_id = ?").get(context.job_id)).toBeNull();
  expect(db.query("SELECT 1 FROM smc_curator_action_charges WHERE job_id = ?").get(context.job_id)).toBeNull();
  expect(db.query("SELECT id FROM smc_terminal_receipts WHERE job_id = ?").get(context.job_id))
    .toEqual({ id: context.receipt_id });
  expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(context.job_id))
    .toEqual({ phase: "abandoned" });
  expect(db.query("SELECT id FROM ingest_jobs WHERE id = ?").get(context.job_id)).toEqual({ id: context.job_id });
  expect(db.query("SELECT state FROM experience_event_tombstones WHERE original_event_id = 'evt-cleanup'").get())
    .toEqual({ state: "unfinished" });
  expect(db.query("SELECT id FROM experience_events WHERE id = 'evt-cleanup'").get()).toEqual({ id: "evt-cleanup" });
  expect(db.query("SELECT id FROM session_memories WHERE id = 'memory-base'").get()).toEqual({ id: "memory-base" });

  const replay = abandonSessionMaintenanceAnchor(db, context.input);
  expect(replay).toMatchObject({ kind: "replayed", receipt: { id: context.receipt_id } });
});

test("malformed or mismatched terminal proof never cleans forensic state", () => {
  const context = abandonPrepared("job-cleanup-malformed");
  db.query("UPDATE smc_terminal_receipts SET receipt_digest = ? WHERE job_id = ?")
    .run(`sha256:${"0".repeat(64)}`, context.job_id);
  expect(cleanupSessionMaintenanceForensics(db, {
    job_id: context.job_id,
    ...cleanupIdentity(context),
    now: new Date("2027-08-11T12:00:00.000Z"),
    forensic_retention_ms: 0,
  })).toEqual({ kind: "blocked", code: "smc_forensic_cleanup_receipt_invalid" });
  expect(db.query("SELECT 1 FROM smc_manifests WHERE job_id = ?").get(context.job_id)).not.toBeNull();
});

test("cleanup preserves real audit and terminal receipts while removing finalization detail", async () => {
  db.close();
  db = openMemoryDbAt(":memory:");
  const context = await createAcceptedFinalizationContext(db, {
    jobId: "job-final-cleanup",
    workKind: "audit",
  });
  const finalized = await finalizeSessionMaintenance(db, {
    jobId: context.job_id,
    ownerEpoch: context.owner_epoch,
    acceptedProjectionDigest: context.accepted.projection_digest,
    now: () => new Date(SMC_TEST_NOW),
  });
  const auditBefore = db.query("SELECT id FROM session_memory_audit_receipts WHERE job_id = ?")
    .get(context.job_id) as { id: string };

  expect(cleanupSessionMaintenanceForensics(db, {
    job_id: context.job_id,
    project_key: context.project_key,
    expected_owner_epoch: context.owner_epoch,
    terminal_receipt_digest: finalized.receipt.receipt_digest,
    now: new Date(SMC_TEST_NOW),
    forensic_retention_ms: 0,
  }).kind).toBe("cleaned");
  expect(db.query("SELECT 1 FROM smc_manifests WHERE job_id = ?").get(context.job_id)).toBeNull();
  expect(db.query("SELECT 1 FROM smc_memory_snapshot WHERE job_id = ?").get(context.job_id)).toBeNull();
  expect(db.query("SELECT id FROM session_memory_audit_receipts WHERE job_id = ?").get(context.job_id))
    .toEqual(auditBefore);
  expect(db.query("SELECT id FROM smc_terminal_receipts WHERE job_id = ?").get(context.job_id))
    .toEqual({ id: finalized.receipt.id });
  expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(context.job_id))
    .toEqual({ phase: "completed" });
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
});

function abandonPrepared(jobId: string) {
  const prepared = prepare(db, planEvidence(db, jobId));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const input = {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    expected_owner_epoch: 1,
    receipt_id: `receipt-${jobId}`,
    request_id: `request-${jobId}`,
    operator_id: "operator-1",
    reason: "cleanup-test",
    now: "2026-08-11T12:05:00.000Z",
  };
  const result = abandonSessionMaintenanceAnchor(db, input);
  if (result.kind !== "abandoned") throw new Error(JSON.stringify(result));
  return { job_id: jobId, receipt_id: input.receipt_id, receipt_digest: result.receipt.receipt_digest, input };
}

function cleanupIdentity(context: ReturnType<typeof abandonPrepared>) {
  return {
    project_key: "demo",
    expected_owner_epoch: 1,
    terminal_receipt_digest: context.receipt_digest,
  };
}
