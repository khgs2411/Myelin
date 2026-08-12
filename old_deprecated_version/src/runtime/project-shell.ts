import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { projectPath, projectRunsPath, projectSourcesPath, projectStatePath } from "./fs.ts";
import { readProjectStateIfExists, writeProjectState } from "./state.ts";
import { writeJson } from "./json.ts";

export type ProjectShellMove = {
  from: string;
  to: string;
};

export type ProjectShellRepairResult = {
  created: string[];
  kept: string[];
  removed: string[];
  moved: ProjectShellMove[];
};

export type ProjectShellRepairOptions = {
  repoPath?: string;
  curated?: boolean;
};

export async function repairProjectShell(
  root: string,
  projectKey: string,
  options: ProjectShellRepairOptions = {},
): Promise<ProjectShellRepairResult> {
  const result: ProjectShellRepairResult = { created: [], kept: [], removed: [], moved: [] };
  const curated = Boolean(options.curated);

  await ensureDirectory(projectPath(root, projectKey), label(projectKey), result);
  await ensureDirectory(projectStatePath(root, projectKey), stateLabel(projectKey), result);
  await ensureDirectory(projectRunsPath(root, projectKey), runsLabel(projectKey), result);
  await ensureDirectory(projectSourcesPath(root, projectKey), sourcesLabel(projectKey), result);
  await ensureDirectory(projectSourcesPath(root, projectKey, "inbox"), sourcesLabel(projectKey, "inbox"), result);

  await ensureMarkdownFile(
    projectPath(root, projectKey, "index.md"),
    label(projectKey, "index.md"),
    wikiIndex(projectKey, curated),
    result,
  );
  await ensureBootstrapState(root, projectKey, result);

  return result;
}

export async function ensureProjectMemoryBrain(
  root: string,
  projectKey: string,
  now: Date,
  runDir: string,
): Promise<void> {
  const projectRoot = projectPath(root, projectKey);
  await writeGeneratedMarkdown(
    join(projectRoot, "index.md"),
    [
      "# Project Memory",
      "",
      `Curated Project Memory for \`${projectKey}\`.`,
      "",
      "- [Architecture](architecture/index.md)",
      "- [Setup](setup/index.md)",
      "- [Testing](testing/index.md)",
      "- [Decisions](decisions/index.md)",
      "",
    ].join("\n"),
    ["Project Memory has not been curated yet.", `Curated Project Memory for \`${projectKey}\`.`],
  );

  await writeJson(projectStatePath(root, projectKey, "project-memory.json"), {
    project_key: projectKey,
    source_run_dir: runDir,
    status: "curated",
    updated_at: now.toISOString(),
  });
  await writeJson(projectStatePath(root, projectKey, "pages.json"), {
    project_key: projectKey,
    pages: ["index.md"],
    updated_at: now.toISOString(),
  });

  const bootstrapState = (await readProjectStateIfExists<{ missing?: string[]; [key: string]: unknown }>(
    root,
    projectKey,
    "bootstrap-state.json",
  )) ?? { missing: [] };
  await writeProjectState(root, projectKey, "bootstrap-state.json", {
    ...bootstrapState,
    missing: (bootstrapState.missing ?? []).filter((item) => item !== "curated_project_memory"),
    status: "curated",
    updated_at: now.toISOString(),
  });
}

async function ensureDirectory(path: string, pathLabel: string, result: ProjectShellRepairResult): Promise<void> {
  const existing = await statIfExists(path);
  if (existing) {
    if (!existing.isDirectory()) throw new Error(`${pathLabel} exists but is not a directory`);
    result.kept.push(pathLabel);
    return;
  }

  await mkdir(path, { recursive: true });
  result.created.push(pathLabel);
}

async function ensureMarkdownFile(
  path: string,
  pathLabel: string,
  content: string,
  result: ProjectShellRepairResult,
): Promise<void> {
  const existing = await statIfExists(path);
  if (existing) {
    if (!existing.isFile()) throw new Error(`${pathLabel} exists but is not a file`);
    result.kept.push(pathLabel);
    return;
  }

  await writeMarkdown(path, content);
  result.created.push(pathLabel);
}

async function ensureBootstrapState(
  root: string,
  projectKey: string,
  result: ProjectShellRepairResult,
): Promise<void> {
  const path = projectStatePath(root, projectKey, "bootstrap-state.json");
  const pathLabel = stateLabel(projectKey, "bootstrap-state.json");

  if (await exists(path)) {
    result.kept.push(pathLabel);
    return;
  }

  await writeProjectState(root, projectKey, "bootstrap-state.json", {
    missing: ["curated_project_memory", "experience_log_capture_verification"],
    status: "uncurated",
  });
  result.created.push(pathLabel);
}

async function writeMarkdown(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

async function writeGeneratedMarkdown(path: string, content: string, generatedNeedles: string[]): Promise<void> {
  const current = await readTextIfExists(path);
  if (!current) {
    await writeMarkdown(path, content);
    return;
  }

  const marker = "\n## Preserved Previous Content\n\n";
  const markerIndex = current.indexOf(marker);
  if (markerIndex !== -1) {
    await writeMarkdown(path, `${content.trimEnd()}${current.slice(markerIndex)}`);
    return;
  }

  if (generatedNeedles.some((needle) => current.includes(needle))) {
    await writeMarkdown(path, content);
    return;
  }

  await writeMarkdown(path, `${content.trimEnd()}${marker}${current.trimEnd()}\n`);
}

function wikiIndex(projectKey: string, curated: boolean): string {
  return [
    "# Project Memory",
    "",
    curated ? `Curated Project Memory for \`${projectKey}\`.` : "Project Memory has not been curated yet.",
    "",
  ].join("\n");
}

function label(projectKey: string, ...segments: string[]): string {
  return ["projects", projectKey, ...segments].join("/");
}

function stateLabel(projectKey: string, ...segments: string[]): string {
  return ["state", projectKey, ...segments].join("/");
}

function sourcesLabel(projectKey: string, ...segments: string[]): string {
  return ["sources", projectKey, ...segments].join("/");
}

function runsLabel(projectKey: string, ...segments: string[]): string {
  return ["runs", projectKey, ...segments].join("/");
}

async function exists(path: string): Promise<boolean> {
  return (await statIfExists(path)) !== null;
}

async function statIfExists(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
