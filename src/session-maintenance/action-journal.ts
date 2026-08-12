import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { SMCActionJournalRow, SMCJournalActionKind } from "../memory/ingest-types.ts";
import { stableJson } from "../runtime/json.ts";
import { SESSION_MAINTENANCE_TOOL_PROTOCOL_VERSION } from "./identity.ts";
import { readSMCOverlayIdentity } from "./overlay-store.ts";

export type SMCJournalResult<T> =
  | { kind: "executed"; result: T; result_digest: string }
  | { kind: "replayed"; result: T; result_digest: string }
  | {
    kind: "rejected";
    code: "journal_idempotency_conflict" | "journal_identity_mismatch" | "journal_overlay_revision_conflict" | "journal_integrity_mismatch";
  };

export type SMCJournalActionInput = {
  job_id: string;
  project_key: string;
  work_batch_id: string;
  attempt_id: string;
  sequence: number;
  owner_epoch: number;
  protocol_version?: string;
  manifest_digest: string;
  snapshot_token: string;
  expected_overlay_revision: number;
  action_kind: SMCJournalActionKind;
  request: unknown;
};

export type PreparedSMCJournalAction = Readonly<{
  kind: "prepared";
  protocol_version: string;
  request_json: string;
  request_digest: string;
}>;

export function prepareJournaledSMCAction<T>(
  db: Database,
  input: SMCJournalActionInput,
): PreparedSMCJournalAction | Exclude<SMCJournalResult<T>, { kind: "executed" }> {
  const prepared = prepareAction(input);
  return db.transaction(() => {
    if (!validateIdentity(db, { ...input, protocol_version: prepared.protocol_version })) {
      return { kind: "rejected", code: "journal_identity_mismatch" } as const;
    }
    const existing = readExisting(db, input);
    if (existing) return replayExisting<T>(existing, input, prepared);
    if (!overlayAllowsAction(db, input)) {
      return { kind: "rejected", code: "journal_overlay_revision_conflict" } as const;
    }
    return { kind: "prepared", ...prepared } as const;
  }).immediate();
}

export function persistJournaledSMCActionResult<T>(
  db: Database,
  input: SMCJournalActionInput & { result: T; created_at: string },
): SMCJournalResult<T> {
  return db.transaction(() => persistJournaledSMCActionResultInOpenTransaction(db, input)).immediate();
}

export function persistJournaledSMCActionResultInOpenTransaction<T>(
  db: Database,
  input: SMCJournalActionInput & { result: T; created_at: string },
): SMCJournalResult<T> {
  if (!db.inTransaction) throw new Error("SMC journal result persistence requires an open transaction");
  const prepared = prepareAction(input);
  if (!validateIdentity(db, { ...input, protocol_version: prepared.protocol_version })) {
    return { kind: "rejected", code: "journal_identity_mismatch" };
  }
  const existing = readExisting(db, input);
  if (existing) return replayExisting<T>(existing, input, prepared);
  if (!overlayAllowsAction(db, input)) {
    return { kind: "rejected", code: "journal_overlay_revision_conflict" };
  }
  const resultJson = canonicalJson(input.result, "result");
  const resultDigest = digestJson(resultJson);
  insertJournalRow(db, input, prepared, resultJson, resultDigest);
  return { kind: "executed", result: input.result, result_digest: resultDigest };
}

export function executeJournaledSMCAction<T>(
  db: Database,
  input: SMCJournalActionInput & {
    created_at: string;
    execute: (db: Database) => T;
    failure_injection?: { afterCommitBeforeReturn?: () => void };
  },
): SMCJournalResult<T> {
  if (db.inTransaction) {
    throw new Error("SMC journal owns its commit boundary so results cannot escape an outer transaction");
  }
  let outcome: SMCJournalResult<T>;
  const run = () => {
    const prepared = prepareAction(input);

    if (!validateIdentity(db, { ...input, protocol_version: prepared.protocol_version })) {
      return { kind: "rejected", code: "journal_identity_mismatch" } as const;
    }
    const existing = readExisting(db, input);
    if (existing) {
      return replayExisting<T>(existing, input, prepared);
    }
    if (!overlayAllowsAction(db, input)) {
      return { kind: "rejected", code: "journal_overlay_revision_conflict" } as const;
    }

    const result = input.execute(db);
    const resultJson = canonicalJson(result, "result");
    const resultDigest = digestJson(resultJson);
    insertJournalRow(db, input, prepared, resultJson, resultDigest);
    return { kind: "executed", result, result_digest: resultDigest } as const;
  };
  outcome = db.transaction(run).immediate();
  input.failure_injection?.afterCommitBeforeReturn?.();
  return outcome;
}

function prepareAction(input: SMCJournalActionInput): Omit<PreparedSMCJournalAction, "kind"> {
  const protocolVersion = input.protocol_version ?? SESSION_MAINTENANCE_TOOL_PROTOCOL_VERSION;
  const requestJson = canonicalJson(input.request, "request");
  return {
    protocol_version: protocolVersion,
    request_json: requestJson,
    request_digest: digest({
      job_id: input.job_id,
      project_key: input.project_key,
      work_batch_id: input.work_batch_id,
      attempt_id: input.attempt_id,
      sequence: input.sequence,
      owner_epoch: input.owner_epoch,
      protocol_version: protocolVersion,
      manifest_digest: input.manifest_digest,
      snapshot_token: input.snapshot_token,
      expected_overlay_revision: input.expected_overlay_revision,
      action_kind: input.action_kind,
      request: input.request,
    }),
  };
}

