import {
  type ProjectMemoryCreationDraft,
  type ProjectMemoryCuratorMode,
  type ProjectMemoryCuratorRunResult,
  type ProjectMemoryCuratorValidationResult,
  type ProjectMemoryCreateTerminalState,
  type ProjectMemoryMaintenanceProposal,
  type ProjectMemoryTrustStatus,
  type RunProjectMemoryCuratorInput,
  PROJECT_MEMORY_CURATOR_OUTPUT_CONTRACT_ARTIFACT,
} from "./project-memory-curator-contracts.ts";
import { validateCuratorOutput } from "./project-memory-curator-validator.ts";
import type { ProjectMemoryApplyResult } from "./project-memory-apply-contracts.ts";
import { ProjectMemoryMarkdownApplier } from "./project-memory-markdown-applier.ts";
import { ProjectMemoryCandidateIntakeService } from "./project-memory-candidate-intake-service.ts";
import { ProjectMemorySourceConsumptionReconciler } from "./project-memory-source-consumption-reconciler.ts";
import { buildProjectMemoryPacket, type ProjectMemoryPacket } from "./project-memory-packet.ts";
import { buildPromptBudgetedProjectMemoryPacket } from "./project-memory-prompt-budget.ts";
import { buildProjectMemoryCuratorOutputSchema } from "./project-memory-curator-output-schema.ts";
import { extractProjectMemorySections } from "./project-memory-markdown-sections.ts";
import { isTrustedProjectMemoryQuality } from "./project-memory-quality-contract.ts";
import {
  buildProjectMemoryEvidenceMap,
  PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT,
  type ProjectMemoryEvidenceMap,
} from "./project-memory-evidence-map.ts";
import type { ProjectMemoryRetrievalIndexResult } from "../memory/project-memory-retrieval-indexer.ts";
import { ProjectMemoryRetrievalIndexService } from "../memory/project-memory-retrieval-index-service.ts";
import { readFile } from "node:fs/promises";
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
import { readJsonIfExists, writeJson } from "../runtime/json.ts";
import { projectPath } from "../runtime/fs.ts";
import { renderPageDraft } from "./project-memory-markdown-renderer.ts";
import {
  buildProjectMemoryUsefulnessCritiquePrompt,
  parseProjectMemoryUsefulnessCritique,
  PROJECT_MEMORY_USEFULNESS_CRITIQUE_ARTIFACT,
  type ProjectMemoryUsefulnessCritique,
} from "./project-memory-usefulness-critique.ts";
import {
  buildProjectMemoryUsefulnessCritiqueSchema,
  PROJECT_MEMORY_USEFULNESS_CRITIQUE_CONTRACT_ARTIFACT,
} from "./project-memory-usefulness-critique-schema.ts";
import { generateProjectMemoryHints } from "./project-memory-hint-generator.ts";

export type ProjectMemoryPostApplyRetrievalLifecycleResult = {
  status: "completed" | "pending";
  artifacts: {
    retrieval_sections?: "project-memory-retrieval-sections.json";
    hint_generation?: "project-memory-hint-generation-result.json";
    retrieval_index_result?: "project-memory-retrieval-index-result.json";
  };
  degraded_reason?: string;
};

export type ProjectMemoryPostApplyRetrievalLifecycle = {
  afterProjectMemoryApply(input: {
    projectKey: string;
    mode: ProjectMemoryCuratorMode;
    run: ProjectCuratorRunPaths;
    apply: ProjectMemoryApplyResult;
    now: Date;
    provider?: RunProjectMemoryCuratorInput["provider"];
    modelOverride?: string;
    env?: NodeJS.ProcessEnv;
    runner?: RunProjectMemoryCuratorInput["runner"];
  }): Promise<ProjectMemoryPostApplyRetrievalLifecycleResult>;
};

