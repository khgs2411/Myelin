import { runProjectPipeline, type PipelineKind, type PipelineRunResult } from "../pipeline/runner.ts";
import { migrateProjectLayout, type MigrationAction } from "../runtime/layout.ts";
import { discoverProjects } from "../runtime/projects.ts";
import { buildProjectMemoryPacket, type ProjectMemoryPacket } from "./project-memory-packet.ts";

export type RunProjectPipelineInput = {
  projectKey: string;
  kind: PipelineKind;
  dryRun: boolean;
  review: boolean;
  provider?: "codex" | "claude";
  modelOverride?: string;
};

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

  async runPipeline(input: RunProjectPipelineInput): Promise<PipelineRunResult> {
    return runProjectPipeline(this.root, input.projectKey, input.kind, {
      dryRun: input.dryRun,
      review: input.review,
      provider: input.provider,
      modelOverride: input.modelOverride,
    });
  }

  async migrateLayout(projectKey: string): Promise<MigrateProjectLayoutResult> {
    return { projectActions: await migrateProjectLayout(this.root, projectKey) };
  }
}
