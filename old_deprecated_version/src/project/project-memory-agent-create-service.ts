import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { invokeFileAuthoringAgent } from "../runtime/project-run-infrastructure.ts";
import { readJson, writeJson } from "../runtime/json.ts";
import { resolveInside } from "../runtime/fs.ts";
import type {
  ProjectMemoryPlannerReport,
  ProjectMemoryRepositorySurfaceCoverage,
  ProjectMemorySubjectManifest,
  ProjectMemorySubjectManifestEntry,
  ProjectMemorySubjectReport,
} from "./project-memory-agent-contracts.ts";
import { PROJECT_MEMORY_REPOSITORY_SURFACE_KINDS } from "./project-memory-agent-contracts.ts";
import type {
  ProjectMemoryCreateModeInput,
  ProjectMemoryCreateModeResult,
} from "./project-memory-agent-service-contracts.ts";
import {
  assertRepositoryIdentityClaims,
  collectProjectRepositoryIdentity,
  PROJECT_REPOSITORY_IDENTITY_REF,
  type ProjectRepositoryIdentity,
} from "./project-repository-identity.ts";
import { PROJECT_MEMORY_BEHAVIOR_COVERAGE_GUIDANCE } from "./project-memory-authoring-guidance.ts";
import { emitProjectLearnProgress } from "./project-learn-progress.ts";
export type {
  ProjectMemoryCreateModeInput,
  ProjectMemoryCreateModeResult,
} from "./project-memory-agent-service-contracts.ts";

const FILE_AUTHORING_TIMEOUT_MS = 600_000;
const SUBJECT_WRITER_RETRY_LIMIT = 3;
const TRANSIENT_SUBJECT_RETRY_DELAYS_MS = [15_000, 45_000, 90_000] as const;

export async function runProjectMemoryCreateMode(
  input: ProjectMemoryCreateModeInput,
): Promise<ProjectMemoryCreateModeResult> {
  const createDir = join(input.absoluteRunDir, "agents", "create");
  const draftWikiDir = join(createDir, "draft-wiki");
  const concurrency = normalizedConcurrency(input.concurrency);
  try {
    await mkdir(draftWikiDir, { recursive: true });
    const repositoryIdentity = await collectProjectRepositoryIdentity(input.projectKey, input.targetRepoDir);
    await writeJson(join(input.absoluteRunDir, PROJECT_REPOSITORY_IDENTITY_REF), repositoryIdentity);
    await writeJson(join(createDir, PROJECT_REPOSITORY_IDENTITY_REF), repositoryIdentity);
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "planner",
      status: "started",
      run_dir: input.runDir,
      message: "discovering Project Memory subjects",
    });
    const planner = await invokeFileAuthoringAgent({
      root: input.root,
      projectKey: input.projectKey,
      stageId: "create-planner",
      prompt: createPlannerPrompt(input.projectKey),
      runDir: input.runDir,
      targetRepoDir: input.targetRepoDir,
      workspaceDir: createDir,
      outputRoots: [
        { name: "draft_wiki", relativePath: "draft-wiki" },
        { name: "planner_reports", relativePath: "reports" },
      ],
      provider: input.provider,
      modelOverride: input.modelOverride,
      env: input.env,
      runner: input.runner,
      timeoutMs: FILE_AUTHORING_TIMEOUT_MS,
    });
    if (planner.status !== "completed") return failedCreateResult(input, draftWikiDir, planner.error ?? "planner failed", concurrency);
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "planner",
      status: "completed",
      run_dir: input.runDir,
    });

    const manifest = normalizeCreateManifest(
      input.projectKey,
      await readJson<ProjectMemorySubjectManifest>(join(createDir, "reports", "documentation-subject-manifest.json")),
    );
    const plannerReport = await readJson<ProjectMemoryPlannerReport>(
      join(createDir, "reports", "documentation-planner-report.json"),
    );
    assertCreatePlannerReport(input.projectKey, plannerReport, manifest);
    await cp(join(createDir, "reports"), join(input.absoluteRunDir, "reports"), { recursive: true, force: true });
    await writeFile(
      join(input.absoluteRunDir, "reports", "documentation-subject-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await assertDraftWikiHasSubjectFiles(draftWikiDir, manifest);
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "subject_writers",
      status: "started",
      current: 0,
      total: manifest.subjects.length,
      run_dir: input.runDir,
    });
    const subjectReports = await runSubjectWriters(
      input,
      manifest,
      plannerReport,
      draftWikiDir,
      concurrency,
      repositoryIdentity,
    );
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "subject_writers",
      status: "completed",
      current: subjectReports.length,
      total: manifest.subjects.length,
      run_dir: input.runDir,
    });
    await finalizeCreateIndex(input, manifest, draftWikiDir, repositoryIdentity);
    await assertRepositoryIdentityClaims(draftWikiDir, repositoryIdentity);
    await cp(draftWikiDir, join(input.absoluteRunDir, "pre-maintenance-wiki"), { recursive: true });
    return {
      status: "completed",
      project_key: input.projectKey,
      draft_wiki_dir: draftWikiDir,
      manifest,
      planner_report_ref: "reports/documentation-planner-report.json",
      subject_manifest_ref: "reports/documentation-subject-manifest.json",
      subject_reports: subjectReports,
      subject_report_refs: subjectReports.map((report) => `agents/subject-${report.subject_id}/reports/subject-report.json`),
      file_authoring_run_refs: [
        "agents/create/file-authoring-agent-result.json",
        ...subjectReports.map((report) => `agents/subject-${report.subject_id}/file-authoring-agent-result.json`),
        "agents/create-index-finalizer/file-authoring-agent-result.json",
      ],
      pre_maintenance_wiki_ref: "pre-maintenance-wiki",
      repository_identity_ref: PROJECT_REPOSITORY_IDENTITY_REF,
      concurrency_limit: concurrency,
      retry_limit: SUBJECT_WRITER_RETRY_LIMIT,
    };
  } catch (error) {
    return failedCreateResult(input, draftWikiDir, errorMessage(error), concurrency);
  }
}

