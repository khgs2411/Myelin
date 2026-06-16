import { runProjectPipeline, type PipelineKind, type PipelineRunResult } from "../pipeline/runner.ts";
import { migrateProjectLayout, type MigrationAction } from "../runtime/layout.ts";

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

export class ProjectService {
  constructor(private readonly root: string) {}

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
