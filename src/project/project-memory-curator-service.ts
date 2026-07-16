import type { ProjectMemoryApplyResult, ProjectMemorySourceConsumptionRecord } from "./project-memory-apply-contracts.ts";
import { dirname, relative, resolve } from "node:path";
import {
  type ProjectMemoryCuratorMode,
  type ProjectMemoryCuratorRunResult,
  type ProjectMemoryCuratorValidationResult,
  type RunProjectMemoryCuratorInput,
} from "./project-memory-curator-contracts.ts";
import {
  buildProjectMemoryPacket,
  type PacketCandidate,
  type PacketHandoff,
  type ProjectMemoryPacket,
} from "./project-memory-packet.ts";
import { ProjectMemoryCandidateIntakeService } from "./project-memory-candidate-intake-service.ts";
import { ProjectMemoryMarkdownApplier } from "./project-memory-markdown-applier.ts";
import { ProjectMemorySourceConsumptionReconciler } from "./project-memory-source-consumption-reconciler.ts";
import { promoteDraftWiki } from "./project-memory-draft-promotion.ts";
import {
  runProjectMemoryCreateMode,
  type ProjectMemoryCreateModeResult,
} from "./project-memory-agent-create-service.ts";
import {
  runProjectMemoryMaintenanceMode,
  type ProjectMemoryMaintenanceModeResult,
  type ProjectMemoryMaintenancePendingSource,
} from "./project-memory-agent-maintenance-service.ts";
import type {
  ProjectMemoryAgentProviderMode,
  ProjectMemoryAgentRunKind,
  ProjectMemoryAgentStateV2,
} from "./project-memory-agent-contracts.ts";
import type { ProjectMemoryRetrievalIndexResult } from "../memory/project-memory-retrieval-index-types.ts";
import { ProjectMemoryRetrievalIndexCoordinator } from "../memory/project-memory-retrieval-index-service.ts";
import { generateProjectMemoryHints } from "./project-memory-hint-generator.ts";
import { extractProjectMemorySections } from "./project-memory-markdown-sections.ts";
import {
  createProjectCuratorRun,
  ensureProjectLearnSchemaContext,
  type ProjectCuratorRunPaths,
  writeMarkdownArtifact,
  writeRunArtifact,
} from "../runtime/project-run-infrastructure.ts";
import { repairProjectShell } from "../runtime/project-shell.ts";
import { findProject } from "../runtime/projects.ts";
import { projectPath, resolveInside } from "../runtime/fs.ts";
import { readJson, readJsonIfExists, writeJson } from "../runtime/json.ts";
import type { ProjectRepositoryIdentity } from "./project-repository-identity.ts";
import { FILE_AUTHORING_STUB_OUTPUTS_DIR } from "../runtime/file-authoring-agent.ts";
import type {
  ProjectMemoryCuratorServiceDependencies,
  ProjectMemoryPostApplyRetrievalLifecycle,
  ProjectMemoryPostApplyRetrievalLifecycleResult,
} from "./project-memory-curator-service-contracts.ts";
import {
  copyProjectMemoryCreateCheckpointArtifacts,
  PROJECT_MEMORY_CREATE_CHECKPOINT_REF,
  verifyProjectMemoryCreateCheckpoint,
  writeProjectMemoryCreateCheckpoint,
} from "./project-memory-create-checkpoint.ts";
import { emitProjectLearnProgress } from "./project-learn-progress.ts";
export type {
  ProjectMemoryCuratorServiceDependencies,
  ProjectMemoryPostApplyRetrievalLifecycle,
  ProjectMemoryPostApplyRetrievalLifecycleResult,
} from "./project-memory-curator-service-contracts.ts";

type CuratorPreflightResult =
  | { kind: "terminal"; result: ProjectMemoryCuratorRunResult }
  | {
      kind: "ready";
      input: RunProjectMemoryCuratorInput;
      now: Date;
      repoPath: string;
      run: ProjectCuratorRunPaths;
      packet: ProjectMemoryPacket;
      mode: ProjectMemoryCuratorMode;
      runKind: ProjectMemoryAgentRunKind;
      schemaContextHash: string;
    };

export class ProjectMemoryCuratorService {
  constructor(
    private readonly root: string,
    private readonly deps: ProjectMemoryCuratorServiceDependencies = {},
  ) {}

  async runProjectMaintenance(input: RunProjectMemoryCuratorInput): Promise<ProjectMemoryCuratorRunResult> {
    const preflight = await this.prepareRun({ ...input, recreate: false }, "maintenance");
    if (preflight.kind === "terminal") return preflight.result;
    return await this.runMaintenanceOnly({
      input: preflight.input,
      run: preflight.run,
      packet: preflight.packet,
      repoPath: preflight.repoPath,
      now: preflight.now,
      runKind: preflight.runKind,
    });
  }

