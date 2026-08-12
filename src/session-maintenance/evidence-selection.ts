import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import {
  isExperienceContentEvent,
  isExperienceNoAgentEvent,
  listExperienceEventPreparationCandidates,
  type ExperienceEventRow,
} from "../memory/experience.ts";
import { stableJson } from "../runtime/json.ts";
import {
  sessionMaintenanceOutputContractIdentity,
  sessionMaintenancePolicyIdentity,
  sessionMaintenanceToolProtocolIdentity,
  type SessionMaintenanceIdentity,
} from "./identity.ts";
import {
  planSMCEvidenceBatches,
  type SMCEvidenceBatchBudgets,
  type SMCWorkBatch,
} from "./evidence-batch-planner.ts";
import type { SMCNormalizedEvidence } from "./evidence-contract.ts";
import {
  bindSessionMemoryAuditSelectionToBatch,
  emptySessionMemoryAuditSelection,
  selectDueSessionMemoryAuditPartition,
  type SMCAuditSelection,
} from "./audit-selection.ts";
export { SMCNormalizedEvidenceSchema, type SMCNormalizedEvidence } from "./evidence-contract.ts";

export type SMCTriggerReason =
  | "manual"
  | "content_threshold"
  | "max_pending_age"
  | "session_start"
  | "manual_audit"
  | "recovery";

export type SMCResolvedInvocationIdentity = {
  provider: string;
  model: string | null;
  reasoning_effort: string | null;
};

export type SMCGoverningIdentities = {
  policy: SessionMaintenanceIdentity;
  output_contract: SessionMaintenanceIdentity;
  tool_protocol: SessionMaintenanceIdentity;
  invocation: SMCResolvedInvocationIdentity;
};

export type SMCSelectedEvidence = {
  source_id: string;
  content_hash: `sha256:${string}`;
  encoded_bytes: number;
  evidence: SMCNormalizedEvidence;
};

export type SMCNoAgentReason =
  | "control_event"
  | "invalid_status"
  | "unsupported_event_kind"
  | "empty_content"
  | "internal_orchestration_prompt"
  | "oversized_evidence_requires_review";

export type SMCNoAgentTerminalIntent = {
  source_id: string;
  source_hash: `sha256:${string}`;
  reason: SMCNoAgentReason;
  terminal_state: "no_output";
  terminal_decision: `no_agent.${Exclude<SMCNoAgentReason, "oversized_evidence_requires_review">}`
    | "oversized_evidence_requires_review";
};

export type SMCEvidencePreparationPlan = {
  schema_version: 1;
  anchor_job_id: string;
  project_key: string;
  trigger_reason: SMCTriggerReason;
  compatibility_selection_limit: number | null;
  governing_identities: SMCGoverningIdentities;
  budgets: SMCEvidenceBatchBudgets;
  plan_identity: `sha256:${string}`;
  ordered_source_ids: string[];
  total_encoded_bytes: number;
  evidence: SMCSelectedEvidence[];
  batches: SMCWorkBatch[];
  audit_selection: SMCAuditSelection;
  no_agent_intents: SMCNoAgentTerminalIntent[];
  workload: "evidence" | "evidence_and_audit" | "audit" | "no_agent_only";
};

export type SMCEvidencePreparationResult =
  | { kind: "planned"; plan: SMCEvidencePreparationPlan }
  | {
      kind: "no_work";
      project_key: string;
      trigger_reason: SMCTriggerReason;
      compatibility_selection_limit: number | null;
      plan_identity: `sha256:${string}`;
    }
  | {
      kind: "blocked";
      code: "evidence_item_too_large";
      project_key: string;
      source_id: string;
      encoded_bytes: number;
      max_encoded_bytes_per_item: number;
      plan_identity: `sha256:${string}`;
    };

export function defaultSMCGoverningIdentities(
  invocation: SMCResolvedInvocationIdentity,
): SMCGoverningIdentities {
  return {
    policy: sessionMaintenancePolicyIdentity(),
    output_contract: sessionMaintenanceOutputContractIdentity(),
    tool_protocol: sessionMaintenanceToolProtocolIdentity(),
    invocation,
  };
}

