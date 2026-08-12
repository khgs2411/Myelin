import type { Database } from "bun:sqlite";
import type { EmbeddingTransport } from "../../src/memory/embedding-types.ts";
import type { ActiveEmbeddingContract } from "../../src/runtime/config.ts";
import { stageSMCBatchProposal, type StageSMCBatchProposalResult } from "../../src/session-maintenance/overlay-store.ts";
import { parseSMCBatchProposal, type SMCBatchProposal, type SMCProposalOperation } from "../../src/session-maintenance/proposal-contract.ts";
import {
  evaluateCuratorBatchCoverage,
  prepareCuratorBatchChannelPlan,
  queryCuratorMemory,
  readCuratorAffectedWorkSet,
} from "../../src/session-maintenance/curator-retrieval-service.ts";
import type { CuratorBatchChannelPlan } from "../../src/session-maintenance/curator-channel-plan.ts";
import type { CuratorQueryRequest } from "../../src/session-maintenance/curator-retrieval-types.ts";

export type SMCTestBatchIdentity = Readonly<{
  job_id: string;
  project_key: string;
  work_batch_id: string;
  attempt_id: string;
  owner_epoch: number;
  manifest_digest: string;
  snapshot_token: string;
  overlay_revision: number;
}>;

export async function completeSMCTestCoverage(
  db: Database,
  identity: SMCTestBatchIdentity,
  transport: EmbeddingTransport,
): Promise<void> {
  for (let round = 0; round < 12; round += 1) {
    const plan = prepareCuratorBatchChannelPlan(db, identity);
    let stale = false;
    for (const obligation of plan.obligations) {
      if (!await exhaust(db, identity, plan, obligation.id, transport)) {
        stale = true;
        break;
      }
    }
    if (stale) continue;
    const coverage = evaluateCuratorBatchCoverage(db, identity);
    if (coverage.complete) return;
  }
  throw new Error("SMC test coverage did not reach a fixed point");
}

export function buildSMCTestProposal(
  db: Database,
  input: {
    identity: SMCTestBatchIdentity;
    staged_operations?: readonly SMCProposalOperation[];
    memory_dispositions?: SMCBatchProposal["memory_dispositions"];
    terminal_summary?: string;
  },
): SMCBatchProposal {
  const sourceIds = (db.query(
    `SELECT source_id FROM smc_evidence_batch_members
     WHERE job_id = ? AND batch_id = ? ORDER BY ordinal`,
  ).all(input.identity.job_id, input.identity.work_batch_id) as Array<{ source_id: string }>).map((row) => row.source_id);
  const operations = [...(input.staged_operations ?? [])];
  const workSet = readCuratorAffectedWorkSet(db, {
    job_id: input.identity.job_id,
    work_batch_id: input.identity.work_batch_id,
  });
  const dispositions = input.memory_dispositions ?? workSet.map((member) => ({
    memory_id: member.stable_id,
    revision_identity: member.revision_identity,
    disposition: "keep" as const,
    reason: "unchanged in overlay contract fixture",
    source_event_refs: [],
  }));
  const refsBySource = new Map<string, Set<string>>();
  for (const operation of operations) {
    if (operation.operation !== "upsert") continue;
    const collection = operation.record_kind === "memory"
      ? "session_memories"
      : operation.record_kind === "candidate"
        ? "memory_candidates"
        : "handoff_instructions";
    for (const sourceId of operation.value.source_event_refs) addRef(refsBySource, sourceId, `${collection}/${operation.value.id}`);
  }
  for (const disposition of dispositions) {
    for (const sourceId of disposition.source_event_refs) addRef(refsBySource, sourceId, `memory_dispositions/${disposition.memory_id}`);
  }
  const sourceDispositions = sourceIds.map((sourceId) => {
    const refs = [...(refsBySource.get(sourceId) ?? [])].sort(compareText);
    return refs.length > 0
      ? { source_event_id: sourceId, disposition: "used" as const, output_refs: refs, reason: "covered by staged fixture output" }
      : { source_event_id: sourceId, disposition: "no_output" as const, reason: "no staged fixture output" };
  });
  return parseSMCBatchProposal({
    schema_version: 1,
    work_batch_id: input.identity.work_batch_id,
    expected_overlay_revision: input.identity.overlay_revision,
    source_event_dispositions: sourceDispositions,
    memory_dispositions: dispositions,
    disposition_receipt_reuses: [],
    staged_operations: operations,
    checked_output_refs: [...new Set(sourceDispositions.flatMap((item) => item.disposition === "used" ? item.output_refs : []))].sort(compareText),
    terminal_summary: input.terminal_summary ?? "Staged overlay contract fixture.",
  });
}

export async function stageSMCTestProposal(
  db: Database,
  input: {
    identity: SMCTestBatchIdentity;
    proposal: unknown;
    document_contract: ActiveEmbeddingContract;
    embedding_transport: EmbeddingTransport;
    created_at: string;
    failure_injection?: { afterCommitBeforeReturn?: () => void };
  },
): Promise<StageSMCBatchProposalResult> {
  return stageSMCBatchProposal(db, {
    ...input.identity,
    proposal: input.proposal,
    document_contract: input.document_contract,
    embedding_transport: input.embedding_transport,
    created_at: input.created_at,
    failure_injection: input.failure_injection,
  });
}

async function exhaust(
  db: Database,
  identity: SMCTestBatchIdentity,
  plan: CuratorBatchChannelPlan,
  obligationId: string,
  transport: EmbeddingTransport,
): Promise<boolean> {
  const obligation = plan.obligations.find((item) => item.id === obligationId)!;
  const request = {
    ...identity,
    plan_revision: plan.plan_revision,
    plan_digest: plan.plan_digest,
    obligation_ids: [obligationId],
    ...(obligation.kind === "text" ? { query_text: String(obligation.selector.source_id ?? "memory") } : {}),
    page_limit: 100,
  } satisfies CuratorQueryRequest;
  let result = await queryCuratorMemory(db, request, { embedding_transport: transport });
  while (result.kind === "page" && result.next_cursor) {
    result = await queryCuratorMemory(db, { ...request, cursor: result.next_cursor }, { embedding_transport: transport });
  }
  if (result.kind === "blocked" && result.code === "curator_channel_plan_stale") return false;
  if (result.kind !== "page") throw new Error(JSON.stringify(result));
  return true;
}

function addRef(map: Map<string, Set<string>>, sourceId: string, ref: string): void {
  const values = map.get(sourceId) ?? new Set<string>();
  values.add(ref);
  map.set(sourceId, values);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
