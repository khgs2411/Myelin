import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type {
  SMCOverlayRecordKind,
  SMCOverlayRecordRow,
  SMCOverlayStateRow,
} from "../memory/ingest-types.ts";
import { stableJson } from "../runtime/json.ts";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { EmbeddingTransport } from "../memory/embedding-types.ts";
import {
  indexSMCOverlayDelta,
  validateSMCOverlaySearchIndex,
  type SMCOverlaySearchIndex,
} from "./overlay-index-service.ts";
import {
  inspectSMCBatchProposal,
  type SMCProposalValidationInput,
  type SMCProposalValidationIssue,
  type ValidatedSMCBatchProposal,
} from "./proposal-validator.ts";

export type SMCOverlayIdentity = Readonly<{
  revision: number;
  digest: string;
}>;

export type SMCOverlayDeltaRecord = Readonly<{
  record_kind: SMCOverlayRecordKind;
  stable_key: string;
  operation: "upsert" | "discard";
  base_memory_id?: string | null;
  final_id?: string | null;
  payload?: unknown;
  search_index?: SMCOverlaySearchIndex;
}>;

export type SMCOverlayRecord = Omit<SMCOverlayRecordRow, "payload_json"> & {
  payload: unknown | null;
  search_index?: SMCOverlaySearchIndex;
};

export const SMC_OVERLAY_REJECTION_CODES = [
  "overlay_revision_conflict",
  "overlay_batch_conflict",
  "overlay_identity_mismatch",
  "overlay_search_index_incomplete",
] as const;

export const SMC_PROPOSAL_BLOCK_CODES = [
  "overlay_memory_payload_invalid",
  "embedding_provider_configuration",
  "embedding_provider_unreachable",
  "embedding_provider_unavailable",
] as const;

export type ApplySMCOverlayDeltaResult =
  | { kind: "accepted"; overlay: SMCOverlayIdentity; response_digest: string; replayed: boolean }
  | { kind: "rejected"; code: (typeof SMC_OVERLAY_REJECTION_CODES)[number] };

export type StageSMCBatchProposalResult = ApplySMCOverlayDeltaResult
  | { kind: "rejected"; code: "proposal_validation_failed"; issues: readonly SMCProposalValidationIssue[] }
  | {
    kind: "blocked";
    code: (typeof SMC_PROPOSAL_BLOCK_CODES)[number];
    reason: string;
    retryable: boolean;
  };

export function initialSMCOverlayDigest(jobId: string): `sha256:${string}` {
  return digest({ schema_version: 1, job_id: jobId, revision: 0, records: [] });
}

export function initializeSMCOverlayInOpenTransaction(
  db: Database,
  input: { job_id: string; created_at: string },
): SMCOverlayIdentity {
  if (!db.inTransaction) throw new Error("SMC overlay initialization requires an open transaction");
  const initial = initialSMCOverlayDigest(input.job_id);
  db.query(
    `INSERT INTO smc_overlay_state (job_id, current_revision, current_digest, updated_at)
     VALUES (?, 0, ?, ?)`,
  ).run(input.job_id, initial, input.created_at);
  return { revision: 0, digest: initial };
}

export function readSMCOverlayIdentity(db: Database, jobId: string): SMCOverlayIdentity | null {
  const row = db.query(
    "SELECT * FROM smc_overlay_state WHERE job_id = ?",
  ).get(jobId) as SMCOverlayStateRow | null;
  return row ? { revision: row.current_revision, digest: row.current_digest } : null;
}

export function stagedSMCRecordId(
  jobId: string,
  recordKind: SMCOverlayRecordKind,
  stableKey: string,
): string {
  if (!jobId || !stableKey) throw new Error("Stable staged IDs require non-empty job and stable keys");
  return `smc_${recordKind}_${createHash("sha256")
    .update(stableJson({ job_id: jobId, record_kind: recordKind, stable_key: stableKey }), "utf8")
    .digest("hex")}`;
}

