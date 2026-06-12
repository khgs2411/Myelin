import { mkdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { projectPath } from "./fs.ts";
import { projectLayout } from "./layout.ts";
import { readJsonIfExists, writeJson } from "./json.ts";
import { discoverProjects } from "./projects.ts";

export type BootstrapResult = {
  projectKey: string;
  repoPath: string;
  created: string[];
  kept: string[];
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

  const paths = projectLayout(root, projectKey);
  const created: string[] = [];
  const kept: string[] = [];

  for (const dir of ["sources", "wiki", "schema", "state", "log", "runs"] as const) {
    const path = paths[dir];
    if (await exists(path)) {
      kept.push(`projects/${projectKey}/${dir}`);
    } else {
      await mkdir(path, { recursive: true });
      created.push(`projects/${projectKey}/${dir}`);
    }
  }

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

  const indexPath = projectPath(root, projectKey, "wiki", "index.md");
  if (await exists(indexPath)) {
    kept.push(`projects/${projectKey}/wiki/index.md`);
  } else {
    await writeFile(
      indexPath,
      [
        `# ${projectKey}`,
        "",
        "Project Memory has not been curated yet.",
        "",
        `Registered repo: \`${resolvedRepo}\``,
        "",
      ].join("\n"),
      "utf8",
    );
    created.push(`projects/${projectKey}/wiki/index.md`);
  }

  const bootstrapStatePath = projectPath(root, projectKey, "state", "bootstrap-state.json");
  if (await exists(bootstrapStatePath)) {
    kept.push(`projects/${projectKey}/state/bootstrap-state.json`);
  } else {
    await writeJson(bootstrapStatePath, {
      missing: ["curated_project_memory", "experience_log_capture_verification"],
      status: "uncurated",
    });
    created.push(`projects/${projectKey}/state/bootstrap-state.json`);
  }

  return { projectKey, repoPath: resolvedRepo, created, kept };
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
