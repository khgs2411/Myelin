import {
  type ProjectMemoryCuratorMode,
  type ProjectMemoryCuratorRunResult,
  type ProjectMemoryCuratorValidationResult,
  type RunProjectMemoryCuratorInput,
} from "./project-memory-curator-contracts.ts";
import { validateCuratorOutput } from "./project-memory-curator-validator.ts";
import { buildProjectMemoryPacket, type ProjectMemoryPacket } from "./project-memory-packet.ts";
import {
  createProjectCuratorRun,
  ensureProjectLearnSchemaContext,
  invokeProjectCurator,
  type ProjectCuratorRunPaths,
  writeMarkdownArtifact,
  writeRunArtifact,
} from "../runtime/project-run-infrastructure.ts";
import { repairProjectShell } from "../runtime/project-shell.ts";
import { findProject } from "../runtime/projects.ts";
import { stableJson } from "../runtime/json.ts";

export class ProjectMemoryCuratorService {
  constructor(private readonly root: string) {}

  async runProjectLearn(input: RunProjectMemoryCuratorInput): Promise<ProjectMemoryCuratorRunResult> {
    const now = input.now ?? new Date();
    const project = await findProject(this.root, input.projectKey);
    if (!input.dryRun) {
      await repairProjectShell(this.root, input.projectKey, { repoPath: project.config.repo_paths?.[0] });
    }

    const run = await createProjectCuratorRun(this.root, input.projectKey, now);
    await ensureProjectLearnSchemaContext(this.root, input.projectKey, { dryRun: input.dryRun, now });
    const packet = await buildProjectMemoryPacket(this.root, input.projectKey);
    await writeRunArtifact(run, "input-packet.json", packet);

    const stageId = packet.mode === "create" ? "curator-create" : "curator-maintain";
    let curatorOutput: unknown;
    try {
      const curator = await invokeProjectCurator({
        root: this.root,
        stageId,
        prompt: this.promptFor(packet.mode, run.relative_run_dir, packet),
        provider: input.provider,
        modelOverride: input.modelOverride,
        env: input.env,
        runner: input.runner,
      });
      curatorOutput = curator.response;
    } catch (error) {
      const stoppedReason = invocationStoppedReason(error);
      const validation = failureValidation(input.projectKey, packet.mode, "curator_invocation_failed", stoppedReason);
      return await this.writeTerminalArtifacts({
        input,
        run,
        mode: packet.mode,
        outputArtifact: "curator-output-error.json",
        outputValue: { error: stoppedReason },
        validation,
        status: "failed",
        stoppedReason,
      });
    }

    const outputArtifact = packet.mode === "create" ? "curator-creation-draft.json" : "curator-maintenance-proposal.json";
    await writeRunArtifact(run, outputArtifact, curatorOutput);
    const validation = validateCuratorOutput(packet, curatorOutput);
    const status = validation.ok && !input.review ? "completed" : "needs_review";
    const stoppedReason = validation.ok ? undefined : "curator validation did not produce eligible output";

    return await this.writeTerminalArtifacts({
      input,
      run,
      mode: packet.mode,
      outputArtifact,
      validation,
      status,
      stoppedReason,
    });
  }

  private promptFor(mode: ProjectMemoryCuratorMode, runDir: string, packet: ProjectMemoryPacket): string {
    const outputName = mode === "create" ? "ProjectMemoryCreationDraft" : "ProjectMemoryMaintenanceProposal";
    return [
      "You are the Project Memory Curator.",
      `Run directory: ${runDir}`,
      `Input packet artifact: ${runDir}/input-packet.json`,
      `Return ONLY strict JSON matching ${outputName}.`,
      "Use packet references from the input packet. Do not invent packet refs.",
      "Do not write files. Do not mutate wiki markdown.",
      mode === "create"
        ? "Create mode: propose the first trusted Project Memory brain draft."
        : "Maintain mode: propose bounded itemized Project Memory updates only.",
      "",
      "Input packet JSON:",
      stableJson(packet),
    ].join("\n");
  }

  private async writeTerminalArtifacts(input: {
    input: RunProjectMemoryCuratorInput;
    run: ProjectCuratorRunPaths;
    mode: ProjectMemoryCuratorMode;
    outputArtifact: string;
    outputValue?: unknown;
    validation: ProjectMemoryCuratorValidationResult;
    status: ProjectMemoryCuratorRunResult["status"];
    stoppedReason?: string;
  }): Promise<ProjectMemoryCuratorRunResult> {
    if (input.outputValue !== undefined) {
      await writeRunArtifact(input.run, input.outputArtifact, input.outputValue);
    }
    await writeRunArtifact(input.run, "curator-validation.json", input.validation);
    const result = buildResult({
      input: input.input,
      mode: input.mode,
      runId: input.run.run_id,
      runDir: input.run.relative_run_dir,
      outputArtifact: input.outputArtifact,
      validation: input.validation,
      status: input.status,
      stoppedReason: input.stoppedReason,
    });
    await writeRunArtifact(input.run, "curator-run-result.json", result);
    await writeMarkdownArtifact(input.run, "summary.md", summaryFor(result));
    return result;
  }
}

function buildResult(input: {
  input: RunProjectMemoryCuratorInput;
  mode: ProjectMemoryCuratorMode;
  runId: string;
  runDir: string;
  outputArtifact: string;
  validation: ProjectMemoryCuratorValidationResult;
  status: ProjectMemoryCuratorRunResult["status"];
  stoppedReason?: string;
}): ProjectMemoryCuratorRunResult {
  return {
    status: input.status,
    project_key: input.input.projectKey,
    mode: input.mode,
    run_id: input.runId,
    run_dir: input.runDir,
    artifacts: {
      input_packet: "input-packet.json",
      curator_output: input.outputArtifact,
      curator_validation: "curator-validation.json",
      curator_run_result: "curator-run-result.json",
      summary: "summary.md",
    },
    validation_ok: input.validation.ok,
    stopped_before_writes: true,
    dry_run: input.input.dryRun,
    review: input.input.review,
    stopped_reason: input.stoppedReason,
  };
}

function failureValidation(
  projectKey: string,
  mode: ProjectMemoryCuratorMode,
  code: string,
  message: string,
): ProjectMemoryCuratorValidationResult {
  return {
    ok: false,
    mode,
    project_key: projectKey,
    global_findings: [{ severity: "blocker", category: "schema", code, message }],
    item_results: [],
    eligible_item_ids: [],
    rejected_item_ids: [],
    quarantined_item_ids: [],
    noop_refs: [],
  };
}

function invocationStoppedReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("response is not valid JSON") ||
    message.includes("empty output") ||
    message.includes("not valid JSON")
  ) {
    return `curator output was not valid JSON: ${message}`;
  }
  return `provider invocation failed: ${message}`;
}

function summaryFor(result: ProjectMemoryCuratorRunResult): string {
  return [
    `# Project learn ${result.project_key}`,
    "",
    `mode: ${result.mode}`,
    `status: ${result.status}`,
    `validation_ok: ${result.validation_ok}`,
    `stopped_before_writes: ${result.stopped_before_writes}`,
    result.stopped_reason ? `stopped_reason: ${result.stopped_reason}` : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}
