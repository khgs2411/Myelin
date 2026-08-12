import type { Database } from "bun:sqlite";
import { createAnchorIngestJobInOpenTransaction } from "../ingest/jobs.ts";
import {
  acquireProjectSessionMutationFenceInOpenTransaction,
  ProjectSessionMutationAuthorityError,
} from "../memory/project-session-mutation-fence.ts";
import { isLegacySessionJobOwnerDenied } from "../memory/session-memory-write-firewall.ts";
import { revalidateLeaseAndCopyEvidenceInOpenTransaction, SessionEvidencePlanChangedError } from "./evidence-snapshot.ts";
import type { SMCEvidencePreparationPlan } from "./evidence-selection.ts";
import { createPreparingSessionMemoryAnchorJobInOpenTransaction } from "./job-lifecycle.ts";
import {
  freezeSMCWorkflowBudgets,
  insertCompleteSMCManifestInOpenTransaction,
  type SMCManifest,
  type SMCTargetContext,
  type SMCWorkflowBudgets,
} from "./manifest.ts";
import { copyActiveSessionMemorySnapshotInOpenTransaction } from "./memory-snapshot.ts";
import { copyCompleteSessionRetrievalSnapshotInOpenTransaction } from "./retrieval-snapshot.ts";
import { extractCanonicalMemoryReferences } from "./curator-channel-plan.ts";

export type SessionMaintenancePreparationBlockerCode =
  | "smc_workflow_budget_infeasible"
  | "session_memory_authority_not_activated"
  | "session_memory_project_busy"
  | "session_embedding_lifecycle_busy"
  | "session_memory_anchor_legacy_denied"
  | "session_memory_anchor_identity_conflict"
  | "session_evidence_plan_changed"
  | "session_memory_snapshot_changed"
  | "session_retrieval_snapshot_incomplete"
  | "session_retrieval_provider_unavailable";

export type PrepareSessionMaintenanceAnchorResult =
  | { kind: "prepared"; manifest: SMCManifest }
  | {
      kind: "blocked";
      code: SessionMaintenancePreparationBlockerCode;
      project_key: string;
      job_id: string;
      reason: string;
      owner?: unknown;
      memory_ids?: string[];
      workflow_budget_feasibility?: SMCWorkflowBudgetFeasibility;
    };

export type SMCWorkflowBudgetFeasibility = Readonly<{
  configured: Readonly<Pick<SMCWorkflowBudgets,
    "max_turns" | "max_queries" | "max_provider_envelope_bytes" | "max_affected_work_set_size">>;
  required: Readonly<{
    min_turns: number;
    min_queries: number;
    min_provider_envelope_bytes: number;
    min_affected_work_set_size: number;
  }>;
  deficits: readonly string[];
}>;

export type PrepareSessionMaintenanceAnchorFailureInjection = {
  beforeCommit?: () => void;
  afterCommitBeforeReturn?: (manifest: SMCManifest) => void;
};

