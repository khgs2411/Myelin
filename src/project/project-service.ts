import { migrateProjectLayout, type MigrationAction } from "../runtime/layout.ts";
import { discoverProjects } from "../runtime/projects.ts";
import type { ProjectMemoryCuratorRunResult, RunProjectMemoryCuratorInput } from "./project-memory-curator-contracts.ts";
import { ProjectMemoryCuratorService } from "./project-memory-curator-service.ts";
import { buildProjectMemoryPacket, type ProjectMemoryPacket } from "./project-memory-packet.ts";

export type MigrateProjectLayoutResult = {
  projectActions: MigrationAction[];
};

export type ListedProject = {
  key: string;
  name: string;
  lifecycle: "active" | "legacy" | "deprecated";
  repo_paths: string[];
};

export class ProjectService {
  constructor(private readonly root: string) {}

  async listProjects(input: { includeLegacy?: boolean } = {}): Promise<{ projects: ListedProject[] }> {
    const projects = await discoverProjects(this.root, { includeLegacy: input.includeLegacy });
    return {
      projects: projects.map((project) => ({
        key: project.key,
        name: project.config.name ?? project.key,
        lifecycle: project.config.lifecycle ?? "active",
        repo_paths: project.config.repo_paths ?? [],
      })),
    };
  }

  async buildMemoryPacket(projectKey: string): Promise<ProjectMemoryPacket> {
    return await buildProjectMemoryPacket(this.root, projectKey);
  }

  async runProjectLearn(input: RunProjectMemoryCuratorInput): Promise<ProjectMemoryCuratorRunResult> {
    return await new ProjectMemoryCuratorService(this.root).runProjectLearn(input);
  }

  async migrateLayout(projectKey: string): Promise<MigrateProjectLayoutResult> {
    return { projectActions: await migrateProjectLayout(this.root, projectKey) };
  }
}