export function reconstructSMCOverlay(
  db: Database,
  input: { job_id: string; revision?: number },
): { identity: SMCOverlayIdentity; records: SMCOverlayRecord[]; masked_base_memory_ids: string[] } {
  const current = readSMCOverlayIdentity(db, input.job_id);
  if (!current) throw new Error(`Unknown SMC overlay: ${input.job_id}`);
  const revision = input.revision ?? current.revision;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > current.revision) {
    throw new Error(`Unknown SMC overlay revision: ${input.job_id}@${revision}`);
  }
  const rows = db.query(
    `SELECT * FROM smc_overlay_records
     WHERE job_id = ? AND revision <= ?
     ORDER BY revision, record_kind, staged_id`,
  ).all(input.job_id, revision) as SMCOverlayRecordRow[];
  const searchRows = db.query(
    `SELECT * FROM smc_overlay_search_indexes
     WHERE job_id = ? AND revision <= ?
     ORDER BY revision, staged_id`,
  ).all(input.job_id, revision) as SMCOverlaySearchIndexRow[];
  const rowsWithIndexes = attachSearchIndexes(rows, searchRows);
  const revisions = db.query(
    `SELECT revision, parent_revision, work_batch_id, attempt_id, owner_epoch,
            response_digest, delta_digest, overlay_digest
     FROM smc_overlay_revisions WHERE job_id = ? AND revision <= ? ORDER BY revision`,
  ).all(input.job_id, revision) as SMCOverlayRevisionIdentityRow[];
  let digestChain = initialSMCOverlayDigest(input.job_id);
  let records: SMCOverlayRecord[] = [];
  for (let expected = 1; expected <= revision; expected += 1) {
    const accepted = revisions[expected - 1];
    if (!accepted || accepted.revision !== expected || accepted.parent_revision !== expected - 1) {
      throw new Error(`SMC overlay revision chain mismatch: ${input.job_id}@${expected}`);
    }
    const deltaRows = rowsWithIndexes.filter((row) => row.revision === expected);
    if (storedDeltaDigest(deltaRows) !== accepted.delta_digest) {
      throw new Error(`SMC overlay delta digest mismatch: ${input.job_id}@${expected}`);
    }
    records = materialize(rowsWithIndexes.filter((row) => row.revision <= expected));
    const calculated = overlayRevisionDigest(input.job_id, accepted, digestChain, records);
    if (calculated !== accepted.overlay_digest) {
      throw new Error(`SMC overlay digest mismatch: ${input.job_id}@${expected}`);
    }
    digestChain = calculated;
  }
  if (revisions.length !== revision) throw new Error(`SMC overlay revision chain mismatch: ${input.job_id}@${revision}`);
  const identity = { revision, digest: digestChain };
  if (revision === current.revision && current.digest !== identity.digest) {
    throw new Error(`SMC overlay state digest mismatch: ${input.job_id}@${revision}`);
  }
  return {
    identity,
    records,
    masked_base_memory_ids: records
      .filter((record) => record.record_kind === "memory_disposition"
        && record.base_memory_id
        && isMaskingDisposition(record.payload))
      .map((record) => record.base_memory_id!)
      .sort(),
  };
}

function applySMCOverlayDelta(
  db: Database,
  input: {
    job_id: string;
    project_key: string;
    work_batch_id: string;
    attempt_id: string;
    owner_epoch: number;
    manifest_digest: string;
    snapshot_token: string;
    expected_revision: number;
    response_digest: string;
    records: readonly SMCOverlayDeltaRecord[];
    created_at: string;
    on_accepted_in_open_transaction?: (
      db: Database,
      result: Extract<ApplySMCOverlayDeltaResult, { kind: "accepted" }>,
    ) => void;
    failure_injection?: { afterCommitBeforeReturn?: () => void };
  },
): ApplySMCOverlayDeltaResult {
  const manifest = db.query(
    `SELECT embedding_provider, embedding_model, embedding_dimensions, embedding_format_version
     FROM smc_manifests WHERE job_id = ? AND project_key = ?`,
  ).get(input.job_id, input.project_key) as {
    embedding_provider: ActiveEmbeddingContract["provider"];
    embedding_model: string;
    embedding_dimensions: number;
    embedding_format_version: number;
  } | null;
  if (!manifest) return { kind: "rejected", code: "overlay_identity_mismatch" };
  const contract: ActiveEmbeddingContract = {
    provider: manifest.embedding_provider,
    model: manifest.embedding_model,
    dimensions: manifest.embedding_dimensions,
    purpose: "retrieval_document",
    formatVersion: manifest.embedding_format_version,
  };
  for (const record of input.records) {
    if (record.record_kind !== "memory" || record.operation !== "upsert") continue;
    if (!validateSMCOverlaySearchIndex({ payload: record.payload, search_index: record.search_index, contract })) {
      return { kind: "rejected", code: "overlay_search_index_incomplete" };
    }
  }
  const result = inImmediateTransaction(db, () => applyInOpenTransaction(db, input));
  input.failure_injection?.afterCommitBeforeReturn?.();
  return result;
}

