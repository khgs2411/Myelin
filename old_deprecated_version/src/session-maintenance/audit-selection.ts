import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { readActiveEmbeddingContract } from "../memory/embedding-contract-store.ts";
import { stableJson } from "../runtime/json.ts";
import type { SMCGoverningIdentities } from "./evidence-selection.ts";

export const SMC_AUDIT_SELECTION_ALGORITHM_DIGEST = digest({
  schema_version: 1,
  eligibility: "active-current-revision-without-current-governing-receipt",
  order: ["prior_audit_at_or_created_at", "updated_at", "memory_id"],
  partition_limit: "configured_audit_partition_limit",
});

export type SMCAuditSelectionBasis = "never_audited" | "least_recent_audit" | "identity_invalidated";

export type SMCAuditBatchMember = Readonly<{
  memory_id: string;
  revision: number;
  state_digest: string;
  ordinal: number;
  selection_basis: SMCAuditSelectionBasis;
  prior_audit_at: string | null;
  member_digest: `sha256:${string}`;
}>;

export type SMCAuditSelection = Readonly<{
  algorithm_digest: `sha256:${string}`;
  selection_digest: `sha256:${string}`;
  work_batch_id: string | null;
  work_kind: "audit";
  due_count: number;
  members: readonly SMCAuditBatchMember[];
}>;

export function selectDueSessionMemoryAuditPartition(
  db: Database,
  input: {
    project_key: string;
    governing_identities: Pick<SMCGoverningIdentities, "policy" | "output_contract" | "tool_protocol">;
    limit: number;
  },
): SMCAuditSelection {
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) throw new Error("invalid_smc_audit_partition_limit");
  const embedding = readActiveEmbeddingContract(db, "session_memory");
  if (!embedding) return emptySessionMemoryAuditSelection();
  const params = [
    input.project_key,
    input.governing_identities.policy.version,
    input.governing_identities.policy.digest,
    input.governing_identities.output_contract.version,
    input.governing_identities.output_contract.digest,
    input.governing_identities.tool_protocol.version,
    input.governing_identities.tool_protocol.digest,
    embedding.id,
    input.project_key,
  ] as const;
  const dueCount = (db.query(
    `${dueAuditCte()}
     SELECT count(*) AS count FROM due`,
  ).get(...params) as { count: number }).count;
  const rows = db.query(
    `${dueAuditCte()}
     SELECT memory_id, revision, state_digest, created_at, updated_at, prior_audit_at,
            CASE
              WHEN prior_audit_at IS NULL THEN 'never_audited'
              WHEN same_revision_receipt_count > 0 THEN 'identity_invalidated'
              ELSE 'least_recent_audit'
            END AS selection_basis
     FROM due
     ORDER BY COALESCE(prior_audit_at, created_at), updated_at, memory_id
     LIMIT ?`,
  ).all(...params, input.limit) as Array<{
    memory_id: string;
    revision: number;
    state_digest: string;
    prior_audit_at: string | null;
    selection_basis: SMCAuditSelectionBasis;
  }>;
  const members = rows.map((row, ordinal) => {
    const body = {
      memory_id: row.memory_id,
      revision: row.revision,
      state_digest: row.state_digest,
      ordinal,
      selection_basis: row.selection_basis,
      prior_audit_at: row.prior_audit_at,
    };
    return { ...body, member_digest: digest(body) };
  });
  return {
    algorithm_digest: SMC_AUDIT_SELECTION_ALGORITHM_DIGEST,
    selection_digest: auditSelectionDigest({
      algorithm_digest: SMC_AUDIT_SELECTION_ALGORITHM_DIGEST,
      work_batch_id: null,
      members,
    }),
    work_batch_id: null,
    work_kind: "audit",
    due_count: dueCount,
    members,
  };
}

export function bindSessionMemoryAuditSelectionToBatch(
  selection: SMCAuditSelection,
  input: { anchor_job_id: string },
): SMCAuditSelection {
  if (selection.members.length === 0) return emptySessionMemoryAuditSelection();
  const workBatchId = stableSessionMemoryAuditBatchId({
    anchor_job_id: input.anchor_job_id,
    algorithm_digest: selection.algorithm_digest,
    members: selection.members,
  });
  const members = selection.members.map((member) => ({
    ...member,
    member_digest: sessionMemoryAuditMemberDigest({
      job_id: input.anchor_job_id,
      batch_id: workBatchId,
      work_kind: "audit",
      ...member,
    }),
  }));
  return {
    ...selection,
    work_batch_id: workBatchId,
    work_kind: "audit",
    selection_digest: auditSelectionDigest({
      algorithm_digest: selection.algorithm_digest,
      work_batch_id: workBatchId,
      members,
    }),
    members,
  };
}

