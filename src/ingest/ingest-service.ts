import { getIngestJob } from "./jobs.ts";
import { randomUUID } from "node:crypto";
import { readIngestProjectStatus } from "./status.ts";
import {
  readCurrentGitBranch,
  refreshDetachedIngestJobStatus,
  resolveIngestTargetRepo,
  launchDetachedIngestWorker,
} from "./runtime.ts";
import { runIngestWorker } from "./worker.ts";
import { openMemoryDb } from "../memory/db.ts";
import {
  countExperienceContentEvents,
  countExperienceEvents,
} from "../memory/experience.ts";
import type { IngestJobRow } from "../memory/ingest-types.ts";
import { loadConfig, MAX_INGEST_EVIDENCE_CHUNK_SIZE } from "../runtime/config.ts";
import { findProject } from "../runtime/projects.ts";
import { selectModelProfile } from "../runtime/config.ts";
import {
  AuthorityActivationService,
} from "../session-maintenance/authority-activation-service.ts";
import { getSessionMemoryAnchorJob } from "../session-maintenance/job-lifecycle.ts";
import {
  defaultSMCGoverningIdentities,
  planSessionMaintenanceEvidence,
} from "../session-maintenance/evidence-selection.ts";
import { prepareSessionMaintenanceAnchor } from "../session-maintenance/preparation-service.ts";
import type {
  IngestServiceDeps,
  IngestStatusResult,
  StartEligibleAnchorInput,
  StartIngestInput,
  StartIngestResult,
} from "./ingest-service-contracts.ts";
import { DefaultSessionMaintenanceScheduler } from "../maintenance/session-maintenance-scheduler.ts";

export type {
  IngestProvider,
  IngestServiceDeps,
  IngestStatusResult,
  StartIngestInput,
  StartIngestResult,
} from "./ingest-service-contracts.ts";

export class IngestService {
  constructor(
    private readonly root: string,
    private readonly deps: IngestServiceDeps = {},
  ) {}

  async start(input: StartIngestInput): Promise<StartIngestResult> {
    assertPositiveInteger("ingest limit", input.limit);
    assertPositiveInteger(
      "ingest evidence chunk size",
      input.evidenceChunkSize,
      MAX_INGEST_EVIDENCE_CHUNK_SIZE,
    );

    const scheduler = new DefaultSessionMaintenanceScheduler(this.root, {
      now: this.deps.now,
      planConfig: this.deps.smcPlanConfig,
      startAnchor: async (eligible) => await this.startEligibleAnchor({
        ...input,
        ...eligible,
      }),
    });
    const scheduled = await scheduler.run(input.projectKey, "manual");
    if (scheduled.kind === "anchor") return scheduled.result;

    const db = openMemoryDb(this.root);
    try {
      const config = await loadConfig(this.root);
      const evidenceChunkSize = input.evidenceChunkSize ?? config.ingest.evidenceChunkSize;
      const queuedCount = countExperienceContentEvents(db, input.projectKey);
      if (scheduled.kind === "blocked") {
        return {
          kind: "blocked",
          code: scheduled.code,
          project_key: input.projectKey,
          queued_count: queuedCount,
          reconciled_count: 0,
          selected_count: queuedCount,
          job_id: null,
          process_id: null,
          job_ids: [],
          target_branch: null,
          evidence_chunk_size: evidenceChunkSize,
          workload: {
            evidence_count: scheduled.eligibility.evidence.queued_count,
            audit_count: scheduled.eligibility.audit.due_count,
          },
        };
      }
      const targetRepo = await resolveIngestTargetRepo(this.root, input.projectKey);
      return {
        kind: "no_work",
        project_key: input.projectKey,
        queued_count: queuedCount,
        reconciled_count: 0,
        evidence_chunk_size: evidenceChunkSize,
        target_branch: await readCurrentGitBranch(targetRepo, this.deps.runner),
        workload: {
          evidence_count: scheduled.eligibility.evidence.queued_count,
          audit_count: scheduled.eligibility.audit.due_count,
        },
      };
    } finally {
      db.close();
    }
  }