export async function stageSMCBatchProposal(
  db: Database,
  input: SMCProposalValidationInput & {
    document_contract: ActiveEmbeddingContract;
    embedding_transport: EmbeddingTransport;
    created_at: string;
    on_accepted_in_open_transaction?: (
      db: Database,
      result: Extract<ApplySMCOverlayDeltaResult, { kind: "accepted" }>,
    ) => void;
    failure_injection?: { afterCommitBeforeReturn?: () => void };
  },
): Promise<StageSMCBatchProposalResult> {
  const first = inspectSMCBatchProposal(db, input);
  if (!first.valid) return { kind: "rejected", code: "proposal_validation_failed", issues: first.issues };
  const replay = replayAcceptedSMCBatchProposal(db, first);
  if (replay) {
    if (replay.kind !== "accepted" || !input.on_accepted_in_open_transaction) return replay;
    return inImmediateTransaction(db, () => {
      const currentReplay = replayAcceptedSMCBatchProposal(db, first);
      if (!currentReplay || currentReplay.kind !== "accepted") {
        return { kind: "rejected", code: "overlay_identity_mismatch" } as const;
      }
      input.on_accepted_in_open_transaction!(db, currentReplay);
      return currentReplay;
    });
  }
  const indexed = await indexSMCOverlayDelta({
    records: first.records,
    contract: input.document_contract,
    transport: input.embedding_transport,
  });
  if (indexed.kind !== "indexed") return indexed;

  const current = inspectSMCBatchProposal(db, input);
  if (!current.valid) return { kind: "rejected", code: "proposal_validation_failed", issues: current.issues };
  if (current.response_digest !== first.response_digest
    || current.delta_digest !== first.delta_digest
    || validatedDomainDigest(indexed.records) !== current.delta_digest) {
    return { kind: "rejected", code: "overlay_identity_mismatch" };
  }
  return applySMCOverlayDelta(db, {
    job_id: current.job_id,
    project_key: current.project_key,
    work_batch_id: current.work_batch_id,
    attempt_id: input.attempt_id,
    owner_epoch: input.owner_epoch,
    manifest_digest: current.manifest_digest,
    snapshot_token: current.snapshot_token,
    expected_revision: current.expected_overlay_revision,
    response_digest: current.response_digest,
    records: indexed.records,
    created_at: input.created_at,
    on_accepted_in_open_transaction: input.on_accepted_in_open_transaction,
    failure_injection: input.failure_injection,
  });
}

function replayAcceptedSMCBatchProposal(
  db: Database,
  validation: ValidatedSMCBatchProposal,
): ApplySMCOverlayDeltaResult | null {
  const accepted = db.query(
    `SELECT revision, parent_revision, response_digest, overlay_digest
     FROM smc_overlay_revisions WHERE job_id = ? AND work_batch_id = ?`,
  ).get(validation.job_id, validation.work_batch_id) as {
    revision: number;
    parent_revision: number;
    response_digest: string;
    overlay_digest: string;
  } | null;
  if (!accepted) return null;
  try {
    const overlay = reconstructSMCOverlay(db, { job_id: validation.job_id, revision: accepted.revision });
    if (overlay.identity.digest !== accepted.overlay_digest) {
      return { kind: "rejected", code: "overlay_identity_mismatch" };
    }
  } catch {
    return { kind: "rejected", code: "overlay_identity_mismatch" };
  }
  let persistedDomainDigest: `sha256:${string}`;
  try {
    persistedDomainDigest = persistedRevisionDomainDigest(db, validation.job_id, accepted.revision);
  } catch {
    return { kind: "rejected", code: "overlay_identity_mismatch" };
  }
  if (accepted.parent_revision !== validation.expected_overlay_revision
    || accepted.response_digest !== validation.response_digest
    || persistedDomainDigest !== validation.delta_digest) {
    return { kind: "rejected", code: "overlay_batch_conflict" };
  }
  return {
    kind: "accepted",
    overlay: { revision: accepted.revision, digest: accepted.overlay_digest },
    response_digest: accepted.response_digest,
    replayed: true,
  };
}

