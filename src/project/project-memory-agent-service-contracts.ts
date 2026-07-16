import type { Provider } from "../runtime/config.ts";
import type { ProcessRunner } from "../runtime/llm-contracts.ts";
import type { ProjectMemorySourceConsumptionRecord } from "./project-memory-apply-contracts.ts";
import type { ProjectLearnProgressSink } from "./project-learn-progress.ts";
import type {
  ProjectMemoryMaintenanceReport,
  ProjectMemorySubjectManifest,
  ProjectMemorySubjectReport,
} from "./project-memory-agent-contracts.ts";

export type ProjectMemoryCreateModeInput = {
  root: string;
  projectKey: string;
  runDir: string;
  absoluteRunDir: string;
  targetRepoDir: string;
  provider?: Provider;
  modelOverride?: string;
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
  concurrency?: number;
  now?: Date;
  progress?: ProjectLearnProgressSink;
  retryDelay?: (milliseconds: number) => Promise<void>;
};

export type ProjectMemoryCreateModeResult = {
  status: "completed" | "failed";
  project_key: string;
  draft_wiki_dir: string;
  manifest: ProjectMemorySubjectManifest;
  planner_report_ref: "reports/documentation-planner-report.json";
  subject_manifest_ref: "reports/documentation-subject-manifest.json";
  subject_reports: ProjectMemorySubjectReport[];
  subject_report_refs: string[];
  file_authoring_run_refs: string[];
  pre_maintenance_wiki_ref: "pre-maintenance-wiki";
  repository_identity_ref: "repository-identity.json";
  concurrency_limit: number;
  retry_limit: number;
  error?: string;
};

export type ProjectMemoryMaintenancePendingSource = {
  source_kind: "project_candidate" | "project_handoff";
  source_ref: string;
  title?: string | null;
  summary: string;
  priority?: string;
  reason?: string;
};

export type ProjectMemoryMaintenanceModeInput = {
  root: string;
  projectKey: string;
  runDir: string;
  absoluteRunDir: string;
  targetRepoDir: string;
  baseWikiDir: string;
  pendingSources: ProjectMemoryMaintenancePendingSource[];
  provider?: Provider;
  modelOverride?: string;
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
  now?: Date;
  progress?: ProjectLearnProgressSink;
};

export type ProjectMemoryMaintenanceModeResult = {
  status: "completed" | "noop" | "degraded" | "failed";
  project_key: string;
  draft_wiki_dir: string;
  report: ProjectMemoryMaintenanceReport;
  report_ref: "reports/documentation-maintenance-report.json";
  file_authoring_run_ref?: "agents/maintenance/file-authoring-agent-result.json";
  source_consumptions: ProjectMemorySourceConsumptionRecord[];
  degraded_reasons: string[];
  error?: string;
};