export function assertCreateManifest(projectKey: string, manifest: ProjectMemorySubjectManifest): void {
  if (manifest.schema_version !== 1) throw new Error("documentation subject manifest schema_version must be 1");
  if (manifest.project_key !== projectKey) throw new Error("documentation subject manifest project_key mismatch");
  if (!Array.isArray(manifest.subjects) || manifest.subjects.length === 0) {
    throw new Error("documentation subject manifest must include at least one subject");
  }
  const ids = new Set<string>();
  for (const subject of manifest.subjects) {
    if (!subject.subject_id || ids.has(subject.subject_id)) throw new Error(`duplicate or empty subject_id: ${subject.subject_id}`);
    ids.add(subject.subject_id);
    if (!subject.wiki_path.endsWith(".md")) throw new Error(`subject wiki_path must be markdown: ${subject.wiki_path}`);
    if (subject.wiki_path.startsWith("/") || subject.wiki_path.includes("..")) {
      throw new Error(`subject wiki_path must stay inside draft wiki: ${subject.wiki_path}`);
    }
  }
}

export function assertCreatePlannerReport(
  projectKey: string,
  report: ProjectMemoryPlannerReport,
  manifest: ProjectMemorySubjectManifest,
): void {
  if (report.schema_version !== 1) throw new Error("documentation planner report schema_version must be 1");
  if (report.project_key !== projectKey) throw new Error("documentation planner report project_key mismatch");
  if (!Array.isArray(report.evidence_paths)) throw new Error("documentation planner report evidence_paths must be an array");
  if (!Array.isArray(report.known_gaps)) throw new Error("documentation planner report known_gaps must be an array");
  if (!Array.isArray(report.surface_coverage) || report.surface_coverage.length === 0) {
    throw new Error("documentation planner report must include repository surface coverage");
  }

  const subjectIds = new Set(manifest.subjects.map((subject) => subject.subject_id));
  const surfaceIds = new Set<string>();
  for (const coverage of report.surface_coverage) {
    assertSurfaceCoverageEntry(coverage, subjectIds, surfaceIds);
  }
  for (const kind of PROJECT_MEMORY_REPOSITORY_SURFACE_KINDS) {
    const matching = report.surface_coverage.filter((coverage) => coverage.kind === kind);
    if (matching.length === 0) throw new Error(`documentation planner report must account for surface kind: ${kind}`);
    if (matching.some((coverage) => coverage.status === "covered") && matching.some((coverage) => coverage.status === "not_present")) {
      throw new Error(`documentation planner report cannot mix covered and not_present for surface kind: ${kind}`);
    }
    if (matching[0]?.status === "not_present" && matching.length !== 1) {
      throw new Error(`documentation planner report must use one not_present entry for surface kind: ${kind}`);
    }
  }
}

