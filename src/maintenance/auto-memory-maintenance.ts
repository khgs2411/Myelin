import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openMemoryDb } from "../memory/db.ts";
import { countExperienceEvents } from "../memory/experience.ts";
import { EmbeddingProviderFactory } from "../memory/embedding-provider-factory.ts";
import { SessionMemoryIndexService } from "../memory/session-memory-index-service.ts";
import type { DetachedSpawner, ProcessLivenessChecker } from "../ingest/runtime.ts";
import { isProcessAlive } from "../ingest/runtime.ts";
import { IngestService, type IngestProvider, type IngestServiceDeps, type StartIngestResult } from "../ingest/ingest-service.ts";
import { loadConfig, type AutoMemoryMaintenanceConfig } from "../runtime/config.ts";
import { projectPath } from "../runtime/fs.ts";
import { createId } from "../runtime/ids.ts";
import { prepareProjectLogFile, projectLogPath } from "../runtime/project-logs.ts";

export type AutoMemoryMaintenanceScheduleResult =
  | { status: "disabled"; reason: string }
  | { status: "skipped"; reason: string; queued_count?: number }
  | { status: "scheduled"; project_key: string; run_id: string; pid: number | null; log_path: string; queued_count: number };

export type AutoMemoryMaintenanceRunResult = {
  status: "completed" | "failed";
  project_key: string;
  run_id: string;
  ingest_started: boolean;
  indexed: number;
  index_failed: number;
  pending_remaining: number;
  queued_remaining?: number;
  rescheduled?: boolean;
  error_message?: string;
};

export type AutoMemoryMaintenanceState = {
  project_key: string;
  last_run_id?: string;
  last_scheduled_at?: string;
  last_started_at?: string;
  last_finished_at?: string;
  last_status?: "scheduled" | "running" | "completed" | "failed" | "skipped";
  last_reason?: string;
  last_log_path?: string;
  last_pid?: number | null;
  last_check_at?: string;
  last_check_status?: "skipped";
  last_check_reason?: string;
  last_check_counts?: {
    queued_count?: number;
  };
  last_counts?: {
    queued_count?: number;
    indexed?: number;
    index_failed?: number;
    pending_remaining?: number;
    queued_remaining?: number;
    rescheduled?: boolean;
  };
};

type AutoMemoryMaintenanceIngestService = Pick<IngestService, "start" | "status">;
type AutoMemoryMaintenanceIndexResult = {
  indexed: number;
  failed: number;
  pending_remaining: number;
};

export type AutoMemoryMaintenanceDeps = IngestServiceDeps & {
  now?: () => Date;
  spawn?: DetachedSpawner;
  isProcessAlive?: ProcessLivenessChecker;
  sleep?: (ms: number) => Promise<void>;
  ingestService?: AutoMemoryMaintenanceIngestService;
  indexPending?: (input: {
    projectKey: string;
    limit: number;
    batchSize: number;
    retryFailed: boolean;
  }) => Promise<AutoMemoryMaintenanceIndexResult>;
};

