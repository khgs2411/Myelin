import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { stableJson } from "../runtime/json.ts";
import { readDurableCuratorAffectedWorkSet } from "./curator-channel-plan.ts";
import { evaluatePersistedCuratorBatchCoverage } from "./curator-retrieval-service.ts";
import type { CuratorMemoryRevisionIdentity } from "./curator-retrieval-types.ts";
import { readSMCManifest } from "./manifest.ts";
import { hasExactCuratorMemoryFetchReceipt } from "./curator-fetch-receipts.ts";
import {
  parseSessionMaintenanceProjection,
  SessionMaintenanceCandidateSchema,
  SessionMaintenanceHandoffSchema,
  SessionMaintenanceMemorySchema,
  SessionMaintenanceProjectionMemoryDispositionSchema,
  SessionMaintenanceSourceDispositionSchema,
  type SessionMaintenanceProjection,
} from "./output-contract.ts";
import { inspectSessionMaintenanceProjection } from "./output-validator.ts";
import { reconstructSMCOverlay } from "./overlay-store.ts";
import { readAuditInheritedSourceRefs } from "./audit-provenance.ts";

export type AcceptedSessionMaintenanceProjection = Readonly<{
  projection: SessionMaintenanceProjection;
  projection_digest: `sha256:${string}`;
}>;

export class SessionMaintenanceProjectionError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "SessionMaintenanceProjectionError";
  }
}

export function buildSessionMaintenanceProjection(
  db: Database,
  input: {
    job_id: string;
    project_key: string;
    manifest_digest: string;
    snapshot_token: string;
    overlay_revision: number;
    overlay_digest: string;
  },
): AcceptedSessionMaintenanceProjection {
  const manifest = readSMCManifest(db, input.job_id);
  if (!manifest
    || manifest.project_key !== input.project_key
    || manifest.manifest_digest !== input.manifest_digest
    || manifest.snapshot_token !== input.snapshot_token) {
    throw new SessionMaintenanceProjectionError("projection_identity_mismatch", "manifest identity does not match");
  }
  if (manifest.current_overlay_identity.revision !== input.overlay_revision
    || manifest.current_overlay_identity.digest !== input.overlay_digest) {
    throw new SessionMaintenanceProjectionError("projection_overlay_stale", "overlay identity is not current");
  }
  const batches = db.query(
    "SELECT batch_id, work_kind FROM smc_work_batches WHERE job_id = ? ORDER BY ordinal",
  ).all(input.job_id) as Array<{ batch_id: string; work_kind: "evidence" | "audit" }>;
  const revisions = db.query(
    `SELECT revision, parent_revision, work_batch_id
     FROM smc_overlay_revisions WHERE job_id = ? AND revision <= ? ORDER BY revision`,
  ).all(input.job_id, input.overlay_revision) as Array<{
    revision: number;
    parent_revision: number;
    work_batch_id: string;
  }>;
  if (revisions.length !== batches.length) {
    throw new SessionMaintenanceProjectionError("projection_batch_incomplete", "accepted revision count does not match frozen work batches");
  }
  const affected = new Map<string, CuratorMemoryRevisionIdentity>();
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!;
    const revision = revisions[index];
    if (!revision || revision.revision !== index + 1 || revision.parent_revision !== index
      || revision.work_batch_id !== batch.batch_id) {
      throw new SessionMaintenanceProjectionError("projection_batch_order_invalid", batch.batch_id);
    }
    proveAcceptedBatch(db, manifest, batch, revision, affected);
  }

  const overlay = reconstructSMCOverlay(db, { job_id: input.job_id, revision: input.overlay_revision });
  if (overlay.identity.digest !== input.overlay_digest) {
    throw new SessionMaintenanceProjectionError("projection_overlay_stale", "reconstructed overlay digest differs");
  }
  const selectedSourceIds = (db.query(
    "SELECT source_id FROM smc_evidence_snapshot WHERE job_id = ? ORDER BY ordinal",
  ).all(input.job_id) as Array<{ source_id: string }>).map((row) => row.source_id);

  const projection = parseSessionMaintenanceProjection({
    schema_version: 2,
    job_id: input.job_id,
    project_key: input.project_key,
    manifest_digest: input.manifest_digest,
    snapshot_token: input.snapshot_token,
    overlay_revision: input.overlay_revision,
    overlay_digest: input.overlay_digest,
    governing_identities: manifest.governing_identities,
    session_memories: values(overlay.records, "memory", SessionMaintenanceMemorySchema),
    memory_candidates: values(overlay.records, "candidate", SessionMaintenanceCandidateSchema),
    handoff_instructions: values(overlay.records, "handoff", SessionMaintenanceHandoffSchema),
    memory_dispositions: values(
      overlay.records,
      "memory_disposition",
      SessionMaintenanceProjectionMemoryDispositionSchema,
    ),
    source_event_dispositions: values(
      overlay.records,
      "source_disposition",
      SessionMaintenanceSourceDispositionSchema,
    ),
  });
  for (const disposition of projection.memory_dispositions) {
    const expected = affected.get(disposition.memory_id);
    if (!expected || stableJson(expected) !== stableJson(disposition.revision_identity)) {
      throw new SessionMaintenanceProjectionError(
        "projection_memory_revision_mismatch",
        disposition.memory_id,
      );
    }
  }
  const validated = inspectSessionMaintenanceProjection({
    projection,
    expectedAffectedMemoryIds: [...affected.keys()].sort(compareText),
    expectedSourceEventIds: selectedSourceIds,
    inheritedSourceEventIds: [...readAuditInheritedSourceRefs(db, input.job_id)].sort(compareText),
  });
  if (!validated.valid) {
    throw new SessionMaintenanceProjectionError(
      "projection_validation_failed",
      validated.issues.map((item) => `${item.code}:${item.path}`).join(","),
    );
  }
  return { projection, projection_digest: digest(projection) };
}