function assertSurfaceCoverageEntry(
  coverage: ProjectMemoryRepositorySurfaceCoverage,
  subjectIds: Set<string>,
  surfaceIds: Set<string>,
): void {
  if (!coverage.surface_id || surfaceIds.has(coverage.surface_id)) {
    throw new Error(`duplicate or empty repository surface_id: ${coverage.surface_id}`);
  }
  surfaceIds.add(coverage.surface_id);
  if (!PROJECT_MEMORY_REPOSITORY_SURFACE_KINDS.includes(coverage.kind)) {
    throw new Error(`unsupported repository surface kind: ${coverage.kind}`);
  }
  if (coverage.status !== "covered" && coverage.status !== "not_present") {
    throw new Error(`unsupported repository surface status: ${coverage.status}`);
  }
  if (!coverage.summary?.trim()) throw new Error(`repository surface ${coverage.surface_id} must include a summary`);
  if (!Array.isArray(coverage.evidence_paths) || coverage.evidence_paths.length === 0) {
    throw new Error(`repository surface ${coverage.surface_id} must include evidence paths`);
  }
  if (!Array.isArray(coverage.subject_ids)) {
    throw new Error(`repository surface ${coverage.surface_id} subject_ids must be an array`);
  }
  if (coverage.status === "not_present" && coverage.subject_ids.length > 0) {
    throw new Error(`repository surface ${coverage.surface_id} is not present but has assigned subjects`);
  }
  if (coverage.status === "covered" && coverage.subject_ids.length === 0) {
    throw new Error(`repository surface ${coverage.surface_id} must have an assigned subject`);
  }
  for (const subjectId of coverage.subject_ids) {
    if (!subjectIds.has(subjectId)) {
      throw new Error(`repository surface ${coverage.surface_id} references unknown subject: ${subjectId}`);
    }
  }
}

function normalizeCreateManifest(
  projectKey: string,
  manifest: ProjectMemorySubjectManifest,
): ProjectMemorySubjectManifest {
  const normalized: ProjectMemorySubjectManifest = {
    ...manifest,
    project_key: manifest.project_key ?? projectKey,
    subjects: Array.isArray(manifest.subjects)
      ? manifest.subjects.map((subject) => ({
          ...subject,
          wiki_path: normalizeManifestWikiPath(subject.wiki_path),
          suggested_repo_paths: Array.isArray(subject.suggested_repo_paths) ? subject.suggested_repo_paths : [],
        }))
      : [],
  };
  assertCreateManifest(projectKey, normalized);
  return normalized;
}

