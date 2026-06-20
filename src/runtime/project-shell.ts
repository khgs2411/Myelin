import { mkdir, readFile, readdir, rename, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { projectPath, resolveInside } from "./fs.ts";
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

const REQUIRED_DIRS = ["wiki", "state", "log", "runs"] as const;
const OPTIONAL_LEGACY_DIRS = ["sources", "schema"] as const;

export async function repairProjectShell(
  root: string,
  projectKey: string,
  options: ProjectShellRepairOptions = {},
): Promise<ProjectShellRepairResult> {
  const result: ProjectShellRepairResult = { created: [], kept: [], removed: [], moved: [] };
  const curated = Boolean(options.curated);

  await ensureDirectory(projectPath(root, projectKey), label(projectKey), result);
  for (const dir of REQUIRED_DIRS) {
    await ensureDirectory(projectPath(root, projectKey, dir), label(projectKey, dir), result);
  }

  await moveFileIfDestinationMissing(rootIndexPath(root, projectKey), projectPath(root, projectKey, "wiki", "index.md"), result);
  await moveFileIfDestinationMissing(
    projectPath(root, projectKey, "changelog.md"),
    projectPath(root, projectKey, "log", "changelog.md"),
    result,
  );

  await ensureMarkdownFile(
    projectPath(root, projectKey, "readme.md"),
    label(projectKey, "readme.md"),
    projectReadme(projectKey, options.repoPath, curated),
    result,
  );
  await ensureMarkdownFile(
    rootIndexPath(root, projectKey),
    label(projectKey, "index.md"),
    projectIndex(projectKey),
    result,
  );
  await ensureMarkdownFile(
    projectPath(root, projectKey, "wiki", "index.md"),
    label(projectKey, "wiki", "index.md"),
    wikiIndex(projectKey, curated),
    result,
  );
  await ensureMarkdownFile(
    projectPath(root, projectKey, "state", "index.md"),
    label(projectKey, "state", "index.md"),
    stateIndex(projectKey, curated),
    result,
  );
  await ensureMarkdownFile(
    projectPath(root, projectKey, "log", "index.md"),
    label(projectKey, "log", "index.md"),
    logIndex(projectKey),
    result,
  );
  await ensureMarkdownFile(
    projectPath(root, projectKey, "log", "changelog.md"),
    label(projectKey, "log", "changelog.md"),
    changelog(projectKey),
    result,
  );
  await ensureMarkdownFile(
    projectPath(root, projectKey, "runs", "index.md"),
    label(projectKey, "runs", "index.md"),
    runsIndex(projectKey),
    result,
  );
  await ensureBootstrapState(root, projectKey, result);

  for (const dir of OPTIONAL_LEGACY_DIRS) {
    await repairOptionalLegacyDirectory(root, projectKey, dir, result);
  }

  return result;
}

export async function ensureProjectMemoryBrain(
  root: string,
  projectKey: string,
  now: Date,
  runDir: string,
): Promise<void> {
  const projectRoot = projectPath(root, projectKey);
  const wikiRoot = join(projectRoot, "wiki");

  await writeGeneratedMarkdown(
    join(projectRoot, "readme.md"),
    [
      `# ${projectKey}`,
      "",
      "Project Memory is curated for this project.",
      "",
      "- [Project index](index.md)",
      "- [Wiki](wiki/index.md)",
      "- [State](state/index.md)",
      "- [Log](log/index.md)",
      "- [Runs](runs/index.md)",
      "",
    ].join("\n"),
    ["Project Memory has not been curated yet.", "Project Memory is curated for this project."],
  );
  await writeGeneratedMarkdown(
    join(projectRoot, "index.md"),
    projectIndex(projectKey),
    [`# ${projectKey} Index`, "- [Wiki](wiki/index.md)"],
  );
  await writeGeneratedMarkdown(
    join(wikiRoot, "index.md"),
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

  for (const subject of ["architecture", "setup", "testing", "decisions"]) {
    await writeMarkdownIfMissing(
      join(wikiRoot, subject, "index.md"),
      [
        `# ${titleCase(subject)}`,
        "",
        `Project Memory subject index for \`${subject}\`.`,
        "",
      ].join("\n"),
    );
  }

  await writeMarkdown(join(projectRoot, "state", "index.md"), stateIndex(projectKey, true));
  await writeMarkdown(join(projectRoot, "log", "index.md"), logIndex(projectKey));
  await appendChangelog(join(projectRoot, "log", "changelog.md"), projectKey, now, runDir);

  await writeJson(resolveInside(projectRoot, "state", "project-memory.json"), {
    project_key: projectKey,
    source_run_dir: runDir,
    status: "curated",
    updated_at: now.toISOString(),
  });
  await writeJson(resolveInside(projectRoot, "state", "pages.json"), {
    project_key: projectKey,
    pages: [
      "readme.md",
      "index.md",
      "wiki/index.md",
      "wiki/architecture/index.md",
      "wiki/setup/index.md",
      "wiki/testing/index.md",
      "wiki/decisions/index.md",
    ],
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
  const path = projectPath(root, projectKey, "state", "bootstrap-state.json");
  const pathLabel = label(projectKey, "state", "bootstrap-state.json");

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

async function repairOptionalLegacyDirectory(
  root: string,
  projectKey: string,
  dir: (typeof OPTIONAL_LEGACY_DIRS)[number],
  result: ProjectShellRepairResult,
): Promise<void> {
  const path = projectPath(root, projectKey, dir);
  const pathLabel = label(projectKey, dir);
  const existing = await statIfExists(path);
  if (!existing) return;
  if (!existing.isDirectory()) {
    result.kept.push(pathLabel);
    return;
  }

  const entries = await readdir(path);
  if (entries.length === 0) {
    await rmdir(path);
    result.removed.push(pathLabel);
    return;
  }

  result.kept.push(pathLabel);
  await ensureMarkdownFile(join(path, "index.md"), label(projectKey, dir, "index.md"), optionalIndex(projectKey, dir), result);
}

async function moveFileIfDestinationMissing(
  from: string,
  to: string,
  result: ProjectShellRepairResult,
): Promise<void> {
  const source = await statIfExists(from);
  if (!source) return;
  if (!source.isFile()) return;

  const destination = await statIfExists(to);
  if (destination) {
    result.kept.push(relativeProjectLabel(to));
    return;
  }

  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  result.moved.push({ from: relativeProjectLabel(from), to: relativeProjectLabel(to) });
}

async function appendChangelog(path: string, projectKey: string, now: Date, runDir: string): Promise<void> {
  const entry = [
    `## [${now.toISOString()}] project learn`,
    "",
    `Initial or refreshed Project Memory brain for \`${projectKey}\`.`,
    "",
    `Run: \`${runDir}\``,
    "",
  ].join("\n");

  if (!(await exists(path))) {
    await writeMarkdown(path, ["# Changelog", "", entry].join("\n"));
    return;
  }

  const current = await readFile(path, "utf8");
  if (current.includes(`Run: \`${runDir}\``)) return;
  await writeMarkdown(path, `${current.trimEnd()}\n\n${entry}`);
}

async function writeMarkdown(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

async function writeMarkdownIfMissing(path: string, content: string): Promise<void> {
  if (await exists(path)) return;
  await writeMarkdown(path, content);
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

function projectReadme(projectKey: string, repoPath: string | undefined, curated: boolean): string {
  const lines = [
    `# ${projectKey}`,
    "",
    curated ? "Project Memory is curated for this project." : "Project Memory has not been curated yet.",
    "",
  ];
  if (repoPath) lines.push(`Registered repo: \`${repoPath}\``, "");
  if (!curated) lines.push(`Run \`myelin project learn ${projectKey}\` to create the project brain.`, "");
  return lines.join("\n");
}

function projectIndex(projectKey: string): string {
  return [
    `# ${projectKey} Index`,
    "",
    "- [Readme](readme.md)",
    "- [Wiki](wiki/index.md)",
    "- [State](state/index.md)",
    "- [Log](log/index.md)",
    "- [Runs](runs/index.md)",
    "",
  ].join("\n");
}

function wikiIndex(projectKey: string, curated: boolean): string {
  return [
    "# Project Memory",
    "",
    curated ? `Curated Project Memory for \`${projectKey}\`.` : "Project Memory has not been curated yet.",
    "",
  ].join("\n");
}

function stateIndex(projectKey: string, curated: boolean): string {
  const links = ["- [project.json](project.json)", "- [bootstrap-state.json](bootstrap-state.json)"];
  if (curated) {
    links.push(
      "- [project-memory.json](project-memory.json)",
      "- [schema-context.json](schema-context.json)",
      "- [pages.json](pages.json)",
      "- [freshness.json](freshness.json)",
    );
  }

  return [
    "# State",
    "",
    `Machine-readable state for \`${projectKey}\`.`,
    "",
    ...links,
    "",
  ].join("\n");
}

function logIndex(projectKey: string): string {
  return [
    "# Log",
    "",
    `Chronological Project Memory log for \`${projectKey}\`.`,
    "",
    "- [Changelog](changelog.md)",
    "",
  ].join("\n");
}

function changelog(projectKey: string): string {
  return [
    "# Changelog",
    "",
    `Project Memory shell created for \`${projectKey}\`.`,
    "",
  ].join("\n");
}

function runsIndex(projectKey: string): string {
  return [
    "# Runs",
    "",
    `Command run artifacts for \`${projectKey}\`.`,
    "",
    "Command-specific run folders live under this directory.",
    "",
  ].join("\n");
}

function optionalIndex(projectKey: string, dir: string): string {
  return [
    `# ${titleCase(dir)}`,
    "",
    `Preserved legacy \`${dir}\` material for \`${projectKey}\`.`,
    "",
  ].join("\n");
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function rootIndexPath(root: string, projectKey: string): string {
  return projectPath(root, projectKey, "index.md");
}

function label(projectKey: string, ...segments: string[]): string {
  return ["projects", projectKey, ...segments].join("/");
}

function relativeProjectLabel(path: string): string {
  const marker = "/projects/";
  const index = path.indexOf(marker);
  return index === -1 ? path : path.slice(index + 1);
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