export function digestSessionMaintenanceProjection(
  projection: SessionMaintenanceProjection,
): `sha256:${string}` {
  return digest(parseSessionMaintenanceProjection(projection));
}

function proveAcceptedBatch(
  db: Database,
  manifest: NonNullable<ReturnType<typeof readSMCManifest>>,
  batch: { batch_id: string; work_kind: "evidence" | "audit" },
  revision: { revision: number; parent_revision: number },
  latestAffected: Map<string, CuratorMemoryRevisionIdentity>,
): void {
  let coverage;
  try {
    coverage = evaluatePersistedCuratorBatchCoverage(db, {
      job_id: manifest.job_id,
      work_batch_id: batch.batch_id,
      overlay_revision: revision.parent_revision,
    });
  } catch (error) {
    throw new SessionMaintenanceProjectionError("projection_historical_coverage_invalid", message(error));
  }
  if (!coverage.complete) {
    throw new SessionMaintenanceProjectionError("projection_historical_coverage_invalid", coverage.missing.join(","));
  }
  const records = db.query(
    `SELECT record_kind, stable_key, payload_json FROM smc_overlay_records
     WHERE job_id = ? AND revision = ? AND record_kind IN ('source_disposition', 'memory_disposition')`,
  ).all(manifest.job_id, revision.revision) as Array<{ record_kind: string; stable_key: string; payload_json: string | null }>;
  const sourceRecords = new Map(records.filter((row) => row.record_kind === "source_disposition").map((row) => [row.stable_key, row]));
  const expectedSources = db.query(
    `SELECT source_id FROM smc_evidence_batch_members
     WHERE job_id = ? AND batch_id = ? ORDER BY ordinal`,
  ).all(manifest.job_id, batch.batch_id) as Array<{ source_id: string }>;
  if (sourceRecords.size !== expectedSources.length) {
    throw new SessionMaintenanceProjectionError("projection_historical_source_coverage_invalid", batch.batch_id);
  }
  for (const source of expectedSources) {
    const row = sourceRecords.get(source.source_id);
    if (!row?.payload_json) throw new SessionMaintenanceProjectionError("projection_historical_source_coverage_invalid", source.source_id);
    const disposition = SessionMaintenanceSourceDispositionSchema.parse(JSON.parse(row.payload_json));
    if (disposition.source_event_id !== source.source_id) {
      throw new SessionMaintenanceProjectionError("projection_historical_source_coverage_invalid", source.source_id);
    }
  }
  const memoryRecords = new Map(records.filter((row) => row.record_kind === "memory_disposition").map((row) => [row.stable_key, row]));
  const affected = readDurableCuratorAffectedWorkSet(db, { job_id: manifest.job_id, work_batch_id: batch.batch_id });
  if (memoryRecords.size !== affected.length) {
    throw new SessionMaintenanceProjectionError("projection_historical_memory_coverage_invalid", batch.batch_id);
  }
  for (const member of affected) {
    const row = memoryRecords.get(member.stable_id);
    if (!row?.payload_json) throw new SessionMaintenanceProjectionError("projection_historical_memory_coverage_invalid", member.stable_id);
    const disposition = SessionMaintenanceProjectionMemoryDispositionSchema.parse(JSON.parse(row.payload_json));
    if (disposition.memory_id !== member.stable_id
      || stableJson(disposition.revision_identity) !== stableJson(member.revision_identity)
      || disposition.work_kind !== batch.work_kind) {
      throw new SessionMaintenanceProjectionError("projection_historical_memory_coverage_invalid", member.stable_id);
    }
    latestAffected.set(member.stable_id, member.revision_identity);
  }
  if (batch.work_kind === "audit") {
    const members = db.query(
      `SELECT memory_id, revision, state_digest FROM smc_audit_batch_members
       WHERE job_id = ? AND batch_id = ? ORDER BY ordinal`,
    ).all(manifest.job_id, batch.batch_id) as Array<{ memory_id: string; revision: number; state_digest: string }>;
    for (const member of members) {
      if (!hasExactCuratorMemoryFetchReceipt(db, manifest, { work_batch_id: batch.batch_id, ...member })) {
        throw new SessionMaintenanceProjectionError("projection_historical_coverage_invalid", `audit fetch ${member.memory_id}`);
      }
    }
  }
}

function values<T>(
  records: ReturnType<typeof reconstructSMCOverlay>["records"],
  kind: "memory" | "candidate" | "handoff" | "memory_disposition" | "source_disposition",
  schema: { parse(value: unknown): T },
): T[] {
  return records
    .filter((record) => record.record_kind === kind)
    .map((record) => {
      const value = schema.parse(record.payload);
      if ((kind === "memory" || kind === "candidate" || kind === "handoff")
        && record.final_id !== stableId(value)) {
        throw new SessionMaintenanceProjectionError("projection_final_id_mismatch", record.staged_id);
      }
      return value;
    })
    .sort((left, right) => compareText(stableId(left), stableId(right)));
}

function stableId(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return stableJson(value);
  const record = value as Record<string, unknown>;
  return String(record.id ?? record.memory_id ?? record.source_event_id ?? stableJson(value));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