function normalizeManifestWikiPath(path: string): string {
  return path.replace(/^\.?\//, "").replace(/^draft-wiki\//, "").replace(/^wiki\//, "");
}

function createPlannerPrompt(projectKey: string): string {
  return [
    `You are creating Project Memory documentation for project ${projectKey}.`,
    "Inspect the repository thoroughly from target-repo/.",
    `Read ${PROJECT_REPOSITORY_IDENTITY_REF} as sanitized deterministic checkout evidence. When repository documentation conflicts with it, preserve and explicitly label the contradiction; never silently prefer a stale no-remote claim.`,
    `If you cite that evidence artifact, link to ${PROJECT_REPOSITORY_IDENTITY_REF}; publication rewrites that target to canonical state.`,
    ...PROJECT_MEMORY_BEHAVIOR_COVERAGE_GUIDANCE,
    "Decide the documentation shape yourself. Do not assume required filenames other than index.md.",
    "Write draft-wiki/index.md as a publishable current orientation and navigation page, then create one placeholder markdown file per documentation subject.",
    "The index must describe the subjects as current canonical pages, never as planned, eventual, future, or placeholder documentation.",
    "Write reports/documentation-subject-manifest.json with schema_version 1, project_key, and subjects.",
    "Each subject needs subject_id, wiki_path, title, purpose, and suggested_repo_paths.",
    "Inventory every materially distinct repository surface and map each present surface to one or more subjects. Do not list only representative examples.",
    `Account explicitly for every surface kind: ${PROJECT_MEMORY_REPOSITORY_SURFACE_KINDS.join(", ")}.`,
    "Destructive or irreversible operations include delete, truncate, reset, prune, rollback, revoke, overwrite, archival, and other operations that remove or permanently transform state.",
    "For an absent surface kind, write exactly one not_present entry with inspected evidence paths and no subject_ids.",
    "Write reports/documentation-planner-report.json with schema_version 1, project_key, evidence_paths, surface_coverage, and known_gaps.",
    "Each surface_coverage entry needs surface_id, kind, status, summary, evidence_paths, and subject_ids. Status must be exactly covered or not_present. Every covered subject mapping must be reflected in that subject's purpose and suggested_repo_paths.",
    "Do not write outside the allowed output roots.",
  ].join("\n");
}

async function finalizeCreateIndex(
  input: ProjectMemoryCreateModeInput,
  manifest: ProjectMemorySubjectManifest,
  draftWikiDir: string,
  repositoryIdentity: ProjectRepositoryIdentity,
): Promise<void> {
  const workspaceDir = join(input.absoluteRunDir, "agents", "create-index-finalizer");
  await cp(draftWikiDir, join(workspaceDir, "current-wiki"), { recursive: true, force: true });
  await writeJson(join(workspaceDir, "documentation-subject-manifest.json"), manifest);
  await writeJson(join(workspaceDir, PROJECT_REPOSITORY_IDENTITY_REF), repositoryIdentity);
  emitProjectLearnProgress(input.progress, {
    project_key: input.projectKey,
    stage: "index_finalizer",
    status: "started",
    run_dir: input.runDir,
    message: "finalizing canonical Project Memory navigation",
  });

  let lastError = "index finalizer failed";
  for (let attempt = 1; attempt <= SUBJECT_WRITER_RETRY_LIMIT + 1; attempt += 1) {
    const result = await invokeFileAuthoringAgent({
      root: input.root,
      projectKey: input.projectKey,
      stageId: "create-index-finalizer",
      prompt: createIndexFinalizerPrompt(input.projectKey),
      runDir: input.runDir,
      targetRepoDir: input.targetRepoDir,
      workspaceDir,
      outputRoots: [{ name: "finalized_index", relativePath: "finalized-index" }],
      provider: input.provider,
      modelOverride: input.modelOverride,
      env: input.env,
      runner: input.runner,
      timeoutMs: FILE_AUTHORING_TIMEOUT_MS,
    });
    if (result.status === "completed") {
      const expectedOutput = "finalized-index/index.md";
      const outputs = result.discovered_outputs.map((output) => output.relative_path);
      if (outputs.length !== 1 || outputs[0] !== expectedOutput) {
        throw new Error(`index finalizer must write only ${expectedOutput}`);
      }
      const markdown = await readFile(join(workspaceDir, expectedOutput), "utf8");
      assertFinalizedIndex(markdown, manifest);
      await writeFile(join(draftWikiDir, "index.md"), markdown, "utf8");
      emitProjectLearnProgress(input.progress, {
        project_key: input.projectKey,
        stage: "index_finalizer",
        status: "completed",
        run_dir: input.runDir,
      });
      return;
    }

    lastError = result.error ?? lastError;
    await writeJson(join(workspaceDir, "retry-attempts", `attempt-${attempt}.json`), result);
    if (!isTransientProviderCapacityFailure(lastError) || attempt > SUBJECT_WRITER_RETRY_LIMIT) break;
    const delayMs = TRANSIENT_SUBJECT_RETRY_DELAYS_MS[attempt - 1];
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "index_finalizer",
      status: "progress",
      run_dir: input.runDir,
      message: `retrying in ${Math.ceil(delayMs / 1000)}s (attempt ${attempt + 1}/${SUBJECT_WRITER_RETRY_LIMIT + 1})`,
    });
    await (input.retryDelay ?? wait)(delayMs);
  }
  throw new Error(lastError);
}

