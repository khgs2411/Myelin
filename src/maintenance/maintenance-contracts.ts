import type { LaunchContext } from "../runtime/launch-context.ts";
import type {
  IngestServiceDeps,
  IngestStatusResult,
  StartIngestInput,
  StartIngestResult,
} from "../ingest/ingest-service-contracts.ts";
import type { DetachedSpawner, ProcessLivenessChecker } from "../ingest/runtime.ts";

export type AutoMemoryMaintenanceScheduleResult =
  | { status: "disabled"; reason: string }
  | { status: "skipped"; reason: string; queued_count?: number }
  | { status: "scheduled"; project_key: string; run_id: string; pid: number | null; log_path: string; queued_count: number };

export type AutoMemoryMaintenanceScheduler = {
  maybeSchedule: (
    projectKey: string,
    options?: { forceIngest?: boolean; forceIndex?: boolean },
  ) => Promise<AutoMemoryMaintenanceScheduleResult>;
};

export type AutoMemoryMaintenanceRunResult = {
  status: "completed" | "failed";
  project_key: string;
  run_id: string;
  ingest_started: boolean;
  indexed: number;
  index_failed: number;
  pending_remaining: number;
  queued_remaining?: number;
  rescheduled?: boolean;
  error_message?: string;
};

export type AutoMemoryMaintenanceState = MaintenanceRunState & {
  last_check_at?: string;
  last_check_status?: "skipped";
  last_check_reason?: string;
  last_check_counts?: { queued_count?: number };
  last_counts?: {
    queued_count?: number;
    indexed?: number;
    index_failed?: number;
    pending_remaining?: number;
    queued_remaining?: number;
    rescheduled?: boolean;
  };
};

export type AutoMemoryMaintenanceIndexResult = {
  indexed: number;
  failed: number;
  pending_remaining: number;
};

export type AutoMemoryMaintenanceDeps = IngestServiceDeps & {
  now?: () => Date;
  spawn?: DetachedSpawner;
  isProcessAlive?: ProcessLivenessChecker;
  sleep?: (ms: number) => Promise<void>;
  ingestService?: {
    start(input: StartIngestInput): Promise<StartIngestResult>;
    status(input: { jobId?: string; projectKey?: string }): Promise<IngestStatusResult>;
  };
  indexPending?: (input: {
    projectKey: string;
    limit: number;
    batchSize: number;
    retryFailed: boolean;
  }) => Promise<AutoMemoryMaintenanceIndexResult>;
  context?: LaunchContext;
};

export type AutoProjectMemoryMaintenanceTrigger =
  | "runtime_inbox_created"
  | "session_memory_candidate_created"
  | "retrieval_index_pending";

export type AutoProjectMemoryMaintenanceCounts = {
  pending_inbox_items: number;
  pending_project_candidates: number;
};

export type AutoProjectMemoryMaintenanceScheduleResult =
  | { status: "disabled"; reason: string }
  | { status: "skipped"; reason: string; counts?: AutoProjectMemoryMaintenanceCounts }
  | {
      status: "scheduled";
      project_key: string;
      run_id: string;
      pid: number | null;
      log_path: string;
      trigger: AutoProjectMemoryMaintenanceTrigger;
      counts: AutoProjectMemoryMaintenanceCounts;
    };

export type AutoProjectMemoryMaintenanceRunResult = {
  status: "completed" | "failed" | "skipped";
  project_key: string;
  run_id: string;
  maintenance_status?: string;
  changed_files: string[];
  counts_before: AutoProjectMemoryMaintenanceCounts;
  counts_after: AutoProjectMemoryMaintenanceCounts;
  error_message?: string;
  reason?: string;
};

export type AutoProjectMemoryMaintenanceState = MaintenanceRunState & {
  last_trigger?: AutoProjectMemoryMaintenanceTrigger;
  last_counts?: Partial<AutoProjectMemoryMaintenanceCounts> & {
    pending_inbox_items_after?: number;
    pending_project_candidates_after?: number;
  };
};

export type AutoProjectMemoryMaintenanceScheduler = {
  maybeSchedule: (
    projectKey: string,
    trigger: AutoProjectMemoryMaintenanceTrigger,
  ) => Promise<AutoProjectMemoryMaintenanceScheduleResult>;
};

export type AutoProjectMemoryMaintenanceDeps = {
  now?: () => Date;
  spawn?: DetachedSpawner;
  isProcessAlive?: ProcessLivenessChecker;
  runMaintenance?: (projectKey: string) => Promise<{ status: string; changed_files?: string[]; stopped_reason?: string }>;
  indexProject?: (projectKey: string) => Promise<{ indexed: number; failed: number; pending_remaining: number; degraded: boolean; degraded_reason?: string }>;
  context?: LaunchContext;
};

export type MaintenanceRunState = {
  project_key: string;
  last_run_id?: string;
  last_scheduled_at?: string;
  last_started_at?: string;
  last_finished_at?: string;
  last_status?: "scheduled" | "running" | "completed" | "failed" | "skipped";
  last_reason?: string;
  last_log_path?: string;
  last_pid?: number | null;
};
