import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  SESSION_MEMORY_KINDS,
  SESSION_MEMORY_LINK_RELATIONSHIPS,
} from "../memory/ingest-types.ts";
import { stableJson } from "../runtime/json.ts";
import { SMCNormalizedEvidenceSchema } from "./evidence-contract.ts";
import { readSMCManifest } from "./manifest.ts";
import {
  SessionMaintenanceMemorySchema,
  SessionMaintenanceProjectionMemoryDispositionSchema,
} from "./output-contract.ts";
import { reconstructSMCOverlay } from "./overlay-store.ts";
import type { CuratorMemoryRevisionIdentity, CuratorQueryIdentity } from "./curator-retrieval-types.ts";
import {
  CuratorActionChargeError,
  effectiveCuratorBudgets,
} from "./curator-action-charges.ts";
import {
  preflightCuratorFetchReceipt,
  reconcileCuratorFetchReceiptInOpenTransaction,
} from "./curator-fetch-receipts.ts";

type CuratorRecordRequestBase = CuratorQueryIdentity & Readonly<{
  stable_id: string;
  max_encoded_bytes: number;
}>;

export const CURATOR_RECORD_REJECTION_CODES = [
  "curator_record_request_invalid",
  "curator_identity_mismatch",
  "curator_record_not_found",
  "curator_record_revision_mismatch",
  "curator_record_too_large",
  "curator_action_charge_conflict",
  "curator_action_charge_missing",
  "curator_action_charge_invalid",
  "curator_budget_exceeded",
  "curator_budget_overflow",
] as const;

const recordString = z.string();
const recordNonEmpty = recordString.min(1);
const recordNullableString = recordString.nullable();
const recordDigest = recordString.regex(/^sha256:[0-9a-f]{64}$/u);

export const SMCFrozenMemoryContextSchema = z.strictObject({
  repo_path: recordNullableString,
  git_branch: recordNullableString,
  git_commit: recordNullableString,
  git_worktree_id: recordNullableString,
  source_event_ref: recordNonEmpty,
});

export const SMCFrozenMemoryLinkSchema = z.strictObject({
  source_memory_id: recordNonEmpty,
  target_memory_id: recordNonEmpty,
  relationship: z.enum(SESSION_MEMORY_LINK_RELATIONSHIPS),
  reason: recordString,
  source_event_refs: z.array(recordNonEmpty),
  created_at: recordNonEmpty,
});

export const SMCFrozenBaseMemorySchema = z.strictObject({
  id: recordNonEmpty,
  project_key: recordNonEmpty,
  provider: recordNullableString,
  provider_session_id: recordNullableString,
  ingest_job_id: recordNullableString,
  source_event_refs: z.array(recordNonEmpty),
  memory_kind: z.enum(SESSION_MEMORY_KINDS),
  title: recordNullableString,
  summary: recordString,
  payload: z.record(z.string(), z.json()),
  confidence: recordString,
  risk: recordString,
  status: z.literal("active"),
  superseded_by: recordNullableString,
  lifecycle_reason: recordNullableString,
  superseded_at: recordNullableString,
  retracted_at: recordNullableString,
  revision: z.number().int().positive(),
  state_digest: recordDigest,
  created_at: recordNonEmpty,
  updated_at: recordNonEmpty,
});

export const SMCFrozenSourceRecordSchema = z.strictObject({
  kind: z.literal("source"),
  stable_id: recordNonEmpty,
  ordinal: z.number().int().nonnegative(),
  tombstone_id: recordNonEmpty,
  content_hash: recordDigest,
  encoded_bytes: z.number().int().nonnegative(),
  evidence: SMCNormalizedEvidenceSchema,
});

export const SMCFrozenBaseMemoryRecordSchema = z.strictObject({
  kind: z.literal("memory"),
  stable_id: recordNonEmpty,
  revision_identity: z.strictObject({
    origin: z.literal("base"),
    revision: z.number().int().positive(),
    state_digest: recordDigest,
  }),
  memory: SMCFrozenBaseMemorySchema,
  contexts: z.array(SMCFrozenMemoryContextSchema),
  links: z.array(SMCFrozenMemoryLinkSchema),
  current_overlay_disposition: SessionMaintenanceProjectionMemoryDispositionSchema.nullable(),
});