function createIndexFinalizerPrompt(projectKey: string): string {
  return [
    `You are finalizing the canonical Project Memory index for project ${projectKey}.`,
    "Read every completed page under current-wiki/ and documentation-subject-manifest.json.",
    `Use ${PROJECT_REPOSITORY_IDENTITY_REF} only as deterministic identity evidence. If you link it, use ../state/${PROJECT_REPOSITORY_IDENTITY_REF}.`,
    "Write only finalized-index/index.md.",
    "The index must orient a future agent to the current repository and link every manifest subject by its exact wiki_path.",
    "Describe all linked pages as current canonical documentation. Do not call them planned, eventual, future, incomplete, or placeholders.",
    "Do not repeat implementation detail that belongs in a subject page; keep the index compact and navigational.",
  ].join("\n");
}

function assertFinalizedIndex(markdown: string, manifest: ProjectMemorySubjectManifest): void {
  if (/\b(?:planned canonical subjects|eventual pages|planning placeholders)\b/i.test(markdown)) {
    throw new Error("finalized index still contains planner lifecycle language");
  }
  for (const subject of manifest.subjects) {
    if (!markdown.includes(`](${subject.wiki_path})`)) {
      throw new Error(`finalized index is missing subject link: ${subject.wiki_path}`);
    }
  }
}

async function assertDraftWikiHasSubjectFiles(draftWikiDir: string, manifest: ProjectMemorySubjectManifest): Promise<void> {
  await stat(join(draftWikiDir, "index.md"));
  for (const subject of manifest.subjects) {
    await stat(resolveInside(draftWikiDir, subject.wiki_path));
  }
}

async function runSubjectWriters(
  input: ProjectMemoryCreateModeInput,
  manifest: ProjectMemorySubjectManifest,
  plannerReport: ProjectMemoryPlannerReport,
  draftWikiDir: string,
  concurrency: number,
  repositoryIdentity: ProjectRepositoryIdentity,
): Promise<ProjectMemorySubjectReport[]> {
  const reports: ProjectMemorySubjectReport[] = [];
  let index = 0;
  async function worker(): Promise<void> {
    while (index < manifest.subjects.length) {
      const subject = manifest.subjects[index++];
      const report = await runSubjectWriterWithRetry(
        input,
        subject,
        plannerReport.surface_coverage.filter((coverage) => coverage.subject_ids.includes(subject.subject_id)),
        draftWikiDir,
        repositoryIdentity,
        () => reports.length,
        manifest.subjects.length,
      );
      reports.push(report);
      emitProjectLearnProgress(input.progress, {
        project_key: input.projectKey,
        stage: "subject_writers",
        status: "progress",
        current: reports.length,
        total: manifest.subjects.length,
        run_dir: input.runDir,
        message: `${report.status === "completed" ? "completed" : "failed"} ${subject.subject_id}`,
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, manifest.subjects.length) }, () => worker()));
  const failed = reports.filter((report) => report.status !== "completed");
  if (failed.length > 0) throw new Error(`subject writers failed: ${failed.map((report) => report.subject_id).join(", ")}`);
  return reports.sort((a, b) => a.subject_id.localeCompare(b.subject_id));
}

