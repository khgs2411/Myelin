import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { stableJson } from "../runtime/json.ts";
import type { SMCEvidencePreparationPlan } from "./evidence-selection.ts";
import type { FrozenEvidenceSnapshot } from "./evidence-snapshot.ts";
import type { FrozenSessionMemorySnapshot } from "./memory-snapshot.ts";
import type { FrozenSessionRetrievalSnapshot } from "./retrieval-snapshot.ts";
import {
  initializeSMCOverlayInOpenTransaction,
  readSMCOverlayIdentity,
  type SMCOverlayIdentity,
} from "./overlay-store.ts";

export const SMC_WORKFLOW_BUDGET_KEYS = [
  "max_affected_work_set_size",
  "max_cumulative_returned_result_bytes",
  "max_provider_envelope_bytes",
  "max_queries",
  "max_turns",
  "retrieval_page_item_limit",
  "semantic_distance_threshold_micros",
  "semantic_qualifying_result_ceiling",
] as const;

export const SMC_ADDITIVE_WORKFLOW_BUDGET_KEYS = [
  "max_turns",
  "max_queries",
  "max_cumulative_returned_result_bytes",
  "max_provider_envelope_bytes",
  "max_affected_work_set_size",
] as const;

export type SMCAdditiveWorkflowBudgetKey = (typeof SMC_ADDITIVE_WORKFLOW_BUDGET_KEYS)[number];

export type SMCWorkflowBudgets = Readonly<{
  max_affected_work_set_size: number;
  max_cumulative_returned_result_bytes: number;
  max_provider_envelope_bytes: number;
  max_queries: number;
  max_turns: number;
  retrieval_page_item_limit: number;
  /** Maximum semantic distance as an integer number of millionths, in (0, 2_000_000]. */
  semantic_distance_threshold_micros: number;
  semantic_qualifying_result_ceiling: number;
}>;

export class InvalidSMCWorkflowBudgetsError extends Error {
  readonly code = "invalid_smc_workflow_budgets" as const;

  constructor(message: string) {
    super(`invalid_smc_workflow_budgets: ${message}`);
    this.name = "InvalidSMCWorkflowBudgetsError";
  }
}

export type SMCTargetContext = {
  repo_path: string;
  git_branch: string | null;
  git_commit: string | null;
  git_worktree_id: string | null;
};

type SMCManifestRow = {
  job_id: string;
  project_key: string;
  schema_version: number;
  owner_epoch: number;
  trigger_reason: string;
  compatibility_selection_limit: number | null;
  preparation_plan_identity: string;
  evidence_digest: string;
  memory_snapshot_digest: string;
  retrieval_snapshot_digest: string;
  snapshot_token: string;
  manifest_digest: string;
  governing_identities_json: string;
  evidence_budgets_json: string;
  workflow_budgets_json: string;
  target_context_json: string;
  embedding_contract_id: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_format_version: number;
  embedding_vector_table: string;
  selected_evidence_count: number;
  no_agent_intent_count: number;
  work_batch_count: number;
  evidence_batch_count: number;
  audit_batch_count: number;
  audit_member_count: number;
  audit_selection_digest: string;
  audit_algorithm_digest: string;
  active_memory_count: number;
  total_evidence_bytes: number;
  created_at: string;
};

export type SMCManifest = Omit<
  SMCManifestRow,
  "governing_identities_json" | "evidence_budgets_json" | "workflow_budgets_json" | "target_context_json"
> & {
  governing_identities: SMCEvidencePreparationPlan["governing_identities"];
  evidence_budgets: SMCEvidencePreparationPlan["budgets"];
  workflow_budgets: SMCWorkflowBudgets;
  target_context: SMCTargetContext;
  current_overlay_identity: SMCOverlayIdentity;
};

