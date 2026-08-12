import { openMemoryDb } from "../memory/db.ts";
import { MemorySchemaCompatibilityError } from "../memory/migrations.ts";
import { isProcessAlive, resolveIngestTargetRepo } from "../ingest/runtime.ts";
import { IngestService } from "../ingest/ingest-service.ts";
import { loadConfig, type AutoMemoryMaintenanceConfig, type SMCPlanConfig } from "../runtime/config.ts";
import { projectStatePath } from "../runtime/fs.ts";
import { createId } from "../runtime/ids.ts";
import { prepareProjectLogFile, projectLogPath } from "../runtime/project-logs.ts";
import {
  backgroundInvocationEnv,
  backgroundLaunchContext,
  resolveMyelinCommandInvocation,
} from "../runtime/command-invocation.ts";
import {
  type AutoMemoryMaintenanceDeps,
  type AutoMemoryMaintenanceRunResult,
  type AutoMemoryMaintenanceScheduler,
  type AutoMemoryMaintenanceScheduleResult,
  type AutoMemoryMaintenanceState,
} from "./maintenance-contracts.ts";
import { MaintenanceRunRuntime, spawnDetachedMaintenanceWorker } from "./maintenance-run-runtime.ts";
import { DefaultSessionMaintenanceScheduler } from "./session-maintenance-scheduler.ts";
import type { SessionMaintenanceWakeKind } from "./session-maintenance-eligibility.ts";

export type {
  AutoMemoryMaintenanceDeps,
  AutoMemoryMaintenanceRunResult,
  AutoMemoryMaintenanceScheduler,
  AutoMemoryMaintenanceScheduleResult,
  AutoMemoryMaintenanceState,
} from "./maintenance-contracts.ts";

export class AutoMemoryMaintenanceService implements AutoMemoryMaintenanceScheduler {
  constructor(
    private readonly root: string,
    private readonly deps: AutoMemoryMaintenanceDeps = {},
  ) {}

  async maybeSchedule(
    projectKey: string,
    options: {
      wakeKind?: SessionMaintenanceWakeKind;
      drainBelowThreshold?: boolean;
      forceIndex?: boolean;
      forceIngest?: boolean;
    } = {},
  ): Promise<AutoMemoryMaintenanceScheduleResult> {
    const wakeKind = options.wakeKind
      ?? (options.forceIndex ? "index_request" : options.drainBelowThreshold || options.forceIngest ? "session_start" : "capture");
    const config = await loadConfig(this.root);
    const maintenance = config.autoMemoryMaintenance;
    if (!maintenance.enabled) return { status: "disabled", reason: "AUTO_MEMORY_MAINTENANCE is not enabled" };
    if (process.env.MYELIN_AUTO_MEMORY_MAINTENANCE_WORKER === "1") {
      return { status: "skipped", reason: "capture disabled for Myelin-owned worker" };
    }
    if (process.env.MYELIN_CAPTURE_DISABLED === "1" && wakeKind !== "index_request") {
      return { status: "skipped", reason: "capture disabled for Myelin-owned worker" };
    }

    let db;
    try {
      db = openMemoryDb(this.root);
    } catch (error) {
      if (error instanceof MemorySchemaCompatibilityError) {
        return this.skip(projectKey, error.message);
      }
      throw error;
    }
    let queuedCount = 0;
    try {
      const runningJobs = db
        .query("SELECT count(*) AS count FROM ingest_jobs WHERE project_key = ? AND status IN ('starting', 'running')")
        .get(projectKey) as { count: number };
      if (runningJobs.count > 0) {
        return this.skip(projectKey, "ingest already running", { queuedCount, preserveActiveState: true });
      }
    } finally {
      db.close();
    }

    const eligibility = await this.scheduler(config.sessionMaintenance.planConfig ?? undefined).evaluate(projectKey, wakeKind);
    queuedCount = eligibility.evidence.queued_count;
    if (!eligibility.curation_due && !eligibility.index.due) {
      return this.skip(projectKey, "no eligible Session Memory work", { queuedCount });
    }
    if (wakeKind === "capture" && await this.isInCooldown(projectKey, maintenance)) {
      return this.skip(projectKey, "cooldown active", { queuedCount });
    }

    return this.scheduleDetachedWorker(projectKey, queuedCount, wakeKind);
  }

  private async scheduleDetachedWorker(
    projectKey: string,
    queuedCount: number,
    wakeKind: SessionMaintenanceWakeKind,
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
          MYELIN_SESSION_MAINTENANCE_WAKE_KIND: wakeKind,
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
      const wakeKind = parseWakeKind(process.env.MYELIN_SESSION_MAINTENANCE_WAKE_KIND);
      const scheduled = await this.scheduler(config.sessionMaintenance.planConfig ?? undefined).run(projectKey, wakeKind);
      if (scheduled.kind === "blocked") throw new Error(`${scheduled.code}: ${scheduled.reason}`);
      const ingestResult = scheduled.kind === "anchor" ? scheduled.result : null;
      const indexResult = scheduled.kind === "no_work"
        ? { indexed: 0, failed: 0, pending_remaining: 0 }
        : scheduled.indexing;
      const queuedRemaining = scheduled.eligibility.evidence.queued_count;
      await writeState(this.root, projectKey, {
        ...(await readState(this.root, projectKey)),
        project_key: projectKey,
        last_run_id: runId,
        last_finished_at: this.now(),
        last_status: "completed",
        last_counts: {
          queued_count: ingestResult?.queued_count ?? scheduled.eligibility.evidence.queued_count,
          indexed: indexResult.indexed,
          index_failed: indexResult.failed,
          pending_remaining: indexResult.pending_remaining,
          reconciled_count: ingestResult?.reconciled_count ?? 0,
          queued_remaining: queuedRemaining,
          rescheduled: false,
        },
      });

      return {
        status: "completed",
        project_key: projectKey,
        run_id: runId,
        ingest_started: ingestResult?.kind === "started",
        indexed: indexResult.indexed,
        index_failed: indexResult.failed,
        pending_remaining: indexResult.pending_remaining,
        reconciled_count: ingestResult?.reconciled_count ?? 0,
        queued_remaining: queuedRemaining,
        rescheduled: false,
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

  private ingestService(smcPlanConfig?: SMCPlanConfig): NonNullable<AutoMemoryMaintenanceDeps["ingestService"]> {
    return this.deps.ingestService ?? new IngestService(this.root, {
      ...this.deps,
      isProcessAlive: this.deps.isProcessAlive ?? isProcessAlive,
      smcPlanConfig,
    });
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

  private scheduler(planConfig?: SMCPlanConfig): DefaultSessionMaintenanceScheduler {
    const service = this.ingestService(planConfig);
    return new DefaultSessionMaintenanceScheduler(this.root, {
      now: this.deps.now,
      planConfig,
      indexPending: this.deps.indexPending,
      startAnchor: async (input) => service.startEligibleAnchor
        ? await service.startEligibleAnchor(input)
        : await service.start(input),
    });
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
  return projectStatePath(root, projectKey, "auto-memory-maintenance.json");
}

export function autoMemoryLogPath(root: string, projectKey: string, runId: string): string {
  return projectLogPath(root, projectKey, `${runId}.log`);
}

function lockPath(root: string, projectKey: string): string {
  return projectStatePath(root, projectKey, ".auto-memory-maintenance.lock");
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

function parseWakeKind(value: string | undefined): SessionMaintenanceWakeKind {
  return value === "session_start" || value === "explicit_maintenance" || value === "index_request"
    || value === "manual" || value === "capture"
    ? value
    : "capture";
}