export function stableSessionMemoryAuditBatchId(input: {
  anchor_job_id: string;
  algorithm_digest: string;
  members: readonly Pick<SMCAuditBatchMember,
    "memory_id" | "revision" | "state_digest" | "ordinal" | "selection_basis" | "prior_audit_at">[];
}): string {
  return `smc_audit_batch_${digest({
    schema_version: 1,
    anchor_job_id: input.anchor_job_id,
    work_kind: "audit",
    algorithm_digest: input.algorithm_digest,
    members: input.members.map(memberCore),
  }).slice(7)}`;
}

export function sessionMemoryAuditMemberDigest(input: {
  job_id: string;
  batch_id: string;
  work_kind: "audit";
  memory_id: string;
  revision: number;
  state_digest: string;
  ordinal: number;
  selection_basis: SMCAuditSelectionBasis;
  prior_audit_at: string | null;
}): `sha256:${string}` {
  return digest({
    schema_version: 1,
    job_id: input.job_id,
    batch_id: input.batch_id,
    work_kind: input.work_kind,
    ...memberCore(input),
  });
}

export function auditSelectionDigest(input: {
  algorithm_digest: string;
  work_batch_id: string | null;
  members: readonly SMCAuditBatchMember[];
}): `sha256:${string}` {
  return digest({
    algorithm_digest: input.algorithm_digest,
    work_batch_id: input.work_batch_id,
    work_kind: "audit",
    members: input.members,
  });
}

function memberCore(member: Pick<SMCAuditBatchMember,
  "memory_id" | "revision" | "state_digest" | "ordinal" | "selection_basis" | "prior_audit_at">) {
  return {
    memory_id: member.memory_id,
    revision: member.revision,
    state_digest: member.state_digest,
    ordinal: member.ordinal,
    selection_basis: member.selection_basis,
    prior_audit_at: member.prior_audit_at,
  };
}

function dueAuditCte(): string {
  return `WITH current_receipts AS (
      SELECT r.memory_id
      FROM session_memory_audit_receipts r
      JOIN session_memories m
        ON m.id = r.memory_id AND m.project_key = r.project_key
       AND m.status = 'active'
       AND m.revision = r.resulting_revision
       AND m.state_digest = r.resulting_state_digest
       AND r.resulting_status = 'active'
      WHERE r.project_key = ?
        AND r.policy_version = ? AND r.policy_digest = ?
        AND r.output_contract_version = ? AND r.output_contract_digest = ?
        AND r.tool_protocol_version = ? AND r.tool_protocol_digest = ?
        AND r.embedding_contract_id = ?
    ), receipt_history AS (
      SELECT r.memory_id, max(r.created_at) AS prior_audit_at,
             sum(CASE WHEN r.reviewed_revision = m.revision AND r.reviewed_state_digest = m.state_digest THEN 1 ELSE 0 END)
               AS same_revision_receipt_count
      FROM session_memory_audit_receipts r
      JOIN session_memories m ON m.id = r.memory_id
      GROUP BY memory_id
    ), due AS (
      SELECT m.id AS memory_id, m.revision, m.state_digest, m.created_at, m.updated_at,
             h.prior_audit_at, COALESCE(h.same_revision_receipt_count, 0) AS same_revision_receipt_count
      FROM session_memories m
      LEFT JOIN current_receipts c ON c.memory_id = m.id
      LEFT JOIN receipt_history h ON h.memory_id = m.id
      WHERE m.project_key = ? AND m.status = 'active' AND c.memory_id IS NULL
    )`;
}

export function emptySessionMemoryAuditSelection(): SMCAuditSelection {
  return {
    algorithm_digest: SMC_AUDIT_SELECTION_ALGORITHM_DIGEST,
    selection_digest: auditSelectionDigest({
      algorithm_digest: SMC_AUDIT_SELECTION_ALGORITHM_DIGEST,
      work_batch_id: null,
      members: [],
    }),
    work_batch_id: null,
    work_kind: "audit",
    due_count: 0,
    members: [],
  };
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}
