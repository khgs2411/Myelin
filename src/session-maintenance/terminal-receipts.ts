import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type {
  LegacySessionJobDenyIdentityRow,
  SessionMemoryAnchorJobRow,
  SMCTerminalBasisKind,
  SMCTerminalReceiptKind,
  SMCTerminalReceiptRow,
} from "../memory/ingest-types.ts";
import { stableJson } from "../runtime/json.ts";

export const SMC_TERMINAL_RECEIPT_SCHEMA_VERSION = 1 as const;
export const LEGACY_QUARANTINE_TERMINAL_BASIS_VERSION = 1 as const;

export type SMCTerminalBasis = Readonly<{
  kind: SMCTerminalBasisKind;
  digest: `sha256:${string}`;
}>;

export type SMCTerminalReceipt = SMCTerminalReceiptRow & { result: unknown };

export type ParseSMCTerminalReceiptResult =
  | { kind: "valid"; receipt: SMCTerminalReceipt }
  | { kind: "invalid"; reason: string };

export function legacyQuarantineTerminalBasis(
  db: Database,
  input: { job_id: string; project_key: string },
): SMCTerminalBasis | null {
  const deny = db.query(
    "SELECT * FROM legacy_session_job_deny_identities WHERE job_id = ? AND project_key = ?",
  ).get(input.job_id, input.project_key) as LegacySessionJobDenyIdentityRow | null;
  const anchor = db.query(
    `SELECT job_id, project_key, phase, owner_epoch, reason_code
     FROM session_memory_anchor_jobs WHERE job_id = ? AND project_key = ?`,
  ).get(input.job_id, input.project_key) as Pick<SessionMemoryAnchorJobRow,
    "job_id" | "project_key" | "phase" | "owner_epoch" | "reason_code"> | null;
  if (
    !deny
    || !anchor
    || anchor.reason_code !== "legacy_state_missing_smc_manifest"
    || db.query("SELECT 1 FROM smc_manifests WHERE job_id = ?").get(input.job_id)
  ) return null;
  return {
    kind: "legacy_quarantine",
    digest: digest({
      schema_version: LEGACY_QUARANTINE_TERMINAL_BASIS_VERSION,
      basis_kind: "legacy_quarantine",
      job_id: input.job_id,
      project_key: input.project_key,
      deny: {
        reason_code: deny.reason_code,
        source_status: deny.source_status,
        denied_at: deny.denied_at,
      },
    }),
  };
}