export const SMCStagedMemoryRecordSchema = z.strictObject({
  kind: z.literal("memory"),
  stable_id: recordNonEmpty,
  revision_identity: z.strictObject({
    origin: z.literal("overlay"),
    overlay_revision: z.number().int().nonnegative(),
    overlay_digest: recordDigest,
    payload_digest: recordDigest,
  }),
  memory: SessionMaintenanceMemorySchema,
  contexts: z.array(SMCFrozenMemoryContextSchema),
  links: z.array(SMCFrozenMemoryLinkSchema),
});

export const CuratorRecordValueSchema = z.union([
  SMCFrozenSourceRecordSchema,
  SMCFrozenBaseMemoryRecordSchema,
  SMCStagedMemoryRecordSchema,
]);

export type CuratorRecordValue = z.infer<typeof CuratorRecordValueSchema>;

type CuratorRecordSuccess = Extract<CuratorRecordResult, { kind: "record" }>;
type CuratorRecordResultHook = (db: Database, result: CuratorRecordSuccess) => void;

class CuratorRecordResultHookError extends Error {
  constructor(readonly cause: unknown) {
    super("curator record result hook failed");
  }
}

export type CuratorRecordRequest =
  | (CuratorRecordRequestBase & Readonly<{
    record_kind: "memory";
    expected_revision: CuratorMemoryRevisionIdentity;
    expected_source_hash?: never;
  }>)
  | (CuratorRecordRequestBase & Readonly<{
    record_kind: "source";
    expected_source_hash: string;
    expected_revision?: never;
  }>);

export type CuratorRecordResult =
  | { kind: "record"; record: CuratorRecordValue; encoded_bytes: number }
  | {
    kind: "rejected";
    code: (typeof CURATOR_RECORD_REJECTION_CODES)[number];
    reason: string;
  };

export function fetchCuratorRecord(
  db: Database,
  request: CuratorRecordRequest,
  options: {
    failure_injection?: { after_charge?: () => void };
    on_result_in_open_transaction?: CuratorRecordResultHook;
  } = {},
): CuratorRecordResult {
  const requestError = validateRecordRequest(request);
  if (requestError) return rejected("curator_record_request_invalid", requestError);
  const manifest = readSMCManifest(db, request.job_id);
  if (
    !manifest
    || manifest.project_key !== request.project_key
    || manifest.manifest_digest !== request.manifest_digest
    || manifest.snapshot_token !== request.snapshot_token
    || manifest.current_overlay_identity.revision !== request.overlay_revision
    || !runningIdentityMatches(db, request)
  ) {
    return rejected("curator_identity_mismatch", "record fetch identity does not match the running anchor");
  }
  const fetchIdentity = fetchReceiptIdentity(request);
  try {
    preflightCuratorFetchReceipt(db, manifest, {
      ...fetchIdentity,
      manifest_digest: manifest.manifest_digest,
    });
  } catch (error) {
    return chargeRejected(error);
  }
  let effectiveProviderEnvelope: number;
  try {
    effectiveProviderEnvelope = effectiveCuratorBudgets(db, manifest).max_provider_envelope_bytes;
  } catch (error) {
    return chargeRejected(error);
  }

  const record = request.record_kind === "source"
    ? fetchSource(db, request)
    : fetchMemory(db, request, manifest.current_overlay_identity.digest);
  if (record.kind !== "record") return record;
  const encodedBytes = publicRecordEnvelopeBytes(record.record);
  const result = { kind: "record" as const, record: record.record, encoded_bytes: encodedBytes };
  if (encodedBytes > Math.min(request.max_encoded_bytes, effectiveProviderEnvelope)) {
    return rejected("curator_record_too_large", `record requires ${encodedBytes} bytes`);
  }
  try {
    const durableResult = db.transaction(() => {
      const receipt = reconcileCuratorFetchReceiptInOpenTransaction(db, manifest, {
        ...fetchIdentity,
        result_json: stableJson(result),
        result_digest: digest(result),
        result_bytes: encodedBytes,
        manifest_digest: manifest.manifest_digest,
        created_at: new Date().toISOString(),
      }, options.failure_injection);
      const durableResult = JSON.parse(receipt.result_json) as CuratorRecordSuccess;
      runRecordResultHook(db, durableResult, options.on_result_in_open_transaction);
      return durableResult;
    }).immediate();
    return durableResult;
  } catch (error) {
    if (error instanceof CuratorRecordResultHookError) throw error.cause;
    return chargeRejected(error);
  }
}

