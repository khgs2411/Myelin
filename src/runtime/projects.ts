import { readdir, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { resolveInside } from "./fs.ts";
import { readJsonIfExists } from "./json.ts";

export type ProjectConfig = {
  key: string;
  name?: string;
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

export async function discoverProjects(root: string): Promise<Project[]> {
  const projectsDir = resolveInside(root, "projects");
  let entries: string[];

  try {
    entries = await readdir(projectsDir);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const projects: Project[] = [];
  for (const entry of entries.sort()) {
    const dir = resolveInside(projectsDir, entry);
    if (!(await stat(dir)).isDirectory()) continue;
    const config = await readJsonIfExists<ProjectConfig>(resolveInside(dir, "state", "project.json"));
    if (config?.key) {
      projects.push({ key: config.key, dir, config });
    }
  }
  return projects;
}

export async function findProject(root: string, key: string): Promise<Project> {
  const project = (await discoverProjects(root)).find((candidate) => candidate.key === key);
  if (!project) throw new Error(`Unknown project: ${key}`);
  return project;
}

export async function projectForRepoPath(root: string, cwd: string): Promise<Project | null> {
  const projects = await discoverProjects(root);
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
