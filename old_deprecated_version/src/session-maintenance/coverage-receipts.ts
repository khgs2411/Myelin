import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { stableJson } from "../runtime/json.ts";
import {
  SMC_ADDITIVE_WORKFLOW_BUDGET_KEYS,
  type SMCAdditiveWorkflowBudgetKey,
} from "./manifest.ts";
import type {
  CuratorAffectedWorkSetMember,
  CuratorChannelDiagnostic,
  CuratorMemoryRevisionIdentity,
  CuratorQueryMatch,
} from "./curator-retrieval-types.ts";

export type SMCCuratorChannelHit = Readonly<{
  stable_id: string;
  revision_identity: CuratorMemoryRevisionIdentity;
  semantic_distance?: number;
}>;

export type SMCCuratorQueryMaterialization = Readonly<{
  schema_version: 1;
  query_digest: string;
  cursor_secret: string;
  request_identity_digest: string;
  plan_revision: number;
  plan_digest: string;
  obligation_ids: readonly string[];
  obligation_channel_keys: readonly string[];
  channel_hits: Readonly<Record<string, readonly SMCCuratorChannelHit[]>>;
  ordered_hits: readonly CuratorQueryMatch[];
  diagnostics: readonly CuratorChannelDiagnostic[];
  frozen_controls: Readonly<{
    page_item_limit: number;
    semantic_distance_threshold_micros: number;
    semantic_qualifying_result_ceiling: number;
    max_affected_work_set_size: number;
  }>;
  truncated: boolean;
}>;

export type SMCCuratorQueryPagePayload = Readonly<{
  schema_version: 1;
  materialization_receipt_id: string;
  materialization_receipt_digest: string | null;
  query_digest: string;
  offset: number;
  page_limit: number;
  ordered_ids: readonly string[];
  next_offset: number | null;
  public_result_envelope_bytes: number;
}>;

export type SMCCuratorWorkSetPayload = Readonly<{
  schema_version: 1;
  query_receipt_id: string;
  query_receipt_digest: string;
  members: readonly CuratorAffectedWorkSetMember[];
}>;

export type SMCCoverageReceipt = Readonly<{
  id: string;
  job_id: string;
  work_batch_id: string;
  attempt_id: string;
  owner_epoch: number;
  receipt_kind: "query" | "work_set";
  channel: string | null;
  manifest_digest: string;
  snapshot_token: string;
  overlay_revision: number;
  complete: boolean;
  truncated: boolean;
  payload: unknown;
  receipt_digest: string;
  created_at: string;
}>;

