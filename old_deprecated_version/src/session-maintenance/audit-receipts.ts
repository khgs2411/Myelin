import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { readActiveEmbeddingContract } from "../memory/embedding-contract-store.ts";
import type { SessionMemoryRow } from "../memory/ingest-types.ts";
import { stableJson } from "../runtime/json.ts";
import type { SessionMaintenanceIdentity } from "./identity.ts";
import type { SMCManifest } from "./manifest.ts";

export type SessionMemoryAuditReceipt = Readonly<{
  id: string;
  project_key: string;
  memory_id: string;
  reviewed_revision: number;
  reviewed_state_digest: string;
  job_id: string;
  work_batch_id: string;
  manifest_digest: string;
  accepted_projection_digest: string;
  policy_version: string;
  policy_digest: string;
  output_contract_version: string;
  output_contract_digest: string;
  tool_protocol_version: string;
  tool_protocol_digest: string;
  embedding_contract_id: string;
  disposition: "keep" | "supersede" | "retract";
  resulting_status: "active" | "superseded" | "retracted";
  resulting_revision: number;
  resulting_state_digest: string;
  receipt_digest: string;
  created_at: string;
}>;

export function writeSessionMemoryAuditReceiptInOpenTransaction(
  db: Database,
  input: {
    manifest: SMCManifest;
    memory_id: string;
    work_batch_id: string;
    reviewed_revision: number;
    reviewed_state_digest: string;
    disposition: "keep" | "supersede" | "retract";
    accepted_projection_digest: string;
    created_at: string;
  },
): SessionMemoryAuditReceipt {
  if (!db.inTransaction) throw new Error("Session Memory audit receipt storage requires an open transaction");
  const memory = db.query(
    `SELECT * FROM session_memories WHERE id = ? AND project_key = ?`,
  ).get(input.memory_id, input.manifest.project_key) as SessionMemoryRow | null;
  if (!memory) throw new Error(`session_memory_audit_target_missing: ${input.memory_id}`);
  const exact = db.query(
    `SELECT * FROM session_memory_audit_receipts
     WHERE memory_id = ? AND reviewed_revision = ? AND reviewed_state_digest = ?
       AND policy_version = ? AND policy_digest = ?
       AND output_contract_version = ? AND output_contract_digest = ?
       AND tool_protocol_version = ? AND tool_protocol_digest = ?
       AND embedding_contract_id = ?`,
  ).get(
    memory.id,
    input.reviewed_revision,
    input.reviewed_state_digest,
    input.manifest.governing_identities.policy.version,
    input.manifest.governing_identities.policy.digest,
    input.manifest.governing_identities.output_contract.version,
    input.manifest.governing_identities.output_contract.digest,
    input.manifest.governing_identities.tool_protocol.version,
    input.manifest.governing_identities.tool_protocol.digest,
    input.manifest.embedding_contract_id,
  ) as SessionMemoryAuditReceipt | null;
  if (exact) {
    if (
      exact.job_id !== input.manifest.job_id
      || exact.work_batch_id !== input.work_batch_id
      || exact.manifest_digest !== input.manifest.manifest_digest
      || exact.accepted_projection_digest !== input.accepted_projection_digest
      || exact.disposition !== input.disposition
      || exact.resulting_status !== memory.status
      || exact.resulting_revision !== memory.revision
      || exact.resulting_state_digest !== memory.state_digest
    ) throw new Error("session_memory_audit_receipt_conflict");
    return exact;
  }
  const body = receiptBody(input, memory);
  const id = `smc_audit_${sha256(stableJson(body))}`;
  const receiptDigest = digest(body);
  const existing = readSessionMemoryAuditReceipt(db, id);
  if (existing) {
    if (existing.receipt_digest !== receiptDigest) throw new Error("session_memory_audit_receipt_conflict");
    return existing;
  }
  db.query(
    `INSERT INTO session_memory_audit_receipts
      (id, project_key, memory_id, reviewed_revision, reviewed_state_digest, job_id, work_batch_id,
       manifest_digest, accepted_projection_digest,
       policy_version, policy_digest, output_contract_version, output_contract_digest,
       tool_protocol_version, tool_protocol_digest, embedding_contract_id, disposition,
       resulting_status, resulting_revision, resulting_state_digest, receipt_digest, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    body.project_key,
    body.memory_id,
    body.reviewed_revision,
    body.reviewed_state_digest,
    body.job_id,
    body.work_batch_id,
    body.manifest_digest,
    body.accepted_projection_digest,
    body.policy.version,
    body.policy.digest,
    body.output_contract.version,
    body.output_contract.digest,
    body.tool_protocol.version,
    body.tool_protocol.digest,
    body.embedding_contract_id,
    body.disposition,
    body.resulting_status,
    body.resulting_revision,
    body.resulting_state_digest,
    receiptDigest,
    body.created_at,
  );
  return readSessionMemoryAuditReceipt(db, id)!;
}

export function readSessionMemoryAuditReceipt(
  db: Database,
  id: string,
): SessionMemoryAuditReceipt | null {
  return (db.query("SELECT * FROM session_memory_audit_receipts WHERE id = ?").get(id) as
    SessionMemoryAuditReceipt | null) ?? null;
}

export function listCurrentSessionMemoryAuditCoverage(
  db: Database,
  input: {
    project_key: string;
    policy: SessionMaintenanceIdentity;
    output_contract: SessionMaintenanceIdentity;
    tool_protocol: SessionMaintenanceIdentity;
  },
): SessionMemoryAuditReceipt[] {
  const embedding = readActiveEmbeddingContract(db, "session_memory");
  if (!embedding) return [];
  return db.query(
    `SELECT r.*
     FROM session_memory_audit_receipts r
     JOIN session_memories m
       ON m.id = r.memory_id
      AND m.project_key = r.project_key
      AND m.status = 'active'
      AND r.resulting_status = 'active'
      AND m.revision = r.resulting_revision
      AND m.state_digest = r.resulting_state_digest
     WHERE r.project_key = ?
       AND r.policy_version = ? AND r.policy_digest = ?
       AND r.output_contract_version = ? AND r.output_contract_digest = ?
       AND r.tool_protocol_version = ? AND r.tool_protocol_digest = ?
       AND r.embedding_contract_id = ?
     ORDER BY r.memory_id`,
  ).all(
    input.project_key,
    input.policy.version,
    input.policy.digest,
    input.output_contract.version,
    input.output_contract.digest,
    input.tool_protocol.version,
    input.tool_protocol.digest,
    embedding.id,
  ) as SessionMemoryAuditReceipt[];
}

function receiptBody(
  input: Parameters<typeof writeSessionMemoryAuditReceiptInOpenTransaction>[1],
  memory: SessionMemoryRow,
) {
  return {
    schema_version: 1,
    project_key: input.manifest.project_key,
    memory_id: memory.id,
    reviewed_revision: input.reviewed_revision,
    reviewed_state_digest: input.reviewed_state_digest,
    job_id: input.manifest.job_id,
    work_batch_id: input.work_batch_id,
    manifest_digest: input.manifest.manifest_digest,
    accepted_projection_digest: input.accepted_projection_digest,
    policy: input.manifest.governing_identities.policy,
    output_contract: input.manifest.governing_identities.output_contract,
    tool_protocol: input.manifest.governing_identities.tool_protocol,
    embedding_contract_id: input.manifest.embedding_contract_id,
    disposition: input.disposition,
    resulting_status: memory.status,
    resulting_revision: memory.revision,
    resulting_state_digest: memory.state_digest,
    created_at: input.created_at,
  } as const;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${sha256(stableJson(value))}`;
}
