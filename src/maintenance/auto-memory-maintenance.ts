import { openMemoryDb } from "../memory/db.ts";
import { countExperienceEvents } from "../memory/experience.ts";
import { EmbeddingProviderFactory } from "../memory/embedding-provider-factory.ts";
import { SessionMemoryIndexService } from "../memory/session-memory-index-service.ts";
import { isProcessAlive, resolveIngestTargetRepo } from "../ingest/runtime.ts";
import { IngestService } from "../ingest/ingest-service.ts";
import type { IngestProvider, StartIngestResult } from "../ingest/ingest-service-contracts.ts";
import { loadConfig, type AutoMemoryMaintenanceConfig } from "../runtime/config.ts";
import { projectPath } from "../runtime/fs.ts";
import { createId } from "../runtime/ids.ts";
import { prepareProjectLogFile, projectLogPath } from "../runtime/project-logs.ts";
import {
  backgroundInvocationEnv,
  backgroundLaunchContext,
  resolveMyelinCommandInvocation,
} from "../runtime/command-invocation.ts";
import {
  type AutoMemoryMaintenanceDeps,
  type AutoMemoryMaintenanceIndexResult,
  type AutoMemoryMaintenanceRunResult,
  type AutoMemoryMaintenanceScheduleResult,
  type AutoMemoryMaintenanceState,
} from "./maintenance-contracts.ts";
import { MaintenanceRunRuntime, spawnDetachedMaintenanceWorker } from "./maintenance-run-runtime.ts";

export type {
  AutoMemoryMaintenanceDeps,
  AutoMemoryMaintenanceRunResult,
  AutoMemoryMaintenanceScheduleResult,
  AutoMemoryMaintenanceState,
} from "./maintenance-contracts.ts";

export class AutoMemoryMaintenanceService {
  constructor(
    private readonly root: string,
    private readonly deps: AutoMemoryMaintenanceDeps = {},
  ) {}

  async maybeSchedule(
    projectKey: string,
    options: { forceIngest?: boolean } = {},
  ): Promise<AutoMemoryMaintenanceScheduleResult> {
    const config = await loadConfig(this.root);
    const maintenance = config.autoMemoryMaintenance;
    if (!maintenance.enabled) return { status: "disabled", reason: "AUTO_MEMORY_MAINTENANCE is not enabled" };
    if (process.env.MYELIN_CAPTURE_DISABLED === "1" || process.env.MYELIN_AUTO_MEMORY_MAINTENANCE_WORKER === "1") {
      return { status: "skipped", reason: "capture disabled for Myelin-owned worker" };
    }

    const db = openMemoryDb(this.root);
    let queuedCount = 0;
    try {
      queuedCount = countExperienceEvents(db, projectKey);
      const runningJobs = db
        .query("SELECT count(*) AS count FROM ingest_jobs WHERE project_key = ? AND status = 'running'")
        .get(projectKey) as { count: number };
      if (runningJobs.count > 0) {
        return this.skip(projectKey, "ingest already running", { queuedCount, preserveActiveState: true });
      }
    } finally {
      db.close();
    }

    if (!options.forceIngest && queuedCount < maintenance.minCapturedEvents) {
      return this.skip(projectKey, "below captured event threshold", { queuedCount });
    }
    if (!options.forceIngest && await this.isInCooldown(projectKey, maintenance)) {
      return this.skip(projectKey, "cooldown active", { queuedCount });
    }

    return this.scheduleDetachedWorker(projectKey, queuedCount, options.forceIngest ?? false);
  }

  private async scheduleDetachedWorker(
    projectKey: string,
    queuedCount: number,
    forceIngest: boolean,
  ): Promise<AutoMemoryMaintenanceScheduleResult> {
    const runId = `auto_memory_${createId()}`;
    const runtime = this.runtime(projectKey);
    let lock = await runtime.tryAcquireLock(runId);
    if (!lock && await runtime.clearDeadLock("Detached auto memory maintenance worker PID is no longer running.")) {
      lock = await runtime.tryAcquireLock(runId);
    }
    if (!lock) return this.skip(projectKey, "maintenance already locked", { queuedCount, preserveActiveState: true });

    const logPath = autoMemoryLogPath(this.root, projectKey, runId);
    try {
      await prepareProjectLogFile(this.root, projectKey, logPath);
      const targetRepo = await resolveIngestTargetRepo(this.root, projectKey);
      const context = backgroundLaunchContext({
        myelinRoot: this.root,
        callerCwd: targetRepo,
        context: this.deps.context,
      });
      const spawn = this.deps.spawn ?? ((options) => Bun.spawn(options));
      const proc = spawnDetachedMaintenanceWorker({
        spawn,
        command: resolveMyelinCommandInvocation(context, ["maintenance", "worker", "session", projectKey]),
        cwd: targetRepo,
        logPath,
        env: {
          ...process.env,
          ...backgroundInvocationEnv(context, "worker"),
          MYELIN_CAPTURE_DISABLED: "1",
          MYELIN_AUTO_MEMORY_MAINTENANCE_WORKER: "1",
          MYELIN_AUTO_MEMORY_RUN_ID: runId,
          ...(forceIngest ? { MYELIN_AUTO_MEMORY_FORCE_INGEST: "1" } : {}),
        },
      });
      await writeState(this.root, projectKey, {
        project_key: projectKey,
        last_run_id: runId,
        last_scheduled_at: this.now(),
        last_status: "scheduled",
        last_log_path: logPath,
        last_pid: proc.pid,
        last_counts: { queued_count: queuedCount },
      });
      return {
        status: "scheduled",
        project_key: projectKey,
        run_id: runId,
        pid: proc.pid,
        log_path: logPath,
        queued_count: queuedCount,
      };
    } catch (error) {
      await lock.release();
      const message = error instanceof Error ? error.message : String(error);
      await writeState(this.root, projectKey, {
        project_key: projectKey,
        last_run_id: runId,
        last_scheduled_at: this.now(),
        last_finished_at: this.now(),
        last_status: "failed",
        last_reason: message,
        last_log_path: logPath,
        last_counts: { queued_count: queuedCount },
      });
      return { status: "skipped", reason: `launch failed: ${message}`, queued_count: queuedCount };
    }
  }