async function runSubjectWriterWithRetry(
  input: ProjectMemoryCreateModeInput,
  subject: ProjectMemorySubjectManifestEntry,
  assignedSurfaces: ProjectMemoryRepositorySurfaceCoverage[],
  draftWikiDir: string,
  repositoryIdentity: ProjectRepositoryIdentity,
  completedCount: () => number,
  totalCount: number,
): Promise<ProjectMemorySubjectReport> {
  let lastError = "writer failed";
  const maxAttempts = SUBJECT_WRITER_RETRY_LIMIT + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const workspaceDir = join(input.absoluteRunDir, "agents", `subject-${subject.subject_id}`);
    await writeJson(join(workspaceDir, PROJECT_REPOSITORY_IDENTITY_REF), repositoryIdentity);
    const indexMarkdown = await readFile(join(draftWikiDir, "index.md"), "utf8");
    const result = await invokeFileAuthoringAgent({
      root: input.root,
      projectKey: input.projectKey,
      stageId: `subject-${subject.subject_id}`,
      prompt: subjectWriterPrompt(input.projectKey, subject, assignedSurfaces, indexMarkdown),
      runDir: input.runDir,
      targetRepoDir: input.targetRepoDir,
      workspaceDir,
      outputRoots: [
        { name: "draft_wiki", relativePath: "draft-wiki" },
        { name: "subject_reports", relativePath: "reports" },
      ],
      provider: input.provider,
      modelOverride: input.modelOverride,
      env: input.env,
      runner: input.runner,
      timeoutMs: FILE_AUTHORING_TIMEOUT_MS,
    });
    let transientProviderFailure = false;
    if (result.status !== "completed") {
      lastError = result.error ?? "writer failed";
      transientProviderFailure = isTransientProviderCapacityFailure(lastError);
      await writeJson(join(workspaceDir, "retry-attempts", `attempt-${attempt}.json`), result);
    } else {
      try {
        await assertRepositoryIdentityClaims(join(workspaceDir, "draft-wiki"), repositoryIdentity);
        await copySubjectOutput(workspaceDir, draftWikiDir, subject.wiki_path);
        return await readSubjectReportOrFallback(input.projectKey, subject, workspaceDir);
      } catch (error) {
        lastError = errorMessage(error);
      }
    }

    const retryLimit = transientProviderFailure ? SUBJECT_WRITER_RETRY_LIMIT : 1;
    if (attempt > retryLimit) break;
    const delayMs = transientProviderFailure ? TRANSIENT_SUBJECT_RETRY_DELAYS_MS[attempt - 1] : 0;
    emitSubjectWriterRetryProgress(
      input,
      subject.subject_id,
      completedCount(),
      totalCount,
      attempt + 1,
      retryLimit + 1,
      delayMs,
    );
    if (delayMs > 0) await (input.retryDelay ?? wait)(delayMs);
    emitSubjectWriterRetryProgress(
      input,
      subject.subject_id,
      completedCount(),
      totalCount,
      attempt + 1,
      retryLimit + 1,
      0,
    );
  }
  return failedSubjectReport(input.projectKey, subject, lastError);
}

function isTransientProviderCapacityFailure(error: string): boolean {
  return /selected model is at capacity/i.test(error);
}

