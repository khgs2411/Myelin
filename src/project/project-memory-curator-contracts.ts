import type { ProcessRunner } from "../runtime/llm-contracts.ts";
import type { Provider } from "../runtime/config.ts";

export const PROJECT_MEMORY_CURATOR_MODES = ["create", "maintain"] as const;
export const PROJECT_MEMORY_CURATOR_RUN_STATUSES = [
  "completed",
  "completed_with_pending_index",
  "failed",
  "needs_review",
] as const;

export type ProjectMemoryCuratorMode = (typeof PROJECT_MEMORY_CURATOR_MODES)[number];
export type ProjectMemoryCuratorRunStatus = (typeof PROJECT_MEMORY_CURATOR_RUN_STATUSES)[number];

export type ProjectMemoryValidationFinding = {
  severity: "info" | "warn" | "blocker";
  category: "provider" | "runtime";
  code: string;
  message: string;
};

export type ProjectMemoryCuratorValidationResult = {
  ok: boolean;
  mode: ProjectMemoryCuratorMode;
  project_key: string;
  global_findings: ProjectMemoryValidationFinding[];
  item_results: [];
  eligible_item_ids: string[];
  rejected_item_ids: string[];
  quarantined_item_ids: string[];
  noop_refs: string[];
};

export type RunProjectMemoryCuratorInput = {
  projectKey: string;
  dryRun: boolean;
  review: boolean;
  provider?: Provider;
  modelOverride?: string;
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
  now?: Date;
  recreate?: boolean;
};

export type ProjectMemoryCuratorRunResult = {
  status: ProjectMemoryCuratorRunStatus;
  project_key: string;
  mode: ProjectMemoryCuratorMode;
  run_id: string;
  run_dir: string;
  content_quality_status?: "trusted";
  retrieval_readiness_status?: "ready" | "pending";
  quality_diagnostics_ref?: undefined;
  artifacts: {
    input_packet: string;
    curator_output: string;
    curator_validation: string;
    curator_run_result: string;
    summary: string;
    runtime_inbox_intake?: "runtime-inbox-intake.json";
    apply_journal?: "project-memory-apply-journal.json";
    apply_result?: "project-memory-apply-result.json";
    changeset?: "project-memory-changeset.json";
    retrieval_sections?: "project-memory-retrieval-sections.json";
    hint_generation?: "project-memory-hint-generation-result.json";
    retrieval_index_result?: "project-memory-retrieval-index-result.json";
    subject_manifest?: "reports/documentation-subject-manifest.json";
    planner_report?: "reports/documentation-planner-report.json";
    subject_reports?: string[];
    maintenance_report?: "reports/documentation-maintenance-report.json";
    file_authoring_runs?: string[];
    pre_maintenance_wiki?: "pre-maintenance-wiki";
  };
  curation_kind?: "agent_authored" | "human_reviewed";
  run_kind?: "create" | "maintenance" | "create_then_maintenance" | "recreate";
  validation_ok: boolean;
  stopped_before_writes: boolean;
  dry_run: boolean;
  review: boolean;
  applied_page_ids?: string[];
  applied_item_ids?: string[];
  changed_files?: string[];
  source_consumptions?: string[];
  stopped_reason?: string;
  failure_kind?: "provider_failed_before_output" | "curator_output_invalid_json";
};