function runRecordResultHook(db: Database, result: CuratorRecordSuccess, hook?: CuratorRecordResultHook): void {
  if (!hook) return;
  try {
    hook(db, result);
  } catch (error) {
    throw new CuratorRecordResultHookError(error);
  }
}

function validateRecordRequest(request: CuratorRecordRequest): string | null {
  const allowed = [
    "attempt_id", "expected_revision", "expected_source_hash", "job_id", "manifest_digest",
    "max_encoded_bytes", "overlay_revision", "owner_epoch", "project_key", "record_kind",
    "snapshot_token", "stable_id", "work_batch_id",
  ];
  const unknown = Object.keys(request).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) return `unknown record request fields: ${unknown.join(",")}`;
  if (request.record_kind !== "memory" && request.record_kind !== "source") return "record_kind is invalid";
  for (const [name, value] of [
    ["job_id", request.job_id], ["project_key", request.project_key], ["work_batch_id", request.work_batch_id],
    ["attempt_id", request.attempt_id], ["manifest_digest", request.manifest_digest],
    ["snapshot_token", request.snapshot_token], ["stable_id", request.stable_id],
  ] as const) {
    if (typeof value !== "string" || value.trim() === "") return `${name} must be a non-empty string`;
  }
  if (!Number.isSafeInteger(request.owner_epoch) || request.owner_epoch <= 0) return "owner_epoch must be positive";
  if (!Number.isSafeInteger(request.overlay_revision) || request.overlay_revision < 0) return "overlay_revision must be nonnegative";
  if (!Number.isSafeInteger(request.max_encoded_bytes) || request.max_encoded_bytes <= 0) return "max_encoded_bytes must be positive";
  if (request.record_kind === "source" && request.expected_revision !== undefined) return "source fetch cannot carry expected_revision";
  if (request.record_kind === "memory" && request.expected_source_hash !== undefined) return "memory fetch cannot carry expected_source_hash";
  if (request.record_kind === "source" && (typeof request.expected_source_hash !== "string" || request.expected_source_hash === "")) {
    return "source fetch requires expected_source_hash";
  }
  if (request.record_kind === "memory" && request.expected_revision === undefined) {
    return "memory fetch requires expected_revision";
  }
  return null;
}

function fetchSource(db: Database, request: Extract<CuratorRecordRequest, { record_kind: "source" }>): CuratorRecordResult {
  const row = db.query(
    `SELECT source_id, ordinal, tombstone_id, content_hash, encoded_bytes, evidence_json
     FROM smc_evidence_snapshot WHERE job_id = ? AND source_id = ?`,
  ).get(request.job_id, request.stable_id) as {
    source_id: string;
    ordinal: number;
    tombstone_id: string;
    content_hash: string;
    encoded_bytes: number;
    evidence_json: string;
  } | null;
  if (!row) return rejected("curator_record_not_found", `unknown frozen source ${request.stable_id}`);
  if (request.expected_source_hash !== row.content_hash) {
    return rejected("curator_record_revision_mismatch", `frozen source hash changed for ${request.stable_id}`);
  }
  return {
    kind: "record",
    encoded_bytes: 0,
    record: CuratorRecordValueSchema.parse({
      kind: "source",
      stable_id: row.source_id,
      ordinal: row.ordinal,
      tombstone_id: row.tombstone_id,
      content_hash: row.content_hash,
      encoded_bytes: row.encoded_bytes,
      evidence: JSON.parse(row.evidence_json),
    }),
  };
}

