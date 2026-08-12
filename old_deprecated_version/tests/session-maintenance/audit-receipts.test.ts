import { afterEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  listCurrentSessionMemoryAuditCoverage,
  readSessionMemoryAuditReceipt,
} from "../../src/session-maintenance/audit-receipts.ts";
import { finalizeSessionMaintenance } from "../../src/session-maintenance/finalization-service.ts";
import { sessionMaintenanceOutputContractIdentity, sessionMaintenancePolicyIdentity, sessionMaintenanceToolProtocolIdentity } from "../../src/session-maintenance/identity.ts";
import { createAcceptedFinalizationContext } from "../helpers/smc-finalization.ts";
import { SMC_TEST_NOW } from "../helpers/smc-preparation.ts";

const databases: MemoryDb[] = [];
afterEach(() => { while (databases.length > 0) databases.pop()!.close(); });

test("audit receipt proves exact current revision and governing identities", async () => {
  const db = memoryDb();
  const context = await createAcceptedFinalizationContext(db, { jobId: "job-audit", workKind: "audit" });
  const finalized = await finalizeSessionMaintenance(db, {
    jobId: context.job_id,
    ownerEpoch: context.owner_epoch,
    acceptedProjectionDigest: context.accepted.projection_digest,
    now: () => new Date(SMC_TEST_NOW),
  });
  const receiptId = (finalized.receipt.result as any).output_ids.audit_receipts[0] as string;
  const receipt = readSessionMemoryAuditReceipt(db, receiptId)!;

  expect(receipt).toMatchObject({
    memory_id: "memory-0",
    reviewed_revision: 1,
    resulting_status: "active",
    resulting_revision: 1,
    job_id: context.job_id,
  });
  expect(currentCoverage(db)).toEqual([receipt]);
  expect(listCurrentSessionMemoryAuditCoverage(db, {
    project_key: "demo",
    policy: { ...sessionMaintenancePolicyIdentity(), digest: `sha256:${"0".repeat(64)}` },
    output_contract: sessionMaintenanceOutputContractIdentity(),
    tool_protocol: sessionMaintenanceToolProtocolIdentity(),
  })).toEqual([]);
});

test("audit receipt identity is immutable and historical rows are not rewritten", async () => {
  const db = memoryDb();
  const context = await createAcceptedFinalizationContext(db, { jobId: "job-audit-immutable", workKind: "audit" });
  const finalized = await finalizeSessionMaintenance(db, {
    jobId: context.job_id,
    ownerEpoch: context.owner_epoch,
    acceptedProjectionDigest: context.accepted.projection_digest,
    now: () => new Date(SMC_TEST_NOW),
  });
  const receiptId = (finalized.receipt.result as any).output_ids.audit_receipts[0] as string;
  expect(() => db.query("UPDATE session_memory_audit_receipts SET created_at = ? WHERE id = ?")
    .run("2026-08-11T13:00:00.000Z", receiptId)).toThrow("immutable");
  expect(() => db.query("DELETE FROM session_memory_audit_receipts WHERE id = ?").run(receiptId))
    .toThrow("immutable");
  expect(readSessionMemoryAuditReceipt(db, receiptId)?.created_at).toBe(SMC_TEST_NOW);
  expect(db.query("SELECT count(*) AS n FROM session_memory_audit_receipts").get()).toEqual({ n: 1 });
});

test("audit supersede and retract receipts bind terminal outcomes and do not count as active coverage", async () => {
  for (const disposition of ["supersede", "retract"] as const) {
    const db = memoryDb();
    const context = await createAcceptedFinalizationContext(db, {
      jobId: `job-audit-${disposition}`,
      workKind: "audit",
      auditDisposition: disposition,
    });
    const finalized = await finalizeSessionMaintenance(db, {
      jobId: context.job_id,
      ownerEpoch: context.owner_epoch,
      acceptedProjectionDigest: context.accepted.projection_digest,
      now: () => new Date(SMC_TEST_NOW),
    });
    const receiptId = (finalized.receipt.result as any).output_ids.audit_receipts[0] as string;
    const receipt = readSessionMemoryAuditReceipt(db, receiptId)!;

    expect(receipt).toMatchObject({
      memory_id: "memory-0",
      reviewed_revision: 1,
      disposition,
      resulting_status: disposition === "supersede" ? "superseded" : "retracted",
      resulting_revision: 2,
    });
    expect(currentCoverage(db)).toEqual([]);
    expect(db.query("SELECT status, revision FROM session_memories WHERE id = 'memory-0'").get())
      .toEqual({ status: disposition === "supersede" ? "superseded" : "retracted", revision: 2 });
  }
});

function memoryDb(): MemoryDb {
  const db = openMemoryDbAt(":memory:");
  databases.push(db);
  return db;
}

function currentCoverage(db: MemoryDb) {
  return listCurrentSessionMemoryAuditCoverage(db, {
    project_key: "demo",
    policy: sessionMaintenancePolicyIdentity(),
    output_contract: sessionMaintenanceOutputContractIdentity(),
    tool_protocol: sessionMaintenanceToolProtocolIdentity(),
  });
}
