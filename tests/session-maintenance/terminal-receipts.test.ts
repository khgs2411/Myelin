import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  getSessionMemoryAnchorJob,
  transitionSessionMemoryAnchorJob,
} from "../../src/session-maintenance/job-lifecycle.ts";
import {
  isForensicCleanupEligible,
  parseSMCTerminalReceipt,
  writeSMCTerminalReceiptInOpenTransaction,
} from "../../src/session-maintenance/terminal-receipts.ts";
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
});

afterEach(() => db.close());

test("stores one digest-valid terminal receipt per anchor and exact retry returns it", () => {
  const context = prepareFinalizingAnchor();
  const receipt = db.transaction(() => writeSMCTerminalReceiptInOpenTransaction(db, {
    id: "receipt-final",
    ...context,
    receipt_kind: "finalization",
    result: { accepted_projection_digest: `sha256:${"a".repeat(64)}` },
    created_at: SMC_TEST_NOW,
  })).immediate();
  expect(parseSMCTerminalReceipt(receipt)).toMatchObject({ kind: "valid" });
  const replay = db.transaction(() => writeSMCTerminalReceiptInOpenTransaction(db, {
    id: "receipt-final-retry",
    ...context,
    receipt_kind: "finalization",
    result: { accepted_projection_digest: `sha256:${"a".repeat(64)}` },
    created_at: "2026-08-11T12:01:00.000Z",
  })).immediate();
  expect(replay).toEqual(receipt);
  expect(db.query("SELECT count(*) AS n FROM smc_terminal_receipts").get()).toEqual({ n: 1 });
});

test("finalization versus abandonment conflict can persist only one terminal kind", () => {
  const context = prepareFinalizingAnchor();
  db.transaction(() => writeSMCTerminalReceiptInOpenTransaction(db, {
    id: "receipt-final",
    ...context,
    receipt_kind: "finalization",
    result: { outcome: "completed" },
    created_at: SMC_TEST_NOW,
  })).immediate();
  expect(() => db.transaction(() => writeSMCTerminalReceiptInOpenTransaction(db, {
    id: "receipt-abandon",
    ...context,
    receipt_kind: "abandonment",
    result: { outcome: "abandoned" },
    created_at: SMC_TEST_NOW,
  })).immediate()).toThrow("smc_conflicting_terminal_receipt");
  expect(() => db.query(
     `INSERT INTO smc_terminal_receipts
      (job_id, id, schema_version, receipt_kind, terminal_basis_kind, terminal_basis_digest,
       target_owner_epoch, result_json, result_digest, receipt_digest, created_at)
     SELECT job_id, 'raw-second', 1, 'abandonment', terminal_basis_kind, terminal_basis_digest,
            target_owner_epoch, result_json, result_digest, receipt_digest, created_at
     FROM smc_terminal_receipts WHERE job_id = ?`,
  ).run(context.job_id)).toThrow();
  expect(db.query("SELECT receipt_kind FROM smc_terminal_receipts WHERE job_id = ?").get(context.job_id))
    .toEqual({ receipt_kind: "finalization" });
});

test("cleanup requires a valid matching terminal receipt and elapsed retention", () => {
  const context = prepareFinalizingAnchor();
  const receipt = db.transaction(() => writeSMCTerminalReceiptInOpenTransaction(db, {
    id: "receipt-final",
    ...context,
    receipt_kind: "finalization",
    result: { outcome: "completed" },
    created_at: SMC_TEST_NOW,
  })).immediate();
  const completed = transitionSessionMemoryAnchorJob(db, {
    jobId: context.job_id,
    projectKey: context.project_key,
    expectedPhase: "finalizing",
    expectedOwnerEpoch: context.owner_epoch,
    nextPhase: "completed",
    now: SMC_TEST_NOW,
  });
  if (completed.kind !== "updated") throw new Error(JSON.stringify(completed));
  const anchor = getSessionMemoryAnchorJob(db, context.job_id);

  expect(isForensicCleanupEligible({
    receipt,
    anchor,
    now: new Date("2026-08-11T12:59:59.999Z"),
    retention_ms: 60 * 60 * 1_000,
  })).toBeFalse();
  expect(isForensicCleanupEligible({
    receipt,
    anchor,
    now: new Date("2026-08-11T13:00:00.000Z"),
    retention_ms: 60 * 60 * 1_000,
  })).toBeTrue();

  expect(isForensicCleanupEligible({
    receipt: { ...receipt, result_digest: `sha256:${"0".repeat(64)}` },
    anchor,
    now: new Date("2026-08-11T14:00:00.000Z"),
    retention_ms: 0,
  })).toBeFalse();
  expect(isForensicCleanupEligible({
    receipt: { malformed: true },
    anchor,
    now: new Date("2026-08-11T14:00:00.000Z"),
    retention_ms: 0,
  })).toBeFalse();
  expect(isForensicCleanupEligible({
    receipt,
    anchor: { ...anchor!, job_id: "another-job" },
    now: new Date("2026-08-11T14:00:00.000Z"),
    retention_ms: 0,
  })).toBeFalse();
});

