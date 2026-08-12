import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { leaseExperienceEventForAnchorInOpenTransaction } from "../memory/experience.ts";
import { stableJson } from "../runtime/json.ts";
import {
  planSessionMaintenanceEvidence,
  frozenAuditSelection,
  type SMCEvidencePreparationPlan,
} from "./evidence-selection.ts";
import {
  sessionMaintenanceOutputContractIdentity,
  sessionMaintenancePolicyIdentity,
  sessionMaintenanceToolProtocolIdentity,
} from "./identity.ts";

export class SessionEvidencePlanChangedError extends Error {
  readonly code = "session_evidence_plan_changed" as const;

  constructor(message: string) {
    super(`${"session_evidence_plan_changed"}: ${message}`);
    this.name = "SessionEvidencePlanChangedError";
  }
}

export type FrozenEvidenceSnapshot = {
  job_id: string;
  evidence_count: number;
  no_agent_intent_count: number;
  batch_count: number;
  total_encoded_bytes: number;
  digest: `sha256:${string}`;
};

export function revalidateLeaseAndCopyEvidenceInOpenTransaction(
  db: Database,
  input: {
    plan: SMCEvidencePreparationPlan;
    owner_epoch: number;
    claimed_at: string;
  },
): FrozenEvidenceSnapshot {
  if (!db.inTransaction) throw new Error("SMC evidence snapshot requires an open transaction");
  const currentGoverningIdentities = {
    policy: sessionMaintenancePolicyIdentity(),
    output_contract: sessionMaintenanceOutputContractIdentity(),
    tool_protocol: sessionMaintenanceToolProtocolIdentity(),
  };
  const plannedGoverningIdentities = {
    policy: input.plan.governing_identities.policy,
    output_contract: input.plan.governing_identities.output_contract,
    tool_protocol: input.plan.governing_identities.tool_protocol,
  };
  if (stableJson(currentGoverningIdentities) !== stableJson(plannedGoverningIdentities)) {
    throw new SessionEvidencePlanChangedError("governing Session Memory identities changed after planning");
  }
  const actual = planSessionMaintenanceEvidence(db, {
    anchor_job_id: input.plan.anchor_job_id,
    project_key: input.plan.project_key,
    trigger_reason: input.plan.trigger_reason,
    compatibility_selection_limit: input.plan.compatibility_selection_limit,
    governing_identities: input.plan.governing_identities,
    budgets: input.plan.budgets,
    include_audit: input.plan.audit_selection.members.length > 0,
    audit_partition_limit: input.plan.audit_selection.members.length > 0
      ? input.plan.audit_selection.members.length
      : undefined,
  });
  if (actual.kind !== "planned" || stableJson(actual.plan) !== stableJson(input.plan)) {
    throw new SessionEvidencePlanChangedError(
      "selected Experience Log evidence changed after deterministic planning",
    );
  }

  const ordered = new Map(input.plan.ordered_source_ids.map((sourceId, ordinal) => [sourceId, ordinal]));
  const insertEvidence = db.query(
    `INSERT INTO smc_evidence_snapshot
      (job_id, source_id, ordinal, tombstone_id, content_hash, encoded_bytes, evidence_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of input.plan.evidence) {
    const ordinal = ordered.get(item.source_id);
    if (ordinal === undefined) throw new SessionEvidencePlanChangedError(`missing evidence ordinal for ${item.source_id}`);
    const tombstoneId = stableTombstoneId(input.plan.anchor_job_id, item.source_id);
    leaseExperienceEventForAnchorInOpenTransaction(db, {
      ingest_job_id: input.plan.anchor_job_id,
      project_key: input.plan.project_key,
      source_id: item.source_id,
      tombstone_id: tombstoneId,
      claimed_at: input.claimed_at,
      owner_epoch: input.owner_epoch,
    });
    insertEvidence.run(
      input.plan.anchor_job_id,
      item.source_id,
      ordinal,
      tombstoneId,
      item.content_hash,
      item.encoded_bytes,
      stableJson(item.evidence),
    );
  }

  const insertIntent = db.query(
    `INSERT INTO smc_no_agent_intents
      (job_id, source_id, ordinal, tombstone_id, source_hash, reason, terminal_state, terminal_decision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const intent of input.plan.no_agent_intents) {
    const ordinal = ordered.get(intent.source_id);
    if (ordinal === undefined) throw new SessionEvidencePlanChangedError(`missing no-agent ordinal for ${intent.source_id}`);
    const tombstoneId = stableTombstoneId(input.plan.anchor_job_id, intent.source_id);
    leaseExperienceEventForAnchorInOpenTransaction(db, {
      ingest_job_id: input.plan.anchor_job_id,
      project_key: input.plan.project_key,
      source_id: intent.source_id,
      tombstone_id: tombstoneId,
      claimed_at: input.claimed_at,
      owner_epoch: input.owner_epoch,
    });
    insertIntent.run(
      input.plan.anchor_job_id,
      intent.source_id,
      ordinal,
      tombstoneId,
      intent.source_hash,
      intent.reason,
      intent.terminal_state,
      intent.terminal_decision,
    );
  }

  const insertBatch = db.query(
    `INSERT INTO smc_work_batches
      (job_id, batch_id, ordinal, work_kind, item_count, encoded_bytes, batch_digest)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMember = db.query(
    `INSERT INTO smc_evidence_batch_members
      (job_id, batch_id, work_kind, source_id, ordinal, content_hash)
     VALUES (?, ?, 'evidence', ?, ?, ?)`,
  );
  for (const batch of input.plan.batches) {
    const batchDigest = digest(batch);
    insertBatch.run(
      input.plan.anchor_job_id,
      batch.id,
      batch.ordinal,
      batch.work_kind,
      batch.item_count,
      batch.encoded_bytes,
      batchDigest,
    );
    batch.source_ids.forEach((sourceId, ordinal) => {
      insertMember.run(
        input.plan.anchor_job_id,
        batch.id,
        sourceId,
        ordinal,
        batch.content_hashes[ordinal],
      );
    });
  }
  const auditBatch = input.plan.batches.find((batch) => batch.work_kind === "audit");
  if (auditBatch) {
    const insertAuditMember = db.query(
      `INSERT INTO smc_audit_batch_members
        (job_id, batch_id, work_kind, memory_id, ordinal, revision, state_digest,
         selection_basis, prior_audit_at, member_digest)
       VALUES (?, ?, 'audit', ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const member of input.plan.audit_selection.members) {
      insertAuditMember.run(
        input.plan.anchor_job_id,
        auditBatch.id,
        member.memory_id,
        member.ordinal,
        member.revision,
        member.state_digest,
        member.selection_basis,
        member.prior_audit_at,
        member.member_digest,
      );
    }
  }

  return {
    job_id: input.plan.anchor_job_id,
    evidence_count: input.plan.evidence.length,
    no_agent_intent_count: input.plan.no_agent_intents.length,
    batch_count: input.plan.batches.length,
    total_encoded_bytes: input.plan.total_encoded_bytes,
    digest: digest({
      plan_identity: input.plan.plan_identity,
      ordered_source_ids: input.plan.ordered_source_ids,
      evidence: input.plan.evidence,
      batches: input.plan.batches,
      audit_selection: frozenAuditSelection(input.plan.audit_selection),
      no_agent_intents: input.plan.no_agent_intents,
    }),
  };
}

function stableTombstoneId(jobId: string, sourceId: string): string {
  const hex = createHash("sha256").update(stableJson({ job_id: jobId, source_id: sourceId })).digest("hex");
  return `smc_tomb_${hex}`;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}
