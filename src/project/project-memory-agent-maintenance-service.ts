import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveInside } from "../runtime/fs.ts";
import { readJson, writeJson } from "../runtime/json.ts";
import { invokeFileAuthoringAgent } from "../runtime/project-run-infrastructure.ts";
import type { ProjectMemorySourceConsumptionRecord } from "./project-memory-apply-contracts.ts";
import {
  isProjectMemoryAgentCandidateDisposition,
  PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS,
  PROJECT_MEMORY_MAINTENANCE_REPORT_SCHEMA,
  type ProjectMemoryMaintenanceDisposition,
  type ProjectMemoryMaintenanceReport,
} from "./project-memory-agent-contracts.ts";
import type {
  ProjectMemoryMaintenanceModeInput,
  ProjectMemoryMaintenanceModeResult,
  ProjectMemoryMaintenancePendingSource,
} from "./project-memory-agent-service-contracts.ts";
import {
  assertRepositoryIdentityClaims,
  collectProjectRepositoryIdentity,
  PROJECT_REPOSITORY_IDENTITY_REF,
} from "./project-repository-identity.ts";
import { PROJECT_MEMORY_BEHAVIOR_COVERAGE_GUIDANCE } from "./project-memory-authoring-guidance.ts";
import { emitProjectLearnProgress } from "./project-learn-progress.ts";
export type {
  ProjectMemoryMaintenanceModeInput,
  ProjectMemoryMaintenanceModeResult,
  ProjectMemoryMaintenancePendingSource,
} from "./project-memory-agent-service-contracts.ts";

const FILE_AUTHORING_TIMEOUT_MS = 600_000;
const MAINTENANCE_RETRY_LIMIT = 1;
const MAINTENANCE_REPORT_REF = "reports/documentation-maintenance-report.json";
const MAINTENANCE_REPORT_CONTRACT_REF = "contracts/project-memory-maintenance-report.schema.json";