export function insertCompleteSMCManifestInOpenTransaction(
  db: Database,
  input: {
    owner_epoch: number;
    plan: SMCEvidencePreparationPlan;
    evidence: FrozenEvidenceSnapshot;
    memory: FrozenSessionMemorySnapshot;
    retrieval: FrozenSessionRetrievalSnapshot;
    workflow_budgets: SMCWorkflowBudgets;
    target_context: SMCTargetContext;
    created_at: string;
  },
): SMCManifest {
  if (!db.inTransaction) throw new Error("SMC manifest insertion requires an open transaction");
  const workflowBudgets = freezeSMCWorkflowBudgets(input.workflow_budgets);
  assertCompleteRows(db, input);
  const snapshotToken = digest({
    memory_snapshot_digest: input.memory.digest,
    retrieval_snapshot_digest: input.retrieval.digest,
    embedding_contract_id: input.retrieval.contract_id,
  });
  const manifestBody = {
    schema_version: 1,
    job_id: input.plan.anchor_job_id,
    project_key: input.plan.project_key,
    owner_epoch: input.owner_epoch,
    trigger_reason: input.plan.trigger_reason,
    compatibility_selection_limit: input.plan.compatibility_selection_limit,
    preparation_plan_identity: input.plan.plan_identity,
    evidence_digest: input.evidence.digest,
    memory_snapshot_digest: input.memory.digest,
    retrieval_snapshot_digest: input.retrieval.digest,
    snapshot_token: snapshotToken,
    governing_identities: input.plan.governing_identities,
    evidence_budgets: input.plan.budgets,
    workflow_budgets: workflowBudgets,
    target_context: input.target_context,
    embedding: {
      contract_id: input.retrieval.contract_id,
      provider: input.retrieval.provider,
      model: input.retrieval.model,
      dimensions: input.retrieval.dimensions,
      format_version: input.retrieval.format_version,
      vector_table: input.retrieval.vector_table,
      coverage_digest: input.retrieval.coverage_digest,
    },
    audit: {
      selection_digest: input.plan.audit_selection.selection_digest,
      algorithm_digest: input.plan.audit_selection.algorithm_digest,
    },
    counts: {
      selected_evidence: input.evidence.evidence_count,
      no_agent_intents: input.evidence.no_agent_intent_count,
      evidence_batches: input.plan.batches.filter((batch) => batch.work_kind === "evidence").length,
      work_batches: input.plan.batches.length,
      audit_batches: input.plan.audit_selection.members.length > 0 ? 1 : 0,
      audit_members: input.plan.audit_selection.members.length,
      active_memories: input.memory.count,
      total_evidence_bytes: input.evidence.total_encoded_bytes,
    },
    created_at: input.created_at,
  };
  const manifestDigest = digest(manifestBody);
  db.query(
    `INSERT INTO smc_manifests
      (job_id, project_key, schema_version, owner_epoch, trigger_reason, compatibility_selection_limit,
       preparation_plan_identity,
       evidence_digest, memory_snapshot_digest, retrieval_snapshot_digest, snapshot_token,
       manifest_digest, governing_identities_json, evidence_budgets_json, workflow_budgets_json,
       target_context_json, embedding_contract_id, embedding_provider, embedding_model,
       embedding_dimensions, embedding_format_version, embedding_vector_table,
      selected_evidence_count, no_agent_intent_count, evidence_batch_count, active_memory_count,
       work_batch_count, audit_batch_count, audit_member_count, audit_selection_digest,
       audit_algorithm_digest, total_evidence_bytes, created_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.plan.anchor_job_id,
    input.plan.project_key,
    input.owner_epoch,
    input.plan.trigger_reason,
    input.plan.compatibility_selection_limit,
    input.plan.plan_identity,
    input.evidence.digest,
    input.memory.digest,
    input.retrieval.digest,
    snapshotToken,
    manifestDigest,
    stableJson(input.plan.governing_identities),
    stableJson(input.plan.budgets),
    stableJson(workflowBudgets),
    stableJson(input.target_context),
    input.retrieval.contract_id,
    input.retrieval.provider,
    input.retrieval.model,
    input.retrieval.dimensions,
    input.retrieval.format_version,
    input.retrieval.vector_table,
    input.evidence.evidence_count,
    input.evidence.no_agent_intent_count,
    input.plan.batches.filter((batch) => batch.work_kind === "evidence").length,
    input.memory.count,
    input.plan.batches.length,
    input.plan.audit_selection.members.length > 0 ? 1 : 0,
    input.plan.audit_selection.members.length,
    input.plan.audit_selection.selection_digest,
    input.plan.audit_selection.algorithm_digest,
    input.evidence.total_encoded_bytes,
    input.created_at,
  );
  initializeSMCOverlayInOpenTransaction(db, {
    job_id: input.plan.anchor_job_id,
    created_at: input.created_at,
  });
  return readSMCManifest(db, input.plan.anchor_job_id)!;
}

export function readSMCManifest(db: Database, jobId: string): SMCManifest | null {
  const row = db.query("SELECT * FROM smc_manifests WHERE job_id = ?").get(jobId) as SMCManifestRow | null;
  if (!row) return null;
  const currentOverlayIdentity = readSMCOverlayIdentity(db, jobId);
  if (!currentOverlayIdentity) throw new Error(`SMC manifest is missing overlay state: ${jobId}`);
  return {
    ...withoutJsonColumns(row),
    governing_identities: parseJson(row.governing_identities_json),
    evidence_budgets: parseJson(row.evidence_budgets_json),
    workflow_budgets: freezeSMCWorkflowBudgets(parseJson(row.workflow_budgets_json)),
    target_context: parseJson(row.target_context_json),
    current_overlay_identity: currentOverlayIdentity,
  };
}

function assertCompleteRows(
  db: Database,
  input: Parameters<typeof insertCompleteSMCManifestInOpenTransaction>[1],
): void {
  const expected: Array<[string, number]> = [
    ["smc_evidence_snapshot", input.evidence.evidence_count],
    ["smc_no_agent_intents", input.evidence.no_agent_intent_count],
    ["smc_work_batches", input.plan.batches.length],
    ["smc_audit_batch_members", input.plan.audit_selection.members.length],
    ["smc_memory_snapshot", input.memory.count],
    ["smc_memory_snapshot_search_texts", input.memory.count],
    ["smc_memory_snapshot_vectors", input.memory.count],
    ["smc_retrieval_snapshot_completeness", 1],
  ];
  for (const [table, count] of expected) {
    const actual = db.query(`SELECT count(*) AS count FROM ${table} WHERE job_id = ?`)
      .get(input.plan.anchor_job_id) as { count: number };
    if (actual.count !== count) {
      throw new Error(`SMC manifest is incomplete: ${table} expected ${count}, got ${actual.count}`);
    }
  }
}

export function freezeSMCWorkflowBudgets(value: unknown): SMCWorkflowBudgets {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidSMCWorkflowBudgetsError("workflow controls must be an object");
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  if (
    actualKeys.length !== SMC_WORKFLOW_BUDGET_KEYS.length
    || actualKeys.some((key, index) => key !== SMC_WORKFLOW_BUDGET_KEYS[index])
  ) {
    const missing = SMC_WORKFLOW_BUDGET_KEYS.filter((key) => !Object.hasOwn(record, key));
    const unknown = actualKeys.filter((key) => !(SMC_WORKFLOW_BUDGET_KEYS as readonly string[]).includes(key));
    throw new InvalidSMCWorkflowBudgetsError(
      `workflow controls must contain exactly the frozen fields; missing=[${missing.join(",")}], unknown=[${unknown.join(",")}]`,
    );
  }

  for (const key of SMC_WORKFLOW_BUDGET_KEYS) {
    const budget = record[key];
    if (!Number.isSafeInteger(budget) || (budget as number) <= 0) {
      throw new InvalidSMCWorkflowBudgetsError(`${key} must be a positive safe integer`);
    }
  }
  if ((record.semantic_distance_threshold_micros as number) > 2_000_000) {
    throw new InvalidSMCWorkflowBudgetsError(
      "semantic_distance_threshold_micros must be at most 2000000",
    );
  }

  return Object.freeze({
    max_affected_work_set_size: record.max_affected_work_set_size as number,
    max_cumulative_returned_result_bytes: record.max_cumulative_returned_result_bytes as number,
    max_provider_envelope_bytes: record.max_provider_envelope_bytes as number,
    max_queries: record.max_queries as number,
    max_turns: record.max_turns as number,
    retrieval_page_item_limit: record.retrieval_page_item_limit as number,
    semantic_distance_threshold_micros: record.semantic_distance_threshold_micros as number,
    semantic_qualifying_result_ceiling: record.semantic_qualifying_result_ceiling as number,
  });
}

function withoutJsonColumns(row: SMCManifestRow): Omit<SMCManifestRow,
  "governing_identities_json" | "evidence_budgets_json" | "workflow_budgets_json" | "target_context_json"> {
  const {
    governing_identities_json: _governing,
    evidence_budgets_json: _evidence,
    workflow_budgets_json: _workflow,
    target_context_json: _target,
    ...rest
  } = row;
  return rest;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}
