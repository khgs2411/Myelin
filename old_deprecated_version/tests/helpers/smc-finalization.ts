import type { Database } from "bun:sqlite";
import type { EmbeddingTransport } from "../../src/memory/embedding-types.ts";
import { defaultSMCGoverningIdentities, planSessionMaintenanceEvidence } from "../../src/session-maintenance/evidence-selection.ts";
import { transitionSessionMemoryAnchorJob } from "../../src/session-maintenance/job-lifecycle.ts";
import { stageSMCBatchProposal } from "../../src/session-maintenance/overlay-store.ts";
import { parseSMCBatchProposal } from "../../src/session-maintenance/proposal-contract.ts";
import { buildSessionMaintenanceProjection } from "../../src/session-maintenance/projection.ts";
import {
  evaluateCuratorBatchCoverage,
  prepareCuratorBatchChannelPlan,
  queryCuratorMemory,
  readCuratorAffectedWorkSet,
} from "../../src/session-maintenance/curator-retrieval-service.ts";
import type { CuratorQueryRequest } from "../../src/session-maintenance/curator-retrieval-types.ts";
import { fetchCuratorRecord } from "../../src/session-maintenance/curator-record-service.ts";
import { writeSessionMaintenanceProjectionResultInOpenTransaction } from "../../src/session-maintenance/result.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  prepare,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_NOW,
} from "./smc-preparation.ts";

export async function createAcceptedFinalizationContext(
  db: Database,
  input: {
    jobId: string;
    workKind?: "evidence" | "audit";
    auditDisposition?: "keep" | "supersede" | "retract";
  } = { jobId: "job-finalize" },
) {
  const documentContract = { ...configureSMCTestContract(db), purpose: "retrieval_document" as const };
  seedIndexedMemory(db, {
    id: "memory-0",
    summary: "Current durable state",
    source_event_refs: input.workKind === "audit" ? ["audit-inherited-source"] : [],
  });
  if (input.workKind !== "audit") {
    seedEvidence(db, "evt-0", "A durable update for session_memories/memory-0");
  }
  activateSMCAuthority(db);
  const planned = planSessionMaintenanceEvidence(db, {
    anchor_job_id: input.jobId,
    project_key: "demo",
    trigger_reason: input.workKind === "audit" ? "manual_audit" : "manual",
    governing_identities: defaultSMCGoverningIdentities({
      provider: "codex",
      model: "gpt-test",
      reasoning_effort: "medium",
    }),
    budgets: {
      max_items_per_batch: 10,
      max_encoded_bytes_per_batch: 100_000,
      max_encoded_bytes_per_item: 100_000,
    },
    include_audit: input.workKind === "audit",
    audit_partition_limit: input.workKind === "audit" ? 10 : undefined,
  });
  if (planned.kind !== "planned") throw new Error(JSON.stringify(planned));
  const prepared = prepare(db, planned.plan);
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const attemptId = `attempt-${input.jobId}`;
  const running = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: prepared.manifest.project_key,
    expectedPhase: "preparing",
    expectedOwnerEpoch: prepared.manifest.owner_epoch,
    nextPhase: "running",
    now: SMC_TEST_NOW,
    resumeAttempt: { id: attemptId, provider: "codex" },
  });
  if (running.kind !== "updated") throw new Error(JSON.stringify(running));
  const batch = db.query(
    "SELECT batch_id FROM smc_work_batches WHERE job_id = ?",
  ).get(prepared.manifest.job_id) as { batch_id: string };
  const identity = {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    work_batch_id: batch.batch_id,
    attempt_id: attemptId,
    owner_epoch: running.anchor.owner_epoch,
    manifest_digest: prepared.manifest.manifest_digest,
    snapshot_token: prepared.manifest.snapshot_token,
    overlay_revision: 0,
  };
  await completeCoverage(db, identity);
  const workSet = readCuratorAffectedWorkSet(db, {
    job_id: identity.job_id,
    work_batch_id: identity.work_batch_id,
  });
  if (input.workKind === "audit") {
    for (const member of workSet) {
      if (member.revision_identity.origin !== "base") throw new Error("audit fixture expected a frozen base revision");
      const fetched = fetchCuratorRecord(db, {
        ...identity,
        record_kind: "memory",
        stable_id: member.stable_id,
        expected_revision: member.revision_identity,
        max_encoded_bytes: 100_000,
      });
      if (fetched.kind !== "record") throw new Error(JSON.stringify(fetched));
    }
  }
  const proposal = parseSMCBatchProposal({
    schema_version: 1,
    work_batch_id: identity.work_batch_id,
    expected_overlay_revision: 0,
    source_event_dispositions: input.workKind === "audit" ? [] : [{
      source_event_id: "evt-0",
      disposition: "used",
      output_refs: ["session_memories/memory-new"],
      reason: "captured durable state",
    }],
    memory_dispositions: workSet.map((member) => input.workKind === "audit"
      ? input.auditDisposition === "supersede"
        ? {
          memory_id: member.stable_id,
          revision_identity: member.revision_identity,
          disposition: "supersede" as const,
          replacement_memory_id: "memory-audit-replacement",
          relationship: "supersedes" as const,
          reason: "audit found a replacement",
          source_event_refs: ["audit-inherited-source"],
        }
        : input.auditDisposition === "retract"
          ? {
            memory_id: member.stable_id,
            revision_identity: member.revision_identity,
            disposition: "retract" as const,
            reason: "audit found the memory invalid",
            source_event_refs: ["audit-inherited-source"],
          }
          : {
            memory_id: member.stable_id,
            revision_identity: member.revision_identity,
            disposition: "keep" as const,
            reason: "still current",
            source_event_refs: [],
          }
      : {
        memory_id: member.stable_id,
        revision_identity: member.revision_identity,
        disposition: "keep" as const,
        reason: "still current",
        source_event_refs: [],
      }),
    disposition_receipt_reuses: [],
    staged_operations: input.workKind === "audit"
      ? input.auditDisposition === "supersede" ? [{
        record_kind: "memory" as const,
        operation: "upsert" as const,
        stable_key: "memory-audit-replacement",
        value: {
          id: "memory-audit-replacement",
          source_event_refs: ["audit-inherited-source"],
          memory_kind: "continuity" as const,
          title: "Audit replacement",
          summary: "Replacement selected during rolling audit",
          payload: { current: true },
          confidence: "high",
          risk: "low",
        },
      }] : []
      : [{
      record_kind: "memory",
      operation: "upsert",
      stable_key: "memory-new",
      value: {
        id: "memory-new",
        source_event_refs: ["evt-0"],
        memory_kind: "continuity",
        title: "New state",
        summary: "A new durable state",
        payload: { current: true },
        confidence: "high",
        risk: "low",
      },
    }],
    checked_output_refs: input.workKind === "audit" ? [] : ["session_memories/memory-new"],
    terminal_summary: "Curated",
  });
  const staged = await stageSMCBatchProposal(db, {
    job_id: identity.job_id,
    project_key: identity.project_key,
    attempt_id: identity.attempt_id,
    owner_epoch: identity.owner_epoch,
    manifest_digest: identity.manifest_digest,
    snapshot_token: identity.snapshot_token,
    proposal,
    document_contract: documentContract,
    embedding_transport: fixedTransport(),
    created_at: SMC_TEST_NOW,
  });
  if (staged.kind !== "accepted") throw new Error(JSON.stringify(staged));
  const accepted = buildSessionMaintenanceProjection(db, {
    job_id: identity.job_id,
    project_key: identity.project_key,
    manifest_digest: identity.manifest_digest,
    snapshot_token: identity.snapshot_token,
    overlay_revision: staged.overlay.revision,
    overlay_digest: staged.overlay.digest,
  });
  db.transaction(() => writeSessionMaintenanceProjectionResultInOpenTransaction(db, {
    project_key: identity.project_key,
    job_id: identity.job_id,
    owner_epoch: identity.owner_epoch,
    phase: "running",
    projection: accepted.projection,
    stored_at: SMC_TEST_NOW,
  })).immediate();
  return { ...identity, accepted, documentContract };
}