function persistedRevisionDomainDigest(
  db: Database,
  jobId: string,
  revision: number,
): `sha256:${string}` {
  const rows = db.query(
    `SELECT record_kind, stable_key, operation, base_memory_id, final_id, payload_json
     FROM smc_overlay_records WHERE job_id = ? AND revision = ?
     ORDER BY record_kind, stable_key`,
  ).all(jobId, revision) as Array<{
    record_kind: SMCOverlayRecordKind;
    stable_key: string;
    operation: "upsert" | "discard";
    base_memory_id: string | null;
    final_id: string | null;
    payload_json: string | null;
  }>;
  return validatedDomainDigest(rows.map((row) => ({
    record_kind: row.record_kind,
    stable_key: row.stable_key,
    operation: row.operation,
    base_memory_id: row.base_memory_id,
    final_id: row.final_id,
    ...(row.operation === "upsert"
      ? { payload: row.payload_json === null ? failMissingPayload(row) : JSON.parse(row.payload_json) as unknown }
      : {}),
  })));
}

function failMissingPayload(row: { record_kind: string; stable_key: string }): never {
  throw new Error(`SMC overlay payload missing: ${row.record_kind}/${row.stable_key}`);
}

function applyInOpenTransaction(
  db: Database,
  input: Parameters<typeof applySMCOverlayDelta>[1],
): ApplySMCOverlayDeltaResult {
  if (!db.inTransaction) throw new Error("SMC overlay CAS requires an open transaction");
  if (!validDigest(input.response_digest) || !validateRunningIdentity(db, input)) {
    return { kind: "rejected", code: "overlay_identity_mismatch" };
  }
  const normalized = normalizeDelta(input.job_id, input.records);
  const suppliedDeltaDigest = computeDeltaDigest(normalized);
  const state = readSMCOverlayIdentity(db, input.job_id);
  if (!state) return { kind: "rejected", code: "overlay_identity_mismatch" };
  let priorOverlay;
  try {
    priorOverlay = reconstructSMCOverlay(db, { job_id: input.job_id, revision: state.revision });
  } catch {
    return { kind: "rejected", code: "overlay_identity_mismatch" };
  }
  const priorBatch = db.query(
    `SELECT revision, parent_revision, response_digest, delta_digest, overlay_digest
     FROM smc_overlay_revisions WHERE job_id = ? AND work_batch_id = ?`,
  ).get(input.job_id, input.work_batch_id) as {
    revision: number;
    parent_revision: number;
    response_digest: string;
    delta_digest: string;
    overlay_digest: string;
  } | null;
  if (priorBatch) {
    const replayRevision = db.query(
      "SELECT overlay_digest FROM smc_overlay_revisions WHERE job_id = ? AND revision = ?",
    ).get(input.job_id, priorBatch.revision) as { overlay_digest: string } | null;
    const result: ApplySMCOverlayDeltaResult = priorBatch.parent_revision === input.expected_revision
        && priorBatch.response_digest === input.response_digest
        && priorBatch.delta_digest === suppliedDeltaDigest
        && replayRevision?.overlay_digest === priorBatch.overlay_digest
      ? {
        kind: "accepted",
        overlay: { revision: priorBatch.revision, digest: priorBatch.overlay_digest },
        response_digest: priorBatch.response_digest,
        replayed: true,
      }
      : { kind: "rejected", code: "overlay_batch_conflict" };
    if (result.kind === "accepted") input.on_accepted_in_open_transaction?.(db, result);
    return result;
  }

  if (state.revision !== input.expected_revision) {
    return { kind: "rejected", code: "overlay_revision_conflict" };
  }

  const nextRevision = state.revision + 1;
  const acceptedDeltaDigest = suppliedDeltaDigest;
  const prior = priorOverlay.records;
  const nextRows = materialize([
    ...prior.map(toStoredRecord),
    ...normalized.map((record) => ({ ...record, job_id: input.job_id, revision: nextRevision, created_at: input.created_at })),
  ]);
  const nextDigest = overlayRevisionDigest(input.job_id, {
    revision: nextRevision,
    parent_revision: state.revision,
    work_batch_id: input.work_batch_id,
    attempt_id: input.attempt_id,
    owner_epoch: input.owner_epoch,
    response_digest: input.response_digest,
    delta_digest: acceptedDeltaDigest,
    overlay_digest: "",
  }, state.digest, nextRows);

  db.query(
    `INSERT INTO smc_overlay_revisions
      (job_id, revision, parent_revision, work_batch_id, attempt_id, owner_epoch,
       response_digest, delta_digest, overlay_digest, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.job_id,
    nextRevision,
    state.revision,
    input.work_batch_id,
    input.attempt_id,
    input.owner_epoch,
    input.response_digest,
    acceptedDeltaDigest,
    nextDigest,
    input.created_at,
  );
  const insert = db.query(
    `INSERT INTO smc_overlay_records
      (job_id, revision, record_kind, staged_id, stable_key, operation, base_memory_id,
       final_id, payload_json, payload_digest, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSearchIndex = db.query(
    `INSERT INTO smc_overlay_search_indexes
      (job_id, revision, record_kind, staged_id, schema_version, normalized_text,
       normalized_text_hash, embedding_contract_id, embedding_provider, embedding_model,
       embedding_dimensions, embedding_purpose, embedding_format_version, vector_bytes,
       vector_digest, index_digest, created_at)
     VALUES (?, ?, 'memory', ?, 1, ?, ?, ?, ?, ?, ?, 'retrieval_document', ?, ?, ?, ?, ?)`,
  );
  for (const record of normalized) {
    insert.run(
      input.job_id,
      nextRevision,
      record.record_kind,
      record.staged_id,
      record.stable_key,
      record.operation,
      record.base_memory_id,
      record.final_id,
      record.payload_json,
      record.payload_digest,
      input.created_at,
    );
    if (record.search_index) {
      const index = record.search_index;
      insertSearchIndex.run(
        input.job_id,
        nextRevision,
        record.staged_id,
        index.normalized_text,
        index.normalized_text_hash,
        index.embedding_contract.id,
        index.embedding_contract.provider,
        index.embedding_contract.model,
        index.embedding_contract.dimensions,
        index.embedding_contract.format_version,
        encodeVector(index.vector),
        index.vector_digest,
        record.search_index_digest,
        input.created_at,
      );
    }
  }
  const updated = db.query(
    `UPDATE smc_overlay_state
     SET current_revision = ?, current_digest = ?, updated_at = ?
     WHERE job_id = ? AND current_revision = ? AND current_digest = ?`,
  ).run(nextRevision, nextDigest, input.created_at, input.job_id, state.revision, state.digest);
  if (updated.changes !== 1) throw new Error("SMC overlay state lost its revision CAS");
  const result = {
    kind: "accepted",
    overlay: { revision: nextRevision, digest: nextDigest },
    response_digest: input.response_digest,
    replayed: false,
  } as const;
  input.on_accepted_in_open_transaction?.(db, result);
  return result;
}

function normalizeDelta(jobId: string, records: readonly SMCOverlayDeltaRecord[]) {
  const seen = new Set<string>();
  return records.map((record) => {
    if (!record.stable_key) throw new Error("SMC overlay stable_key must not be empty");
    const stagedId = stagedSMCRecordId(jobId, record.record_kind, record.stable_key);
    const key = `${record.record_kind}\u0000${stagedId}`;
    if (seen.has(key)) throw new Error(`Duplicate SMC overlay delta record: ${record.record_kind}/${record.stable_key}`);
    seen.add(key);
    if (record.operation === "discard" && record.payload !== undefined) {
      throw new Error("Discarded SMC overlay records cannot carry payloads");
    }
    if (record.operation === "upsert" && record.payload === undefined) {
      throw new Error("Upserted SMC overlay records require a payload");
    }
    if ((record.record_kind !== "memory" || record.operation !== "upsert") && record.search_index !== undefined) {
      throw new Error("Only upserted SMC memory records may carry a search index");
    }
    const payloadJson = record.operation === "upsert"
      ? canonicalJson(record.payload, "overlay payload")
      : null;
    return {
      record_kind: record.record_kind,
      staged_id: stagedId,
      stable_key: record.stable_key,
      operation: record.operation,
      base_memory_id: record.base_memory_id ?? null,
      final_id: record.final_id ?? null,
      payload_json: payloadJson,
      payload_digest: payloadJson === null ? null : digestJson(payloadJson),
      search_index: record.search_index,
      search_index_digest: record.search_index ? searchIndexDigest(record.search_index) : null,
    };
  }).sort(compareStoredRecords);
}

type MaterializableOverlayRow = SMCOverlayRecordRow & {
  search_index?: SMCOverlaySearchIndex;
  search_index_digest?: string | null;
};

function materialize(rows: MaterializableOverlayRow[]): SMCOverlayRecord[] {
  const latest = new Map<string, MaterializableOverlayRow>();
  for (const row of rows) latest.set(`${row.record_kind}\u0000${row.staged_id}`, row);
  return [...latest.values()]
    .filter((row) => row.operation === "upsert")
    .sort(compareStoredRecords)
    .map((row) => {
      if (row.payload_json === null || row.payload_digest === null) {
        throw new Error(`SMC overlay upsert is missing payload: ${row.job_id}@${row.revision}/${row.staged_id}`);
      }
      if (digestJson(row.payload_json) !== row.payload_digest) {
        throw new Error(`SMC overlay payload digest mismatch: ${row.job_id}@${row.revision}/${row.staged_id}`);
      }
      if (row.record_kind === "memory" && !row.search_index) {
        throw new Error(`SMC overlay memory search index missing: ${row.job_id}@${row.revision}/${row.staged_id}`);
      }
      return {
        ...row,
        payload: JSON.parse(row.payload_json) as unknown,
        ...(row.search_index ? { search_index: row.search_index } : {}),
      };
    });
}

function computeDeltaDigest(records: ReturnType<typeof normalizeDelta>): `sha256:${string}` {
  return digest(records.map(({ payload_json: _payloadJson, search_index: _searchIndex, ...record }) => record));
}

function validatedDomainDigest(records: readonly SMCOverlayDeltaRecord[]): `sha256:${string}` {
  return digest(records.map((record) => ({
    record_kind: record.record_kind,
    stable_key: record.stable_key,
    operation: record.operation,
    base_memory_id: record.base_memory_id ?? null,
    final_id: record.final_id ?? null,
    payload: record.payload ?? null,
  })).sort((left, right) => compareText(
    `${left.record_kind}\u0000${left.stable_key}`,
    `${right.record_kind}\u0000${right.stable_key}`,
  )));
}

function isMaskingDisposition(payload: unknown): boolean {
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload)
    && ((payload as { disposition?: unknown }).disposition === "supersede"
      || (payload as { disposition?: unknown }).disposition === "retract"));
}

