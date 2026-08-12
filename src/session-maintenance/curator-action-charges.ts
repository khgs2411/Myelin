import type { Database } from "bun:sqlite";
import { sumValidatedSMCBudgetGrants } from "./coverage-receipts.ts";
import type { SMCAdditiveWorkflowBudgetKey, SMCManifest } from "./manifest.ts";

export type CuratorActionCharge = Readonly<{
  job_id: string;
  action_key: string;
  action_kind: "query" | "fetch_record";
  request_digest: string;
  result_digest: string;
  query_count: 0 | 1;
  result_bytes: number;
  manifest_digest: string;
  created_at: string;
}>;

export type EffectiveCuratorBudgets = Readonly<{
  max_affected_work_set_size: number;
  max_queries: number;
  max_cumulative_returned_result_bytes: number;
  max_provider_envelope_bytes: number;
}>;

export class CuratorActionChargeError extends Error {
  constructor(public readonly code:
    | "curator_action_charge_conflict"
    | "curator_action_charge_missing"
    | "curator_action_charge_invalid"
    | "curator_budget_exceeded"
    | "curator_budget_overflow", message: string) {
    super(`${code}: ${message}`);
    this.name = "CuratorActionChargeError";
  }
}

export function effectiveCuratorBudgets(db: Database, manifest: SMCManifest): EffectiveCuratorBudgets {
  try {
    return {
      max_affected_work_set_size: addSafe(
        manifest.workflow_budgets.max_affected_work_set_size,
        grant(db, manifest, "max_affected_work_set_size"),
      ),
      max_queries: addSafe(manifest.workflow_budgets.max_queries, grant(db, manifest, "max_queries")),
      max_cumulative_returned_result_bytes: addSafe(
        manifest.workflow_budgets.max_cumulative_returned_result_bytes,
        grant(db, manifest, "max_cumulative_returned_result_bytes"),
      ),
      max_provider_envelope_bytes: addSafe(
        manifest.workflow_budgets.max_provider_envelope_bytes,
        grant(db, manifest, "max_provider_envelope_bytes"),
      ),
    };
  } catch (error) {
    if (error instanceof CuratorActionChargeError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new CuratorActionChargeError(
      detail.includes("overflow") ? "curator_budget_overflow" : "curator_action_charge_invalid",
      detail,
    );
  }
}

export function recordCuratorActionChargeInOpenTransaction(
  db: Database,
  manifest: SMCManifest,
  input: CuratorActionCharge,
): { replayed: boolean; charge: CuratorActionCharge } {
  if (!db.inTransaction) throw new Error("curator action charge requires an open transaction");
  validateInput(manifest, input);
  const existing = readCharge(db, input.job_id, input.action_key);
  if (existing) {
    validateStoredCharge(manifest, existing);
    if (!sameChargeIdentity(existing, input)) {
      throw new CuratorActionChargeError("curator_action_charge_conflict", `changed replay for ${input.action_key}`);
    }
    assertLedgerWithinBudgets(db, manifest);
    return { replayed: true, charge: existing };
  }
  const budgets = effectiveCuratorBudgets(db, manifest);
  const totals = readValidatedTotals(db, manifest);
  if (input.result_bytes > budgets.max_provider_envelope_bytes
    || addSafe(totals.query_count, input.query_count) > budgets.max_queries
    || addSafe(totals.result_bytes, input.result_bytes) > budgets.max_cumulative_returned_result_bytes) {
    throw new CuratorActionChargeError("curator_budget_exceeded", `action ${input.action_key} exceeds an effective workflow budget`);
  }
  db.query(
    `INSERT INTO smc_curator_action_charges
      (job_id, action_key, action_kind, request_digest, result_digest, query_count,
       result_bytes, manifest_digest, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.job_id, input.action_key, input.action_kind, input.request_digest, input.result_digest,
    input.query_count, input.result_bytes, input.manifest_digest, input.created_at,
  );
  return { replayed: false, charge: readCharge(db, input.job_id, input.action_key)! };
}

export function requireCuratorActionCharge(
  db: Database,
  manifest: SMCManifest,
  input: Omit<CuratorActionCharge, "created_at">,
): CuratorActionCharge {
  const existing = readCharge(db, input.job_id, input.action_key);
  if (!existing) throw new CuratorActionChargeError("curator_action_charge_missing", `missing charge for ${input.action_key}`);
  validateStoredCharge(manifest, existing);
  if (!sameChargeIdentity(existing, input)) {
    throw new CuratorActionChargeError("curator_action_charge_conflict", `changed replay for ${input.action_key}`);
  }
  assertLedgerWithinBudgets(db, manifest);
  return existing;
}

export function readCuratorActionCharge(
  db: Database,
  input: { job_id: string; action_key: string },
): CuratorActionCharge | null {
  return readCharge(db, input.job_id, input.action_key);
}

function assertLedgerWithinBudgets(db: Database, manifest: SMCManifest): void {
  const totals = readValidatedTotals(db, manifest);
  const budgets = effectiveCuratorBudgets(db, manifest);
  if (totals.query_count > budgets.max_queries || totals.result_bytes > budgets.max_cumulative_returned_result_bytes) {
    throw new CuratorActionChargeError("curator_action_charge_invalid", "stored charge totals exceed effective workflow budgets");
  }
}

function readValidatedTotals(db: Database, manifest: SMCManifest): { query_count: number; result_bytes: number } {
  const rows = db.query(
    "SELECT * FROM smc_curator_action_charges WHERE job_id = ? ORDER BY created_at, action_key",
  ).all(manifest.job_id) as CuratorActionCharge[];
  let queryCount = 0;
  let resultBytes = 0;
  for (const row of rows) {
    validateStoredCharge(manifest, row);
    queryCount = addSafe(queryCount, row.query_count);
    resultBytes = addSafe(resultBytes, row.result_bytes);
  }
  return { query_count: queryCount, result_bytes: resultBytes };
}

function validateStoredCharge(manifest: SMCManifest, value: CuratorActionCharge): void {
  try {
    validateInput(manifest, value);
  } catch (error) {
    if (error instanceof CuratorActionChargeError) throw error;
    throw new CuratorActionChargeError("curator_action_charge_invalid", error instanceof Error ? error.message : String(error));
  }
}

function validateInput(manifest: SMCManifest, value: Omit<CuratorActionCharge, "created_at"> & { created_at?: string }): void {
  if (value.job_id !== manifest.job_id || value.manifest_digest !== manifest.manifest_digest
    || !/^curator_action_[0-9a-f]{64}$/u.test(value.action_key)
    || !validDigest(value.request_digest) || !validDigest(value.result_digest)
    || !Number.isSafeInteger(value.result_bytes) || value.result_bytes < 0
    || (value.created_at !== undefined && value.created_at.length === 0)
    || (value.action_kind === "query"
      ? (value.query_count !== 0 && value.query_count !== 1) || value.result_bytes !== 0
      : value.action_kind === "fetch_record" ? value.query_count !== 0 || value.result_bytes <= 0 : true)) {
    throw new CuratorActionChargeError("curator_action_charge_invalid", `invalid charge ${value.action_key}`);
  }
}

function sameChargeIdentity(
  stored: CuratorActionCharge,
  input: Omit<CuratorActionCharge, "created_at">,
): boolean {
  return stored.job_id === input.job_id && stored.action_key === input.action_key
    && stored.action_kind === input.action_kind && stored.request_digest === input.request_digest
    && stored.result_digest === input.result_digest && stored.query_count === input.query_count
    && stored.result_bytes === input.result_bytes && stored.manifest_digest === input.manifest_digest;
}

function readCharge(db: Database, jobId: string, actionKey: string): CuratorActionCharge | null {
  return db.query(
    "SELECT * FROM smc_curator_action_charges WHERE job_id = ? AND action_key = ?",
  ).get(jobId, actionKey) as CuratorActionCharge | null;
}

function grant(
  db: Database,
  manifest: SMCManifest,
  budgetName: SMCAdditiveWorkflowBudgetKey,
): number {
  return sumValidatedSMCBudgetGrants(db, {
    job_id: manifest.job_id,
    manifest_digest: manifest.manifest_digest,
    budget_name: budgetName,
  });
}

function addSafe(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || !Number.isSafeInteger(value)) {
    throw new CuratorActionChargeError("curator_budget_overflow", "effective workflow budget exceeds safe integer range");
  }
  return value;
}

function validDigest(value: string): boolean { return /^sha256:[0-9a-f]{64}$/u.test(value); }
