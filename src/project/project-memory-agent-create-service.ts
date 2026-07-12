import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { invokeFileAuthoringAgent } from "../runtime/project-run-infrastructure.ts";
import { readJson } from "../runtime/json.ts";
import { resolveInside } from "../runtime/fs.ts";
import type {
  ProjectMemorySubjectManifest,
  ProjectMemorySubjectManifestEntry,
  ProjectMemorySubjectReport,
} from "./project-memory-agent-contracts.ts";
import type {
  ProjectMemoryCreateModeInput,
  ProjectMemoryCreateModeResult,
} from "./project-memory-agent-service-contracts.ts";
export type {
  ProjectMemoryCreateModeInput,
  ProjectMemoryCreateModeResult,
} from "./project-memory-agent-service-contracts.ts";

const FILE_AUTHORING_TIMEOUT_MS = 600_000;

export async function runProjectMemoryCreateMode(
  input: ProjectMemoryCreateModeInput,
): Promise<ProjectMemoryCreateModeResult> {
  const createDir = join(input.absoluteRunDir, "agents", "create");
  const draftWikiDir = join(createDir, "draft-wiki");
  const concurrency = normalizedConcurrency(input.concurrency);
  try {
    await mkdir(draftWikiDir, { recursive: true });
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

    const manifest = normalizeCreateManifest(
      input.projectKey,
      await readJson<ProjectMemorySubjectManifest>(join(createDir, "reports", "documentation-subject-manifest.json")),
    );
    await cp(join(createDir, "reports"), join(input.absoluteRunDir, "reports"), { recursive: true, force: true });
    await writeFile(
      join(input.absoluteRunDir, "reports", "documentation-subject-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await assertDraftWikiHasSubjectFiles(draftWikiDir, manifest);
    const subjectReports = await runSubjectWriters(input, manifest, draftWikiDir, concurrency);
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
      ],
      pre_maintenance_wiki_ref: "pre-maintenance-wiki",
      concurrency_limit: concurrency,
      retry_limit: 1,
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
    "Decide the documentation shape yourself. Do not assume required filenames other than index.md.",
    "Write draft-wiki/index.md and create one placeholder markdown file per documentation subject.",
    "Write reports/documentation-subject-manifest.json with schema_version 1, project_key, and subjects.",
    "Each subject needs subject_id, wiki_path, title, purpose, and suggested_repo_paths.",
    "Write reports/documentation-planner-report.json with evidence_paths and known_gaps.",
    "Do not write outside the allowed output roots.",
  ].join("\n");
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
  draftWikiDir: string,
  concurrency: number,
): Promise<ProjectMemorySubjectReport[]> {
  const reports: ProjectMemorySubjectReport[] = [];
  let index = 0;
  async function worker(): Promise<void> {
    while (index < manifest.subjects.length) {
      const subject = manifest.subjects[index++];
      reports.push(await runSubjectWriterWithRetry(input, subject, draftWikiDir));
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
  draftWikiDir: string,
): Promise<ProjectMemorySubjectReport> {
  let lastError = "writer failed";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const workspaceDir = join(input.absoluteRunDir, "agents", `subject-${subject.subject_id}`);
    const indexMarkdown = await readFile(join(draftWikiDir, "index.md"), "utf8");
    const result = await invokeFileAuthoringAgent({
      root: input.root,
      projectKey: input.projectKey,
      stageId: `subject-${subject.subject_id}`,
      prompt: subjectWriterPrompt(input.projectKey, subject, indexMarkdown),
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
    if (result.status !== "completed") {
      lastError = result.error ?? "writer failed";
      continue;
    }

    try {
      await copySubjectOutput(workspaceDir, draftWikiDir, subject.wiki_path);
      return await readSubjectReportOrFallback(input.projectKey, subject, workspaceDir);
    } catch (error) {
      lastError = errorMessage(error);
    }
  }
  return failedSubjectReport(input.projectKey, subject, lastError);
}

function subjectWriterPrompt(
  projectKey: string,
  subject: ProjectMemorySubjectManifestEntry,
  indexMarkdown: string,
): string {
  return [
    `You are documenting one Project Memory subject for project ${projectKey}.`,
    `Subject id: ${subject.subject_id}`,
    `Assigned wiki path: ${subject.wiki_path}`,
    `Title: ${subject.title}`,
    `Purpose: ${subject.purpose}`,
    `Suggested repo paths: ${subject.suggested_repo_paths.join(", ") || "inspect the repository as needed"}`,
    "Current draft-wiki/index.md:",
    indexMarkdown,
    "Read the repository from target-repo/ and write only the assigned markdown file under draft-wiki.",
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
    concurrency_limit: concurrency,
    retry_limit: 1,
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
