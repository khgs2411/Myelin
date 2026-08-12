import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { stableJson } from "../runtime/json.ts";
import type { SMCManifest } from "./manifest.ts";
import {
  CuratorActionChargeError,
  readCuratorActionCharge,
  recordCuratorActionChargeInOpenTransaction,
  requireCuratorActionCharge,
} from "./curator-action-charges.ts";

export type CuratorFetchReceipt = Readonly<{
  job_id: string;
  work_batch_id: string;
  action_key: string;
  request_json: string;
  request_digest: string;
  result_json: string;
  result_digest: string;
  result_bytes: number;
  manifest_digest: string;
  created_at: string;
}>;

export function preflightCuratorFetchReceipt(
  db: Database,
  manifest: SMCManifest,
  input: Pick<CuratorFetchReceipt,
    "job_id" | "work_batch_id" | "action_key" | "request_json" | "request_digest" | "manifest_digest">,
): CuratorFetchReceipt | null {
  const existing = readReceipt(db, input.job_id, input.action_key);
  if (!existing) {
    if (readCuratorActionCharge(db, input)) {
      throw new CuratorActionChargeError(
        "curator_action_charge_invalid",
        `fetch charge without result receipt for ${input.action_key}`,
      );
    }
    return null;
  }
  validateReceipt(manifest, existing);
  if (existing.job_id !== input.job_id || existing.work_batch_id !== input.work_batch_id
    || existing.action_key !== input.action_key || existing.request_json !== input.request_json
    || existing.request_digest !== input.request_digest || existing.manifest_digest !== input.manifest_digest) {
    throw new CuratorActionChargeError("curator_action_charge_conflict", `changed fetch replay for ${input.action_key}`);
  }
  requireCuratorActionCharge(db, manifest, chargeIdentity(existing));
  return existing;
}

export function reconcileCuratorFetchReceiptInOpenTransaction(
  db: Database,
  manifest: SMCManifest,
  input: CuratorFetchReceipt,
  failureInjection?: { after_charge?: () => void },
): { replayed: boolean; result_json: string } {
  if (!db.inTransaction) throw new Error("curator fetch receipt requires an open transaction");
  validateReceipt(manifest, input);
  const existing = preflightCuratorFetchReceipt(db, manifest, input);
  if (existing) {
    if (!sameReceiptIdentity(existing, input)) {
      throw new CuratorActionChargeError("curator_action_charge_conflict", `changed fetch replay for ${input.action_key}`);
    }
    return { replayed: true, result_json: existing.result_json };
  }
  recordCuratorActionChargeInOpenTransaction(db, manifest, {
    ...chargeIdentity(input),
    created_at: input.created_at,
  });
  failureInjection?.after_charge?.();
  db.query(
    `INSERT INTO smc_curator_fetch_receipts
      (job_id, work_batch_id, action_key, request_json, request_digest, result_json,
       result_digest, result_bytes, manifest_digest, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.job_id,
    input.work_batch_id,
    input.action_key,
    input.request_json,
    input.request_digest,
    input.result_json,
    input.result_digest,
    input.result_bytes,
    input.manifest_digest,
    input.created_at,
  );
  return { replayed: false, result_json: input.result_json };
}

function readReceipt(db: Database, jobId: string, actionKey: string): CuratorFetchReceipt | null {
  return db.query(
    "SELECT * FROM smc_curator_fetch_receipts WHERE job_id = ? AND action_key = ?",
  ).get(jobId, actionKey) as CuratorFetchReceipt | null;
}

export function hasExactCuratorMemoryFetchReceipt(
  db: Database,
  manifest: SMCManifest,
  input: { work_batch_id: string; memory_id: string; revision: number; state_digest: string },
): boolean {
  const rows = db.query(
    `SELECT action_key FROM smc_curator_fetch_receipts
     WHERE job_id = ? AND work_batch_id = ? ORDER BY created_at, action_key`,
  ).all(manifest.job_id, input.work_batch_id) as Array<{ action_key: string }>;
  for (const row of rows) {
    const receipt = readReceipt(db, manifest.job_id, row.action_key);
    if (!receipt) continue;
    validateReceipt(manifest, receipt);
    const request = JSON.parse(receipt.request_json) as Record<string, unknown>;
    const result = JSON.parse(receipt.result_json) as { record?: Record<string, unknown> };
    const expected = request.immutable_identity as Record<string, unknown> | undefined;
    const recordRevision = result.record?.revision_identity as Record<string, unknown> | undefined;
    if (request.record_kind === "memory" && request.stable_id === input.memory_id
      && expected?.origin === "base" && expected.revision === input.revision
      && expected.state_digest === input.state_digest && result.record?.kind === "memory"
      && result.record.stable_id === input.memory_id && recordRevision?.origin === "base"
      && recordRevision.revision === input.revision && recordRevision.state_digest === input.state_digest) return true;
  }
  return false;
}

function validateReceipt(manifest: SMCManifest, receipt: CuratorFetchReceipt): void {
  let request: unknown;
  let result: unknown;
  try {
    request = JSON.parse(receipt.request_json);
    result = JSON.parse(receipt.result_json);
  } catch {
    throw invalid(receipt.action_key, "invalid JSON");
  }
  if (receipt.job_id !== manifest.job_id || receipt.manifest_digest !== manifest.manifest_digest
    || receipt.work_batch_id === "" || !/^curator_action_[0-9a-f]{64}$/u.test(receipt.action_key)
    || stableJson(request) !== receipt.request_json || digest(request) !== receipt.request_digest
    || stableJson(result) !== receipt.result_json || digest(result) !== receipt.result_digest
    || !Number.isSafeInteger(receipt.result_bytes) || receipt.result_bytes <= 0
    || Buffer.byteLength(receipt.result_json, "utf8") !== receipt.result_bytes
    || !isRecordResult(result) || result.encoded_bytes !== receipt.result_bytes
    || receipt.created_at === "") {
    throw invalid(receipt.action_key, "identity or digest mismatch");
  }
}

function sameReceiptIdentity(left: CuratorFetchReceipt, right: CuratorFetchReceipt): boolean {
  return left.job_id === right.job_id && left.work_batch_id === right.work_batch_id
    && left.action_key === right.action_key && left.request_json === right.request_json
    && left.request_digest === right.request_digest && left.result_json === right.result_json
    && left.result_digest === right.result_digest && left.result_bytes === right.result_bytes
    && left.manifest_digest === right.manifest_digest;
}

function chargeIdentity(receipt: CuratorFetchReceipt) {
  return {
    job_id: receipt.job_id,
    action_key: receipt.action_key,
    action_kind: "fetch_record" as const,
    request_digest: receipt.request_digest,
    result_digest: receipt.result_digest,
    query_count: 0 as const,
    result_bytes: receipt.result_bytes,
    manifest_digest: receipt.manifest_digest,
  };
}

function isRecordResult(value: unknown): value is { kind: "record"; encoded_bytes: number; record: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === "record"
    && Number.isSafeInteger((value as { encoded_bytes?: unknown }).encoded_bytes);
}

function invalid(actionKey: string, detail: string): CuratorActionChargeError {
  return new CuratorActionChargeError("curator_action_charge_invalid", `invalid fetch receipt ${actionKey}: ${detail}`);
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}