test("terminal phase alone and malformed stored fields never authorize cleanup", () => {
  const context = prepareFinalizingAnchor();
  const completed = transitionSessionMemoryAnchorJob(db, {
    jobId: context.job_id,
    projectKey: context.project_key,
    expectedPhase: "finalizing",
    expectedOwnerEpoch: context.owner_epoch,
    nextPhase: "completed",
    now: SMC_TEST_NOW,
  });
  if (completed.kind !== "updated") throw new Error(JSON.stringify(completed));
  expect(isForensicCleanupEligible({
    receipt: null,
    anchor: completed.anchor,
    now: new Date("2027-08-11T12:00:00.000Z"),
    retention_ms: 0,
  })).toBeFalse();
  expect(parseSMCTerminalReceipt({})).toMatchObject({ kind: "invalid" });
});

test("terminal receipt basis is exact and finalization never accepts legacy quarantine", () => {
  const context = prepareFinalizingAnchor();
  expect(() => db.transaction(() => writeSMCTerminalReceiptInOpenTransaction(db, {
    id: "receipt-wrong-manifest",
    ...context,
    terminal_basis: { kind: "smc_manifest", digest: `sha256:${"0".repeat(64)}` },
    receipt_kind: "finalization",
    result: { outcome: "completed" },
    created_at: SMC_TEST_NOW,
  })).immediate()).toThrow("smc_terminal_receipt_identity_mismatch");
  expect(() => db.transaction(() => writeSMCTerminalReceiptInOpenTransaction(db, {
    id: "receipt-legacy-finalization",
    ...context,
    terminal_basis: { kind: "legacy_quarantine", digest: `sha256:${"1".repeat(64)}` },
    receipt_kind: "finalization",
    result: { outcome: "completed" },
    created_at: SMC_TEST_NOW,
  })).immediate()).toThrow("smc_terminal_receipt_basis_kind_mismatch");
  expect(db.query("SELECT count(*) AS n FROM smc_terminal_receipts").get()).toEqual({ n: 0 });
});

function prepareFinalizingAnchor() {
  seedIndexedMemory(db, { id: "memory-base" });
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);
  const prepared = prepare(db, planEvidence(db, "job-terminal"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status,
       details_json, created_at, updated_at)
     VALUES ('attempt-terminal', ?, 1, ?, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(prepared.manifest.job_id, prepared.manifest.owner_epoch, SMC_TEST_NOW, SMC_TEST_NOW);
  const running = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: prepared.manifest.owner_epoch,
    nextPhase: "running",
    now: SMC_TEST_NOW,
  });
  if (running.kind !== "updated") throw new Error(JSON.stringify(running));
  const finalizing = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "running",
    expectedOwnerEpoch: prepared.manifest.owner_epoch,
    nextPhase: "finalizing",
    now: SMC_TEST_NOW,
  });
  if (finalizing.kind !== "updated") throw new Error(JSON.stringify(finalizing));
  return {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    owner_epoch: prepared.manifest.owner_epoch,
    target_owner_epoch: prepared.manifest.owner_epoch,
    terminal_basis: {
      kind: "smc_manifest" as const,
      digest: prepared.manifest.manifest_digest as `sha256:${string}`,
    },
  };
}