type LockHandle = {
  runId: string;
  release: () => Promise<void>;
};

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
    let lock = await tryAcquireLock(this.root, projectKey, runId, this.now());
    if (!lock && await this.clearDeadLock(projectKey)) {
      lock = await tryAcquireLock(this.root, projectKey, runId, this.now());
    }
    if (!lock) return this.skip(projectKey, "maintenance already locked", { queuedCount, preserveActiveState: true });

    const logPath = autoMemoryLogPath(this.root, projectKey, runId);
    try {
      await prepareProjectLogFile(this.root, projectKey, logPath);
      const spawn = this.deps.spawn ?? ((options) => Bun.spawn(options));
      const proc = spawn({
        cmd: ["bun", join(this.root, "src", "maintenance", "worker.ts"), projectKey],
        cwd: this.root,
        stdout: Bun.file(logPath),
        stderr: Bun.file(logPath),
        stdin: "ignore",
        detached: true,
        env: {
          ...process.env,
          MYELIN_ROOT: this.root,
          MYELIN_CAPTURE_DISABLED: "1",
          MYELIN_AUTO_MEMORY_MAINTENANCE_WORKER: "1",
          MYELIN_AUTO_MEMORY_RUN_ID: runId,
          ...(forceIngest ? { MYELIN_AUTO_MEMORY_FORCE_INGEST: "1" } : {}),
        },
      });
      proc.unref();
      await writeState(this.root, projectKey, {
        project_key: projectKey,
        last_run_id: runId,
        last_scheduled_at: this.now(),
        last_status: "scheduled",
        last_log_path: logPath,
        last_pid: proc.pid ?? null,
        last_counts: { queued_count: queuedCount },
      });
      return {
        status: "scheduled",
        project_key: projectKey,
        run_id: runId,
        pid: proc.pid ?? null,
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
    const lock = await adoptOrAcquireLock(this.root, projectKey, runId, this.now());
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

  private ingestService(): AutoMemoryMaintenanceIngestService {
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
    if (config.cooldownMs <= 0) return false;
    const state = await readState(this.root, projectKey);
    const last = state.last_status === "completed" || state.last_status === "failed"
      ? state.last_finished_at
      : state.last_scheduled_at;
    if (!last) return false;
    return Date.parse(last) + config.cooldownMs > Date.parse(this.now());
  }

  private async clearDeadLock(projectKey: string): Promise<boolean> {
    const state = await readState(this.root, projectKey);
    if (state.last_status !== "scheduled" && state.last_status !== "running") return false;
    if (typeof state.last_pid !== "number") return false;
    const alive = (this.deps.isProcessAlive ?? isProcessAlive)(state.last_pid);
    if (alive) return false;
    await rm(lockPath(this.root, projectKey), { recursive: true, force: true });
    await writeState(this.root, projectKey, {
      ...state,
      last_status: "failed",
      last_finished_at: this.now(),
      last_reason: "Detached auto memory maintenance worker PID is no longer running.",
    });
    return true;
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
}

export async function readState(root: string, projectKey: string): Promise<AutoMemoryMaintenanceState> {
  try {
    const text = await readFile(statePath(root, projectKey), "utf8");
    const parsed = JSON.parse(text) as AutoMemoryMaintenanceState;
    return parsed && typeof parsed === "object" ? parsed : { project_key: projectKey };
  } catch {
    return { project_key: projectKey };
  }
}

export async function writeState(root: string, projectKey: string, state: AutoMemoryMaintenanceState): Promise<void> {
  const path = statePath(root, projectKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function statePath(root: string, projectKey: string): string {
  return projectPath(root, projectKey, "state", "auto-memory-maintenance.json");
}

export function autoMemoryLogPath(root: string, projectKey: string, runId: string): string {
  return projectLogPath(root, projectKey, `${runId}.log`);
}

async function tryAcquireLock(root: string, projectKey: string, runId: string, now: string): Promise<LockHandle | null> {
  const path = lockPath(root, projectKey);
  try {
    await mkdir(path, { recursive: false });
    await writeFile(join(path, "owner.json"), `${JSON.stringify({ run_id: runId, created_at: now }, null, 2)}\n`, "utf8");
    return { runId, release: async () => rm(path, { recursive: true, force: true }) };
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
}

async function adoptOrAcquireLock(root: string, projectKey: string, runId: string, now: string): Promise<LockHandle | null> {
  const path = lockPath(root, projectKey);
  try {
    const owner = JSON.parse(await readFile(join(path, "owner.json"), "utf8")) as { run_id?: string };
    if (owner.run_id === runId) return { runId, release: async () => rm(path, { recursive: true, force: true }) };
    return null;
  } catch {
    return await tryAcquireLock(root, projectKey, runId, now);
  }
}

function lockPath(root: string, projectKey: string): string {
  return projectPath(root, projectKey, "state", ".auto-memory-maintenance.lock");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