function fetchMemory(
  db: Database,
  request: Extract<CuratorRecordRequest, { record_kind: "memory" }>,
  overlayDigest: string,
): CuratorRecordResult {
  const overlay = reconstructSMCOverlay(db, { job_id: request.job_id, revision: request.overlay_revision });
  const staged = overlay.records.find((record) => record.record_kind === "memory" && record.staged_id === request.stable_id);
  if (staged) {
    const revision: CuratorMemoryRevisionIdentity = {
      origin: "overlay",
      overlay_revision: request.overlay_revision,
      overlay_digest: overlayDigest,
      payload_digest: staged.payload_digest!,
    };
    if (stableJson(request.expected_revision) !== stableJson(revision)) {
      return rejected("curator_record_revision_mismatch", `staged memory revision changed for ${request.stable_id}`);
    }
    return {
      kind: "record",
      encoded_bytes: 0,
      record: CuratorRecordValueSchema.parse({
        kind: "memory",
        stable_id: staged.staged_id,
        revision_identity: revision,
        memory: SessionMaintenanceMemorySchema.parse(staged.payload),
        contexts: [],
        links: [],
      }),
    };
  }
  const auditMember = request.expected_revision.origin === "base" && db.query(
    `SELECT 1 FROM smc_audit_batch_members a
     JOIN smc_work_batches b
       ON b.job_id = a.job_id AND b.batch_id = a.batch_id AND b.work_kind = 'audit'
     WHERE a.job_id = ? AND a.batch_id = ? AND a.work_kind = 'audit'
       AND a.memory_id = ? AND a.revision = ? AND a.state_digest = ?`,
  ).get(
    request.job_id,
    request.work_batch_id,
    request.stable_id,
    request.expected_revision.revision,
    request.expected_revision.state_digest,
  );
  if (overlay.masked_base_memory_ids.includes(request.stable_id) && !auditMember) {
    return rejected("curator_record_not_found", `base memory ${request.stable_id} is masked by the accepted overlay`);
  }
  const memory = db.query(
    "SELECT * FROM smc_memory_snapshot WHERE job_id = ? AND memory_id = ?",
  ).get(request.job_id, request.stable_id) as FrozenBaseMemoryRow | null;
  if (!memory) return rejected("curator_record_not_found", `unknown frozen memory ${request.stable_id}`);
  const revision: CuratorMemoryRevisionIdentity = {
    origin: "base",
    revision: memory.revision as number,
    state_digest: memory.state_digest as string,
  };
  if (stableJson(request.expected_revision) !== stableJson(revision)) {
    return rejected("curator_record_revision_mismatch", `base memory revision changed for ${request.stable_id}`);
  }
  const contexts = db.query(
    `SELECT repo_path, git_branch, git_commit, git_worktree_id, source_event_ref
     FROM smc_memory_snapshot_contexts WHERE job_id = ? AND memory_id = ? ORDER BY ordinal`,
  ).all(request.job_id, request.stable_id);
  const links = db.query(
    `SELECT source_memory_id, target_memory_id, relationship, reason, source_event_refs_json, created_at
     FROM smc_memory_snapshot_links
     WHERE job_id = ? AND (source_memory_id = ? OR target_memory_id = ?)
     ORDER BY source_memory_id, target_memory_id, relationship, reason, link_id`,
  ).all(request.job_id, request.stable_id, request.stable_id) as FrozenMemoryLinkRow[];
  const dispositionRecord = overlay.records.find((record) =>
    record.record_kind === "memory_disposition"
    && record.stable_key === request.stable_id
    && record.operation === "upsert");
  return {
    kind: "record",
    encoded_bytes: 0,
    record: CuratorRecordValueSchema.parse({
      kind: "memory",
      stable_id: request.stable_id,
      revision_identity: revision,
      memory: SMCFrozenBaseMemorySchema.parse({
        id: memory.memory_id,
        project_key: memory.project_key,
        provider: memory.provider,
        provider_session_id: memory.provider_session_id,
        ingest_job_id: memory.ingest_job_id,
        source_event_refs: JSON.parse(memory.source_event_refs_json),
        memory_kind: memory.memory_kind,
        title: memory.title,
        summary: memory.summary,
        payload: JSON.parse(memory.payload_json),
        confidence: memory.confidence,
        risk: memory.risk,
        status: memory.status,
        superseded_by: memory.superseded_by,
        lifecycle_reason: memory.lifecycle_reason,
        superseded_at: memory.superseded_at,
        retracted_at: memory.retracted_at,
        revision: memory.revision,
        state_digest: memory.state_digest,
        created_at: memory.created_at,
        updated_at: memory.updated_at,
      }),
      contexts,
      links: links.map((link) => ({
        source_memory_id: link.source_memory_id,
        target_memory_id: link.target_memory_id,
        relationship: link.relationship,
        reason: link.reason,
        source_event_refs: JSON.parse(link.source_event_refs_json),
        created_at: link.created_at,
      })),
      current_overlay_disposition: dispositionRecord
        ? SessionMaintenanceProjectionMemoryDispositionSchema.parse(dispositionRecord.payload)
        : null,
    }),
  };
}

