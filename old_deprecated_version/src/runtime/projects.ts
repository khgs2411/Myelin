import { readdir, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { projectPath, resolveInside } from "./fs.ts";
import { readJsonIfExists } from "./json.ts";

export type ProjectConfig = {
  key: string;
  name?: string;
  lifecycle?: "active" | "legacy" | "deprecated";
  repo_paths?: string[];
  tags?: string[];
  entry_pages?: string[];
  related_concepts?: string[];
  ignored_paths?: string[];
};

export type Project = {
  key: string;
  dir: string;
  config: ProjectConfig;
};

export type ProjectDiscoveryOptions = {
  includeLegacy?: boolean;
};

export async function discoverProjects(root: string, options: ProjectDiscoveryOptions = {}): Promise<Project[]> {
  const stateDir = resolveInside(root, "state");
  const entries = await directoryEntries(stateDir);
  const projects: Project[] = [];
  const discovered = new Set<string>();
  for (const entry of entries.sort()) {
    const projectStateDir = resolveInside(stateDir, entry);
    if (!(await stat(projectStateDir)).isDirectory()) continue;
    const config = await readJsonIfExists<ProjectConfig>(resolveInside(projectStateDir, "project.json"));
    if (config?.key && (options.includeLegacy || isActiveProject(config))) {
      projects.push({ key: config.key, dir: projectPath(root, config.key), config });
      discovered.add(config.key);
    }
  }

  const legacyProjectsDir = resolveInside(root, "projects");
  for (const entry of (await directoryEntries(legacyProjectsDir)).sort()) {
    if (discovered.has(entry)) continue;
    const dir = resolveInside(legacyProjectsDir, entry);
    if (!(await stat(dir)).isDirectory()) continue;
    const config = await readJsonIfExists<ProjectConfig>(resolveInside(dir, "state", "project.json"));
    if (config?.key && (options.includeLegacy || isActiveProject(config))) {
      projects.push({ key: config.key, dir, config });
    }
  }

  projects.sort((a, b) => a.key.localeCompare(b.key));
  return projects;
}

async function directoryEntries(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function findProject(root: string, key: string, options: ProjectDiscoveryOptions = {}): Promise<Project> {
  const project = (await discoverProjects(root, options)).find((candidate) => candidate.key === key);
  if (!project) throw new Error(`Unknown project: ${key}`);
  return project;
}

export async function projectForRepoPath(
  root: string,
  cwd: string,
  options: ProjectDiscoveryOptions = {},
): Promise<Project | null> {
  const projects = await discoverProjects(root, options);
  const resolvedCwd = resolve(cwd);

  for (const project of projects) {
    for (const repoPath of project.config.repo_paths ?? []) {
      const resolvedRepo = resolve(repoPath);
      const rel = relative(resolvedRepo, resolvedCwd);
      if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
        return project;
      }
    }
  }

  return null;
}

export function isActiveProject(config: ProjectConfig): boolean {
  return config.lifecycle !== "legacy" && config.lifecycle !== "deprecated";
}