  async run(projectKey: string, runId = process.env.MYELIN_AUTO_MEMORY_RUN_ID ?? `auto_memory_${createId()}`): Promise<AutoMemoryMaintenanceRunResult> {
    const lock = await this.runtime(projectKey).adoptOrAcquireLock(runId);
    if (!lock) {
      return {
        status: "failed",
        project_key: projectKey,
        run_id: runId,
        ingest_started: false,
        indexed: 0,
        index_failed: 0,
        pending_remaining: 0,
        error_message: "maintenance already locked",
      };
    }
    let lockReleased = false;
    const releaseLock = async (): Promise<void> => {
      if (lockReleased) return;
      lockReleased = true;
      await lock.release();
    };

    try {
      await writeState(this.root, projectKey, {
        ...(await readState(this.root, projectKey)),
        project_key: projectKey,
        last_run_id: runId,
        last_started_at: this.now(),
        last_status: "running",
      });

      const config = await loadConfig(this.root);
      let ingestResult: StartIngestResult | null = null;
      let drainError: Error | null = null;
      const queuedBefore = this.countQueued(projectKey);

      if (process.env.MYELIN_AUTO_MEMORY_FORCE_INGEST === "1" || queuedBefore >= config.autoMemoryMaintenance.minCapturedEvents) {
        ingestResult = await this.ingestService().start({
          projectKey,
          provider: config.defaultProvider as IngestProvider,
          limit: config.ingest.batchSize,
          batchSize: config.ingest.batchSize,
        });
        try {
          await this.waitForDrain(projectKey, config.autoMemoryMaintenance);
        } catch (error) {
          drainError = error instanceof Error ? error : new Error(String(error));
        }
      }

      const indexResult = await this.indexPending(projectKey, config);
      const queuedRemaining = this.countQueued(projectKey);

      if (drainError) {
        await writeState(this.root, projectKey, {
          ...(await readState(this.root, projectKey)),
          project_key: projectKey,
          last_run_id: runId,
          last_finished_at: this.now(),
          last_status: "failed",
          last_reason: drainError.message,
          last_counts: {
            queued_count: ingestResult?.queued_count ?? queuedBefore,
            indexed: indexResult.indexed,
            index_failed: indexResult.failed,
            pending_remaining: indexResult.pending_remaining,
            queued_remaining: queuedRemaining,
          },
        });
        return {
          status: "failed",
          project_key: projectKey,
          run_id: runId,
          ingest_started: ingestResult?.kind === "started",
          indexed: indexResult.indexed,
          index_failed: indexResult.failed,
          pending_remaining: indexResult.pending_remaining,
          queued_remaining: queuedRemaining,
          error_message: drainError.message,
        };
      }

      const shouldContinue =
        queuedRemaining >= config.autoMemoryMaintenance.minCapturedEvents || indexResult.pending_remaining > 0;
      await writeState(this.root, projectKey, {
        ...(await readState(this.root, projectKey)),
        project_key: projectKey,
        last_run_id: runId,
        last_finished_at: this.now(),
        last_status: "completed",
        last_counts: {
          queued_count: ingestResult?.queued_count ?? queuedBefore,
          indexed: indexResult.indexed,
          index_failed: indexResult.failed,
          pending_remaining: indexResult.pending_remaining,
          queued_remaining: queuedRemaining,
          rescheduled: shouldContinue,
        },
      });

      let rescheduled = false;
      if (shouldContinue) {
        await releaseLock();
        const continuation = await this.scheduleDetachedWorker(projectKey, queuedRemaining, false);
        rescheduled = continuation.status === "scheduled";
      }

      return {
        status: "completed",
        project_key: projectKey,
        run_id: runId,
        ingest_started: ingestResult?.kind === "started",
        indexed: indexResult.indexed,
        index_failed: indexResult.failed,
        pending_remaining: indexResult.pending_remaining,
        queued_remaining: queuedRemaining,
        rescheduled,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeState(this.root, projectKey, {
        ...(await readState(this.root, projectKey)),
        project_key: projectKey,
        last_run_id: runId,
        last_finished_at: this.now(),
        last_status: "failed",
        last_reason: message,
      });
      return {
        status: "failed",
        project_key: projectKey,
        run_id: runId,
        ingest_started: false,
        indexed: 0,
        index_failed: 0,
        pending_remaining: 0,
        error_message: message,
      };
    } finally {
      await releaseLock();
    }
  }

  private async waitForDrain(projectKey: string, config: AutoMemoryMaintenanceConfig): Promise<void> {
    const started = Date.now();
    const service = this.ingestService();
    while (Date.now() - started <= config.drainTimeoutMs) {
      const result = await service.status({ projectKey });
      if (result.kind === "project" && result.status.counts.running_jobs === 0) return;
      await (this.deps.sleep ?? sleep)(config.drainPollIntervalMs);
    }
    throw new Error(`Auto memory maintenance timed out waiting for ingest drain for ${projectKey}`);
  }

  private ingestService(): NonNullable<AutoMemoryMaintenanceDeps["ingestService"]> {
    return this.deps.ingestService ?? new IngestService(this.root, {
      ...this.deps,
      isProcessAlive: this.deps.isProcessAlive ?? isProcessAlive,
    });
  }

  private async indexPending(projectKey: string, config: Awaited<ReturnType<typeof loadConfig>>): Promise<AutoMemoryMaintenanceIndexResult> {
    if (this.deps.indexPending) {
      return this.deps.indexPending({
        projectKey,
        limit: config.autoMemoryMaintenance.indexLimit,
        batchSize: config.embedding.batchSize,
        retryFailed: false,
      });
    }

    const db = openMemoryDb(this.root);
    try {
      const selection = await new EmbeddingProviderFactory(config).initialize("retrieval_document");
      return await new SessionMemoryIndexService({
        db,
        contract: selection.contract,
        provider: selection.client,
      }).indexPending({
        projectKey,
        limit: config.autoMemoryMaintenance.indexLimit,
        batchSize: config.embedding.batchSize,
        retryFailed: false,
      });
    } finally {
      db.close();
    }
  }

  private countQueued(projectKey: string): number {
    const db = openMemoryDb(this.root);
    try {
      return countExperienceEvents(db, projectKey);
    } finally {
      db.close();
    }
  }

  private async isInCooldown(projectKey: string, config: AutoMemoryMaintenanceConfig): Promise<boolean> {
    return await this.runtime(projectKey).isInCooldown(config.cooldownMs);
  }

  private async skip(
    projectKey: string,
    reason: string,
    input: { queuedCount?: number; preserveActiveState?: boolean } = {},
  ): Promise<AutoMemoryMaintenanceScheduleResult> {
    const state = await readState(this.root, projectKey);
    await writeState(this.root, projectKey, {
      ...state,
      project_key: projectKey,
      last_check_at: this.now(),
      last_check_status: "skipped",
      last_check_reason: reason,
      last_check_counts: { queued_count: input.queuedCount },
    });
    return { status: "skipped", reason, queued_count: input.queuedCount };
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }

  private runtime(projectKey: string): MaintenanceRunRuntime<AutoMemoryMaintenanceState> {
    return maintenanceRuntime(this.root, projectKey, () => this.now(), this.deps.isProcessAlive ?? isProcessAlive);
  }
}

export async function readState(root: string, projectKey: string): Promise<AutoMemoryMaintenanceState> {
  return await maintenanceRuntime(root, projectKey).readState();
}

export async function writeState(root: string, projectKey: string, state: AutoMemoryMaintenanceState): Promise<void> {
  await maintenanceRuntime(root, projectKey).writeState(state);
}

export function statePath(root: string, projectKey: string): string {
  return projectPath(root, projectKey, "state", "auto-memory-maintenance.json");
}

export function autoMemoryLogPath(root: string, projectKey: string, runId: string): string {
  return projectLogPath(root, projectKey, `${runId}.log`);
}

function lockPath(root: string, projectKey: string): string {
  return projectPath(root, projectKey, "state", ".auto-memory-maintenance.lock");
}

function maintenanceRuntime(
  root: string,
  projectKey: string,
  now: () => string = () => new Date().toISOString(),
  alive: (pid: number) => boolean = isProcessAlive,
): MaintenanceRunRuntime<AutoMemoryMaintenanceState> {
  return new MaintenanceRunRuntime({
    projectKey,
    statePath: statePath(root, projectKey),
    lockPath: lockPath(root, projectKey),
    initialState: () => ({ project_key: projectKey }),
    now,
    isProcessAlive: alive,
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