type FrozenMemoryLinkRow = {
  source_memory_id: string;
  target_memory_id: string;
  relationship: (typeof SESSION_MEMORY_LINK_RELATIONSHIPS)[number];
  reason: string;
  source_event_refs_json: string;
  created_at: string;
};

type FrozenBaseMemoryRow = {
  job_id: string;
  memory_id: string;
  ordinal: number;
  project_key: string;
  provider: string | null;
  provider_session_id: string | null;
  ingest_job_id: string | null;
  source_event_refs_json: string;
  memory_kind: (typeof SESSION_MEMORY_KINDS)[number];
  title: string | null;
  summary: string;
  payload_json: string;
  confidence: string;
  risk: string;
  status: "active";
  superseded_by: string | null;
  lifecycle_reason: string | null;
  superseded_at: string | null;
  retracted_at: string | null;
  revision: number;
  state_digest: string;
  created_at: string;
  updated_at: string;
};

function runningIdentityMatches(db: Database, input: CuratorQueryIdentity): boolean {
  return Boolean(db.query(
    `SELECT 1
     FROM smc_manifests m
     JOIN session_memory_anchor_jobs a ON a.job_id = m.job_id
     JOIN project_session_mutation_fences f
       ON f.project_key = a.project_key AND f.owner_id = a.job_id AND f.owner_kind = 'anchor_job'
     JOIN session_memory_anchor_attempts t ON t.job_id = a.job_id AND t.id = ?
     JOIN smc_work_batches b ON b.job_id = a.job_id AND b.batch_id = ?
     WHERE m.job_id = ? AND m.project_key = ? AND m.manifest_digest = ? AND m.snapshot_token = ?
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

function publicRecordEnvelopeBytes(record: unknown): number {
  let encodedBytes = 0;
  while (true) {
    const next = Buffer.byteLength(stableJson({ kind: "record", record, encoded_bytes: encodedBytes }), "utf8");
    if (next === encodedBytes) return next;
    encodedBytes = next;
  }
}

function fetchReceiptIdentity(request: CuratorRecordRequest) {
  const logical = {
    schema_version: 1,
    action_kind: "fetch_record" as const,
    job_id: request.job_id,
    work_batch_id: request.work_batch_id,
    overlay_revision: request.overlay_revision,
    record_kind: request.record_kind,
    stable_id: request.stable_id,
    immutable_identity: request.record_kind === "memory" ? request.expected_revision : request.expected_source_hash,
  };
  const completeRequest = {
    ...logical,
    project_key: request.project_key,
    manifest_digest: request.manifest_digest,
    snapshot_token: request.snapshot_token,
    max_encoded_bytes: request.max_encoded_bytes,
  };
  return {
    job_id: request.job_id,
    work_batch_id: request.work_batch_id,
    action_key: `curator_action_${digest(logical).slice(7)}`,
    request_json: stableJson(completeRequest),
    request_digest: digest(completeRequest),
  };
}

function rejected(code: Extract<CuratorRecordResult, { kind: "rejected" }>["code"], reason: string): CuratorRecordResult {
  return { kind: "rejected", code, reason };
}

function chargeRejected(error: unknown): CuratorRecordResult {
  return error instanceof CuratorActionChargeError
    ? rejected(error.code, error.message)
    : rejected("curator_action_charge_invalid", error instanceof Error ? error.message : String(error));
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}