  async startEligibleAnchor(input: StartEligibleAnchorInput): Promise<StartIngestResult> {
    assertPositiveInteger("ingest limit", input.limit);

    const db = openMemoryDb(this.root);
    try {
      const config = await loadConfig(this.root);
      const planConfig = this.deps.smcPlanConfig ?? config.sessionMaintenance.planConfig;
      const evidenceChunkSize = input.evidenceChunkSize ?? config.ingest.evidenceChunkSize;
      assertPositiveInteger(
        "ingest evidence chunk size",
        evidenceChunkSize,
        MAX_INGEST_EVIDENCE_CHUNK_SIZE,
      );
      const queuedCountBeforeActivation = countExperienceContentEvents(db, input.projectKey);
      const drainableCountBeforeActivation = countExperienceEvents(db, input.projectKey);
      const selectedCountBeforeActivation = input.limit === undefined
        ? drainableCountBeforeActivation
        : Math.min(input.limit, drainableCountBeforeActivation);
      if ((selectedCountBeforeActivation > 0 || input.includeAudit) && !planConfig) {
        return {
          kind: "blocked",
          code: "session_memory_plan_config_unavailable",
          project_key: input.projectKey,
          queued_count: queuedCountBeforeActivation,
          reconciled_count: 0,
          selected_count: selectedCountBeforeActivation,
          job_id: null,
          process_id: null,
          job_ids: [],
          target_branch: null,
          evidence_chunk_size: evidenceChunkSize,
          workload: { evidence_count: selectedCountBeforeActivation, audit_count: input.auditDueCount },
        };
      }
      const activation = new AuthorityActivationService({
        now: this.deps.now,
        isProcessAlive: this.deps.isProcessAlive,
      }).activate(db);
      if (activation.kind === "blocked") {
        const queuedCount = countExperienceContentEvents(db, input.projectKey);
        const drainableCount = countExperienceEvents(db, input.projectKey);
        return {
          kind: "blocked",
          code: activation.code,
          project_key: input.projectKey,
          queued_count: queuedCount,
          reconciled_count: 0,
          selected_count: input.limit === undefined
            ? drainableCount
            : Math.min(input.limit, drainableCount),
          job_id: activation.job_id,
          process_id: activation.process_id,
          job_ids: activation.job_ids,
          target_branch: null,
          evidence_chunk_size: evidenceChunkSize,
          workload: {
            evidence_count: input.limit === undefined ? drainableCount : Math.min(input.limit, drainableCount),
            audit_count: input.auditDueCount,
          },
        };
      }

      // Compatibility reconciliation is a protected legacy write and is intentionally unavailable
      // after authority activation until the SMC preparation transaction owns it.
      const reconciledCount = 0;
      const queuedCount = countExperienceContentEvents(db, input.projectKey);
      const drainableCount = countExperienceEvents(db, input.projectKey);
      const selectedCount = input.limit === undefined ? drainableCount : Math.min(input.limit, drainableCount);
      const targetRepo = await resolveIngestTargetRepo(this.root, input.projectKey);
      const targetBranch = await readCurrentGitBranch(targetRepo, this.deps.runner);
      if (selectedCount === 0 && !input.includeAudit) {
        return {
          kind: "no_work",
          project_key: input.projectKey,
          queued_count: queuedCount,
          reconciled_count: reconciledCount,
          evidence_chunk_size: evidenceChunkSize,
          target_branch: targetBranch,
          workload: { evidence_count: 0, audit_count: 0 },
        };
      }
      const profile = selectModelProfile(config, "ingest", input.provider);
      const anchorJobId = `ingest_${randomUUID()}`;
      const plan = planSessionMaintenanceEvidence(db, {
        anchor_job_id: anchorJobId,
        project_key: input.projectKey,
        trigger_reason: input.triggerReason,
        compatibility_selection_limit: input.limit ?? null,
        include_audit: input.includeAudit,
        audit_partition_limit: input.auditPartitionLimit,
        governing_identities: defaultSMCGoverningIdentities({
          provider: profile.provider,
          model: profile.model ?? null,
          reasoning_effort: profile.reasoningEffort ?? null,
        }),
        budgets: {
          ...planConfig!.evidenceBudgets,
          max_items_per_batch: evidenceChunkSize,
        },
      });
      if (plan.kind === "blocked") {
        return {
          kind: "blocked",
          code: plan.code,
          project_key: input.projectKey,
          queued_count: queuedCount,
          reconciled_count: reconciledCount,
          selected_count: selectedCount,
          job_id: null,
          process_id: null,
          job_ids: [],
          target_branch: null,
          evidence_chunk_size: evidenceChunkSize,
          workload: { evidence_count: selectedCount, audit_count: input.auditDueCount },
        };
      }
      if (plan.kind === "no_work") throw new Error("SMC planning diverged from scheduler eligibility");
      const prepared = prepareSessionMaintenanceAnchor(db, {
        plan: plan.plan,
        requested_by: input.triggerReason === "manual" || input.triggerReason === "manual_audit"
          ? "manual"
          : "automatic",
        target_context: {
          repo_path: targetRepo,
          git_branch: targetBranch,
          git_commit: null,
          git_worktree_id: null,
        },
        workflow_budgets: planConfig!.workflowBudgets,
        now: this.now(),
      });
      if (prepared.kind === "blocked") {
        return {
          kind: "blocked",
          code: prepared.code,
          project_key: input.projectKey,
          queued_count: queuedCount,
          reconciled_count: reconciledCount,
          selected_count: selectedCount,
          job_id: prepared.job_id,
          process_id: null,
          job_ids: [prepared.job_id],
          target_branch: null,
          evidence_chunk_size: evidenceChunkSize,
          workload: { evidence_count: selectedCount, audit_count: input.auditDueCount },
          ...(prepared.workflow_budget_feasibility
            ? { workflow_budget_feasibility: prepared.workflow_budget_feasibility }
            : {}),
        };
      }
      this.deps.smcFailureInjection?.afterPreparationBeforeSpawn?.();
      const launch = await launchDetachedIngestWorker({
          db,
          root: this.root,
          projectKey: input.projectKey,
          jobId: prepared.manifest.job_id,
          now: this.now(),
          runner: this.deps.runner,
          spawn: this.deps.spawn,
          context: this.deps.context,
          failure_injection: {
            afterSpawnBeforeAcknowledgement: this.deps.smcFailureInjection?.afterSpawnBeforeAcknowledgement,
          },
        });
      const job = getIngestJob(db, prepared.manifest.job_id);
      if (!job) throw new Error(`Prepared ingest job disappeared: ${prepared.manifest.job_id}`);
      return {
        kind: "started",
        project_key: input.projectKey,
        queued_count: queuedCount,
        reconciled_count: reconciledCount,
        selected_count: plan.plan.ordered_source_ids.length,
        evidence_chunk_size: evidenceChunkSize,
        target_branch: targetBranch,
        job,
        workload: {
          evidence_count: plan.plan.ordered_source_ids.length,
          audit_count: input.auditDueCount,
        },
        launches: [launch],
      };
    } finally {
      db.close();
    }
  }

