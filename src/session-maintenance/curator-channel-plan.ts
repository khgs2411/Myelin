import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { stableJson } from "../runtime/json.ts";
import { listSMCCoverageReceipts } from "./coverage-receipts.ts";
import { reconstructSMCOverlay } from "./overlay-store.ts";
import {
  CURATOR_RETRIEVAL_CHANNELS,
  type CuratorAffectedWorkSetMember,
  type CuratorMemoryRevisionIdentity,
  type CuratorRetrievalChannel,
} from "./curator-retrieval-types.ts";

export const CURATOR_CHANNEL_NORMALIZATION_IDENTITY = digest({
  schema_version: 1,
  exact_reference_syntax: "session_memories/<opaque-id>",
  structured_metadata_only: true,
  path_branch_case_sensitive: true,
  commit_ascii_lowercase: true,
  topic_entity_nfkc_lowercase: true,
});

export type CuratorChannelObligation = Readonly<{
  id: string;
  kind: "text" | "exact" | "metadata" | "link" | "overlay";
  required_channels: readonly CuratorRetrievalChannel[];
  selector: Readonly<Record<string, unknown>>;
  provenance: readonly string[];
}>;

export type CuratorBatchChannelPlan = Readonly<{
  schema_version: 1;
  job_id: string;
  work_batch_id: string;
  plan_revision: number;
  parent_plan_digest: string | null;
  manifest_digest: string;
  snapshot_token: string;
  overlay_revision: number;
  overlay_digest: string;
  work_batch_digest: string;
  affected_work_set_digest: string;
  normalization_identity: string;
  input_digest: string;
  applicable_channels: readonly CuratorRetrievalChannel[];
  obligations: readonly CuratorChannelObligation[];
  plan_digest: string;
  created_at: string;
}>;

type PlanRow = {
  job_id: string;
  work_batch_id: string;
  plan_revision: number;
  parent_plan_digest: string | null;
  manifest_digest: string;
  snapshot_token: string;
  overlay_revision: number;
  overlay_digest: string;
  work_batch_digest: string;
  affected_work_set_digest: string;
  normalization_identity: string;
  plan_json: string;
  plan_digest: string;
  created_at: string;
};