export function planSessionMaintenanceEvidence(
  db: Database,
  input: {
    anchor_job_id: string;
    project_key: string;
    trigger_reason: SMCTriggerReason;
    compatibility_selection_limit?: number | null;
    governing_identities: SMCGoverningIdentities;
    budgets: SMCEvidenceBatchBudgets;
    include_audit?: boolean;
    audit_partition_limit?: number;
  },
): SMCEvidencePreparationResult {
  const selectionLimit = normalizeSelectionLimit(input.compatibility_selection_limit);
  const rows = listExperienceEventPreparationCandidates(db, input.project_key);
  const contentRows = rows.filter(isCuratorContentEvent);
  const noAgentRows = rows.filter(isCuratorNoAgentEvent);
  const orderedCandidates = [...contentRows, ...noAgentRows];
  const selectedRows = selectionLimit === null
    ? orderedCandidates
    : orderedCandidates.slice(0, selectionLimit);
  const evidence: SMCSelectedEvidence[] = [];
  const noAgentIntents: SMCNoAgentTerminalIntent[] = [];
  for (const row of selectedRows) {
    if (isCuratorContentEvent(row)) {
      const item = normalizeSelectedEvidence(row);
      if (item.encoded_bytes > input.budgets.max_encoded_bytes_per_item) {
        noAgentIntents.push(normalizeNoAgentIntent(row, "oversized_evidence_requires_review"));
      } else {
        evidence.push(item);
      }
    } else {
      noAgentIntents.push(normalizeNoAgentIntent(row));
    }
  }
  const selectedAudit = input.include_audit
    ? selectDueSessionMemoryAuditPartition(db, {
      project_key: input.project_key,
      governing_identities: input.governing_identities,
      limit: requiredAuditPartitionLimit(input.audit_partition_limit),
    })
    : emptySessionMemoryAuditSelection();
  const auditSelection = bindSessionMemoryAuditSelectionToBatch(selectedAudit, {
    anchor_job_id: input.anchor_job_id,
  });
  const planIdentity = digest({
    schema_version: 1,
    anchor_job_id: input.anchor_job_id,
    project_key: input.project_key,
    trigger_reason: input.trigger_reason,
    compatibility_selection_limit: selectionLimit,
    governing_identities: input.governing_identities,
    budgets: input.budgets,
    evidence: evidence.map(({ source_id, content_hash, encoded_bytes }) => ({
      source_id,
      content_hash,
      encoded_bytes,
    })),
    no_agent_intents: noAgentIntents,
    audit_selection: frozenAuditSelection(auditSelection),
  });

  const batchResult = planSMCEvidenceBatches({
    anchor_job_id: input.anchor_job_id,
    preparation_plan_identity: planIdentity,
    items: evidence,
    budgets: input.budgets,
  });
  if (batchResult.kind === "blocked") {
    return {
      ...batchResult,
      project_key: input.project_key,
      plan_identity: planIdentity,
    };
  }

  if (evidence.length === 0 && noAgentIntents.length === 0 && auditSelection.members.length === 0) {
    return {
      kind: "no_work",
      project_key: input.project_key,
      trigger_reason: input.trigger_reason,
      compatibility_selection_limit: selectionLimit,
      plan_identity: planIdentity,
    };
  }

  const batches = [...batchResult.batches];
  if (auditSelection.members.length > 0) {
    batches.push(auditWorkBatch(input.anchor_job_id, planIdentity, batches.length, auditSelection));
  }
  return {
    kind: "planned",
    plan: {
      schema_version: 1,
      anchor_job_id: input.anchor_job_id,
      project_key: input.project_key,
      trigger_reason: input.trigger_reason,
      compatibility_selection_limit: selectionLimit,
      governing_identities: input.governing_identities,
      budgets: input.budgets,
      plan_identity: planIdentity,
      ordered_source_ids: selectedRows.map((row) => row.id),
      total_encoded_bytes: evidence.reduce((total, item) => total + item.encoded_bytes, 0),
      evidence,
      batches,
      audit_selection: auditSelection,
      no_agent_intents: noAgentIntents,
      workload: evidence.length > 0
        ? auditSelection.members.length > 0 ? "evidence_and_audit" : "evidence"
        : auditSelection.members.length > 0 ? "audit" : "no_agent_only",
    },
  };
}