  async status(input: { jobId?: string; projectKey?: string }): Promise<IngestStatusResult> {
    const db = openMemoryDb(this.root);
    try {
      if (input.projectKey) {
        await findProject(this.root, input.projectKey);
        this.refreshRunningProjectIngestJobs(db, input.projectKey);
        return { kind: "project", status: readIngestProjectStatus(db, input.projectKey) };
      }

      const job = getIngestJob(db, input.jobId ?? "");
      if (!job) throw new Error(`Unknown ingest job: ${input.jobId}`);
      const anchor = getSessionMemoryAnchorJob(db, job.id);
      return {
        kind: "job",
        job: anchor ? job : refreshDetachedIngestJobStatus({
          db,
          job,
          now: this.now(),
          isAlive: this.deps.isProcessAlive,
        }),
        anchor,
      };
    } finally {
      db.close();
    }
  }

  async runWorker(jobId: string): Promise<void> {
    await sleep(Number(process.env.MYELIN_INGEST_START_DELAY_MS ?? 0));

    const db = openMemoryDb(this.root);
    try {
      const job = getIngestJob(db, jobId);
      if (!job) throw new Error(`Unknown ingest job: ${jobId}`);
      const anchor = getSessionMemoryAnchorJob(db, jobId);
      if (!anchor) throw new Error("smc_companion_anchor_required");

      await (this.deps.runWorker ?? runIngestWorker)({
        root: this.root,
        projectKey: job.project_key,
        jobId: job.id,
        provider: job.provider === "claude" ? "claude" : "codex",
        providerSessionId: job.provider_session_id,
      });
    } finally {
      db.close();
    }
  }

  private refreshRunningProjectIngestJobs(db: ReturnType<typeof openMemoryDb>, projectKey: string): void {
    const jobs = db
      .query("SELECT * FROM ingest_jobs WHERE project_key = ? AND status = 'running' ORDER BY created_at, id")
      .all(projectKey) as IngestJobRow[];
    for (const job of jobs) {
      if (getSessionMemoryAnchorJob(db, job.id)) continue;
      refreshDetachedIngestJobStatus({
        db,
        job,
        now: this.now(),
        isAlive: this.deps.isProcessAlive,
      });
    }
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }
}

async function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function assertPositiveInteger(name: string, value: number | undefined, maximum?: number): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value <= 0 || (maximum !== undefined && value > maximum)) {
    const expected = maximum === undefined ? "a positive integer" : `an integer between 1 and ${maximum}`;
    throw new Error(`Invalid ${name}: ${value}. Expected ${expected}`);
  }
}