function emitSubjectWriterRetryProgress(
  input: ProjectMemoryCreateModeInput,
  subjectId: string,
  current: number,
  total: number,
  attempt: number,
  maxAttempts: number,
  delayMs: number,
): void {
  const timing = delayMs > 0 ? ` in ${Math.ceil(delayMs / 1000)}s` : " now";
  emitProjectLearnProgress(input.progress, {
    project_key: input.projectKey,
    stage: "subject_writers",
    status: "progress",
    current,
    total,
    run_dir: input.runDir,
    message: `retrying ${subjectId}${timing} (attempt ${attempt}/${maxAttempts})`,
  });
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function subjectWriterPrompt(
  projectKey: string,
  subject: ProjectMemorySubjectManifestEntry,
  assignedSurfaces: ProjectMemoryRepositorySurfaceCoverage[],
  indexMarkdown: string,
): string {
  return [
    `You are documenting one Project Memory subject for project ${projectKey}.`,
    `Subject id: ${subject.subject_id}`,
    `Assigned wiki path: ${subject.wiki_path}`,
    `Title: ${subject.title}`,
    `Purpose: ${subject.purpose}`,
    `Suggested repo paths: ${subject.suggested_repo_paths.join(", ") || "inspect the repository as needed"}`,
    "Assigned repository surfaces:",
    ...assignedSurfaces.map((coverage) =>
      `- [${coverage.kind}] ${coverage.surface_id}: ${coverage.summary} (evidence: ${coverage.evidence_paths.join(", ")})`
    ),
    "Cover every assigned repository surface explicitly. A passing subject page must explain the supported operation, authority boundary, user-visible outcome, and destructive or irreversible consequences where applicable.",
    "Current draft-wiki/index.md:",
    indexMarkdown,
    "Read the repository from target-repo/ and write only the assigned markdown file under draft-wiki.",
    `Read ${PROJECT_REPOSITORY_IDENTITY_REF} as deterministic checkout evidence. If authored docs conflict with it, label the contradiction as stale, conflicting, or needing review.`,
    `If you cite that evidence artifact, link to ${PROJECT_REPOSITORY_IDENTITY_REF}; publication rewrites that target to canonical state.`,
    ...PROJECT_MEMORY_BEHAVIOR_COVERAGE_GUIDANCE,
    "Write reports/subject-report.json with schema_version, project_key, subject_id, wiki_path, status, evidence_paths, touched_paths, and known_gaps.",
    "Use concrete repo path references naturally where they help future agents.",
  ].join("\n");
}

async function copySubjectOutput(workspaceDir: string, draftWikiDir: string, wikiPath: string): Promise<void> {
  const source = resolveInside(workspaceDir, "draft-wiki", wikiPath);
  const destination = resolveInside(draftWikiDir, wikiPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(source, "utf8"), "utf8");
}

async function readSubjectReportOrFallback(
  projectKey: string,
  subject: ProjectMemorySubjectManifestEntry,
  workspaceDir: string,
): Promise<ProjectMemorySubjectReport> {
  try {
    const report = await readJson<Partial<ProjectMemorySubjectReport>>(join(workspaceDir, "reports", "subject-report.json"));
    return normalizeSubjectReport(projectKey, subject, report);
  } catch (error) {
    return {
      schema_version: 1,
      project_key: projectKey,
      subject_id: subject.subject_id,
      wiki_path: subject.wiki_path,
      status: "completed",
      evidence_paths: [],
      touched_paths: [subject.wiki_path],
      known_gaps: [`subject report could not be read: ${errorMessage(error)}`],
    };
  }
}

function normalizeSubjectReport(
  projectKey: string,
  subject: ProjectMemorySubjectManifestEntry,
  report: Partial<ProjectMemorySubjectReport>,
): ProjectMemorySubjectReport {
  const knownGaps = Array.isArray(report.known_gaps) ? report.known_gaps.filter((item): item is string => typeof item === "string") : [];
  if (report.schema_version !== 1) knownGaps.push(`subject report schema_version was normalized from ${String(report.schema_version)}`);
  if (report.project_key && report.project_key !== projectKey) knownGaps.push(`subject report project_key was ${report.project_key}`);
  if (report.subject_id && report.subject_id !== subject.subject_id) knownGaps.push(`subject report subject_id was ${report.subject_id}`);
  if (report.wiki_path && report.wiki_path !== subject.wiki_path) knownGaps.push(`subject report wiki_path was ${report.wiki_path}`);
  if (report.status && report.status !== "completed") knownGaps.push(`subject report status was ${report.status}`);
  return {
    schema_version: 1,
    project_key: projectKey,
    subject_id: subject.subject_id,
    wiki_path: subject.wiki_path,
    status: "completed",
    evidence_paths: Array.isArray(report.evidence_paths)
      ? report.evidence_paths.filter((item): item is string => typeof item === "string")
      : [],
    touched_paths: Array.isArray(report.touched_paths)
      ? report.touched_paths.filter((item): item is string => typeof item === "string")
      : [subject.wiki_path],
    known_gaps: knownGaps,
  };
}

function failedSubjectReport(
  projectKey: string,
  subject: ProjectMemorySubjectManifestEntry,
  error: string,
): ProjectMemorySubjectReport {
  return {
    schema_version: 1,
    project_key: projectKey,
    subject_id: subject.subject_id,
    wiki_path: subject.wiki_path,
    status: "failed",
    evidence_paths: [],
    touched_paths: [],
    known_gaps: [],
    error,
  };
}

function failedCreateResult(
  input: ProjectMemoryCreateModeInput,
  draftWikiDir: string,
  error: string,
  concurrency: number,
): ProjectMemoryCreateModeResult {
  return {
    status: "failed",
    project_key: input.projectKey,
    draft_wiki_dir: draftWikiDir,
    manifest: { schema_version: 1, project_key: input.projectKey, subjects: [] },
    planner_report_ref: "reports/documentation-planner-report.json",
    subject_manifest_ref: "reports/documentation-subject-manifest.json",
    subject_reports: [],
    subject_report_refs: [],
    file_authoring_run_refs: [],
    pre_maintenance_wiki_ref: "pre-maintenance-wiki",
    repository_identity_ref: PROJECT_REPOSITORY_IDENTITY_REF,
    concurrency_limit: concurrency,
    retry_limit: SUBJECT_WRITER_RETRY_LIMIT,
    error,
  };
}

function normalizedConcurrency(value?: number): number {
  if (value === undefined) return 4;
  if (!Number.isFinite(value)) return 4;
  return Math.max(1, Math.min(Math.trunc(value), 8));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