export function recordSMCCoverageReceiptInOpenTransaction(
  db: Database,
  input: Omit<SMCCoverageReceipt, "receipt_digest"> & { project_key: string },
): SMCCoverageReceipt {
  if (!db.inTransaction) throw new Error("SMC coverage receipt storage requires an open transaction");
  if (!validateRunningIdentity(db, input)) throw new Error("smc_coverage_identity_mismatch");
  const payloadJson = canonicalJson(input.payload, "coverage payload");
  const receiptDigest = coverageReceiptDigest({
    schema_version: 1,
    id: input.id,
    job_id: input.job_id,
    work_batch_id: input.work_batch_id,
    attempt_id: input.attempt_id,
    owner_epoch: input.owner_epoch,
    receipt_kind: input.receipt_kind,
    channel: input.channel,
    manifest_digest: input.manifest_digest,
    snapshot_token: input.snapshot_token,
    overlay_revision: input.overlay_revision,
    complete: input.complete,
    truncated: input.truncated,
    payload_json: payloadJson,
    created_at: input.created_at,
  });
  const existing = db.query(
    "SELECT receipt_digest FROM smc_coverage_receipts WHERE id = ?",
  ).get(input.id) as { receipt_digest: string } | null;
  if (existing) {
    if (existing.receipt_digest !== receiptDigest) throw new Error("smc_coverage_receipt_conflict");
    return readSMCCoverageReceipt(db, input.id)!;
  }
  db.query(
    `INSERT INTO smc_coverage_receipts
      (id, job_id, work_batch_id, attempt_id, owner_epoch, receipt_kind, channel,
       manifest_digest, snapshot_token, overlay_revision, complete, truncated,
       payload_json, receipt_digest, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.job_id,
    input.work_batch_id,
    input.attempt_id,
    input.owner_epoch,
    input.receipt_kind,
    input.channel,
    input.manifest_digest,
    input.snapshot_token,
    input.overlay_revision,
    input.complete ? 1 : 0,
    input.truncated ? 1 : 0,
    payloadJson,
    receiptDigest,
    input.created_at,
  );
  return readSMCCoverageReceipt(db, input.id)!;
}

export function readSMCCoverageReceipt(db: Database, id: string): SMCCoverageReceipt | null {
  const row = db.query("SELECT * FROM smc_coverage_receipts WHERE id = ?").get(id) as {
    id: string;
    job_id: string;
    work_batch_id: string;
    attempt_id: string;
    owner_epoch: number;
    receipt_kind: "query" | "work_set";
    channel: string | null;
    manifest_digest: string;
    snapshot_token: string;
    overlay_revision: number;
    complete: number;
    truncated: number;
    payload_json: string;
    receipt_digest: string;
    created_at: string;
  } | null;
  if (!row) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    throw new Error("invalid_smc_coverage_receipt: payload_json is invalid");
  }
  if (canonicalJson(payload, "coverage payload") !== row.payload_json) {
    throw new Error("invalid_smc_coverage_receipt: payload_json is not canonical");
  }
  const expectedDigest = coverageReceiptDigest({
    schema_version: 1,
    id: row.id,
    job_id: row.job_id,
    work_batch_id: row.work_batch_id,
    attempt_id: row.attempt_id,
    owner_epoch: row.owner_epoch,
    receipt_kind: row.receipt_kind,
    channel: row.channel,
    manifest_digest: row.manifest_digest,
    snapshot_token: row.snapshot_token,
    overlay_revision: row.overlay_revision,
    complete: row.complete === 1,
    truncated: row.truncated === 1,
    payload_json: row.payload_json,
    created_at: row.created_at,
  });
  if (expectedDigest !== row.receipt_digest) {
    throw new Error("invalid_smc_coverage_receipt: receipt digest mismatch");
  }
  const { payload_json: _payloadJson, ...stored } = row;
  return {
    ...stored,
    complete: row.complete === 1,
    truncated: row.truncated === 1,
    payload,
  };
}

export function listSMCCoverageReceipts(
  db: Database,
  input: { job_id: string; work_batch_id: string; receipt_kind?: SMCCoverageReceipt["receipt_kind"] },
): SMCCoverageReceipt[] {
  const rows = db.query(
    `SELECT id FROM smc_coverage_receipts
     WHERE job_id = ? AND work_batch_id = ?
       AND (? IS NULL OR receipt_kind = ?)
     ORDER BY created_at, id`,
  ).all(input.job_id, input.work_batch_id, input.receipt_kind ?? null, input.receipt_kind ?? null) as Array<{ id: string }>;
  return rows.map((row) => readSMCCoverageReceipt(db, row.id)!);
}

export type SMCBudgetGrant = Readonly<{
  id: string;
  job_id: string;
  owner_epoch: number;
  budget_name: SMCAdditiveWorkflowBudgetKey;
  additive_amount: number;
  operator_id: string;
  reason: string;
  manifest_digest: string;
  request_digest: string;
  grant_digest: string;
  created_at: string;
}>;

export function recordSMCBudgetGrant(
  db: Database,
  input: Omit<SMCBudgetGrant, "request_digest" | "grant_digest"> & { project_key: string },
): SMCBudgetGrant {
  if (!(SMC_ADDITIVE_WORKFLOW_BUDGET_KEYS as readonly string[]).includes(input.budget_name)) {
    throw new Error(`invalid_smc_budget_name: ${input.budget_name}`);
  }
  if (!Number.isSafeInteger(input.additive_amount) || input.additive_amount <= 0) {
    throw new Error("invalid_smc_budget_grant_amount");
  }
  const requestDigest = digest({
    id: input.id,
    job_id: input.job_id,
    owner_epoch: input.owner_epoch,
    budget_name: input.budget_name,
    additive_amount: input.additive_amount,
    operator_id: input.operator_id,
    reason: input.reason,
    manifest_digest: input.manifest_digest,
    created_at: input.created_at,
  });
  const grantDigest = digest({ schema_version: 1, request_digest: requestDigest });
  return inImmediateTransaction(db, () => {
    if (!validateGrantIdentity(db, input)) throw new Error("smc_budget_grant_identity_mismatch");
    const existing = db.query("SELECT * FROM smc_budget_grants WHERE id = ?").get(input.id) as
      SMCBudgetGrant | null;
    if (existing) {
      if (existing.request_digest !== requestDigest) throw new Error("smc_budget_grant_conflict");
      const storedRequestDigest = budgetGrantRequestDigest(existing);
      const storedGrantDigest = digest({ schema_version: 1, request_digest: storedRequestDigest });
      if (storedRequestDigest !== existing.request_digest || storedGrantDigest !== existing.grant_digest) {
        throw new Error("invalid_smc_budget_grant_digest");
      }
      return existing;
    }
    db.query(
      `INSERT INTO smc_budget_grants
        (id, job_id, owner_epoch, budget_name, additive_amount, operator_id, reason,
         manifest_digest, request_digest, grant_digest, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.job_id,
      input.owner_epoch,
      input.budget_name,
      input.additive_amount,
      input.operator_id,
      input.reason,
      input.manifest_digest,
      requestDigest,
      grantDigest,
      input.created_at,
    );
    return db.query("SELECT * FROM smc_budget_grants WHERE id = ?").get(input.id) as SMCBudgetGrant;
  });
}

export function sumSMCBudgetGrants(
  db: Database,
  input: { job_id: string; budget_name: SMCBudgetGrant["budget_name"] },
): number {
  const row = db.query(
    `SELECT COALESCE(SUM(additive_amount), 0) AS total
     FROM smc_budget_grants WHERE job_id = ? AND budget_name = ?`,
  ).get(input.job_id, input.budget_name) as { total: number };
  return row.total;
}

