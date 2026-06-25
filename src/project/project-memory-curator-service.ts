import {
  type ProjectMemoryCreationDraft,
  type ProjectMemoryCuratorMode,
  type ProjectMemoryCuratorRunResult,
  type ProjectMemoryCuratorValidationResult,
  type ProjectMemoryMaintenanceProposal,
  type RunProjectMemoryCuratorInput,
} from "./project-memory-curator-contracts.ts";
import { validateCuratorOutput } from "./project-memory-curator-validator.ts";
import type { ProjectMemoryApplyResult } from "./project-memory-apply-contracts.ts";
import { ProjectMemoryMarkdownApplier } from "./project-memory-markdown-applier.ts";
import { ProjectMemorySourceConsumptionReconciler } from "./project-memory-source-consumption-reconciler.ts";
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
import { readJsonIfExists, stableJson } from "../runtime/json.ts";
import { projectPath } from "../runtime/fs.ts";

export class ProjectMemoryCuratorService {
  constructor(private readonly root: string) {}

  async runProjectLearn(input: RunProjectMemoryCuratorInput): Promise<ProjectMemoryCuratorRunResult> {
    const now = input.now ?? new Date();
    const project = await findProject(this.root, input.projectKey);
    const applier = new ProjectMemoryMarkdownApplier(this.root);
    const incompleteJournals = await applier.findIncompleteApplyJournals(input.projectKey);
    if (incompleteJournals.length > 0) {
      const recovered = await applier.recoverFromJournal(incompleteJournals[0]);
      const recoveredRun = runInfoFromJournalPath(incompleteJournals[0]);
      return {
        status: recovered.status === "applied" ? "completed" : "failed",
        project_key: input.projectKey,
        mode: recoveredRun.mode,
        run_id: recoveredRun.run_id,
        run_dir: recoveredRun.run_dir,
        artifacts: {
          input_packet: "input-packet.json",
          curator_output: recoveredRun.mode === "create" ? "curator-creation-draft.json" : "curator-maintenance-proposal.json",
          curator_validation: "curator-validation.json",
          curator_run_result: "curator-run-result.json",
          summary: "summary.md",
          apply_journal: recovered.status === "applied" ? "project-memory-apply-journal.json" : undefined,
          apply_result: recovered.status === "applied" ? "project-memory-apply-result.json" : undefined,
          changeset: recovered.status === "applied" ? "project-memory-changeset.json" : undefined,
        },
        validation_ok: recovered.status === "applied",
        stopped_before_writes: recovered.status !== "applied",
        dry_run: input.dryRun,
        review: input.review,
        changed_files: recovered.changed_files.map((file) => file.path),
        stopped_reason: recovered.status === "applied" ? undefined : recovered.reason,
      };
    }
    if (!input.dryRun) {
      await repairProjectShell(this.root, input.projectKey, { repoPath: project.config.repo_paths?.[0] });
    }

    const run = await createProjectCuratorRun(this.root, input.projectKey, now);
    await ensureProjectLearnSchemaContext(this.root, input.projectKey, { dryRun: input.dryRun, now });
    const reconciliation = await new ProjectMemorySourceConsumptionReconciler(this.root).reconcileProject(input.projectKey, {
      now,
    });
    if (reconciliation.blocking) {
      const mode = await projectLearnModeForState(this.root, input.projectKey);
      const packet = await buildProjectMemoryPacket(this.root, input.projectKey);
      await writeRunArtifact(run, "input-packet.json", packet);
      return await this.writeTerminalArtifacts({
        input,
        run,
        mode,
        outputArtifact: "source-consumption-reconciliation.json",
        outputValue: reconciliation,
        validation: failureValidation(
          input.projectKey,
          mode,
          "source_consumption_reconciliation_failed",
          reconciliation.degraded_reasons.join("; ") || "source-consumption reconciliation failed",
        ),
        status: "failed",
        stoppedReason: reconciliation.degraded_reasons.join("; ") || "source-consumption reconciliation failed",
      });
    }
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
    const applyDecision = canApply({ dryRun: input.dryRun, review: input.review, packet, validation });
    if (applyDecision.ok) {
      const applyResult =
        packet.mode === "create"
          ? await applier.applyCreationDraft({
              project_key: input.projectKey,
              run_dir: run.relative_run_dir,
              absolute_run_dir: run.absolute_run_dir,
              draft: curatorOutput as ProjectMemoryCreationDraft,
            })
          : await applier.applyMaintenanceProposal({
              project_key: input.projectKey,
              run_dir: run.relative_run_dir,
              absolute_run_dir: run.absolute_run_dir,
              proposal: curatorOutput as ProjectMemoryMaintenanceProposal,
              eligible_item_ids: validation.eligible_item_ids,
            });
      if (applyResult.status === "applied") {
        return await this.writeTerminalArtifacts({
          input,
          run,
          mode: packet.mode,
          outputArtifact,
          validation,
          status: "completed",
          apply: applyResult,
        });
      }
      return await this.writeTerminalArtifacts({
        input,
        run,
        mode: packet.mode,
        outputArtifact,
        validation,
        status: "needs_review",
        stoppedReason: applyResult.reason ?? "project memory apply skipped",
      });
    }

    return await this.writeTerminalArtifacts({
      input,
      run,
      mode: packet.mode,
      outputArtifact,
      validation,
      status: applyDecision.status,
      stoppedReason: applyDecision.reason,
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
    apply?: ProjectMemoryApplyResult;
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
      apply: input.apply,
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
  apply?: ProjectMemoryApplyResult;
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
      apply_journal: input.apply ? "project-memory-apply-journal.json" : undefined,
      apply_result: input.apply ? "project-memory-apply-result.json" : undefined,
      changeset: input.apply ? "project-memory-changeset.json" : undefined,
    },
    validation_ok: input.validation.ok,
    stopped_before_writes: !input.apply,
    dry_run: input.input.dryRun,
    review: input.input.review,
    applied_page_ids: input.apply?.applied_page_ids,
    applied_item_ids: input.apply?.applied_item_ids,
    changed_files: input.apply?.changed_files.map((file) => file.path),
    source_consumptions: input.apply?.source_consumptions.map((record) => `${record.source_kind}:${record.source_ref}`),
    stopped_reason: input.stoppedReason,
  };
}

function canApply(input: {
  dryRun: boolean;
  review: boolean;
  packet: ProjectMemoryPacket;
  validation: ProjectMemoryCuratorValidationResult;
}): { ok: true } | { ok: false; status: ProjectMemoryCuratorRunResult["status"]; reason?: string } {
  if (input.dryRun) return { ok: false, status: "completed", reason: "dry-run requested" };
  if (input.review) return { ok: false, status: "needs_review", reason: "review requested" };
  if (!input.validation.ok) {
    return { ok: false, status: "needs_review", reason: "curator validation did not produce eligible output" };
  }
  if (input.validation.rejected_item_ids.length > 0 || input.validation.quarantined_item_ids.length > 0) {
    return { ok: false, status: "needs_review", reason: "curator validation produced rejected or quarantined output" };
  }
  if (input.packet.degraded) {
    return { ok: false, status: "needs_review", reason: "packet was degraded" };
  }
  if (input.packet.mode === "maintain" && statusOf(input.packet.state.project_memory) !== "curated") {
    return { ok: false, status: "needs_review", reason: "trusted Project Memory state is required for maintenance apply" };
  }
  if (input.packet.mode === "maintain" && input.validation.eligible_item_ids.length === 0) {
    return { ok: false, status: "needs_review", reason: "maintenance proposal had no eligible items" };
  }
  return { ok: true };
}

function statusOf(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

async function projectLearnModeForState(root: string, projectKey: string): Promise<ProjectMemoryCuratorMode> {
  const projectMemory = await readJsonIfExists(projectPath(root, projectKey, "state", "project-memory.json"));
  const bootstrapState = await readJsonIfExists(projectPath(root, projectKey, "state", "bootstrap-state.json"));
  return statusOf(projectMemory) === "curated" || statusOf(bootstrapState) === "curated" ? "maintain" : "create";
}

function runInfoFromJournalPath(journalPath: string): {
  run_id: string;
  run_dir: string;
  mode: ProjectMemoryCuratorMode;
} {
  const normalized = journalPath.replaceAll("\\", "/");
  const match = normalized.match(/(projects\/[^/]+\/runs\/project-learn\/([^/]+))\/project-memory-apply-journal\.json$/);
  return {
    run_id: match?.[2] ?? "recovered",
    run_dir: match?.[1] ?? normalized,
    mode: "maintain",
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