export function ensureCuratorBatchChannelPlan(
  db: Database,
  input: {
    job_id: string;
    work_batch_id: string;
    manifest_digest: string;
    snapshot_token: string;
    overlay_revision: number;
    overlay_digest: string;
    created_at?: string;
  },
): CuratorBatchChannelPlan {
  const run = () => {
    const latest = readLatestCuratorBatchChannelPlan(db, input);
    const derived = derivePlanInput(db, input);
    if (latest?.input_digest === derived.input_digest
      && latest.overlay_revision === input.overlay_revision
      && latest.overlay_digest === input.overlay_digest) return latest;

    const prior = latest?.obligations.filter((obligation) => obligation.kind !== "overlay") ?? [];
    const obligations = unionObligations(prior, derived.obligations);
    const applicableChannels = CURATOR_RETRIEVAL_CHANNELS.filter((channel) =>
      obligations.some((obligation) => obligation.required_channels.includes(channel)));
    const planRevision = (latest?.plan_revision ?? 0) + 1;
    const createdAt = input.created_at ?? new Date().toISOString();
    const body = {
      schema_version: 1 as const,
      job_id: input.job_id,
      work_batch_id: input.work_batch_id,
      plan_revision: planRevision,
      parent_plan_digest: latest?.plan_digest ?? null,
      manifest_digest: input.manifest_digest,
      snapshot_token: input.snapshot_token,
      overlay_revision: input.overlay_revision,
      overlay_digest: input.overlay_digest,
      work_batch_digest: derived.work_batch_digest,
      affected_work_set_digest: derived.affected_work_set_digest,
      normalization_identity: CURATOR_CHANNEL_NORMALIZATION_IDENTITY,
      input_digest: derived.input_digest,
      applicable_channels: applicableChannels,
      obligations,
      created_at: createdAt,
    };
    const plan: CuratorBatchChannelPlan = { ...body, plan_digest: digest(body) };
    db.query(
      `INSERT INTO smc_curator_batch_channel_plans
        (job_id, work_batch_id, plan_revision, parent_plan_digest, manifest_digest, snapshot_token,
         overlay_revision, overlay_digest, work_batch_digest, affected_work_set_digest,
         normalization_identity, plan_json, plan_digest, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      plan.job_id,
      plan.work_batch_id,
      plan.plan_revision,
      plan.parent_plan_digest,
      plan.manifest_digest,
      plan.snapshot_token,
      plan.overlay_revision,
      plan.overlay_digest,
      plan.work_batch_digest,
      plan.affected_work_set_digest,
      plan.normalization_identity,
      stableJson(body),
      plan.plan_digest,
      plan.created_at,
    );
    return plan;
  };
  return db.inTransaction ? run() : db.transaction(run).immediate();
}

export function readLatestCuratorBatchChannelPlan(
  db: Database,
  input: { job_id: string; work_batch_id: string },
): CuratorBatchChannelPlan | null {
  const row = db.query(
    `SELECT * FROM smc_curator_batch_channel_plans
     WHERE job_id = ? AND work_batch_id = ? ORDER BY plan_revision DESC LIMIT 1`,
  ).get(input.job_id, input.work_batch_id) as PlanRow | null;
  return row ? decodePlanRow(row) : null;
}

export function readCuratorBatchChannelPlan(
  db: Database,
  input: { job_id: string; work_batch_id: string; plan_revision: number },
): CuratorBatchChannelPlan | null {
  const row = db.query(
    `SELECT * FROM smc_curator_batch_channel_plans
     WHERE job_id = ? AND work_batch_id = ? AND plan_revision = ?`,
  ).get(input.job_id, input.work_batch_id, input.plan_revision) as PlanRow | null;
  return row ? decodePlanRow(row) : null;
}

export function readDurableCuratorAffectedWorkSet(
  db: Database,
  input: { job_id: string; work_batch_id: string },
): CuratorAffectedWorkSetMember[] {
  const members = new Map<string, CuratorAffectedWorkSetMember>();
  const auditMembers = db.query(
    `SELECT memory_id, revision, state_digest
     FROM smc_audit_batch_members
     WHERE job_id = ? AND batch_id = ? ORDER BY ordinal`,
  ).all(input.job_id, input.work_batch_id) as Array<{
    memory_id: string; revision: number; state_digest: string;
  }>;
  for (const member of auditMembers) {
    members.set(member.memory_id, {
      stable_id: member.memory_id,
      revision_identity: {
        origin: "base",
        revision: member.revision,
        state_digest: member.state_digest,
      },
    });
  }
  for (const receipt of listSMCCoverageReceipts(db, { ...input, receipt_kind: "work_set" })) {
    const payload = receipt.payload as { schema_version?: unknown; members?: unknown };
    if (payload.schema_version !== 1 || !Array.isArray(payload.members)) {
      throw new Error(`invalid_curator_work_set_receipt: ${receipt.id}`);
    }
    for (const value of payload.members) {
      if (!isRecord(value) || typeof value.stable_id !== "string" || !isRevisionIdentity(value.revision_identity)) {
        throw new Error(`invalid_curator_work_set_receipt: ${receipt.id}`);
      }
      const member = value as CuratorAffectedWorkSetMember;
      const existing = members.get(member.stable_id);
      if (existing && stableJson(existing.revision_identity) !== stableJson(member.revision_identity)) {
        throw new Error(`curator_work_set_revision_conflict: ${member.stable_id}`);
      }
      members.set(member.stable_id, member);
    }
  }
  return [...members.values()].sort((left, right) => compareText(left.stable_id, right.stable_id));
}

function derivePlanInput(
  db: Database,
  input: Parameters<typeof ensureCuratorBatchChannelPlan>[1],
): {
  work_batch_digest: string;
  affected_work_set_digest: string;
  input_digest: string;
  obligations: CuratorChannelObligation[];
} {
  const batch = db.query(
    `SELECT batch_digest, work_kind FROM smc_work_batches WHERE job_id = ? AND batch_id = ?`,
  ).get(input.job_id, input.work_batch_id) as { batch_digest: string; work_kind: "evidence" | "audit" } | null;
  if (!batch) throw new Error("curator_channel_plan_missing_batch");
  const evidenceRows = db.query(
    `SELECT s.source_id, s.content_hash, s.evidence_json
     FROM smc_evidence_batch_members b
     JOIN smc_evidence_snapshot s ON s.job_id = b.job_id AND s.source_id = b.source_id
     WHERE b.job_id = ? AND b.batch_id = ? ORDER BY b.ordinal`,
  ).all(input.job_id, input.work_batch_id) as Array<{ source_id: string; content_hash: string; evidence_json: string }>;
  const workSet = readDurableCuratorAffectedWorkSet(db, input);
  const obligations: CuratorChannelObligation[] = [];
  if (batch.work_kind === "audit") {
    for (const member of workSet) {
      obligations.push(obligation("exact", ["exact"], { memory_id: member.stable_id }, [`audit:${member.stable_id}`]));
    }
  }
  for (const row of evidenceRows) {
    const evidence = JSON.parse(row.evidence_json) as Record<string, unknown>;
    const scope = evidenceScope(evidence);
    if (typeof evidence.raw_text === "string" && evidence.raw_text.trim() !== "") {
      obligations.push(obligation("text", ["lexical", "semantic"], {
        source_id: row.source_id,
        content_hash: row.content_hash,
        scope,
      }, [`evidence:${row.source_id}`]));
      for (const memoryId of extractCanonicalMemoryReferences(evidence.raw_text)) {
        obligations.push(obligation("exact", ["exact"], {
          memory_id: memoryId, source_id: row.source_id, content_hash: row.content_hash, scope,
        }, [`evidence:${row.source_id}`]));
        obligations.push(obligation("link", ["link"], {
          stable_id: memoryId, source_id: row.source_id, content_hash: row.content_hash, scope,
        }, [`evidence:${row.source_id}`]));
      }
    }
  }

  const overlay = reconstructSMCOverlay(db, { job_id: input.job_id, revision: input.overlay_revision });
  if (overlay.identity.digest !== input.overlay_digest) throw new Error("curator_channel_plan_overlay_identity_mismatch");
  if (overlay.records.length > 0) {
    obligations.push(obligation("overlay", ["overlay"], {
      revision: overlay.identity.revision,
      digest: overlay.identity.digest,
    }, [`overlay:${overlay.identity.revision}`]));
  }
  const sorted = unionObligations(obligations);
  // Kept only for the pre-release migration-21 row shape. It is deliberately
  // invariant: affected members never feed recall-plan identity or expansion.
  const affectedWorkSetDigest = digest([]);
  const inputDigest = digest({
    batch_digest: batch.batch_digest,
    overlay: overlay.identity,
    normalization_identity: CURATOR_CHANNEL_NORMALIZATION_IDENTITY,
    derived_obligations: sorted,
  });
  return {
    work_batch_digest: batch.batch_digest,
    affected_work_set_digest: affectedWorkSetDigest,
    input_digest: inputDigest,
    obligations: sorted,
  };
}

function evidenceScope(evidence: Record<string, unknown>): Record<string, string> {
  const scope: Record<string, string> = {};
  for (const field of ["repo_path", "git_branch", "git_commit"] as const) {
    const raw = evidence[field];
    if (typeof raw !== "string") continue;
    const value = normalizeCuratorMetadataValue(field, raw);
    if (value !== "") scope[field] = value;
  }
  return scope;
}

export function normalizeCuratorMetadataValue(field: string, raw: string): string {
  const value = raw.normalize("NFC").trim();
  if (field === "git_commit") return /^[0-9a-fA-F]+$/.test(value) ? value.toLowerCase() : "";
  if (field === "topic" || field === "entity") return value.normalize("NFKC").replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
  if (field === "repo_path") return value.replaceAll("\\", "/");
  return value;
}

export function extractCanonicalMemoryReferences(text: string): string[] {
  const values: string[] = [];
  const pattern = /(?:^|[^\p{L}\p{N}_])session_memories\/([^\s`"'<>()[\]{},;]+)(?=$|[^\p{L}\p{N}_])/gu;
  for (const match of text.matchAll(pattern)) {
    const value = match[1]?.replace(/[.!?:]+$/u, "") ?? "";
    if (value !== "" && !/[\u0000-\u001f\u007f]/u.test(value)) values.push(value);
  }
  return [...new Set(values)].sort(compareText);
}

function obligation(
  kind: CuratorChannelObligation["kind"],
  channels: readonly CuratorRetrievalChannel[],
  selector: Record<string, unknown>,
  provenance: readonly string[],
): CuratorChannelObligation {
  const body = { kind, required_channels: channels, selector };
  return { id: `curator_obligation_${digest(body).slice(7)}`, ...body, provenance: [...new Set(provenance)].sort(compareText) };
}

function unionObligations(...groups: readonly (readonly CuratorChannelObligation[])[]): CuratorChannelObligation[] {
  const byId = new Map<string, CuratorChannelObligation>();
  for (const group of groups) {
    for (const item of group) {
      const existing = byId.get(item.id);
      if (!existing) {
        byId.set(item.id, { ...item, provenance: [...new Set(item.provenance)].sort(compareText) });
        continue;
      }
      if (existing.kind !== item.kind
        || stableJson(existing.required_channels) !== stableJson(item.required_channels)
        || stableJson(existing.selector) !== stableJson(item.selector)) {
        throw new Error(`curator_obligation_identity_conflict: ${item.id}`);
      }
      byId.set(item.id, {
        ...existing,
        provenance: [...new Set([...existing.provenance, ...item.provenance])].sort(compareText),
      });
    }
  }
  return [...byId.values()].sort(compareObligations);
}

function decodePlanRow(row: PlanRow): CuratorBatchChannelPlan {
  const stored = JSON.parse(row.plan_json) as Omit<CuratorBatchChannelPlan, "plan_digest">;
  const plan = { ...stored, plan_digest: row.plan_digest } as CuratorBatchChannelPlan;
  if (
    stableJson(stored) !== row.plan_json
    || digest(stored) !== row.plan_digest
    || stored.job_id !== row.job_id
    || stored.work_batch_id !== row.work_batch_id
    || stored.plan_revision !== row.plan_revision
    || stored.parent_plan_digest !== row.parent_plan_digest
    || stored.manifest_digest !== row.manifest_digest
    || stored.snapshot_token !== row.snapshot_token
    || stored.overlay_revision !== row.overlay_revision
    || stored.overlay_digest !== row.overlay_digest
    || stored.work_batch_digest !== row.work_batch_digest
    || stored.affected_work_set_digest !== row.affected_work_set_digest
    || stored.normalization_identity !== row.normalization_identity
    || stored.created_at !== row.created_at
  ) {
    throw new Error(`invalid_curator_channel_plan: ${row.job_id}/${row.work_batch_id}@${row.plan_revision}`);
  }
  return plan;
}

function compareObligations(left: CuratorChannelObligation, right: CuratorChannelObligation): number {
  return compareText(left.kind, right.kind) || compareText(left.id, right.id);
}

function isRevisionIdentity(value: unknown): value is CuratorMemoryRevisionIdentity {
  if (!isRecord(value)) return false;
  return value.origin === "base"
    ? Number.isSafeInteger(value.revision) && typeof value.state_digest === "string"
    : value.origin === "overlay"
      && Number.isSafeInteger(value.overlay_revision)
      && typeof value.overlay_digest === "string"
      && typeof value.payload_digest === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}