export class ProjectMemoryCuratorService {
  constructor(
    private readonly root: string,
    private readonly deps: { retrievalLifecycle?: ProjectMemoryPostApplyRetrievalLifecycle } = {},
  ) {}

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
      const evidenceMap = await this.writeEvidenceMapIfNeeded(input.projectKey, packet, run, project.config.repo_paths?.[0] ?? this.root);
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
        evidenceMap: Boolean(evidenceMap),
      });
    }

    const runtimeInboxIntake = await new ProjectMemoryCandidateIntakeService(this.root).intakeProjectInbox(input.projectKey, now);
    await writeRunArtifact(run, "runtime-inbox-intake.json", runtimeInboxIntake);
    if (runtimeInboxIntake.blocking) {
      const mode = await projectLearnModeForState(this.root, input.projectKey);
      const packet = await buildProjectMemoryPacket(this.root, input.projectKey);
      await writeRunArtifact(run, "input-packet.json", packet);
      const evidenceMap = await this.writeEvidenceMapIfNeeded(input.projectKey, packet, run, project.config.repo_paths?.[0] ?? this.root);
      return await this.writeTerminalArtifacts({
        input,
        run,
        mode,
        outputArtifact: "runtime-inbox-intake.json",
        validation: failureValidation(
          input.projectKey,
          mode,
          "runtime_inbox_intake_failed",
          runtimeInboxIntake.degraded_reasons.join("; ") || "runtime inbox intake failed",
        ),
        status: "failed",
        stoppedReason: runtimeInboxIntake.degraded_reasons.join("; ") || "runtime inbox intake failed",
        runtimeInboxIntake: true,
        evidenceMap: Boolean(evidenceMap),
      });
    }

    const packet = await buildProjectMemoryPacket(this.root, input.projectKey);
    await writeRunArtifact(run, "input-packet.json", packet);
    const evidenceMap = await this.writeEvidenceMapIfNeeded(input.projectKey, packet, run, project.config.repo_paths?.[0] ?? this.root);
    const promptBudget = await buildPromptBudgetedProjectMemoryPacket({
      root: this.root,
      projectKey: input.projectKey,
      runDir: run.relative_run_dir,
      absoluteRunDir: run.absolute_run_dir,
      repoPath: project.config.repo_paths?.[0] ?? this.root,
      packet,
      evidenceMapArtifact: evidenceMap ? PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT : undefined,
      transport: "artifact_reference",
    });
    await writeRunArtifact(run, "prompt-budget.json", promptBudget.artifact);
    const outputSchema = buildProjectMemoryCuratorOutputSchema({
      projectKey: input.projectKey,
      mode: packet.mode,
      runDir: run.relative_run_dir,
      packetSchemaVersion: packet.schema_version,
    });
    await writeRunArtifact(run, PROJECT_MEMORY_CURATOR_OUTPUT_CONTRACT_ARTIFACT, outputSchema);
    if (promptBudget.status === "too_large") {
      const validation = failureValidation(input.projectKey, packet.mode, "curator_prompt_too_large", promptBudget.reason);
      return await this.writeTerminalArtifacts({
        input,
        run,
        mode: packet.mode,
        outputArtifact: "curator-output-error.json",
        outputValue: { error: promptBudget.reason },
        validation,
        status: "failed",
        stoppedReason: promptBudget.reason,
        promptBudget: true,
        evidenceMap: Boolean(evidenceMap),
        runtimeInboxIntake: true,
        curatorOutputContract: true,
      });
    }

    const stageId = packet.mode === "create" ? "curator-create" : "curator-maintain";
    let curatorOutput: unknown;
    try {
      const curator = await invokeProjectCurator({
        root: this.root,
        stageId,
        prompt: promptBudget.prompt,
        provider: input.provider,
        modelOverride: input.modelOverride,
        env: input.env,
        cwd: project.config.repo_paths?.[0] ?? this.root,
        outputSchema: projectPath(this.root, input.projectKey, "runs", "project-learn", run.run_id, PROJECT_MEMORY_CURATOR_OUTPUT_CONTRACT_ARTIFACT),
        runner: input.runner,
      });
      curatorOutput = curator.response;
    } catch (error) {
      const failure = classifyCuratorInvocationFailure(error);
      const validation = failureValidation(
        input.projectKey,
        packet.mode,
        failure.validationCode,
        failure.stoppedReason,
        failure.validationCategory,
      );
      return await this.writeTerminalArtifacts({
        input,
        run,
        mode: packet.mode,
        outputArtifact: "curator-output-error.json",
        outputValue: { error: failure.stoppedReason, failure_kind: failure.kind },
        validation,
        status: "failed",
        stoppedReason: failure.stoppedReason,
        failureKind: failure.kind,
        promptBudget: true,
        evidenceMap: Boolean(evidenceMap),
        runtimeInboxIntake: true,
        curatorOutputContract: true,
      });
    }

    const outputArtifact = packet.mode === "create" ? "curator-creation-draft.json" : "curator-maintenance-proposal.json";
    await writeRunArtifact(run, outputArtifact, curatorOutput);
    const validation = validateCuratorOutput(packet, curatorOutput, { evidenceMap });
    const applyDecision = canApply({ dryRun: input.dryRun, review: input.review, packet, validation, curatorOutput });
    if (applyDecision.ok) {
      const critiqueDecision =
        packet.mode === "create"
          ? await this.runUsefulnessCritique({
              input,
              run,
              projectKey: input.projectKey,
              draft: curatorOutput as ProjectMemoryCreationDraft,
              repoPath: project.config.repo_paths?.[0] ?? this.root,
            })
          : { ok: true as const, usefulnessCritique: false };
      if (!critiqueDecision.ok) {
        return await this.writeTerminalArtifacts({
          input,
          run,
          mode: packet.mode,
          outputArtifact,
          validation,
          status: "needs_review",
          stoppedReason: critiqueDecision.reason,
          promptBudget: true,
          evidenceMap: Boolean(evidenceMap),
          runtimeInboxIntake: true,
          curatorOutputContract: true,
          usefulnessCritique: critiqueDecision.usefulnessCritique,
        });
      }
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
        const retrieval = await this.postApplyRetrievalLifecycle({
          projectKey: input.projectKey,
          mode: packet.mode,
          run,
          apply: applyResult,
          now,
          provider: input.provider,
          modelOverride: input.modelOverride,
          env: input.env,
          runner: input.runner,
        });
        await this.updateCuratedRetrievalReadiness({
          projectKey: input.projectKey,
          status: retrieval.status,
          reason: retrieval.degraded_reason,
          now,
        });
        return await this.writeTerminalArtifacts({
          input,
          run,
          mode: packet.mode,
          outputArtifact,
          validation,
          status: retrieval.status === "completed" ? "completed" : "completed_with_pending_index",
          stoppedReason: retrieval.degraded_reason,
          apply: applyResult,
          retrievalStatus: retrieval.status,
          retrievalArtifacts: retrieval.artifacts,
          promptBudget: true,
          evidenceMap: Boolean(evidenceMap),
          runtimeInboxIntake: true,
          curatorOutputContract: true,
          usefulnessCritique: critiqueDecision.usefulnessCritique,
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
        promptBudget: true,
        evidenceMap: Boolean(evidenceMap),
        runtimeInboxIntake: true,
        curatorOutputContract: true,
        usefulnessCritique: critiqueDecision.usefulnessCritique,
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
      promptBudget: true,
      evidenceMap: Boolean(evidenceMap),
      runtimeInboxIntake: true,
      curatorOutputContract: true,
    });
  }

  private async writeEvidenceMapIfNeeded(
    projectKey: string,
    packet: ProjectMemoryPacket,
    run: ProjectCuratorRunPaths,
    repoPath: string,
  ): Promise<ProjectMemoryEvidenceMap | undefined> {
    if (packet.mode !== "create") return undefined;
    const evidenceMap = await buildProjectMemoryEvidenceMap({
      root: this.root,
      projectKey,
      packet,
      repoPath,
    });
    await writeRunArtifact(run, PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT, evidenceMap);
    return evidenceMap;
  }

  private async runUsefulnessCritique(input: {
    input: RunProjectMemoryCuratorInput;
    run: ProjectCuratorRunPaths;
    projectKey: string;
    draft: ProjectMemoryCreationDraft;
    repoPath: string;
  }): Promise<{ ok: true; usefulnessCritique: true } | { ok: false; usefulnessCritique: true; reason: string }> {
    const renderedMarkdown = input.draft.pages.map((page) => {
      const payloadPage = page.apply_payload?.pages?.find((candidate) => candidate.page_path === page.target.path);
      if (!payloadPage) throw new Error(`validated creation page is missing rendered payload: ${page.target.path}`);
      return {
        page_path: page.target.path,
        markdown: renderPageDraft(payloadPage),
      };
    });
    const evidenceMapJson = await readFile(
      projectPath(this.root, input.projectKey, "runs", "project-learn", input.run.run_id, PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT),
      "utf8",
    );
    const schema = buildProjectMemoryUsefulnessCritiqueSchema({ projectKey: input.projectKey });
    await writeRunArtifact(input.run, PROJECT_MEMORY_USEFULNESS_CRITIQUE_CONTRACT_ARTIFACT, schema);
    const prompt = buildProjectMemoryUsefulnessCritiquePrompt({
      projectKey: input.projectKey,
      evidenceMapJson,
      renderedMarkdown,
    });

    let critique: ProjectMemoryUsefulnessCritique;
    try {
      const result = await invokeProjectCurator({
        root: this.root,
        stageId: "project-memory-usefulness-critique",
        prompt,
        provider: input.input.provider,
        modelOverride: input.input.modelOverride,
        env: input.input.env,
        cwd: input.repoPath,
        outputSchema: projectPath(
          this.root,
          input.projectKey,
          "runs",
          "project-learn",
          input.run.run_id,
          PROJECT_MEMORY_USEFULNESS_CRITIQUE_CONTRACT_ARTIFACT,
        ),
        runner: input.input.runner,
      });
      critique =
        parseProjectMemoryUsefulnessCritique(result.response) ??
        failedUsefulnessCritique(input.projectKey, renderedMarkdown, "usefulness critique output was invalid");
    } catch (error) {
      critique = failedUsefulnessCritique(
        input.projectKey,
        renderedMarkdown,
        `usefulness critique provider failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await writeRunArtifact(input.run, PROJECT_MEMORY_USEFULNESS_CRITIQUE_ARTIFACT, critique);
    if (critique.verdict === "pass") return { ok: true, usefulnessCritique: true };
    return {
      ok: false,
      usefulnessCritique: true,
      reason: `Project Memory usefulness critique returned ${critique.verdict}: ${critique.reasons.join("; ") || "no reason provided"}`,
    };
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
    retrievalStatus?: ProjectMemoryPostApplyRetrievalLifecycleResult["status"];
    retrievalArtifacts?: ProjectMemoryPostApplyRetrievalLifecycleResult["artifacts"];
    promptBudget?: boolean;
    evidenceMap?: boolean;
    runtimeInboxIntake?: boolean;
    curatorOutputContract?: boolean;
    usefulnessCritique?: boolean;
    failureKind?: ProjectMemoryCuratorRunResult["failure_kind"];
  }): Promise<ProjectMemoryCuratorRunResult> {
    if (input.outputValue !== undefined) {
      await writeRunArtifact(input.run, input.outputArtifact, input.outputValue);
    }
    await writeRunArtifact(input.run, "curator-validation.json", input.validation);
    if (input.mode === "create" && !input.apply && !input.input.dryRun) {
      await this.writeCreateTerminalState({
        projectKey: input.input.projectKey,
        run: input.run,
        status: trustStatusForCreateFailure({ validation: input.validation, stoppedReason: input.stoppedReason }),
        stoppedReason: input.stoppedReason,
        evidenceMap: input.evidenceMap,
        usefulnessCritique: input.usefulnessCritique,
        now: input.input.now ?? new Date(),
      });
    }
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
      retrievalStatus: input.retrievalStatus,
      retrievalArtifacts: input.retrievalArtifacts,
      promptBudget: input.promptBudget,
      evidenceMap: input.evidenceMap,
      runtimeInboxIntake: input.runtimeInboxIntake,
      curatorOutputContract: input.curatorOutputContract,
      usefulnessCritique: input.usefulnessCritique,
      failureKind: input.failureKind,
    });
    await writeRunArtifact(input.run, "curator-run-result.json", result);
    await writeMarkdownArtifact(input.run, "summary.md", summaryFor(result));
    return result;
  }

  private async writeCreateTerminalState(input: {
    projectKey: string;
    run: ProjectCuratorRunPaths;
    status: ProjectMemoryTrustStatus;
    stoppedReason?: string;
    evidenceMap?: boolean;
    usefulnessCritique?: boolean;
    now: Date;
  }): Promise<void> {
    const state: ProjectMemoryCreateTerminalState = {
      schema_version: 1,
      status: input.status,
      quality_contract_version: "answer-domain-v1",
      latest_create_run_ref: input.run.relative_run_dir,
      evidence_map_ref: input.evidenceMap ? PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT : undefined,
      validation_diagnostics_ref: "curator-validation.json",
      usefulness_critique_ref: input.usefulnessCritique ? PROJECT_MEMORY_USEFULNESS_CRITIQUE_ARTIFACT : undefined,
      terminal_reason: input.stoppedReason ?? input.status,
      updated_at: input.now.toISOString(),
    };
    await writeJson(projectPath(this.root, input.projectKey, "state", "project-memory.json"), state);
  }

  private async postApplyRetrievalLifecycle(input: {
    projectKey: string;
    mode: ProjectMemoryCuratorMode;
    run: ProjectCuratorRunPaths;
    apply: ProjectMemoryApplyResult;
    now: Date;
    provider?: RunProjectMemoryCuratorInput["provider"];
    modelOverride?: string;
    env?: NodeJS.ProcessEnv;
    runner?: RunProjectMemoryCuratorInput["runner"];
  }): Promise<ProjectMemoryPostApplyRetrievalLifecycleResult> {
    const lifecycle = this.deps.retrievalLifecycle ?? new DefaultProjectMemoryPostApplyRetrievalLifecycle(this.root);
    return lifecycle.afterProjectMemoryApply(input);
  }

  private async updateCuratedRetrievalReadiness(input: {
    projectKey: string;
    status: ProjectMemoryPostApplyRetrievalLifecycleResult["status"];
    reason?: string;
    now: Date;
  }): Promise<void> {
    const statePath = projectPath(this.root, input.projectKey, "state", "project-memory.json");
    const state = await readJsonIfExists<Record<string, unknown>>(statePath);
    if (!state || state.status !== "curated") return;

    await writeJson(statePath, {
      ...state,
      retrieval_readiness: {
        status: input.status === "completed" ? "ready" : "pending",
        checked_at: input.now.toISOString(),
        reason: input.reason ?? null,
      },
    });
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
  retrievalStatus?: ProjectMemoryPostApplyRetrievalLifecycleResult["status"];
  retrievalArtifacts?: ProjectMemoryPostApplyRetrievalLifecycleResult["artifacts"];
  promptBudget?: boolean;
  evidenceMap?: boolean;
  runtimeInboxIntake?: boolean;
  curatorOutputContract?: boolean;
  usefulnessCritique?: boolean;
  failureKind?: ProjectMemoryCuratorRunResult["failure_kind"];
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
      curator_output_contract: input.curatorOutputContract ? PROJECT_MEMORY_CURATOR_OUTPUT_CONTRACT_ARTIFACT : undefined,
      curator_validation: "curator-validation.json",
      curator_run_result: "curator-run-result.json",
      summary: "summary.md",
      prompt_budget: input.promptBudget ? "prompt-budget.json" : undefined,
      evidence_map: input.evidenceMap ? PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT : undefined,
      runtime_inbox_intake: input.runtimeInboxIntake ? "runtime-inbox-intake.json" : undefined,
      apply_journal: input.apply ? "project-memory-apply-journal.json" : undefined,
      apply_result: input.apply ? "project-memory-apply-result.json" : undefined,
      changeset: input.apply ? "project-memory-changeset.json" : undefined,
      retrieval_sections: input.retrievalArtifacts?.retrieval_sections,
      hint_generation: input.retrievalArtifacts?.hint_generation,
      retrieval_index_result: input.retrievalArtifacts?.retrieval_index_result,
      usefulness_critique: input.usefulnessCritique ? PROJECT_MEMORY_USEFULNESS_CRITIQUE_ARTIFACT : undefined,
    },
    content_quality_status: input.validation.quality_diagnostics?.content_quality.status,
    retrieval_readiness_status:
      input.retrievalStatus === "completed"
        ? "ready"
        : input.retrievalStatus === "pending" || input.status === "completed_with_pending_index"
        ? "pending"
        : input.validation.quality_diagnostics?.retrieval_readiness.status,
    quality_diagnostics_ref: input.validation.quality_diagnostics ? "curator-validation.json" : undefined,
    validation_ok: input.validation.ok,
    stopped_before_writes: !input.apply,
    dry_run: input.input.dryRun,
    review: input.input.review,
    applied_page_ids: input.apply?.applied_page_ids,
    applied_item_ids: input.apply?.applied_item_ids,
    changed_files: input.apply?.changed_files.map((file) => file.path),
    source_consumptions: input.apply?.source_consumptions.map((record) => `${record.source_kind}:${record.source_ref}`),
    stopped_reason: input.stoppedReason,
    failure_kind: input.failureKind,
  };
}

function failedUsefulnessCritique(
  projectKey: string,
  renderedMarkdown: { page_path: string }[],
  reason: string,
): ProjectMemoryUsefulnessCritique {
  return {
    schema_version: 1,
    project_key: projectKey,
    verdict: "fail",
    reasons: [reason],
    weak_sections: [],
    evidence_map_ref: PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT,
    rendered_markdown_refs: renderedMarkdown.map((page) => page.page_path),
  };
}

function trustStatusForCreateFailure(input: {
  validation: ProjectMemoryCuratorValidationResult;
  stoppedReason?: string;
}): ProjectMemoryTrustStatus {
  const status = input.validation.quality_diagnostics?.content_quality.status;
  if (status === "blocked") return "blocked";
  if (status === "review_only") return "review_only";
  if (status === "shallow") return "shallow";
  const reason = input.stoppedReason ?? "";
  if (reason.includes("review_only") || reason.includes("review requested")) return "review_only";
  return input.stoppedReason ? "blocked" : "uncurated";
}

function canApply(input: {
  dryRun: boolean;
  review: boolean;
  packet: ProjectMemoryPacket;
  validation: ProjectMemoryCuratorValidationResult;
  curatorOutput: unknown;
}): { ok: true } | { ok: false; status: ProjectMemoryCuratorRunResult["status"]; reason?: string } {
  if (input.dryRun) return { ok: false, status: "completed", reason: "dry-run requested" };
  if (input.review) return { ok: false, status: "needs_review", reason: "review requested" };
  if (input.packet.mode === "maintain" && input.validation.eligible_item_ids.length === 0 && input.validation.noop_refs.length > 0) {
    if (!input.validation.ok) {
      return { ok: false, status: "needs_review", reason: "curator validation did not produce eligible output" };
    }
    if (input.validation.rejected_item_ids.length > 0 || input.validation.quarantined_item_ids.length > 0) {
      return { ok: false, status: "needs_review", reason: "curator validation produced rejected or quarantined output" };
    }
    if (statusOf(input.packet.state.project_memory) !== "curated") {
      return { ok: false, status: "needs_review", reason: "trusted Project Memory state is required for maintenance apply" };
    }
    if (!hasConsumableProjectMemoryNoop(input.curatorOutput)) {
      return { ok: false, status: "completed", reason: "explicit no-op decision produced no source-consumption writes" };
    }
    return { ok: true };
  }
  if (!isTrustedProjectMemoryQuality(input.validation.quality_diagnostics)) {
    return { ok: false, status: "needs_review", reason: "Project Memory content quality is not trusted" };
  }
  if (!input.validation.ok) {
    return { ok: false, status: "needs_review", reason: "curator validation did not produce eligible output" };
  }
  if (input.validation.rejected_item_ids.length > 0 || input.validation.quarantined_item_ids.length > 0) {
    return { ok: false, status: "needs_review", reason: "curator validation produced rejected or quarantined output" };
  }
  if (input.packet.degraded) {
    return { ok: false, status: "needs_review", reason: "packet has blocking degraded context" };
  }
  if (input.packet.mode === "maintain" && statusOf(input.packet.state.project_memory) !== "curated") {
    return { ok: false, status: "needs_review", reason: "trusted Project Memory state is required for maintenance apply" };
  }
  if (input.packet.mode === "maintain" && input.validation.eligible_item_ids.length === 0) {
    if (input.validation.noop_refs.length > 0) {
      return { ok: false, status: "completed", reason: "explicit no-op decision produced no writes" };
    }
    return { ok: false, status: "completed", reason: "documented no-op inputs produced no writes" };
  }
  return { ok: true };
}

function hasConsumableProjectMemoryNoop(output: unknown): boolean {
  if (!output || typeof output !== "object" || Array.isArray(output) || !("explicit_noop_decisions" in output)) return false;
  const decisions = (output as { explicit_noop_decisions?: unknown }).explicit_noop_decisions;
  if (!Array.isArray(decisions)) return false;
  return decisions.some((decision) => {
    if (!decision || typeof decision !== "object" || Array.isArray(decision) || !("source_packet_refs" in decision)) return false;
    const refs = (decision as { source_packet_refs?: unknown }).source_packet_refs;
    return Array.isArray(refs) && refs.some((ref) => {
      return Boolean(
        ref &&
          typeof ref === "object" &&
          !Array.isArray(ref) &&
          "kind" in ref &&
          (ref.kind === "project_candidate" || ref.kind === "project_handoff"),
      );
    });
  });
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
  category: ProjectMemoryCuratorValidationResult["global_findings"][number]["category"] = "schema",
): ProjectMemoryCuratorValidationResult {
  return {
    ok: false,
    mode,
    project_key: projectKey,
    global_findings: [{ severity: "blocker", category, code, message }],
    item_results: [],
    eligible_item_ids: [],
    rejected_item_ids: [],
    quarantined_item_ids: [],
    noop_refs: [],
  };
}

function classifyCuratorInvocationFailure(error: unknown): {
  kind: NonNullable<ProjectMemoryCuratorRunResult["failure_kind"]>;
  validationCode: string;
  validationCategory: ProjectMemoryCuratorValidationResult["global_findings"][number]["category"];
  stoppedReason: string;
} {
  const message = conciseInvocationMessage(error instanceof Error ? error.message : String(error));
  if (
    message.includes("response is not valid JSON") ||
    message.includes("empty output") ||
    message.includes("not valid JSON")
  ) {
    return {
      kind: "curator_output_invalid_json",
      validationCode: "curator_output_invalid_json",
      validationCategory: "schema",
      stoppedReason: `curator output was not valid JSON: ${message}`,
    };
  }
  return {
    kind: "provider_failed_before_output",
    validationCode: "provider_failed_before_output",
    validationCategory: "provider",
    stoppedReason: `provider invocation failed before curator output: ${message}`,
  };
}

function conciseInvocationMessage(message: string): string {
  const structuredError = extractStructuredErrorMessage(message);
  if (structuredError) return structuredError;

  const errorLines = [...message.matchAll(/^ERROR:\s*(.+)$/gim)]
    .map((match) => match[1]?.trim())
    .filter((line): line is string => Boolean(line));
  const tokensUsed = message.match(/tokens used\s*[\r\n]+\s*([0-9,]+)/i)?.[1];
  const exitPrefix = message.match(/\b(?:codex|claude) exited \d+/i)?.[0];
  if (errorLines.length > 0) {
    return [
      exitPrefix,
      ...errorLines.slice(-2).map((line) => `ERROR: ${line}`),
      tokensUsed ? `tokens used ${tokensUsed}` : "",
    ].filter(Boolean).join("; ");
  }

  const maxLength = 1_200;
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength)}...[truncated]`;
}

function extractStructuredErrorMessage(message: string): string | null {
  const marker = "ERROR:";
  let searchFrom = 0;
  while (searchFrom < message.length) {
    const markerIndex = message.indexOf(marker, searchFrom);
    if (markerIndex === -1) return null;
    const jsonStart = message.indexOf("{", markerIndex + marker.length);
    if (jsonStart === -1) return null;
    const jsonText = balancedJsonAt(message, jsonStart);
    if (!jsonText) {
      searchFrom = markerIndex + marker.length;
      continue;
    }
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      const error = isRecord(parsed) ? parsed.error : null;
      const messageText = isRecord(error) && typeof error.message === "string" ? error.message : null;
      const type = isRecord(error) && typeof error.type === "string" ? error.type : null;
      const param = isRecord(error) && typeof error.param === "string" ? error.param : null;
      return [messageText, type ? `type=${type}` : "", param ? `param=${param}` : ""].filter(Boolean).join("; ");
    } catch {
      searchFrom = jsonStart + jsonText.length;
    }
  }
  return null;
}

function balancedJsonAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function summaryFor(result: ProjectMemoryCuratorRunResult): string {
  return [
    `# Project learn ${result.project_key}`,
    "",
    `mode: ${result.mode}`,
    `status: ${result.status}`,
    `validation_ok: ${result.validation_ok}`,
    `stopped_before_writes: ${result.stopped_before_writes}`,
    result.failure_kind ? `failure_kind: ${result.failure_kind}` : "",
    result.failure_kind === "provider_failed_before_output" ? "curator_output_status: not_produced" : "",
    result.failure_kind === "curator_output_invalid_json" ? "curator_output_status: invalid_json" : "",
    result.failure_kind ? "apply_stage: not_reached" : "",
    result.stopped_reason ? `stopped_reason: ${result.stopped_reason}` : "",
    result.artifacts.retrieval_sections ? `retrieval_sections: ${result.artifacts.retrieval_sections}` : "",
    result.artifacts.hint_generation ? `hint_generation: ${result.artifacts.hint_generation}` : "",
    result.artifacts.retrieval_index_result ? `retrieval_index_result: ${result.artifacts.retrieval_index_result}` : "",
    result.status === "completed_with_pending_index" ? "pending_retrieval_index: yes" : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

class DefaultProjectMemoryPostApplyRetrievalLifecycle implements ProjectMemoryPostApplyRetrievalLifecycle {
  constructor(private readonly root: string) {}

  async afterProjectMemoryApply(input: {
    projectKey: string;
    mode: ProjectMemoryCuratorMode;
    run: ProjectCuratorRunPaths;
    apply: ProjectMemoryApplyResult;
    now: Date;
    provider?: RunProjectMemoryCuratorInput["provider"];
    modelOverride?: string;
    env?: NodeJS.ProcessEnv;
    runner?: RunProjectMemoryCuratorInput["runner"];
  }): Promise<ProjectMemoryPostApplyRetrievalLifecycleResult> {
    const artifacts = {
      retrieval_sections: "project-memory-retrieval-sections.json",
      hint_generation: "project-memory-hint-generation-result.json",
      retrieval_index_result: "project-memory-retrieval-index-result.json",
    } as const;
    const extractedManifest = await extractProjectMemorySections(this.root, input.projectKey, { now: input.now });
    const manifest = {
      ...extractedManifest,
      sections: extractedManifest.sections.filter((section) => section.heading_level > 1),
    };
    await writeRunArtifact(input.run, artifacts.retrieval_sections, manifest);

    const hintsRequired = (input.apply.applied_page_ids?.length ?? 0) > 0 || (input.apply.applied_item_ids?.length ?? 0) > 0;
    const hintResult = hintsRequired
      ? await generateProjectMemoryHints({
          root: this.root,
          projectKey: input.projectKey,
          category: null,
          manifest,
          sections: manifest.sections,
          provider: input.provider,
          model: input.modelOverride,
          required: true,
          now: input.now,
          runner: input.runner,
          env: input.env,
        })
      : {
          status: "skipped" as const,
          project_key: input.projectKey,
          category: null,
          required: false,
          accepted_entries: 0,
          rejected_entries: 0,
          run_ref: "",
          degraded: false,
          degraded_reason: undefined,
        };
    await writeRunArtifact(input.run, artifacts.hint_generation, hintResult);

    let indexResult: ProjectMemoryRetrievalIndexResult | { degraded: true; degraded_reason: string; pending_remaining?: number };
    try {
      indexResult = await new ProjectMemoryRetrievalIndexService({ root: this.root }).indexProject({
        projectKey: input.projectKey,
        limit: 500,
        batchSize: 50,
        retryFailed: false,
      });
    } catch (error) {
      indexResult = {
        degraded: true,
        degraded_reason: error instanceof Error ? error.message : String(error),
      };
    }
    await writeRunArtifact(input.run, artifacts.retrieval_index_result, indexResult);

    const pendingReason = [
      hintResult.degraded_reason,
      indexResult.degraded_reason,
      (indexResult.pending_remaining ?? 0) > 0
        ? `${indexResult.pending_remaining} Project Memory retrieval rows remain pending`
        : "",
    ].filter(Boolean).join("; ");
    return {
      status: pendingReason ? "pending" : "completed",
      artifacts,
      degraded_reason: pendingReason || undefined,
    };
  }
}