export async function runProjectMemoryMaintenanceMode(
  input: ProjectMemoryMaintenanceModeInput,
): Promise<ProjectMemoryMaintenanceModeResult> {
  const workspaceDir = join(input.absoluteRunDir, "agents", "maintenance");
  const draftWikiDir = join(workspaceDir, "draft-wiki");
  await mkdir(workspaceDir, { recursive: true });
  await cp(input.baseWikiDir, draftWikiDir, { recursive: true, force: true });
  const repositoryIdentity = await collectProjectRepositoryIdentity(input.projectKey, input.targetRepoDir);
  await writeJson(join(input.absoluteRunDir, PROJECT_REPOSITORY_IDENTITY_REF), repositoryIdentity);
  await writeJson(join(workspaceDir, PROJECT_REPOSITORY_IDENTITY_REF), repositoryIdentity);
  await writeJson(join(workspaceDir, MAINTENANCE_REPORT_CONTRACT_REF), PROJECT_MEMORY_MAINTENANCE_REPORT_SCHEMA);

  if (input.pendingSources.length === 0) {
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "maintenance",
      status: "completed",
      current: 0,
      total: 0,
      run_dir: input.runDir,
      message: "no pending sources",
    });
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

  emitProjectLearnProgress(input.progress, {
    project_key: input.projectKey,
    stage: "maintenance",
    status: "started",
    run_dir: input.runDir,
    message: `reviewing ${input.pendingSources.length} pending sources in one authoring pass`,
  });

  let retryFeedback: string | undefined;
  for (let attempt = 1; attempt <= MAINTENANCE_RETRY_LIMIT + 1; attempt += 1) {
    const result = await invokeFileAuthoringAgent({
      root: input.root,
      projectKey: input.projectKey,
      stageId: "maintenance",
      prompt: maintenancePrompt(input.projectKey, input.pendingSources, retryFeedback),
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
      retryFeedback = result.error ?? "maintenance agent failed";
    } else {
      try {
        await assertRepositoryIdentityClaims(draftWikiDir, repositoryIdentity);
        const report = await readJson<ProjectMemoryMaintenanceReport>(join(workspaceDir, MAINTENANCE_REPORT_REF));
        assertMaintenanceReport(input.projectKey, input.pendingSources, report);
        await writeRootMaintenanceReport(input, report);
        const sourceConsumptions = sourceConsumptionsFromMaintenanceReport(input, report);
        emitProjectLearnProgress(input.progress, {
          project_key: input.projectKey,
          stage: "maintenance",
          status: report.status === "failed" ? "failed" : "completed",
          current: report.dispositions.length,
          total: input.pendingSources.length,
          run_dir: input.runDir,
        });
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
        const detail = error instanceof Error ? error.message : String(error);
        retryFeedback = detail.startsWith("repository identity contradiction")
          ? `maintenance draft failed repository identity validation: ${detail}`
          : `maintenance report agents/maintenance/${MAINTENANCE_REPORT_REF} does not satisfy agents/maintenance/${MAINTENANCE_REPORT_CONTRACT_REF}: ${detail}`;
      }
    }

    if (attempt <= MAINTENANCE_RETRY_LIMIT) {
      emitProjectLearnProgress(input.progress, {
        project_key: input.projectKey,
        stage: "maintenance",
        status: "progress",
        run_dir: input.runDir,
        message: `retrying authoring pass after validation failure: ${retryFeedback}`,
      });
      continue;
    }
  }

  const message = retryFeedback ?? "maintenance agent failed";
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

export function assertMaintenanceReport(
  projectKey: string,
  pendingSources: ProjectMemoryMaintenancePendingSource[],
  report: ProjectMemoryMaintenanceReport,
): void {
  if (report.schema_version !== 1) throw new Error("maintenance report schema_version must be 1");
  if (report.project_key !== projectKey) throw new Error("maintenance report project_key mismatch");
  if (!["completed", "degraded", "failed"].includes(report.status)) throw new Error(`invalid maintenance report status: ${report.status}`);
  if (!Array.isArray(report.dispositions)) throw new Error("maintenance report dispositions must be an array");
  assertStringArray(report.touched_paths, "maintenance report touched_paths");
  assertStringArray(report.evidence_paths, "maintenance report evidence_paths");
  assertStringArray(report.known_gaps, "maintenance report known_gaps");
  const pendingRefs = new Set(pendingSources.map((source) => `${source.source_kind}:${source.source_ref}`));
  const seenRefs = new Set<string>();
  const appliedOutputRefs = new Set<string>();
  for (const disposition of report.dispositions) {
    assertDisposition(disposition);
    const ref = `${disposition.source_kind}:${disposition.source_ref}`;
    if (!pendingRefs.has(ref)) throw new Error(`maintenance report disposition references unknown source: ${ref}`);
    if (seenRefs.has(ref)) throw new Error(`maintenance report has duplicate disposition for source: ${ref}`);
    seenRefs.add(ref);
    if (disposition.disposition === "applied_to_project_memory") {
      if (disposition.output_refs.length === 0) {
        throw new Error(`maintenance report applied disposition must reference a touched draft path: ${ref}`);
      }
      for (const outputRef of disposition.output_refs) appliedOutputRefs.add(outputRef);
    }
  }
  for (const ref of pendingRefs) {
    if (!seenRefs.has(ref)) throw new Error(`maintenance report missing disposition for source: ${ref}`);
  }
  for (const outputRef of appliedOutputRefs) {
    if (!report.touched_paths.includes(outputRef)) {
      throw new Error(`maintenance report applied output_ref is not listed in touched_paths: ${outputRef}`);
    }
  }
  for (const touchedPath of report.touched_paths.filter((path) => path.startsWith("draft-wiki/"))) {
    if (!appliedOutputRefs.has(touchedPath)) {
      throw new Error(`maintenance report touched draft path is not traced to an applied source: ${touchedPath}`);
    }
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
  if (!disposition || typeof disposition !== "object") throw new Error("maintenance disposition must be an object");
  if (disposition.source_kind !== "project_candidate" && disposition.source_kind !== "project_handoff") {
    throw new Error(`invalid maintenance disposition source_kind: ${disposition.source_kind}`);
  }
  if (!disposition.source_ref) throw new Error("maintenance disposition source_ref is required");
  if (!isProjectMemoryAgentCandidateDisposition(disposition.disposition)) {
    throw new Error(`invalid maintenance disposition: ${disposition.disposition}`);
  }
  assertStringArray(disposition.output_refs, "maintenance disposition output_refs");
  if (typeof disposition.reason !== "string" || disposition.reason.trim().length === 0) {
    throw new Error("maintenance disposition reason is required");
  }
}

function assertStringArray(value: unknown, name: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of strings`);
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
  retryFeedback?: string,
): string {
  return [
    `You are maintaining Project Memory documentation for project ${projectKey}.`,
    "Read the repository from target-repo/ and the existing documentation from draft-wiki/.",
    `Read ${PROJECT_REPOSITORY_IDENTITY_REF} as sanitized deterministic checkout evidence. When docs conflict with it, preserve and explicitly label the contradiction; never silently prefer a stale no-remote claim.`,
    `Use ${PROJECT_REPOSITORY_IDENTITY_REF} in report evidence_paths when relevant. Do not add or refresh a wiki link to that run-local artifact merely because checkout identity was inspected.`,
    "Keep index.md as current canonical navigation: preserve links to every existing subject page and never describe published pages as planned, eventual, or placeholders.",
    ...PROJECT_MEMORY_BEHAVIOR_COVERAGE_GUIDANCE,
    "For each pending source, decide whether it changes durable project documentation.",
    "Update draft-wiki markdown only when the source improves or corrects durable project understanding.",
    "Keep changes source-traceable and surgical. Every touched draft-wiki path must be cited by at least one applied_to_project_memory disposition; do not perform unrelated cleanup.",
    "A requested or proposed implementation handoff is a lead, not proof. Verify it against current repository code and tests: if the work is implemented and materially changes durable behavior, document that current behavior; if it is not implemented, use belongs_to_other_layer for engineering work or not_durable for transient follow-up. Do not classify verified implemented behavior as belongs_to_other_layer merely because the source was phrased as a proposal.",
    "Repository branch, commit hash, and remote URL snapshots are run evidence, not durable project facts. Do not add or refresh canonical prose solely to mirror the current checkout identity; use evidence_paths for repository-identity.json rather than output_refs.",
    "Candidate evidence requires at least one observed_facts item and proposed_payload requires at least one durable_facts item. The relevant_paths, uncertainties, suggested_subjects, and verification_needed fields are required arrays but may be empty. Preserve these exact cardinalities when documenting the candidate contract.",
    "Pending source metadata is routing context, not an acceptance gate. Legacy candidates and handoffs may have empty evidence or proposed payloads; for every concrete durable claim, search current target-repo code, tests, and canonical documentation before choosing a disposition.",
    "Use insufficient_evidence only after repository verification cannot establish the claimed fact, and state what current evidence was checked. Do not reject a concrete legacy lead merely because its stored evidence fields are empty when current repository evidence independently verifies it.",
    "Current repository code, active canonical documentation, and regression-test source are more authoritative than stale source wording. When a source calls a decision unresolved but current code and canonical docs consistently implement and name one choice, treat the source as stale and use already_covered or apply a correction; do not preserve a false unresolved state.",
    "An explicitly open product-policy decision is different from a stale factual claim. Source wording such as decide whether, policy remains unresolved, or verification_needed asking whether behavior is intentional must not be settled from incidental current implementation alone. Use deferred_unsafe_change unless a current explicit decision or contract resolves it.",
    "Observable public and storage contracts are not unresolved policy merely because an old source framed them as a choice. In particular, when current path helpers, migration code, tests, and canonical docs consistently use one directory or root name, classify the stale naming lead already_covered rather than deferred_unsafe_change.",
    "Do not promote a candidate's proposed known gap into canonical documentation or report known_gaps merely because the candidate asks for a decision. Independently verify a current unmet contract that materially limits Project Memory; otherwise document only established behavior or choose a no-write disposition.",
    "Choose dispositions against the final draft produced by this pass. If one source's durable fact is already present or becomes covered by an update attributed to another source in the same pass, mark the overlapping source already_covered rather than insufficient_evidence.",
    "Inspect regression-test source as repository evidence, but do not run repository test commands inside the isolated authoring workspace. That snapshot intentionally differs from the operator checkout, and ambient installed launchers can produce environment-only command failures. Do not record authoring-environment test failures as Project Memory facts or known_gaps.",
    "Report status degraded and known_gaps only for unresolved documentation or repository-verification gaps that materially affect this draft, not for limitations of the authoring sandbox or ambient tools.",
    "Do not create rigid structure for its own sake; update the most natural documentation surface.",
    `Read ${MAINTENANCE_REPORT_CONTRACT_REF} before writing the report. The report must satisfy that JSON Schema exactly; do not invent, rename, or omit fields.`,
    `Allowed dispositions: ${PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS.join(", ")}`,
    `Every pending source must receive exactly one disposition in ${MAINTENANCE_REPORT_REF}.`,
    "Use applied_to_project_memory when you updated docs, already_covered when docs already cover it, insufficient_evidence when this project's claimed durable fact cannot be verified, not_durable for ephemeral/session-only material, and belongs_to_other_layer for non-project-memory material.",
    "A source that clearly concerns another project or repository belongs_to_other_layer even when that other checkout is unavailable; do not classify it as insufficient_evidence merely because the current checkout cannot verify the other project.",
    "Use concrete repo paths and markdown output_refs where helpful.",
    "output_refs identify documentation outputs, not evidence. Every applied_to_project_memory output_ref must also appear in touched_paths; place repository and run evidence only in evidence_paths.",
    ...(retryFeedback ? [
      "This is a bounded retry after the previous authoring pass failed validation.",
      `Validation feedback: ${retryFeedback}`,
      "Repair the existing draft and report so they satisfy the contract; re-check all dispositions before returning.",
    ] : []),
    "Pending sources:",
    JSON.stringify(pendingSources, null, 2),
  ].join("\n");
}
