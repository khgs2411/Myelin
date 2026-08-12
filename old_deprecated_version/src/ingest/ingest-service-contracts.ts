import type { IngestJobRow, SessionMemoryAnchorJobRow } from "../memory/ingest-types.ts";
import type { LaunchContext } from "../runtime/launch-context.ts";
import type {
  DetachedSpawner,
  ProcessLivenessChecker,
  RuntimeProcessRunner,
  launchDetachedIngestWorker,
} from "./runtime.ts";
import type { IngestProjectStatus } from "./status.ts";
import type { runIngestWorker } from "./worker.ts";
import type { SMCPlanConfig } from "../runtime/config.ts";
import type { SMCTriggerReason } from "../session-maintenance/evidence-selection.ts";
import type { SMCWorkflowBudgetFeasibility } from "../session-maintenance/preparation-service.ts";

export type IngestProvider = "codex" | "claude";

export type IngestServiceDeps = {
  now?: () => Date;
  runner?: RuntimeProcessRunner;
  spawn?: DetachedSpawner;
  isProcessAlive?: ProcessLivenessChecker;
  runWorker?: typeof runIngestWorker;
  context?: LaunchContext;
  smcPlanConfig?: SMCPlanConfig;
  smcFailureInjection?: {
    afterPreparationBeforeSpawn?: () => void;
    afterSpawnBeforeAcknowledgement?: () => void;
  };
};

export type StartIngestInput = {
  projectKey: string;
  limit?: number;
  evidenceChunkSize?: number;
  provider?: IngestProvider;
};

export type IngestWorkloadSummary = Readonly<{
  evidence_count: number;
  audit_count: number;
}>;

export type StartEligibleAnchorInput = StartIngestInput & {
  triggerReason: SMCTriggerReason;
  includeAudit: boolean;
  auditPartitionLimit: number;
  auditDueCount: number;
};

export type StartIngestResult =
  | {
      kind: "no_work";
      project_key: string;
      queued_count: number;
      reconciled_count: number;
      evidence_chunk_size?: number;
      target_branch: string | null;
      workload: IngestWorkloadSummary;
    }
  | {
      kind: "blocked";
      code:
        | "smc_preparation_not_available"
        | "smc_workflow_budget_infeasible"
        | "evidence_item_too_large"
        | "session_memory_authority_not_activated"
        | "session_memory_project_busy"
        | "session_embedding_lifecycle_busy"
        | "session_memory_anchor_legacy_denied"
        | "session_memory_anchor_identity_conflict"
        | "session_evidence_plan_changed"
        | "session_memory_snapshot_changed"
        | "session_retrieval_snapshot_incomplete"
        | "session_retrieval_provider_unavailable"
        | "legacy_project_multiple_nonterminal_jobs"
        | "legacy_job_state_changed"
        | "legacy_activation_state_conflict"
        | "session_memory_indexing_incomplete"
        | "session_memory_plan_config_unavailable";
      project_key: string;
      queued_count: number;
      reconciled_count: number;
      selected_count: number;
      job_id: string | null;
      process_id: number | null;
      job_ids: string[];
      target_branch: null;
      evidence_chunk_size: number;
      workload: IngestWorkloadSummary;
      workflow_budget_feasibility?: SMCWorkflowBudgetFeasibility;
    }
  | {
      kind: "started";
      project_key: string;
      queued_count: number;
      reconciled_count: number;
      selected_count: number;
      evidence_chunk_size?: number;
      target_branch: string | null;
      job: IngestJobRow;
      workload: IngestWorkloadSummary;
      launches: Array<Awaited<ReturnType<typeof launchDetachedIngestWorker>>>;
    };

export type IngestStatusResult =
  | { kind: "project"; status: IngestProjectStatus }
  | { kind: "job"; job: IngestJobRow; anchor: SessionMemoryAnchorJobRow | null };