  async runProjectLearn(input: RunProjectMemoryCuratorInput): Promise<ProjectMemoryCuratorRunResult> {
    if (input.resumeRun) return await this.runResumedCreateThenMaintenance(input);
    const preflight = await this.prepareRun(input, "learn");
    if (preflight.kind === "terminal") return preflight.result;
    return preflight.mode === "create"
      ? await this.runCreateThenMaintenance({
          input: preflight.input,
          run: preflight.run,
          packet: preflight.packet,
          repoPath: preflight.repoPath,
          now: preflight.now,
          runKind: preflight.runKind,
          schemaContextHash: preflight.schemaContextHash,
        })
      : await this.runMaintenanceOnly({
          input: preflight.input,
          run: preflight.run,
          packet: preflight.packet,
          repoPath: preflight.repoPath,
          now: preflight.now,
          runKind: preflight.runKind,
        });
  }

  private async runResumedCreateThenMaintenance(
    input: RunProjectMemoryCuratorInput,
  ): Promise<ProjectMemoryCuratorRunResult> {
    if (input.dryRun || input.review || input.recreate) {
      throw new Error("Project learn resume cannot be combined with dry-run, review, or recreate mode.");
    }
    const now = input.now ?? new Date();
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "preflight",
      status: "started",
      message: `verifying resume checkpoint ${input.resumeRun}`,
    });
    const project = await findProject(this.root, input.projectKey);
    const repoPath = project.config.repo_paths?.[0] ?? this.root;
    const incompleteJournals = await new ProjectMemoryMarkdownApplier(this.root).findIncompleteApplyJournals(input.projectKey);
    if (incompleteJournals.length > 0) {
      throw new Error("Project learn resume is blocked by an incomplete canonical apply journal; rerun project learn to recover it first.");
    }
    await repairProjectShell(this.root, input.projectKey, { repoPath });
    emitProjectLearnProgress(input.progress, { project_key: input.projectKey, stage: "schema", status: "started" });
    const schemaContext = await ensureProjectLearnSchemaContext(this.root, input.projectKey, { dryRun: false, now });
    emitProjectLearnProgress(input.progress, { project_key: input.projectKey, stage: "schema", status: "completed" });
    emitProjectLearnProgress(input.progress, { project_key: input.projectKey, stage: "packet", status: "started" });
    const reconciliation = await new ProjectMemorySourceConsumptionReconciler(this.root).reconcileProject(input.projectKey, { now });
    if (reconciliation.blocking) {
      throw new Error(`Project learn resume preflight failed: ${reconciliation.degraded_reasons.join("; ")}`);
    }
    const runtimeInboxIntake = await new ProjectMemoryCandidateIntakeService(this.root).intakeProjectInbox(input.projectKey, now);
    if (runtimeInboxIntake.blocking) {
      throw new Error(`Project learn resume preflight failed: ${runtimeInboxIntake.degraded_reasons.join("; ")}`);
    }
    const packet = await buildProjectMemoryPacket(this.root, input.projectKey);
    const source = resolveResumeSourceRun(this.root, input.projectKey, input.resumeRun!);
    let verified;
    try {
      verified = await verifyProjectMemoryCreateCheckpoint({
        root: this.root,
        projectKey: input.projectKey,
        sourceRunDir: source.relativeRunDir,
        sourceAbsoluteRunDir: source.absoluteRunDir,
        repoPath,
        packet,
        schemaContextHash: schemaContext.hash,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Project learn resume preflight failed:")) throw error;
      throw new Error(`Project learn resume preflight failed: source checkpoint is unavailable or invalid: ${message}. Run a fresh \`myelin project learn ${input.projectKey}\` instead.`);
    }

    const run = await createProjectCuratorRun(this.root, input.projectKey, now);
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "packet",
      status: "completed",
      mode: "create",
      run_dir: run.relative_run_dir,
      message: "resume inputs and immutable checkpoint verified",
    });
    await writeRunArtifact(run, "source-consumption-reconciliation.json", reconciliation);
    await writeRunArtifact(run, "runtime-inbox-intake.json", runtimeInboxIntake);
    await writeRunArtifact(run, "input-packet.json", packet);
    const create = await copyProjectMemoryCreateCheckpointArtifacts({
      sourceAbsoluteRunDir: source.absoluteRunDir,
      targetRun: run,
      checkpoint: verified.checkpoint,
      create: verified.create,
    });
    await writeRunArtifact(run, "resume-source.json", {
      schema_version: 1,
      source_run_dir: source.relativeRunDir,
      checkpoint_ref: `${source.relativeRunDir}/${PROJECT_MEMORY_CREATE_CHECKPOINT_REF}`,
      verified_at: now.toISOString(),
      copied_artifacts: verified.checkpoint.create_artifacts.map((artifact) => artifact.path),
    });
    return await this.runMaintenanceAfterCreate({
      input,
      run,
      packet,
      repoPath,
      now,
      runKind: "create_then_maintenance",
      create,
      resumedFromRun: source.relativeRunDir,
    });
  }

  private async prepareRun(
    input: RunProjectMemoryCuratorInput,
    entryPoint: "learn" | "maintenance",
  ): Promise<CuratorPreflightResult> {
    const now = input.now ?? new Date();
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "preflight",
      status: "started",
      message: "checking project registration and recovery state",
    });
    const project = await findProject(this.root, input.projectKey);
    const repoPath = project.config.repo_paths?.[0] ?? this.root;
    const applier = new ProjectMemoryMarkdownApplier(this.root);
    const incompleteJournals = await applier.findIncompleteApplyJournals(input.projectKey);
    if (incompleteJournals.length > 0) {
      const recovered = await applier.recoverFromJournal(incompleteJournals[0]);
      const recoveredRun = runInfoFromJournalPath(incompleteJournals[0]);
      return { kind: "terminal", result: {
        status: recovered.status === "applied" ? "completed" : "failed",
        project_key: input.projectKey,
        mode: recoveredRun.mode,
        run_id: recoveredRun.run_id,
        run_dir: recoveredRun.run_dir,
        artifacts: baseArtifacts("recovered"),
        validation_ok: recovered.status === "applied",
        stopped_before_writes: recovered.status !== "applied",
        dry_run: input.dryRun,
        review: input.review,
        changed_files: recovered.changed_files.map((file) => file.path),
        stopped_reason: recovered.status === "applied" ? undefined : recovered.reason,
        curation_kind: "agent_authored",
      } };
    }

    if (entryPoint === "learn" && !input.dryRun) await repairProjectShell(this.root, input.projectKey, { repoPath });

    const run = await createProjectCuratorRun(this.root, input.projectKey, now);
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "preflight",
      status: "completed",
      run_dir: run.relative_run_dir,
    });
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "schema",
      status: "started",
      run_dir: run.relative_run_dir,
    });
    const schemaContext = await ensureProjectLearnSchemaContext(this.root, input.projectKey, { dryRun: input.dryRun, now });
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "schema",
      status: "completed",
      run_dir: run.relative_run_dir,
    });
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "packet",
      status: "started",
      run_dir: run.relative_run_dir,
      message: "reconciling sources, intaking runtime inbox, and building packet",
    });

    const reconciliation = await new ProjectMemorySourceConsumptionReconciler(this.root).reconcileProject(input.projectKey, { now });
    await writeRunArtifact(run, "source-consumption-reconciliation.json", reconciliation);
    if (reconciliation.blocking) {
      const packet = await buildProjectMemoryPacket(this.root, input.projectKey);
      await writeRunArtifact(run, "input-packet.json", packet);
      const mode = entryPoint === "maintenance" ? "maintain" : modeForInput(input, packet);
      const runKind = entryPoint === "maintenance" ? "maintenance" : runKindForInput(input, packet);
      return { kind: "terminal", result: await this.writeTerminalArtifacts({
        input,
        run,
        mode,
        runKind,
        outputArtifact: "source-consumption-reconciliation.json",
        validation: failureValidation(input.projectKey, mode, "source_consumption_reconciliation_failed", reconciliation.degraded_reasons.join("; ")),
        status: "failed",
        stoppedReason: reconciliation.degraded_reasons.join("; "),
      }) };
    }

    const runtimeInboxIntake = await new ProjectMemoryCandidateIntakeService(this.root).intakeProjectInbox(input.projectKey, now);
    await writeRunArtifact(run, "runtime-inbox-intake.json", runtimeInboxIntake);
    const packet = await buildProjectMemoryPacket(this.root, input.projectKey);
    await writeRunArtifact(run, "input-packet.json", packet);
    const detectedMode = modeForInput(input, packet);
    const mode = entryPoint === "maintenance" ? "maintain" : detectedMode;
    const runKind = entryPoint === "maintenance" ? "maintenance" : runKindForInput(input, packet);
    emitProjectLearnProgress(input.progress, {
      project_key: input.projectKey,
      stage: "packet",
      status: "completed",
      mode,
      run_dir: run.relative_run_dir,
      message: `${packet.pending.project_candidates.length + packet.pending.project_handoffs.length} pending sources`,
    });
    if (runtimeInboxIntake.blocking) {
      return { kind: "terminal", result: await this.writeTerminalArtifacts({
        input,
        run,
        mode,
        runKind,
        outputArtifact: "runtime-inbox-intake.json",
        validation: failureValidation(input.projectKey, mode, "runtime_inbox_intake_failed", runtimeInboxIntake.degraded_reasons.join("; ")),
        status: "failed",
        stoppedReason: runtimeInboxIntake.degraded_reasons.join("; "),
        runtimeInboxIntake: true,
      }) };
    }

    if (entryPoint === "maintenance" && detectedMode !== "maintain") {
      const reason = `Project Memory is not curated; run myelin project learn ${input.projectKey} first.`;
      return { kind: "terminal", result: await this.writeTerminalArtifacts({
        input,
        run,
        mode: "maintain",
        runKind: "maintenance",
        outputArtifact: "input-packet.json",
        validation: failureValidation(input.projectKey, "maintain", "project_memory_not_curated", reason),
        status: "failed",
        stoppedReason: reason,
        runtimeInboxIntake: true,
      }) };
    }

    if (entryPoint === "maintenance" && !input.dryRun) await repairProjectShell(this.root, input.projectKey, { repoPath });
    return { kind: "ready", input, now, repoPath, run, packet, mode, runKind, schemaContextHash: schemaContext.hash };
  }

  private async runCreateThenMaintenance(input: {
    input: RunProjectMemoryCuratorInput;
    run: ProjectCuratorRunPaths;
    packet: ProjectMemoryPacket;
    repoPath: string;
    now: Date;
    runKind: ProjectMemoryAgentRunKind;
    schemaContextHash: string;
  }): Promise<ProjectMemoryCuratorRunResult> {
    const create = await runProjectMemoryCreateMode({
      root: this.root,
      projectKey: input.input.projectKey,
      runDir: input.run.relative_run_dir,
      absoluteRunDir: input.run.absolute_run_dir,
      targetRepoDir: input.repoPath,
      provider: input.input.provider,
      modelOverride: input.input.modelOverride,
      env: input.input.env,
      runner: input.input.runner,
      now: input.now,
      progress: input.input.progress,
    });
    await writeRunArtifact(input.run, "documentation-create-result.json", create);
    if (create.status !== "completed") {
      return await this.writeTerminalArtifacts({
        input: input.input,
        run: input.run,
        mode: "create",
        runKind: input.runKind,
        outputArtifact: "documentation-create-result.json",
        validation: failureValidation(input.input.projectKey, "create", "project_memory_create_failed", create.error ?? "create mode failed"),
        status: "failed",
        stoppedReason: create.error ?? "create mode failed",
        create,
      });
    }

    await writeProjectMemoryCreateCheckpoint({
      root: this.root,
      projectKey: input.input.projectKey,
      run: input.run,
      repoPath: input.repoPath,
      packet: input.packet,
      create,
      schemaContextHash: input.schemaContextHash,
      now: input.now,
    });

    return await this.runMaintenanceAfterCreate({ ...input, create });
  }

  private async runMaintenanceAfterCreate(input: {
    input: RunProjectMemoryCuratorInput;
    run: ProjectCuratorRunPaths;
    packet: ProjectMemoryPacket;
    repoPath: string;
    now: Date;
    runKind: ProjectMemoryAgentRunKind;
    create: ProjectMemoryCreateModeResult;
    resumedFromRun?: string;
  }): Promise<ProjectMemoryCuratorRunResult> {

    const maintenance = await runProjectMemoryMaintenanceMode({
      root: this.root,
      projectKey: input.input.projectKey,
      runDir: input.run.relative_run_dir,
      absoluteRunDir: input.run.absolute_run_dir,
      targetRepoDir: input.repoPath,
      baseWikiDir: input.create.draft_wiki_dir,
      pendingSources: pendingSourcesFromPacket(input.packet),
      provider: input.input.provider,
      modelOverride: input.input.modelOverride,
      env: input.input.env,
      runner: input.input.runner,
      now: input.now,
      progress: input.input.progress,
    });
    await writeRunArtifact(input.run, "documentation-maintenance-result.json", maintenance);
    if (maintenance.status === "failed") {
      return await this.writeTerminalArtifacts({
        input: input.input,
        run: input.run,
        mode: "create",
        runKind: input.runKind,
        outputArtifact: "documentation-maintenance-result.json",
        validation: failureValidation(input.input.projectKey, "create", "project_memory_maintenance_failed", maintenance.error ?? "maintenance mode failed"),
        status: "failed",
        stoppedReason: maintenance.error ?? "maintenance mode failed",
        create: input.create,
        maintenance,
        resumable: true,
        resumeCommand: resumeCommand(input.input.projectKey, input.resumedFromRun ?? input.run.relative_run_dir),
        resumedFromRun: input.resumedFromRun,
      });
    }

    return await this.promoteAndFinish({
      input: input.input,
      run: input.run,
      mode: "create",
      runKind: input.runKind,
      outputArtifact: "documentation-maintenance-result.json",
      draftWikiDir: maintenance.draft_wiki_dir,
      create: input.create,
      maintenance,
      sourceConsumptions: await this.combinedSourceConsumptions(input.input.projectKey, maintenance.source_consumptions),
      now: input.now,
      resumedFromRun: input.resumedFromRun,
    });
  }

  private async runMaintenanceOnly(input: {
    input: RunProjectMemoryCuratorInput;
    run: ProjectCuratorRunPaths;
    packet: ProjectMemoryPacket;
    repoPath: string;
    now: Date;
    runKind: ProjectMemoryAgentRunKind;
  }): Promise<ProjectMemoryCuratorRunResult> {
    const maintenance = await runProjectMemoryMaintenanceMode({
      root: this.root,
      projectKey: input.input.projectKey,
      runDir: input.run.relative_run_dir,
      absoluteRunDir: input.run.absolute_run_dir,
      targetRepoDir: input.repoPath,
      baseWikiDir: projectPath(this.root, input.input.projectKey, "wiki"),
      pendingSources: pendingSourcesFromPacket(input.packet),
      provider: input.input.provider,
      modelOverride: input.input.modelOverride,
      env: input.input.env,
      runner: input.input.runner,
      now: input.now,
      progress: input.input.progress,
    });
    await writeRunArtifact(input.run, "documentation-maintenance-result.json", maintenance);
    if (maintenance.status === "failed") {
      return await this.writeTerminalArtifacts({
        input: input.input,
        run: input.run,
        mode: "maintain",
        runKind: input.runKind,
        outputArtifact: "documentation-maintenance-result.json",
        validation: failureValidation(input.input.projectKey, "maintain", "project_memory_maintenance_failed", maintenance.error ?? "maintenance mode failed"),
        status: "failed",
        stoppedReason: maintenance.error ?? "maintenance mode failed",
        maintenance,
      });
    }

    return await this.promoteAndFinish({
      input: input.input,
      run: input.run,
      mode: "maintain",
      runKind: input.runKind,
      outputArtifact: "documentation-maintenance-result.json",
      draftWikiDir: maintenance.draft_wiki_dir,
      maintenance,
      sourceConsumptions: await this.combinedSourceConsumptions(input.input.projectKey, maintenance.source_consumptions),
      now: input.now,
    });
  }

  private async promoteAndFinish(input: {
    input: RunProjectMemoryCuratorInput;
    run: ProjectCuratorRunPaths;
    mode: ProjectMemoryCuratorMode;
    runKind: ProjectMemoryAgentRunKind;
    outputArtifact: string;
    draftWikiDir: string;
    create?: ProjectMemoryCreateModeResult;
    maintenance?: ProjectMemoryMaintenanceModeResult;
    sourceConsumptions: ProjectMemorySourceConsumptionRecord[];
    now: Date;
    resumedFromRun?: string;
  }): Promise<ProjectMemoryCuratorRunResult> {
    const validation = successValidation(input.input.projectKey, input.mode);
    if (input.input.dryRun || input.input.review) {
      return await this.writeTerminalArtifacts({
        input: input.input,
        run: input.run,
        mode: input.mode,
        runKind: input.runKind,
        outputArtifact: input.outputArtifact,
        validation,
        status: input.input.review ? "needs_review" : "completed",
        stoppedReason: input.input.review ? "review requested" : "dry-run requested",
        create: input.create,
        maintenance: input.maintenance,
        resumedFromRun: input.resumedFromRun,
      });
    }

    emitProjectLearnProgress(input.input.progress, {
      project_key: input.input.projectKey,
      stage: "canonical_promotion",
      status: "started",
      mode: input.mode,
      run_dir: input.run.relative_run_dir,
      message: "validating canonical links and staging Project Memory writes",
    });
    let apply;
    try {
      apply = await promoteDraftWiki({
        root: this.root,
        projectKey: input.input.projectKey,
        runDir: input.run.relative_run_dir,
        absoluteRunDir: input.run.absolute_run_dir,
        mode: input.mode,
        draftWikiDir: input.draftWikiDir,
        curatorOutputRef: input.outputArtifact,
        state: agentState({
          input: input.input,
          run: input.run,
          runKind: input.runKind,
          create: input.create,
          maintenance: input.maintenance,
          now: input.now,
        }),
        repositoryIdentity: input.create
          ? await readJson<ProjectRepositoryIdentity>(resolveInside(input.run.absolute_run_dir, input.create.repository_identity_ref))
          : undefined,
        requiredSubjectWikiPaths: input.create?.manifest.subjects.map((subject) => subject.wiki_path),
        sourceConsumptions: input.sourceConsumptions,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitProjectLearnProgress(input.input.progress, {
        project_key: input.input.projectKey,
        stage: "canonical_promotion",
        status: "failed",
        mode: input.mode,
        run_dir: input.run.relative_run_dir,
        message,
      });
      const applyJournalExists = await Bun.file(resolveInside(input.run.absolute_run_dir, "project-memory-apply-journal.json")).exists();
      if (applyJournalExists) throw error;
      const resumeRun = input.resumedFromRun ?? input.run.relative_run_dir;
      return await this.writeTerminalArtifacts({
        input: input.input,
        run: input.run,
        mode: input.mode,
        runKind: input.runKind,
        outputArtifact: input.outputArtifact,
        validation: failureValidation(input.input.projectKey, input.mode, "project_memory_canonical_publication_failed", message),
        status: "failed",
        stoppedReason: message,
        create: input.create,
        maintenance: input.maintenance,
        resumable: Boolean(input.create),
        resumeCommand: input.create ? resumeCommand(input.input.projectKey, resumeRun) : undefined,
        resumedFromRun: input.resumedFromRun,
      });
    }
    emitProjectLearnProgress(input.input.progress, {
      project_key: input.input.projectKey,
      stage: "canonical_promotion",
      status: "completed",
      mode: input.mode,
      run_dir: input.run.relative_run_dir,
      message: `${apply.changed_files.length} files changed`,
    });
    const sourceReconciliation = await new ProjectMemorySourceConsumptionReconciler(this.root).reconcileProject(input.input.projectKey, {
      now: input.now,
    });
    await writeRunArtifact(input.run, "post-apply-source-consumption-reconciliation.json", sourceReconciliation);
    emitProjectLearnProgress(input.input.progress, {
      project_key: input.input.projectKey,
      stage: "retrieval_indexing",
      status: "started",
      mode: input.mode,
      run_dir: input.run.relative_run_dir,
    });
    const retrieval = await this.postApplyRetrievalLifecycle({
      projectKey: input.input.projectKey,
      mode: input.mode,
      run: input.run,
      apply,
      now: input.now,
      provider: input.input.provider,
      modelOverride: input.input.modelOverride,
      env: input.input.env,
      runner: input.input.runner,
    });
    emitProjectLearnProgress(input.input.progress, {
      project_key: input.input.projectKey,
      stage: "retrieval_indexing",
      status: "completed",
      mode: input.mode,
      run_dir: input.run.relative_run_dir,
      message: retrieval.status === "completed" ? "retrieval ready" : retrieval.degraded_reason,
    });
    await this.updateCuratedRetrievalReadiness({
      projectKey: input.input.projectKey,
      status: retrieval.status,
      reason: retrieval.degraded_reason,
      now: input.now,
    });
    return await this.writeTerminalArtifacts({
      input: input.input,
      run: input.run,
      mode: input.mode,
      runKind: input.runKind,
      outputArtifact: input.outputArtifact,
      validation,
      status: retrieval.status === "completed" ? "completed" : "completed_with_pending_index",
      stoppedReason: retrieval.degraded_reason,
      apply,
      retrievalStatus: retrieval.status,
      retrievalArtifacts: retrieval.artifacts,
      create: input.create,
      maintenance: input.maintenance,
      resumedFromRun: input.resumedFromRun,
    });
  }

  private async combinedSourceConsumptions(
    projectKey: string,
    next: ProjectMemorySourceConsumptionRecord[],
  ): Promise<ProjectMemorySourceConsumptionRecord[]> {
    const existing = await readJsonIfExists<{ records?: ProjectMemorySourceConsumptionRecord[] }>(
      projectPath(this.root, projectKey, "state", "project-memory-source-consumptions.json"),
    );
    const byKey = new Map<string, ProjectMemorySourceConsumptionRecord>();
    for (const record of existing?.records ?? []) byKey.set(`${record.source_kind}:${record.source_ref}`, record);
    for (const record of next) byKey.set(`${record.source_kind}:${record.source_ref}`, record);
    return [...byKey.values()];
  }

  private async writeTerminalArtifacts(input: {
    input: RunProjectMemoryCuratorInput;
    run: ProjectCuratorRunPaths;
    mode: ProjectMemoryCuratorMode;
    runKind: ProjectMemoryAgentRunKind;
    outputArtifact: string;
    validation: ProjectMemoryCuratorValidationResult;
    status: ProjectMemoryCuratorRunResult["status"];
    stoppedReason?: string;
    apply?: ProjectMemoryApplyResult;
    retrievalStatus?: ProjectMemoryPostApplyRetrievalLifecycleResult["status"];
    retrievalArtifacts?: ProjectMemoryPostApplyRetrievalLifecycleResult["artifacts"];
    create?: ProjectMemoryCreateModeResult;
    maintenance?: ProjectMemoryMaintenanceModeResult;
    runtimeInboxIntake?: boolean;
    resumable?: boolean;
    resumeCommand?: string;
    resumedFromRun?: string;
  }): Promise<ProjectMemoryCuratorRunResult> {
    await writeRunArtifact(input.run, "curator-validation.json", input.validation);
    const result = buildResult(input);
    await writeRunArtifact(input.run, "curator-run-result.json", result);
    await writeMarkdownArtifact(input.run, "summary.md", summaryFor(result));
    return result;
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
  run: ProjectCuratorRunPaths;
  mode: ProjectMemoryCuratorMode;
  runKind: ProjectMemoryAgentRunKind;
  outputArtifact: string;
  validation: ProjectMemoryCuratorValidationResult;
  status: ProjectMemoryCuratorRunResult["status"];
  stoppedReason?: string;
  apply?: ProjectMemoryApplyResult;
  retrievalStatus?: ProjectMemoryPostApplyRetrievalLifecycleResult["status"];
  retrievalArtifacts?: ProjectMemoryPostApplyRetrievalLifecycleResult["artifacts"];
  create?: ProjectMemoryCreateModeResult;
  maintenance?: ProjectMemoryMaintenanceModeResult;
  runtimeInboxIntake?: boolean;
  resumable?: boolean;
  resumeCommand?: string;
  resumedFromRun?: string;
}): ProjectMemoryCuratorRunResult {
  const fileAuthoringRuns = [
    ...(input.create?.file_authoring_run_refs ?? []),
    input.maintenance?.file_authoring_run_ref,
  ].filter((ref): ref is string => Boolean(ref));
  return {
    status: input.status,
    project_key: input.input.projectKey,
    mode: input.mode,
    run_id: input.run.run_id,
    run_dir: input.run.relative_run_dir,
    artifacts: {
      ...baseArtifacts(input.outputArtifact),
      runtime_inbox_intake: "runtime-inbox-intake.json",
      apply_journal: input.apply ? "project-memory-apply-journal.json" : undefined,
      apply_result: input.apply ? "project-memory-apply-result.json" : undefined,
      changeset: input.apply ? "project-memory-changeset.json" : undefined,
      retrieval_sections: input.retrievalArtifacts?.retrieval_sections,
      hint_generation: input.retrievalArtifacts?.hint_generation,
      retrieval_index_result: input.retrievalArtifacts?.retrieval_index_result,
      publication_validation: input.apply ? "canonical-publication-validation.json" : undefined,
      repository_identity: input.create || input.maintenance ? "repository-identity.json" : undefined,
      subject_manifest: input.create ? "reports/documentation-subject-manifest.json" : undefined,
      planner_report: input.create ? "reports/documentation-planner-report.json" : undefined,
      subject_reports: input.create?.subject_report_refs,
      maintenance_report: input.maintenance ? "reports/documentation-maintenance-report.json" : undefined,
      file_authoring_runs: fileAuthoringRuns.length > 0 ? fileAuthoringRuns : undefined,
      pre_maintenance_wiki: input.create ? "pre-maintenance-wiki" : undefined,
      create_checkpoint: input.create && !input.resumedFromRun ? PROJECT_MEMORY_CREATE_CHECKPOINT_REF : undefined,
      resume_source: input.resumedFromRun ? "resume-source.json" : undefined,
    },
    curation_kind: "agent_authored",
    run_kind: input.runKind,
    content_quality_status: "trusted",
    retrieval_readiness_status:
      input.retrievalStatus === "completed" ? "ready" : input.retrievalStatus === "pending" ? "pending" : undefined,
    quality_diagnostics_ref: undefined,
    validation_ok: input.validation.ok,
    stopped_before_writes: !input.apply,
    dry_run: input.input.dryRun,
    review: input.input.review,
    applied_page_ids: input.apply?.applied_page_ids,
    applied_item_ids: input.apply?.applied_item_ids,
    changed_files: input.apply?.changed_files.map((file) => file.path),
    source_consumptions: input.apply?.source_consumptions.map((record) => `${record.source_kind}:${record.source_ref}`),
    stopped_reason: input.stoppedReason,
    resumable: input.resumable,
    resume_command: input.resumeCommand,
    resumed_from_run: input.resumedFromRun,
  };
}

function baseArtifacts(outputArtifact: string): ProjectMemoryCuratorRunResult["artifacts"] {
  return {
    input_packet: "input-packet.json",
    curator_output: outputArtifact,
    curator_validation: "curator-validation.json",
    curator_run_result: "curator-run-result.json",
    summary: "summary.md",
  };
}

function agentState(input: {
  input: RunProjectMemoryCuratorInput;
  run: ProjectCuratorRunPaths;
  runKind: ProjectMemoryAgentRunKind;
  create?: ProjectMemoryCreateModeResult;
  maintenance?: ProjectMemoryMaintenanceModeResult;
  now: Date;
}): ProjectMemoryAgentStateV2 {
  const maintenance = input.maintenance;
  const create = input.create;
  return {
    schema_version: 2,
    project_key: input.input.projectKey,
    status: maintenance?.status === "degraded" ? "degraded" : "curated",
    source_run_dir: input.run.relative_run_dir,
    updated_at: input.now.toISOString(),
    provider_mode: providerModeFor(input.input),
    curation_kind: "agent_authored",
    run_kind: input.runKind,
    create: create
      ? {
          status: create.status,
          planner_status: create.status === "completed" ? "completed" : "failed",
          subject_writer_status: create.status === "completed" ? "completed" : "failed",
          subject_count: create.manifest.subjects.length,
          subject_writer_concurrency_limit: create.concurrency_limit,
          subject_writer_retry_limit: create.retry_limit,
          manifest_ref: create.subject_manifest_ref,
          planner_report_ref: create.planner_report_ref,
          subject_report_refs: create.subject_report_refs,
          pre_maintenance_wiki_ref: create.pre_maintenance_wiki_ref,
        }
      : {
          status: "skipped",
          planner_status: "completed",
          subject_writer_status: "completed",
          subject_count: 0,
          subject_writer_concurrency_limit: 0,
          subject_writer_retry_limit: 0,
          subject_report_refs: [],
        },
    maintenance: maintenance
      ? {
          status: maintenance.status,
          report_ref: maintenance.report_ref,
          dispositions_count: maintenance.report.dispositions.length,
          applied_count: maintenance.report.dispositions.filter((item) => item.disposition === "applied_to_project_memory").length,
          already_covered_count: maintenance.report.dispositions.filter((item) => item.disposition === "already_covered").length,
          degraded_reason: maintenance.degraded_reasons[0],
          degraded_reasons: maintenance.degraded_reasons,
        }
      : {
          status: "skipped",
          dispositions_count: 0,
          applied_count: 0,
          already_covered_count: 0,
          degraded_reasons: [],
        },
    retrieval_readiness: {
      status: "pending",
      checked_at: input.now.toISOString(),
      reason: "retrieval lifecycle has not completed yet",
    },
    content_quality: {
      status: "not_evaluated",
      reason: "agent_authored_documentation_has_no_schema_quality_gate",
    },
  };
}

function providerModeFor(input: RunProjectMemoryCuratorInput): ProjectMemoryAgentProviderMode {
  if (input.env?.[FILE_AUTHORING_STUB_OUTPUTS_DIR]) return "stub";
  return input.runner ? "test" : "live";
}

function pendingSourcesFromPacket(packet: ProjectMemoryPacket): ProjectMemoryMaintenancePendingSource[] {
  return [
    ...packet.pending.project_candidates.map(candidateSource),
    ...packet.pending.project_handoffs.map(handoffSource),
  ];
}

function candidateSource(candidate: PacketCandidate): ProjectMemoryMaintenancePendingSource {
  return {
    source_kind: "project_candidate",
    source_ref: candidate.id,
    title: candidate.title,
    summary: candidate.summary,
    priority: candidate.priority,
    reason: candidate.reason,
  };
}

function handoffSource(handoff: PacketHandoff): ProjectMemoryMaintenancePendingSource {
  return {
    source_kind: "project_handoff",
    source_ref: handoff.id,
    title: handoff.objective,
    summary: handoff.prompt_text,
    priority: handoff.priority,
    reason: handoff.reason,
  };
}

function modeForInput(input: RunProjectMemoryCuratorInput, packet: ProjectMemoryPacket): ProjectMemoryCuratorMode {
  if (input.recreate) return "create";
  return statusOf(packet.state.project_memory) === "curated" ? "maintain" : "create";
}

function runKindForInput(input: RunProjectMemoryCuratorInput, packet: ProjectMemoryPacket): ProjectMemoryAgentRunKind {
  if (input.recreate) return "recreate";
  return statusOf(packet.state.project_memory) === "curated" ? "maintenance" : "create_then_maintenance";
}

function statusOf(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

function successValidation(projectKey: string, mode: ProjectMemoryCuratorMode): ProjectMemoryCuratorValidationResult {
  return {
    ok: true,
    mode,
    project_key: projectKey,
    global_findings: [],
    item_results: [],
    eligible_item_ids: [],
    rejected_item_ids: [],
    quarantined_item_ids: [],
    noop_refs: [],
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
    global_findings: [{ severity: "blocker", category: "provider", code, message }],
    item_results: [],
    eligible_item_ids: [],
    rejected_item_ids: [],
    quarantined_item_ids: [],
    noop_refs: [],
  };
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

function summaryFor(result: ProjectMemoryCuratorRunResult): string {
  return [
    `# Project learn ${result.project_key}`,
    "",
    `mode: ${result.mode}`,
    result.run_kind ? `run_kind: ${result.run_kind}` : "",
    `status: ${result.status}`,
    `curation_kind: ${result.curation_kind ?? "unknown"}`,
    `validation_ok: ${result.validation_ok}`,
    `stopped_before_writes: ${result.stopped_before_writes}`,
    result.stopped_reason ? `stopped_reason: ${result.stopped_reason}` : "",
    result.artifacts.subject_manifest ? `subject_manifest: ${result.artifacts.subject_manifest}` : "",
    result.artifacts.maintenance_report ? `maintenance_report: ${result.artifacts.maintenance_report}` : "",
    result.artifacts.retrieval_sections ? `retrieval_sections: ${result.artifacts.retrieval_sections}` : "",
    result.artifacts.hint_generation ? `hint_generation: ${result.artifacts.hint_generation}` : "",
    result.artifacts.retrieval_index_result ? `retrieval_index_result: ${result.artifacts.retrieval_index_result}` : "",
    result.status === "completed_with_pending_index" ? "pending_retrieval_index: yes" : "",
    result.resumable !== undefined ? `resumable: ${result.resumable}` : "",
    result.resume_command ? `resume_command: ${result.resume_command}` : "",
    result.resumed_from_run ? `resumed_from_run: ${result.resumed_from_run}` : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

function resumeCommand(projectKey: string, runDir: string): string {
  return `myelin project learn ${projectKey} --resume ${runDir}`;
}

function resolveResumeSourceRun(
  root: string,
  projectKey: string,
  value: string,
): { absoluteRunDir: string; relativeRunDir: string } {
  const runsRoot = projectPath(root, projectKey, "runs", "project-learn");
  const absoluteRunDir = value.includes("/") || value.includes("\\")
    ? resolveInside(root, value)
    : resolve(runsRoot, value);
  if (dirname(absoluteRunDir) !== runsRoot) {
    throw new Error(`Project learn resume preflight failed: ${value} is not a direct project-learn run for ${projectKey}.`);
  }
  return {
    absoluteRunDir,
    relativeRunDir: relative(root, absoluteRunDir).replaceAll("\\", "/"),
  };
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
          required: false,
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
      indexResult = await new ProjectMemoryRetrievalIndexCoordinator({ root: this.root }).indexProject({
        projectKey: input.projectKey,
        limit: 500,
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
      indexResult.degraded_reason,
      (indexResult.pending_remaining ?? 0) > 0 ? `${indexResult.pending_remaining} Project Memory retrieval rows remain pending` : "",
    ].filter(Boolean).join("; ");
    if (pendingReason) {
      try {
        const { AutoProjectMemoryMaintenanceService } = await import(
          "../maintenance/auto-project-memory-maintenance.ts"
        );
        await new AutoProjectMemoryMaintenanceService(this.root).maybeSchedule(
          input.projectKey,
          "retrieval_index_pending",
        );
      } catch {
        // Curated Project Memory remains durable and pending if background indexing cannot be scheduled.
      }
    }
    return {
      status: pendingReason ? "pending" : "completed",
      artifacts,
      degraded_reason: pendingReason || undefined,
    };
  }
}
