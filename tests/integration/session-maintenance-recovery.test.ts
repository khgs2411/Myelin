import { afterEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { abandonSessionMaintenanceAnchor } from "../../src/session-maintenance/abandonment-service.ts";
import { cleanupSessionMaintenanceForensics } from "../../src/session-maintenance/forensic-cleanup-service.ts";
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
afterEach(() => db?.close());

test("abandonment releases raw evidence and receipt-gated cleanup preserves terminal replay integrity", () => {
  db = openMemoryDbAt(":memory:");
  configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-recovery" });
  seedEvidence(db, "evt-recovery");
  activateSMCAuthority(db);
  const prepared = prepare(db, planEvidence(db, "job-recovery-integrated"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));

  const input = {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    expected_owner_epoch: prepared.manifest.owner_epoch,
    receipt_id: "receipt-recovery-integrated",
    request_id: "request-recovery-integrated",
    operator_id: "integration-test",
    reason: "exercise recoverable terminal cleanup",
    now: SMC_TEST_NOW,
  };
  const abandoned = abandonSessionMaintenanceAnchor(db, input);
  if (abandoned.kind === "rejected") throw new Error(JSON.stringify(abandoned));
  expect(abandoned.released_lease_count).toBe(1);
  expect(db.query("SELECT state FROM experience_event_tombstones WHERE ingest_job_id = ?").get(input.job_id))
    .toEqual({ state: "unfinished" });

  const cleaned = cleanupSessionMaintenanceForensics(db, {
    job_id: input.job_id,
    project_key: input.project_key,
    expected_owner_epoch: input.expected_owner_epoch,
    terminal_receipt_digest: abandoned.receipt.receipt_digest,
    now: new Date("2026-08-11T12:00:01.000Z"),
    forensic_retention_ms: 0,
  });
  expect(cleaned.kind).toBe("cleaned");
  expect(abandonSessionMaintenanceAnchor(db, input).kind).toBe("replayed");
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
});