function auditWorkBatch(
  anchorJobId: string,
  planIdentity: `sha256:${string}`,
  ordinal: number,
  selection: SMCAuditSelection,
): SMCWorkBatch {
  if (!selection.work_batch_id || selection.members.length === 0) {
    throw new Error("audit work batch requires a bound selection");
  }
  const identity = {
    anchor_job_id: anchorJobId,
    preparation_plan_identity: planIdentity,
    ordinal,
    work_kind: "audit" as const,
    members: selection.members,
  };
  const encodedBytes = Buffer.byteLength(stableJson(identity), "utf8");
  return {
    id: selection.work_batch_id,
    ordinal,
    work_kind: "audit",
    source_ids: [],
    content_hashes: [],
    item_count: selection.members.length,
    encoded_bytes: encodedBytes,
  };
}

function requiredAuditPartitionLimit(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error("invalid_smc_audit_partition_limit");
  return value as number;
}

export function frozenAuditSelection(selection: SMCAuditSelection) {
  return {
    algorithm_digest: selection.algorithm_digest,
    selection_digest: selection.selection_digest,
    work_batch_id: selection.work_batch_id,
    work_kind: selection.work_kind,
    members: selection.members,
  };
}

function normalizeSelectedEvidence(row: ExperienceEventRow): SMCSelectedEvidence {
  const evidence = normalizeEvidence(row);
  const encoded = stableJson(evidence);
  return {
    source_id: row.id,
    content_hash: digest(evidence),
    encoded_bytes: Buffer.byteLength(encoded, "utf8"),
    evidence,
  };
}

function normalizeNoAgentIntent(
  row: ExperienceEventRow,
  forcedReason?: SMCNoAgentReason,
): SMCNoAgentTerminalIntent {
  const reason = forcedReason ?? noAgentReason(row);
  return {
    source_id: row.id,
    source_hash: digest(normalizeEvidence(row)),
    reason,
    terminal_state: "no_output",
    terminal_decision: reason === "oversized_evidence_requires_review"
      ? reason
      : `no_agent.${reason}`,
  };
}

function normalizeEvidence(row: ExperienceEventRow): SMCNormalizedEvidence {
  return {
    source_id: row.id,
    project_key: row.project_key,
    inserted_at: row.inserted_at,
    occurred_at: row.occurred_at,
    hook_event_name: row.hook_event_name,
    event_kind: row.event_kind,
    cwd: row.cwd,
    provider: row.provider,
    provider_session_id: row.provider_session_id,
    turn_id: row.turn_id,
    raw_text: row.raw_text,
    raw_payload_json: row.raw_payload_json,
    source: row.source,
    status: row.status,
    repo_path: row.repo_path,
    git_branch: row.git_branch,
    git_commit: row.git_commit,
    git_worktree_id: row.git_worktree_id,
    dedupe_key: row.dedupe_key,
  };
}

function noAgentReason(row: ExperienceEventRow): SMCNoAgentReason {
  if (isHistoricalHeadlessCodexPrompt(row)) return "internal_orchestration_prompt";
  if (row.status !== "valid") return "invalid_status";
  if (row.event_kind === "session.start") return "control_event";
  if (row.event_kind !== "user.prompt" && row.event_kind !== "assistant.response") {
    return "unsupported_event_kind";
  }
  return "empty_content";
}

function isCuratorContentEvent(row: ExperienceEventRow): boolean {
  return isExperienceContentEvent(row) && !isHistoricalHeadlessCodexPrompt(row);
}

function isCuratorNoAgentEvent(row: ExperienceEventRow): boolean {
  return isExperienceNoAgentEvent(row) || isHistoricalHeadlessCodexPrompt(row);
}

function isHistoricalHeadlessCodexPrompt(row: ExperienceEventRow): boolean {
  if (row.provider !== "codex" || row.event_kind !== "user.prompt") return false;
  try {
    const payload = JSON.parse(row.raw_payload_json) as Record<string, unknown> | null;
    return Boolean(
      payload
      && typeof payload === "object"
      && !Array.isArray(payload)
      && payload.hook_event_name === "UserPromptSubmit"
      && (typeof payload.transcript_path !== "string" || payload.transcript_path.length === 0),
    );
  } catch {
    return false;
  }
}

function normalizeSelectionLimit(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid compatibility selection limit: ${value}. Expected a positive integer`);
  }
  return value;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}