function readExisting(db: Database, input: SMCJournalActionInput): SMCActionJournalRow | null {
  return db.query(
    `SELECT * FROM smc_action_journal
     WHERE job_id = ? AND work_batch_id = ? AND attempt_id = ? AND sequence = ?`,
  ).get(input.job_id, input.work_batch_id, input.attempt_id, input.sequence) as SMCActionJournalRow | null;
}

function replayExisting<T>(
  existing: SMCActionJournalRow,
  input: SMCJournalActionInput,
  prepared: Omit<PreparedSMCJournalAction, "kind">,
): Exclude<SMCJournalResult<T>, { kind: "executed" }> {
  if (existing.request_digest !== prepared.request_digest) {
    return { kind: "rejected", code: "journal_idempotency_conflict" };
  }
  if (
    existing.owner_epoch !== input.owner_epoch
    || existing.protocol_version !== prepared.protocol_version
    || existing.manifest_digest !== input.manifest_digest
    || existing.snapshot_token !== input.snapshot_token
    || existing.expected_overlay_revision !== input.expected_overlay_revision
    || existing.action_kind !== input.action_kind
    || existing.request_json !== prepared.request_json
    || !isCanonicalResult(existing.result_json, existing.result_digest)
  ) {
    return { kind: "rejected", code: "journal_integrity_mismatch" };
  }
  return {
    kind: "replayed",
    result: JSON.parse(existing.result_json) as T,
    result_digest: existing.result_digest,
  };
}

function overlayAllowsAction(db: Database, input: SMCJournalActionInput): boolean {
  const overlay = readSMCOverlayIdentity(db, input.job_id);
  if (!overlay) return false;
  if (overlay.revision === input.expected_overlay_revision) return true;
  if (input.action_kind !== "submit_proposal") return false;
  const accepted = db.query(
    `SELECT overlay_digest FROM smc_overlay_revisions
     WHERE job_id = ? AND work_batch_id = ? AND parent_revision = ? AND revision = ?`,
  ).get(
    input.job_id,
    input.work_batch_id,
    input.expected_overlay_revision,
    input.expected_overlay_revision + 1,
  ) as { overlay_digest: string } | null;
  return accepted?.overlay_digest === overlay.digest;
}

function insertJournalRow(
  db: Database,
  input: SMCJournalActionInput & { created_at: string },
  prepared: Omit<PreparedSMCJournalAction, "kind">,
  resultJson: string,
  resultDigest: string,
): void {
  db.query(
    `INSERT INTO smc_action_journal
      (job_id, work_batch_id, attempt_id, sequence, owner_epoch, protocol_version,
       manifest_digest, snapshot_token, expected_overlay_revision, action_kind,
       request_json, request_digest, result_json, result_digest, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.job_id,
    input.work_batch_id,
    input.attempt_id,
    input.sequence,
    input.owner_epoch,
    prepared.protocol_version,
    input.manifest_digest,
    input.snapshot_token,
    input.expected_overlay_revision,
    input.action_kind,
    prepared.request_json,
    prepared.request_digest,
    resultJson,
    resultDigest,
    input.created_at,
  );
}

export function readSMCActionJournal(
  db: Database,
  input: { job_id: string; attempt_id?: string },
): SMCActionJournalRow[] {
  return input.attempt_id
    ? db.query(
      `SELECT * FROM smc_action_journal
       WHERE job_id = ? AND attempt_id = ?
       ORDER BY sequence, work_batch_id`,
    ).all(input.job_id, input.attempt_id) as SMCActionJournalRow[]
    : db.query(
      `SELECT * FROM smc_action_journal
       WHERE job_id = ?
       ORDER BY created_at, attempt_id, sequence, work_batch_id`,
    ).all(input.job_id) as SMCActionJournalRow[];
}

function validateIdentity(
  db: Database,
  input: {
    job_id: string;
    project_key: string;
    work_batch_id: string;
    attempt_id: string;
    owner_epoch: number;
    protocol_version: string;
    manifest_digest: string;
    snapshot_token: string;
  },
): boolean {
  if (input.protocol_version !== SESSION_MAINTENANCE_TOOL_PROTOCOL_VERSION) return false;
  return Boolean(db.query(
    `SELECT 1
     FROM smc_manifests m
     JOIN session_memory_anchor_jobs a ON a.job_id = m.job_id
     JOIN project_session_mutation_fences f
       ON f.project_key = a.project_key AND f.owner_id = a.job_id AND f.owner_kind = 'anchor_job'
     JOIN session_memory_anchor_attempts t ON t.job_id = a.job_id AND t.id = ?
     JOIN smc_work_batches b ON b.job_id = a.job_id AND b.batch_id = ?
     WHERE m.job_id = ? AND m.project_key = ?
       AND m.manifest_digest = ? AND m.snapshot_token = ?
       AND a.phase = 'running' AND f.phase = 'running' AND t.status = 'running'
       AND a.owner_epoch = ? AND f.owner_epoch = ? AND t.owner_epoch = ?`,
  ).get(
    input.attempt_id,
    input.work_batch_id,
    input.job_id,
    input.project_key,
    input.manifest_digest,
    input.snapshot_token,
    input.owner_epoch,
    input.owner_epoch,
    input.owner_epoch,
  ));
}

function digestJson(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function digest(value: unknown): `sha256:${string}` {
  return digestJson(canonicalJson(value, "digest input"));
}

function isCanonicalResult(resultJson: string, resultDigest: string): boolean {
  try {
    return canonicalJson(JSON.parse(resultJson), "result") === resultJson
      && digestJson(resultJson) === resultDigest;
  } catch {
    return false;
  }
}

function canonicalJson(value: unknown, label: string): string {
  const json = stableJson(value);
  if (typeof json !== "string") throw new Error(`SMC journal ${label} must be JSON-serializable`);
  return json;
}
