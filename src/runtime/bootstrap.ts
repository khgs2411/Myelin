import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { projectPath } from "./fs.ts";
import { repairProjectShell, type ProjectShellMove } from "./project-shell.ts";
import { readJsonIfExists, writeJson } from "./json.ts";
import { discoverProjects } from "./projects.ts";

export type BootstrapResult = {
  projectKey: string;
  repoPath: string;
  created: string[];
  kept: string[];
  removed: string[];
  moved: ProjectShellMove[];
};

type ProjectConfig = {
  key: string;
  name?: string;
  repo_paths?: string[];
};

export async function bootstrapProject(
  root: string,
  projectKey: string,
  repoPath: string,
): Promise<BootstrapResult> {
  assertBootstrapProjectKey(projectKey);
  if (!isAbsolute(repoPath)) throw new Error("Repo path must be absolute");

  const resolvedRepo = resolve(repoPath);
  await assertDirectory(resolvedRepo, "Repo path does not exist");
  await assertRepoPathAvailable(root, projectKey, resolvedRepo);

  const shell = await repairProjectShell(root, projectKey, { repoPath: resolvedRepo });
  const created = [...shell.created];
  const kept = [...shell.kept];

  const projectJsonPath = projectPath(root, projectKey, "state", "project.json");
  const existingConfig = await readJsonIfExists<ProjectConfig>(projectJsonPath);
  const nextConfig: ProjectConfig = {
    key: projectKey,
    name: existingConfig?.name ?? projectKey,
    repo_paths: mergeRepoPaths(existingConfig?.repo_paths ?? [], resolvedRepo),
  };

  if (existingConfig) kept.push(`projects/${projectKey}/state/project.json`);
  else created.push(`projects/${projectKey}/state/project.json`);
  await writeJson(projectJsonPath, nextConfig);

  return {
    projectKey,
    repoPath: resolvedRepo,
    created,
    kept,
    removed: shell.removed,
    moved: shell.moved,
  };
}

async function assertRepoPathAvailable(root: string, projectKey: string, repoPath: string): Promise<void> {
  for (const project of await discoverProjects(root)) {
    if (project.key === projectKey) continue;
    for (const existing of project.config.repo_paths ?? []) {
      if (resolve(existing) === repoPath) {
        throw new Error(`Repo path is already registered to project ${project.key}`);
      }
    }
  }
}

function assertBootstrapProjectKey(projectKey: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectKey)) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }
}

function mergeRepoPaths(existing: string[], repoPath: string): string[] {
  return [...new Set([...existing.map((path) => resolve(path)), repoPath])].sort();
}

async function assertDirectory(path: string, message: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error(message);
  } catch (error) {
    if (isNotFound(error)) throw new Error(message);
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