export function sumValidatedSMCBudgetGrants(
  db: Database,
  input: { job_id: string; manifest_digest: string; budget_name: SMCBudgetGrant["budget_name"] },
): number {
  const rows = db.query(
    `SELECT * FROM smc_budget_grants
     WHERE job_id = ? AND budget_name = ? ORDER BY created_at, id`,
  ).all(input.job_id, input.budget_name) as SMCBudgetGrant[];
  let total = 0;
  for (const row of rows) {
    if (row.job_id !== input.job_id || row.budget_name !== input.budget_name
      || row.manifest_digest !== input.manifest_digest
      || !Number.isSafeInteger(row.additive_amount) || row.additive_amount <= 0) {
      throw new Error("invalid_smc_budget_grant_identity");
    }
    const requestDigest = budgetGrantRequestDigest(row);
    if (requestDigest !== row.request_digest
      || digest({ schema_version: 1, request_digest: requestDigest }) !== row.grant_digest) {
      throw new Error("invalid_smc_budget_grant_digest");
    }
    if (!Number.isSafeInteger(total + row.additive_amount)) throw new Error("smc_budget_grant_overflow");
    total += row.additive_amount;
  }
  return total;
}

function validateRunningIdentity(
  db: Database,
  input: Pick<SMCCoverageReceipt,
    "job_id" | "work_batch_id" | "attempt_id" | "owner_epoch" | "manifest_digest" | "snapshot_token" | "overlay_revision">
    & { project_key: string },
): boolean {
  return Boolean(db.query(
    `SELECT 1
     FROM smc_manifests m
     JOIN smc_overlay_state o ON o.job_id = m.job_id
     JOIN session_memory_anchor_jobs a ON a.job_id = m.job_id
     JOIN project_session_mutation_fences f
       ON f.project_key = a.project_key AND f.owner_id = a.job_id AND f.owner_kind = 'anchor_job'
     JOIN session_memory_anchor_attempts t ON t.job_id = a.job_id AND t.id = ?
     JOIN smc_work_batches b ON b.job_id = a.job_id AND b.batch_id = ?
     WHERE m.job_id = ? AND m.project_key = ?
       AND m.manifest_digest = ? AND m.snapshot_token = ?
       AND o.current_revision = ?
       AND a.phase = 'running' AND f.phase = 'running' AND t.status = 'running'
       AND a.owner_epoch = ? AND f.owner_epoch = ? AND t.owner_epoch = ?`,
  ).get(
    input.attempt_id,
    input.work_batch_id,
    input.job_id,
    input.project_key,
    input.manifest_digest,
    input.snapshot_token,
    input.overlay_revision,
    input.owner_epoch,
    input.owner_epoch,
    input.owner_epoch,
  ));
}

function validateGrantIdentity(
  db: Database,
  input: Pick<SMCBudgetGrant, "job_id" | "owner_epoch" | "manifest_digest"> & { project_key: string },
): boolean {
  return Boolean(db.query(
    `SELECT 1
     FROM smc_manifests m
     JOIN session_memory_anchor_jobs a ON a.job_id = m.job_id
     JOIN project_session_mutation_fences f
       ON f.project_key = a.project_key AND f.owner_id = a.job_id AND f.owner_kind = 'anchor_job'
     WHERE m.job_id = ? AND m.project_key = ? AND m.manifest_digest = ?
       AND a.phase IN ('running', 'needs_followup') AND f.phase = a.phase
       AND a.owner_epoch = ? AND f.owner_epoch = ?`,
  ).get(input.job_id, input.project_key, input.manifest_digest, input.owner_epoch, input.owner_epoch));
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value, "digest input"), "utf8").digest("hex")}`;
}

function coverageReceiptDigest(input: {
  schema_version: 1;
  id: string;
  job_id: string;
  work_batch_id: string;
  attempt_id: string;
  owner_epoch: number;
  receipt_kind: "query" | "work_set";
  channel: string | null;
  manifest_digest: string;
  snapshot_token: string;
  overlay_revision: number;
  complete: boolean;
  truncated: boolean;
  payload_json: string;
  created_at: string;
}): `sha256:${string}` {
  return digest(input);
}

function budgetGrantRequestDigest(input: Pick<SMCBudgetGrant,
  "id" | "job_id" | "owner_epoch" | "budget_name" | "additive_amount" | "operator_id" | "reason" | "manifest_digest" | "created_at">): `sha256:${string}` {
  return digest({
    id: input.id,
    job_id: input.job_id,
    owner_epoch: input.owner_epoch,
    budget_name: input.budget_name,
    additive_amount: input.additive_amount,
    operator_id: input.operator_id,
    reason: input.reason,
    manifest_digest: input.manifest_digest,
    created_at: input.created_at,
  });
}

function canonicalJson(value: unknown, label: string): string {
  const json = stableJson(value);
  if (typeof json !== "string") throw new Error(`SMC ${label} must be JSON-serializable`);
  return json;
}

function inImmediateTransaction<T>(db: Database, callback: () => T): T {
  return db.inTransaction ? callback() : db.transaction(callback).immediate();
}