export function prepareSessionMaintenanceAnchor(
  db: Database,
  input: {
    plan: SMCEvidencePreparationPlan;
    requested_by?: string | null;
    target_context: SMCTargetContext;
    workflow_budgets: SMCWorkflowBudgets;
    now: string;
    failure_injection?: PrepareSessionMaintenanceAnchorFailureInjection;
  },
): PrepareSessionMaintenanceAnchorResult {
  if (db.inTransaction) {
    throw new Error("prepareSessionMaintenanceAnchor must own its BEGIN IMMEDIATE transaction");
  }
  if (input.target_context.repo_path.trim() === "") {
    throw new Error("SMC target repository path must not be empty");
  }
  const workflowBudgets = freezeSMCWorkflowBudgets(input.workflow_budgets);
  const feasibility = evaluateWorkflowBudgetFeasibility(input.plan, workflowBudgets);
  if (feasibility.deficits.length > 0) {
    return {
      ...blockedResult(
        input,
        "smc_workflow_budget_infeasible",
        `frozen workflow budgets cannot complete the selected job: ${feasibility.deficits.join(", ")}`,
      ),
      workflow_budget_feasibility: feasibility,
    };
  }
  let manifest: SMCManifest;
  try {
    manifest = db.transaction(() => {
      if (isLegacySessionJobOwnerDenied(db, input.plan.anchor_job_id)) {
        throw blocked(input, "session_memory_anchor_legacy_denied", "anchor identity is permanently denied");
      }
      if (db.query("SELECT 1 FROM ingest_jobs WHERE id = ?").get(input.plan.anchor_job_id)) {
        throw blocked(input, "session_memory_anchor_identity_conflict", "anchor job identity already exists");
      }

      const acquired = acquireProjectSessionMutationFenceInOpenTransaction(db, {
        projectKey: input.plan.project_key,
        ownerId: input.plan.anchor_job_id,
        ownerKind: "anchor_job",
        phase: "preparing",
        now: input.now,
      });
      if (acquired.kind !== "acquired") {
        if (acquired.kind === "not_activated") {
          throw blocked(input, acquired.code, "Session Memory authority is not activated");
        }
        throw blocked(input, acquired.code, "Session Memory preparation authority is occupied", {
          owner: acquired.owner,
        });
      }
      const ownerEpoch = acquired.fence.owner_epoch;
      createAnchorIngestJobInOpenTransaction(db, {
        id: input.plan.anchor_job_id,
        project_key: input.plan.project_key,
        provider: input.plan.governing_identities.invocation.provider,
        requested_by: input.requested_by ?? null,
        input: {
          trigger_reason: input.plan.trigger_reason,
          preparation_plan_identity: input.plan.plan_identity,
          governing_identities: input.plan.governing_identities,
          evidence_budgets: input.plan.budgets,
          workflow_budgets: workflowBudgets,
          target_context: input.target_context,
        },
        now: input.now,
        owner_epoch: ownerEpoch,
      });
      createPreparingSessionMemoryAnchorJobInOpenTransaction(db, {
        jobId: input.plan.anchor_job_id,
        projectKey: input.plan.project_key,
        ownerEpoch,
        now: input.now,
      });

      const evidence = revalidateLeaseAndCopyEvidenceInOpenTransaction(db, {
        plan: input.plan,
        owner_epoch: ownerEpoch,
        claimed_at: input.now,
      });
      const memory = copyActiveSessionMemorySnapshotInOpenTransaction(db, {
        job_id: input.plan.anchor_job_id,
        project_key: input.plan.project_key,
      });
      const retrieval = copyCompleteSessionRetrievalSnapshotInOpenTransaction(db, {
        job_id: input.plan.anchor_job_id,
        project_key: input.plan.project_key,
      });
      if (retrieval.kind === "blocked") {
        throw blocked(input, retrieval.code, retrieval.reason, {
          memory_ids: retrieval.memory_ids,
        });
      }
      const complete = insertCompleteSMCManifestInOpenTransaction(db, {
        owner_epoch: ownerEpoch,
        plan: input.plan,
        evidence,
        memory,
        retrieval,
        workflow_budgets: workflowBudgets,
        target_context: input.target_context,
        created_at: input.now,
      });
      input.failure_injection?.beforeCommit?.();
      return complete;
    }).immediate();
  } catch (error) {
    if (error instanceof PreparationBlockedError) return error.result;
    if (error instanceof SessionEvidencePlanChangedError) {
      return blockedResult(input, error.code, error.message);
    }
    if (error instanceof ProjectSessionMutationAuthorityError) {
      if (error.code === "session_memory_legacy_authority_rejected") {
        return blockedResult(input, "session_memory_anchor_legacy_denied", error.message);
      }
    }
    if (error instanceof Error && error.message.startsWith("session_memory_snapshot_drift:")) {
      return blockedResult(input, "session_memory_snapshot_changed", error.message);
    }
    throw error;
  }

  input.failure_injection?.afterCommitBeforeReturn?.(manifest);
  return { kind: "prepared", manifest };
}