function toStoredRecord(record: SMCOverlayRecord): MaterializableOverlayRow {
  const { payload, ...row } = record;
  return { ...row, payload_json: payload === null ? null : canonicalJson(payload, "overlay payload") };
}

function compareStoredRecords(a: Pick<SMCOverlayRecordRow, "record_kind" | "staged_id">, b: Pick<SMCOverlayRecordRow, "record_kind" | "staged_id">): number {
  return compareText(a.record_kind, b.record_kind) || compareText(a.staged_id, b.staged_id);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validateRunningIdentity(
  db: Database,
  input: Pick<Parameters<typeof applySMCOverlayDelta>[1],
    "job_id" | "project_key" | "work_batch_id" | "attempt_id" | "owner_epoch" | "manifest_digest" | "snapshot_token">,
): boolean {
  const row = db.query(
    `SELECT 1
     FROM smc_manifests m
     JOIN session_memory_anchor_jobs a ON a.job_id = m.job_id
     JOIN project_session_mutation_fences f
       ON f.project_key = a.project_key AND f.owner_id = a.job_id AND f.owner_kind = 'anchor_job'
     JOIN session_memory_anchor_attempts t
       ON t.job_id = a.job_id AND t.id = ?
     JOIN smc_work_batches b
       ON b.job_id = a.job_id AND b.batch_id = ?
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
  );
  return Boolean(row);
}

type SMCOverlayRevisionIdentityRow = {
  revision: number;
  parent_revision: number;
  work_batch_id: string;
  attempt_id: string;
  owner_epoch: number;
  response_digest: string;
  delta_digest: string;
  overlay_digest: string;
};

function overlayRevisionDigest(
  jobId: string,
  revision: SMCOverlayRevisionIdentityRow,
  parentOverlayDigest: string,
  records: readonly SMCOverlayRecord[],
): `sha256:${string}` {
  return digest({
    schema_version: 1,
    job_id: jobId,
    revision: revision.revision,
    parent_revision: revision.parent_revision,
    parent_overlay_digest: parentOverlayDigest,
    work_batch_id: revision.work_batch_id,
    attempt_id: revision.attempt_id,
    owner_epoch: revision.owner_epoch,
    response_digest: revision.response_digest,
    delta_digest: revision.delta_digest,
    records: records.map(overlayRecordIdentity),
  });
}

function storedDeltaDigest(rows: readonly MaterializableOverlayRow[]): `sha256:${string}` {
  return digest(rows.map((row) => ({
    record_kind: row.record_kind,
    staged_id: row.staged_id,
    stable_key: row.stable_key,
    operation: row.operation,
    base_memory_id: row.base_memory_id,
    final_id: row.final_id,
    payload_digest: row.payload_digest,
    search_index_digest: row.search_index_digest ?? null,
  })).sort(compareStoredRecords));
}

function overlayRecordIdentity(record: SMCOverlayRecord) {
  return {
    record_kind: record.record_kind,
    staged_id: record.staged_id,
    stable_key: record.stable_key,
    base_memory_id: record.base_memory_id,
    final_id: record.final_id,
    payload_digest: record.payload_digest,
    search_index_digest: record.search_index ? searchIndexDigest(record.search_index) : null,
  };
}

type SMCOverlaySearchIndexRow = {
  job_id: string;
  revision: number;
  staged_id: string;
  schema_version: 1;
  normalized_text: string;
  normalized_text_hash: string;
  embedding_contract_id: string;
  embedding_provider: ActiveEmbeddingContract["provider"];
  embedding_model: string;
  embedding_dimensions: number;
  embedding_purpose: "retrieval_document";
  embedding_format_version: number;
  vector_bytes: Uint8Array;
  vector_digest: string;
  index_digest: string;
};

function attachSearchIndexes(
  rows: readonly SMCOverlayRecordRow[],
  searchRows: readonly SMCOverlaySearchIndexRow[],
): MaterializableOverlayRow[] {
  const byRevision = new Map(searchRows.map((row) => [`${row.revision}\u0000${row.staged_id}`, row]));
  return rows.map((row) => {
    const stored = byRevision.get(`${row.revision}\u0000${row.staged_id}`);
    if (!stored) return row;
    const searchIndex: SMCOverlaySearchIndex = {
      schema_version: 1,
      normalized_text: stored.normalized_text,
      normalized_text_hash: stored.normalized_text_hash,
      embedding_contract: {
        id: stored.embedding_contract_id,
        provider: stored.embedding_provider,
        model: stored.embedding_model,
        dimensions: stored.embedding_dimensions,
        purpose: stored.embedding_purpose,
        format_version: stored.embedding_format_version,
      },
      vector: decodeVector(stored.vector_bytes, stored.embedding_dimensions),
      vector_digest: stored.vector_digest,
    };
    const decodedVectorDigest = digestVector(searchIndex.vector);
    if (decodedVectorDigest !== stored.vector_digest) {
      throw new Error(`SMC overlay vector digest mismatch: ${row.job_id}@${row.revision}/${row.staged_id}`);
    }
    if (searchIndexDigest(searchIndex) !== stored.index_digest) {
      throw new Error(`SMC overlay search index digest mismatch: ${row.job_id}@${row.revision}/${row.staged_id}`);
    }
    return { ...row, search_index: searchIndex, search_index_digest: stored.index_digest };
  });
}

function searchIndexDigest(index: SMCOverlaySearchIndex): `sha256:${string}` {
  return digest({
    schema_version: index.schema_version,
    normalized_text: index.normalized_text,
    normalized_text_hash: index.normalized_text_hash,
    embedding_contract: index.embedding_contract,
    vector_digest: index.vector_digest,
  });
}

function encodeVector(values: readonly number[]): Uint8Array {
  return new Uint8Array(new Float32Array(values).buffer);
}

function decodeVector(bytes: Uint8Array, dimensions: number): number[] {
  if (bytes.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error("SMC overlay vector byte length mismatch");
  }
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return [...new Float32Array(copy)];
}

function validDigest(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

function digestJson(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function digestVector(value: readonly number[]): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(new Uint8Array(new Float32Array(value).buffer)).digest("hex")}`;
}

function digest(value: unknown): `sha256:${string}` {
  return digestJson(canonicalJson(value, "digest input"));
}

function canonicalJson(value: unknown, label: string): string {
  const json = stableJson(value);
  if (typeof json !== "string") throw new Error(`SMC ${label} must be JSON-serializable`);
  return json;
}

function inImmediateTransaction<T>(db: Database, callback: () => T): T {
  return db.inTransaction ? callback() : db.transaction(callback).immediate();
}
