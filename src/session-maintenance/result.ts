import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { stableJson } from "../runtime/json.ts";
import type { SessionMaintenanceIdentity } from "./identity.ts";
import {
  parseSessionMaintenanceOutput,
  parseSessionMaintenanceProjection,
  type SessionMaintenanceOutput,
  type SessionMaintenanceProjection,
} from "./output-contract.ts";
import { digestSessionMaintenanceProjection } from "./projection.ts";
import { withAnchorLifecycleAdmission } from "../memory/session-memory-write-firewall.ts";

export type SessionMaintenanceResultRecord = {
  schema_version: 1;
  reference_scope: "ingest_job_relative";
  reference_base: string;
  output_contract_identity: SessionMaintenanceIdentity;
  accepted_output_digest: `sha256:${string}`;
  accepted_output: SessionMaintenanceOutput;
  accepted_at: string;
};

export type SessionMaintenanceProjectionResultRecord = Readonly<{
  schema_version: 1;
  state: "validated_noncanonical" | "committed";
  reference_scope: "ingest_job_relative";
  reference_base: string;
  accepted_projection_digest: `sha256:${string}`;
  accepted_projection: SessionMaintenanceProjection;
  validated_at: string;
}>;

export function buildSessionMaintenanceProjectionResultRecord(input: {
  projection: SessionMaintenanceProjection;
  validatedAt: string;
  state?: "validated_noncanonical" | "committed";
}): SessionMaintenanceProjectionResultRecord {
  const projection = parseSessionMaintenanceProjection(input.projection);
  return {
    schema_version: 1,
    state: input.state ?? "validated_noncanonical",
    reference_scope: "ingest_job_relative",
    reference_base: `ingest_jobs/${projection.job_id}/session_maintenance_projection`,
    accepted_projection_digest: digestSessionMaintenanceProjection(projection),
    accepted_projection: projection,
    validated_at: input.validatedAt,
  };
}

export function writeSessionMaintenanceProjectionResultInOpenTransaction(
  db: Database,
  input: {
    project_key: string;
    job_id: string;
    owner_epoch: number;
    phase: "running" | "finalizing";
    projection: SessionMaintenanceProjection;
    stored_at: string;
    state?: "validated_noncanonical" | "committed";
  },
): SessionMaintenanceProjectionResultRecord {
  if (!db.inTransaction) throw new Error("Session maintenance projection result requires an open transaction");
  const record = buildSessionMaintenanceProjectionResultRecord({
    projection: input.projection,
    validatedAt: input.stored_at,
    state: input.state,
  });
  const existing = readSessionMaintenanceProjectionResult(db, input.job_id);
  if (existing && existing.accepted_projection_digest !== record.accepted_projection_digest) {
    throw new Error("session_maintenance_projection_result_conflict");
  }
  const job = db.query(
    "SELECT followup_state_json FROM ingest_jobs WHERE id = ? AND project_key = ?",
  ).get(input.job_id, input.project_key) as { followup_state_json: string | null } | null;
  if (!job) throw new Error(`Unknown ingest job: ${input.job_id}`);
  const followup = parseObject(job.followup_state_json ?? "{}");
  followup.accepted_projection_digest = record.accepted_projection_digest;
  followup.session_maintenance_projection_result = record;
  withAnchorLifecycleAdmission(db, {
    operation: input.phase === "finalizing" ? "anchor_finalize" : "anchor_resume",
    projectKey: input.project_key,
    ownerId: input.job_id,
    ownerEpoch: input.owner_epoch,
    phase: input.phase,
  }, () => {
    const updated = db.query(
      `UPDATE ingest_jobs SET followup_state_json = ?, updated_at = ?
       WHERE id = ? AND project_key = ?`,
    ).run(stableJson(followup), input.stored_at, input.job_id, input.project_key);
    if (updated.changes !== 1) throw new Error("session_maintenance_projection_result_write_failed");
  });
  return record;
}

export function readSessionMaintenanceProjectionResult(
  db: Database,
  ingestJobId: string,
): SessionMaintenanceProjectionResultRecord | null {
  const row = db.query("SELECT followup_state_json FROM ingest_jobs WHERE id = ?").get(ingestJobId) as {
    followup_state_json: string | null;
  } | null;
  if (!row?.followup_state_json) return null;
  const followup = parseObject(row.followup_state_json);
  const raw = followup.session_maintenance_projection_result;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const projection = parseSessionMaintenanceProjection(value.accepted_projection);
  const projectionDigest = digestSessionMaintenanceProjection(projection);
  if (
    value.schema_version !== 1
    || (value.state !== "validated_noncanonical" && value.state !== "committed")
    || value.reference_scope !== "ingest_job_relative"
    || typeof value.reference_base !== "string"
    || value.accepted_projection_digest !== projectionDigest
    || typeof value.validated_at !== "string"
    || followup.accepted_projection_digest !== projectionDigest
  ) throw new Error(`Invalid Session maintenance projection result for ingest job ${ingestJobId}`);
  return {
    schema_version: 1,
    state: value.state,
    reference_scope: "ingest_job_relative",
    reference_base: value.reference_base,
    accepted_projection_digest: projectionDigest,
    accepted_projection: projection,
    validated_at: value.validated_at,
  };
}