class PreparationBlockedError extends Error {
  constructor(readonly result: Extract<PrepareSessionMaintenanceAnchorResult, { kind: "blocked" }>) {
    super(`${result.code}: ${result.reason}`);
    this.name = "PreparationBlockedError";
  }
}

function blocked(
  input: Parameters<typeof prepareSessionMaintenanceAnchor>[1],
  code: SessionMaintenancePreparationBlockerCode,
  reason: string,
  details: { owner?: unknown; memory_ids?: string[] } = {},
): PreparationBlockedError {
  return new PreparationBlockedError({
    ...blockedResult(input, code, reason),
    ...details,
  });
}

function blockedResult(
  input: Parameters<typeof prepareSessionMaintenanceAnchor>[1],
  code: SessionMaintenancePreparationBlockerCode,
  reason: string,
): Extract<PrepareSessionMaintenanceAnchorResult, { kind: "blocked" }> {
  return {
    kind: "blocked",
    code,
    project_key: input.plan.project_key,
    job_id: input.plan.anchor_job_id,
    reason,
  };
}

function evaluateWorkflowBudgetFeasibility(
  plan: SMCEvidencePreparationPlan,
  configured: SMCWorkflowBudgets,
): SMCWorkflowBudgetFeasibility {
  const required = {
    // Every evidence item needs one provider text formulation. Every work batch
    // needs one complete proposal, and every frozen audit member requires one
    // exact full-record fetch before its lifecycle disposition can be accepted.
    // Coordinator-owned page continuations do not consume provider turns.
    min_turns: plan.evidence.length + plan.batches.length + plan.audit_selection.members.length,
    // Every nonempty evidence item has one lexical/semantic materialization.
    // Every explicit memory reference adds exact plus one-hop link materializations,
    // and every audit member has its own exact materialization.
    min_queries: plan.evidence.reduce((count, item) => {
      const text = item.evidence.raw_text?.trim() ?? "";
      if (text === "") return count;
      return count + 1 + (extractCanonicalMemoryReferences(text).length * 2);
    }, 0) + plan.audit_selection.members.length,
    // The selected batch itself is an irreducible part of the provider
    // envelope; fixed protocol overhead is checked exactly at runtime.
    min_provider_envelope_bytes: plan.batches.reduce(
      (largest, batch) => Math.max(largest, batch.encoded_bytes),
      0,
    ),
    min_affected_work_set_size: plan.audit_selection.members.length,
  };
  const frozenConfigured = {
    max_turns: configured.max_turns,
    max_queries: configured.max_queries,
    max_provider_envelope_bytes: configured.max_provider_envelope_bytes,
    max_affected_work_set_size: configured.max_affected_work_set_size,
  };
  const deficits: string[] = [];
  if (configured.max_turns < required.min_turns) {
    deficits.push(`max_turns configured=${configured.max_turns} required>=${required.min_turns}`);
  }
  if (configured.max_queries < required.min_queries) {
    deficits.push(`max_queries configured=${configured.max_queries} required>=${required.min_queries}`);
  }
  if (configured.max_provider_envelope_bytes < required.min_provider_envelope_bytes) {
    deficits.push(
      `max_provider_envelope_bytes configured=${configured.max_provider_envelope_bytes} required>=${required.min_provider_envelope_bytes}`,
    );
  }
  if (configured.max_affected_work_set_size < required.min_affected_work_set_size) {
    deficits.push(
      `max_affected_work_set_size configured=${configured.max_affected_work_set_size} required>=${required.min_affected_work_set_size}`,
    );
  }
  return Object.freeze({
    configured: Object.freeze(frozenConfigured),
    required: Object.freeze(required),
    deficits: Object.freeze(deficits),
  });
}