async function completeCoverage(db: Database, identity: Parameters<typeof prepareCuratorBatchChannelPlan>[1]) {
  for (let round = 0; round < 8; round += 1) {
    const plan = prepareCuratorBatchChannelPlan(db, identity);
    let stale = false;
    for (const obligation of plan.obligations) {
      const request = {
        ...identity,
        plan_revision: plan.plan_revision,
        plan_digest: plan.plan_digest,
        obligation_ids: [obligation.id],
        ...(obligation.kind === "text" ? { query_text: "durable state" } : {}),
        page_limit: 100,
      } satisfies CuratorQueryRequest;
      let result = await queryCuratorMemory(db, request, { embedding_transport: fixedTransport() });
      while (result.kind === "page" && result.next_cursor) {
        result = await queryCuratorMemory(db, { ...request, cursor: result.next_cursor }, {
          embedding_transport: fixedTransport(),
        });
      }
      if (result.kind === "blocked" && result.code === "curator_channel_plan_stale") {
        stale = true;
        break;
      }
      if (result.kind !== "page") throw new Error(JSON.stringify(result));
    }
    if (stale) continue;
    if (evaluateCuratorBatchCoverage(db, identity).complete) return;
  }
  throw new Error("coverage did not reach a fixed point");
}

export function fixedTransport(): EmbeddingTransport {
  return {
    async embed(request) {
      return { embedding: [0.1, 0.2, 0.3], model: request.contract.model, dimensions: request.contract.dimensions };
    },
  };
}
