import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Provider } from "../runtime/config.ts";
import { resolveInside } from "../runtime/fs.ts";
import { readJson, writeJson } from "../runtime/json.ts";
import type { ProcessRunner } from "../runtime/llm-client.ts";
import { invokeFileAuthoringAgent } from "../runtime/project-run-infrastructure.ts";
import type { ProjectMemorySourceConsumptionRecord } from "./project-memory-apply-contracts.ts";
import {
  isProjectMemoryAgentCandidateDisposition,
  PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS,
  type ProjectMemoryMaintenanceDisposition,
  type ProjectMemoryMaintenanceReport,
} from "./project-memory-agent-contracts.ts";

const FILE_AUTHORING_TIMEOUT_MS = 600_000;

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

export async function runProjectMemoryMaintenanceMode(
  input: ProjectMemoryMaintenanceModeInput,
): Promise<ProjectMemoryMaintenanceModeResult> {
  const workspaceDir = join(input.absoluteRunDir, "agents", "maintenance");
  const draftWikiDir = join(workspaceDir, "draft-wiki");
  await mkdir(workspaceDir, { recursive: true });
  await cp(input.baseWikiDir, draftWikiDir, { recursive: true, force: true });

  if (input.pendingSources.length === 0) {
    const report = emptyMaintenanceReport(input.projectKey, "completed");
    await writeRootMaintenanceReport(input, report);
    return {
      status: "noop",
      project_key: input.projectKey,
      draft_wiki_dir: draftWikiDir,
      report,
      report_ref: "reports/documentation-maintenance-report.json",
      source_consumptions: [],
      degraded_reasons: [],
    };
  }

  const result = await invokeFileAuthoringAgent({
    root: input.root,
    projectKey: input.projectKey,
    stageId: "maintenance",
    prompt: maintenancePrompt(input.projectKey, input.pendingSources),
    runDir: input.runDir,
    targetRepoDir: input.targetRepoDir,
    workspaceDir,
    outputRoots: [
      { name: "draft_wiki", relativePath: "draft-wiki" },
      { name: "maintenance_reports", relativePath: "reports" },
    ],
    provider: input.provider,
    modelOverride: input.modelOverride,
    env: input.env,
    runner: input.runner,
    timeoutMs: FILE_AUTHORING_TIMEOUT_MS,
  });
  if (result.status !== "completed") {
    const report = emptyMaintenanceReport(input.projectKey, "failed");
    const error = result.error ?? "maintenance agent failed";
    report.known_gaps.push(error);
    await writeRootMaintenanceReport(input, report);
    return {
      status: "failed",
      project_key: input.projectKey,
      draft_wiki_dir: draftWikiDir,
      report,
      report_ref: "reports/documentation-maintenance-report.json",
      file_authoring_run_ref: "agents/maintenance/file-authoring-agent-result.json",
      source_consumptions: [],
      degraded_reasons: [error],
      error,
    };
  }

  try {
    const report = await readJson<ProjectMemoryMaintenanceReport>(join(workspaceDir, "reports", "documentation-maintenance-report.json"));
    assertMaintenanceReport(input.projectKey, input.pendingSources, report);
    await writeRootMaintenanceReport(input, report);
    const sourceConsumptions = sourceConsumptionsFromMaintenanceReport(input, report);
    return {
      status: report.status,
      project_key: input.projectKey,
      draft_wiki_dir: draftWikiDir,
      report,
      report_ref: "reports/documentation-maintenance-report.json",
      file_authoring_run_ref: "agents/maintenance/file-authoring-agent-result.json",
      source_consumptions: sourceConsumptions,
      degraded_reasons: report.status === "degraded" ? report.known_gaps : [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = emptyMaintenanceReport(input.projectKey, "failed");
    report.known_gaps.push(message);
    await writeRootMaintenanceReport(input, report);
    return {
      status: "failed",
      project_key: input.projectKey,
      draft_wiki_dir: draftWikiDir,
      report,
      report_ref: "reports/documentation-maintenance-report.json",
      file_authoring_run_ref: "agents/maintenance/file-authoring-agent-result.json",
      source_consumptions: [],
      degraded_reasons: [message],
      error: message,
    };
  }
}

export function assertMaintenanceReport(
  projectKey: string,
  pendingSources: ProjectMemoryMaintenancePendingSource[],
  report: ProjectMemoryMaintenanceReport,
): void {
  if (report.schema_version !== 1) throw new Error("maintenance report schema_version must be 1");
  if (report.project_key !== projectKey) throw new Error("maintenance report project_key mismatch");
  if (!["completed", "degraded", "failed"].includes(report.status)) throw new Error(`invalid maintenance report status: ${report.status}`);
  if (!Array.isArray(report.dispositions)) throw new Error("maintenance report dispositions must be an array");
  const pendingRefs = new Set(pendingSources.map((source) => `${source.source_kind}:${source.source_ref}`));
  const seenRefs = new Set<string>();
  for (const disposition of report.dispositions) {
    assertDisposition(disposition);
    const ref = `${disposition.source_kind}:${disposition.source_ref}`;
    if (!pendingRefs.has(ref)) throw new Error(`maintenance report disposition references unknown source: ${ref}`);
    seenRefs.add(ref);
  }
  for (const ref of pendingRefs) {
    if (!seenRefs.has(ref)) throw new Error(`maintenance report missing disposition for source: ${ref}`);
  }
}

export function sourceConsumptionsFromMaintenanceReport(
  input: Pick<ProjectMemoryMaintenanceModeInput, "projectKey" | "runDir" | "now">,
  report: ProjectMemoryMaintenanceReport,
): ProjectMemorySourceConsumptionRecord[] {
  const consumedAt = (input.now ?? new Date()).toISOString();
  return report.dispositions.map((disposition) => ({
    source_kind: disposition.source_kind,
    source_ref: disposition.source_ref,
    project_key: input.projectKey,
    consumed_by_run: input.runDir,
    consumed_at: consumedAt,
    terminal_decision: disposition.disposition,
    output_refs: disposition.output_refs,
  }));
}

async function writeRootMaintenanceReport(
  input: Pick<ProjectMemoryMaintenanceModeInput, "absoluteRunDir">,
  report: ProjectMemoryMaintenanceReport,
): Promise<void> {
  await mkdir(resolveInside(input.absoluteRunDir, "reports"), { recursive: true });
  await writeJson(resolveInside(input.absoluteRunDir, "reports", "documentation-maintenance-report.json"), report);
}

function assertDisposition(disposition: ProjectMemoryMaintenanceDisposition): void {
  if (disposition.source_kind !== "project_candidate" && disposition.source_kind !== "project_handoff") {
    throw new Error(`invalid maintenance disposition source_kind: ${disposition.source_kind}`);
  }
  if (!disposition.source_ref) throw new Error("maintenance disposition source_ref is required");
  if (!isProjectMemoryAgentCandidateDisposition(disposition.disposition)) {
    throw new Error(`invalid maintenance disposition: ${disposition.disposition}`);
  }
  if (!Array.isArray(disposition.output_refs)) throw new Error("maintenance disposition output_refs must be an array");
  if (typeof disposition.reason !== "string" || disposition.reason.trim().length === 0) {
    throw new Error("maintenance disposition reason is required");
  }
}

function emptyMaintenanceReport(
  projectKey: string,
  status: ProjectMemoryMaintenanceReport["status"],
): ProjectMemoryMaintenanceReport {
  return {
    schema_version: 1,
    project_key: projectKey,
    status,
    dispositions: [],
    touched_paths: [],
    evidence_paths: [],
    known_gaps: [],
  };
}

function maintenancePrompt(
  projectKey: string,
  pendingSources: ProjectMemoryMaintenancePendingSource[],
): string {
  return [
    `You are maintaining Project Memory documentation for project ${projectKey}.`,
    "Read the repository from target-repo/ and the existing documentation from draft-wiki/.",
    "For each pending source, decide whether it changes durable project documentation.",
    "Update draft-wiki markdown only when the source improves or corrects durable project understanding.",
    "Do not create rigid structure for its own sake; update the most natural documentation surface.",
    `Allowed dispositions: ${PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS.join(", ")}`,
    "Every pending source must receive exactly one disposition in reports/documentation-maintenance-report.json.",
    "Use applied_to_project_memory when you updated docs, already_covered when docs already cover it, insufficient_evidence when repo verification cannot support it, not_durable for ephemeral/session-only material, and belongs_to_other_layer for non-project-memory material.",
    "Use concrete repo paths and markdown output_refs where helpful.",
    "Pending sources:",
    JSON.stringify(pendingSources, null, 2),
  ].join("\n");
}