export function resolveSessionMaintenanceProjectionReference(
  result: SessionMaintenanceProjectionResultRecord,
  reference: string,
): unknown | null {
  const separator = reference.indexOf("/");
  if (separator <= 0 || separator === reference.length - 1 || reference.indexOf("/", separator + 1) !== -1) return null;
  const collection = reference.slice(0, separator);
  const id = reference.slice(separator + 1);
  if (collection === "session_memories") return result.accepted_projection.session_memories.find((item) => item.id === id) ?? null;
  if (collection === "memory_candidates") return result.accepted_projection.memory_candidates.find((item) => item.id === id) ?? null;
  if (collection === "handoff_instructions") return result.accepted_projection.handoff_instructions.find((item) => item.id === id) ?? null;
  if (collection === "memory_dispositions") return result.accepted_projection.memory_dispositions.find((item) => item.memory_id === id) ?? null;
  return null;
}

/** Resolves an archived v1 one-shot result. Current SMC jobs use projection results above. */
export function resolveSessionMaintenanceResultReference(
  result: SessionMaintenanceResultRecord,
  reference: string,
): unknown | null {
  const separator = reference.indexOf("/");
  if (separator <= 0 || separator === reference.length - 1) return null;
  const collection = reference.slice(0, separator);
  const id = reference.slice(separator + 1);
  if (collection === "session_memories") {
    return result.accepted_output.session_memories.find((item) => item.id === id) ?? null;
  }
  if (collection === "memory_candidates") {
    return result.accepted_output.memory_candidates.find((item) => item.id === id) ?? null;
  }
  if (collection === "handoff_instructions") {
    return result.accepted_output.handoff_instructions.find((item) => item.id === id) ?? null;
  }
  if (collection === "memory_dispositions") {
    return result.accepted_output.memory_dispositions.find((item) => item.memory_id === id) ?? null;
  }
  return null;
}

export function readSessionMaintenanceResult(
  db: Database,
  ingestJobId: string,
): SessionMaintenanceResultRecord | null {
  const row = db
    .query("SELECT followup_state_json FROM ingest_jobs WHERE id = ?")
    .get(ingestJobId) as { followup_state_json: string | null } | null;
  if (!row?.followup_state_json) return null;
  const followup = parseObject(row.followup_state_json);
  const raw = followup.session_maintenance_result;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const output = parseSessionMaintenanceOutput(record.accepted_output);
  const digest = digestAcceptedOutput(output);
  if (record.accepted_output_digest !== digest) {
    throw new Error(`Session maintenance result digest mismatch for ingest job ${ingestJobId}`);
  }
  const identity = parseIdentity(record.output_contract_identity);
  if (
    record.schema_version !== 1
    || record.reference_scope !== "ingest_job_relative"
    || typeof record.reference_base !== "string"
    || typeof record.accepted_at !== "string"
  ) {
    throw new Error(`Invalid Session maintenance result record for ingest job ${ingestJobId}`);
  }
  return {
    schema_version: 1,
    reference_scope: "ingest_job_relative",
    reference_base: record.reference_base,
    output_contract_identity: identity,
    accepted_output_digest: digest,
    accepted_output: output,
    accepted_at: record.accepted_at,
  };
}

export function resolveIngestJobOutputReference(
  db: Database,
  input: { ingestJobId: string; reference: string },
): unknown | null {
  const result = readSessionMaintenanceResult(db, input.ingestJobId);
  return result ? resolveSessionMaintenanceResultReference(result, input.reference) : null;
}

export function digestAcceptedOutput(output: SessionMaintenanceOutput): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(output), "utf8").digest("hex")}`;
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function parseIdentity(value: unknown): SessionMaintenanceIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Session maintenance output contract identity");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.version !== "string"
    || typeof record.digest !== "string"
    || !record.digest.startsWith("sha256:")
  ) {
    throw new Error("Invalid Session maintenance output contract identity");
  }
  return {
    version: record.version,
    digest: record.digest as `sha256:${string}`,
  };
}
