import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { memoryDbPath } from "../memory/db.ts";
import { bootstrapProject } from "../runtime/bootstrap.ts";
import { projectPath, resolveInside } from "../runtime/fs.ts";
import { findProject } from "../runtime/projects.ts";

export type ProjectResetResult = {
  project_key: string;
  reset_scope: "project_shell";
  deleted_project_path: string;
  preserved_memory_db: string;
  bootstrap_status: string;
};

export class ProjectResetService {
  constructor(private readonly root: string) {}

  async cleanRebootstrap(projectKey: string): Promise<ProjectResetResult> {
    const project = await findProject(this.root, projectKey);
    const repoPath = project.config.repo_paths?.[0];
    if (!repoPath) throw new Error(`Project ${projectKey} has no repo path to rebootstrap from.`);

    const memoryDb = memoryDbPath(this.root);
    const hadMemoryDb = existsSync(memoryDb);
    const projectDir = projectPath(this.root, projectKey);
    const projectsRoot = resolveInside(this.root, "projects");
    if (!projectDir.startsWith(`${projectsRoot}/`)) {
      throw new Error(`Refusing to reset unsafe project path: ${projectDir}`);
    }

    await rm(projectDir, { recursive: true, force: true });
    await bootstrapProject(this.root, projectKey, repoPath);

    if (hadMemoryDb && !existsSync(memoryDb)) {
      throw new Error("Clean project reset must preserve existing root state/memory.db.");
    }

    return {
      project_key: projectKey,
      reset_scope: "project_shell",
      deleted_project_path: projectDir,
      preserved_memory_db: memoryDb,
      bootstrap_status: "rebootstrapped",
    };
  }
}