export function writeSMCTerminalReceiptInOpenTransaction(
  db: Database,
  input: {
    id: string;
    job_id: string;
    project_key: string;
    receipt_kind: SMCTerminalReceiptKind;
    terminal_basis: SMCTerminalBasis;
    target_owner_epoch: number;
    result: unknown;
    created_at: string;
  },
): SMCTerminalReceipt {
  if (!db.inTransaction) throw new Error("SMC terminal receipt storage requires an open transaction");
  if (input.receipt_kind === "finalization" && input.terminal_basis.kind !== "smc_manifest") {
    throw new Error("smc_terminal_receipt_basis_kind_mismatch");
  }
  const resultJson = stableJson(input.result);
  const resultDigest = digestJson(resultJson);
  const existing = readSMCTerminalReceipt(db, input.job_id);
  if (existing) {
    if (
      existing.receipt_kind !== input.receipt_kind
      || existing.terminal_basis_kind !== input.terminal_basis.kind
      || existing.terminal_basis_digest !== input.terminal_basis.digest
      || existing.target_owner_epoch !== input.target_owner_epoch
      || existing.result_digest !== resultDigest
    ) throw new Error("smc_conflicting_terminal_receipt");
    return existing;
  }
  if (!validateTerminalAuthority(db, input)) {
    throw new Error("smc_terminal_receipt_identity_mismatch");
  }
  const receiptDigest = terminalReceiptDigest({
    id: input.id,
    job_id: input.job_id,
    schema_version: SMC_TERMINAL_RECEIPT_SCHEMA_VERSION,
    receipt_kind: input.receipt_kind,
    terminal_basis_kind: input.terminal_basis.kind,
    terminal_basis_digest: input.terminal_basis.digest,
    target_owner_epoch: input.target_owner_epoch,
    result_digest: resultDigest,
    created_at: input.created_at,
  });
  db.query(
    `INSERT INTO smc_terminal_receipts
      (job_id, id, schema_version, receipt_kind, terminal_basis_kind, terminal_basis_digest,
       target_owner_epoch, result_json, result_digest, receipt_digest, created_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.job_id,
    input.id,
    input.receipt_kind,
    input.terminal_basis.kind,
    input.terminal_basis.digest,
    input.target_owner_epoch,
    resultJson,
    resultDigest,
    receiptDigest,
    input.created_at,
  );
  return readSMCTerminalReceipt(db, input.job_id)!;
}

export function readSMCTerminalReceipt(db: Database, jobId: string): SMCTerminalReceipt | null {
  const row = db.query("SELECT * FROM smc_terminal_receipts WHERE job_id = ?").get(jobId) as
    SMCTerminalReceiptRow | null;
  if (!row) return null;
  const parsed = parseSMCTerminalReceipt(row);
  if (parsed.kind === "invalid") throw new Error(`invalid_smc_terminal_receipt: ${parsed.reason}`);
  return parsed.receipt;
}

export function parseSMCTerminalReceipt(value: unknown): ParseSMCTerminalReceiptResult {
  if (!isRecord(value)) return invalid("receipt must be an object");
  const keys = [
    "job_id", "id", "schema_version", "receipt_kind", "terminal_basis_kind",
    "terminal_basis_digest", "target_owner_epoch", "result_json", "result_digest",
    "receipt_digest", "created_at",
  ].sort();
  const actual = Object.keys(value).filter((key) => key !== "result").sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    return invalid("receipt fields do not match schema version 1");
  }
  if (value.schema_version !== SMC_TERMINAL_RECEIPT_SCHEMA_VERSION) return invalid("unsupported schema version");
  if (value.receipt_kind !== "finalization" && value.receipt_kind !== "abandonment") {
    return invalid("invalid receipt kind");
  }
  if (value.terminal_basis_kind !== "smc_manifest" && value.terminal_basis_kind !== "legacy_quarantine") {
    return invalid("invalid terminal basis kind");
  }
  if (value.receipt_kind === "finalization" && value.terminal_basis_kind !== "smc_manifest") {
    return invalid("finalization requires an SMC manifest basis");
  }
  for (const key of [
    "job_id", "id", "terminal_basis_digest", "result_json", "result_digest", "receipt_digest", "created_at",
  ] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0) return invalid(`${key} must be a non-empty string`);
  }
  if (!Number.isSafeInteger(value.target_owner_epoch) || (value.target_owner_epoch as number) <= 0) {
    return invalid("target_owner_epoch must be a positive safe integer");
  }
  if (
    !validDigest(value.terminal_basis_digest as string)
    || !validDigest(value.result_digest as string)
    || !validDigest(value.receipt_digest as string)
  ) return invalid("receipt contains an invalid digest");
  if (!validTimestamp(value.created_at as string)) return invalid("created_at must be an ISO timestamp");
  let result: unknown;
  try {
    result = JSON.parse(value.result_json as string);
  } catch {
    return invalid("result_json is not valid JSON");
  }
  if (Object.hasOwn(value, "result") && stableJson(value.result) !== stableJson(result)) {
    return invalid("decoded result does not match result_json");
  }
  if (stableJson(result) !== value.result_json) return invalid("result_json is not canonical");
  if (digestJson(value.result_json as string) !== value.result_digest) return invalid("result digest mismatch");
  const expected = terminalReceiptDigest({
    id: value.id as string,
    job_id: value.job_id as string,
    schema_version: SMC_TERMINAL_RECEIPT_SCHEMA_VERSION,
    receipt_kind: value.receipt_kind,
    terminal_basis_kind: value.terminal_basis_kind,
    terminal_basis_digest: value.terminal_basis_digest as string,
    target_owner_epoch: value.target_owner_epoch as number,
    result_digest: value.result_digest as string,
    created_at: value.created_at as string,
  });
  if (expected !== value.receipt_digest) return invalid("receipt digest mismatch");
  return {
    kind: "valid",
    receipt: {
      job_id: value.job_id as string,
      id: value.id as string,
      schema_version: SMC_TERMINAL_RECEIPT_SCHEMA_VERSION,
      receipt_kind: value.receipt_kind,
      terminal_basis_kind: value.terminal_basis_kind,
      terminal_basis_digest: value.terminal_basis_digest as string,
      target_owner_epoch: value.target_owner_epoch as number,
      result_json: value.result_json as string,
      result,
      result_digest: value.result_digest as string,
      receipt_digest: value.receipt_digest as string,
      created_at: value.created_at as string,
    },
  };
}

export function isForensicCleanupEligible(input: {
  receipt: unknown;
  anchor: SessionMemoryAnchorJobRow | null;
  now: Date;
  retention_ms: number;
}): boolean {
  if (!Number.isSafeInteger(input.retention_ms) || input.retention_ms < 0) return false;
  if (!Number.isFinite(input.now.getTime()) || !input.anchor) return false;
  const parsed = parseSMCTerminalReceipt(input.receipt);
  if (parsed.kind === "invalid") return false;
  const receipt = parsed.receipt;
  if (receipt.job_id !== input.anchor.job_id || receipt.target_owner_epoch !== input.anchor.owner_epoch) return false;
  const expectedPhase = receipt.receipt_kind === "finalization" ? "completed" : "abandoned";
  if (input.anchor.phase !== expectedPhase) return false;
  const createdAt = Date.parse(receipt.created_at);
  return input.now.getTime() >= createdAt
    && input.now.getTime() - createdAt >= input.retention_ms;
}

function validateTerminalAuthority(
  db: Database,
  input: {
    job_id: string;
    project_key: string;
    receipt_kind: SMCTerminalReceiptKind;
    terminal_basis: SMCTerminalBasis;
    target_owner_epoch: number;
  },
): boolean {
  const anchor = db.query(
    `SELECT phase, owner_epoch FROM session_memory_anchor_jobs
     WHERE job_id = ? AND project_key = ?`,
  ).get(input.job_id, input.project_key) as { phase: string; owner_epoch: number } | null;
  const fence = db.query(
    `SELECT owner_id, owner_epoch, phase FROM project_session_mutation_fences
     WHERE project_key = ?`,
  ).get(input.project_key) as { owner_id: string; owner_epoch: number; phase: string } | null;
  if (
    !anchor
    || !fence
    || anchor.owner_epoch !== input.target_owner_epoch
    || fence.owner_id !== input.job_id
    || fence.owner_epoch !== input.target_owner_epoch
    || fence.phase !== anchor.phase
  ) return false;
  const allowed = input.receipt_kind === "finalization"
    ? anchor.phase === "finalizing"
    : ["preparing", "running", "needs_followup", "finalizing"].includes(anchor.phase);
  if (!allowed) return false;
  if (input.terminal_basis.kind === "smc_manifest") {
    const manifest = db.query(
      "SELECT manifest_digest FROM smc_manifests WHERE job_id = ? AND project_key = ?",
    ).get(input.job_id, input.project_key) as { manifest_digest: string } | null;
    return manifest?.manifest_digest === input.terminal_basis.digest;
  }
  if (input.receipt_kind !== "abandonment") return false;
  const legacy = legacyQuarantineTerminalBasis(db, input);
  return legacy?.digest === input.terminal_basis.digest;
}

function terminalReceiptDigest(input: {
  id: string;
  job_id: string;
  schema_version: 1;
  receipt_kind: SMCTerminalReceiptKind;
  terminal_basis_kind: SMCTerminalBasisKind;
  terminal_basis_digest: string;
  target_owner_epoch: number;
  result_digest: string;
  created_at: string;
}): `sha256:${string}` {
  return digest(input);
}

function invalid(reason: string): ParseSMCTerminalReceiptResult {
  return { kind: "invalid", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validDigest(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

function validTimestamp(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function digestJson(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function digest(value: unknown): `sha256:${string}` {
  return digestJson(stableJson(value));
}
