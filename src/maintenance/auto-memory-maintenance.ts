import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openMemoryDb } from "../memory/db.ts";
import { countExperienceEvents } from "../memory/experience.ts";
import { EmbeddingProviderFactory } from "../memory/embedding-provider-factory.ts";
import { SessionMemoryIndexService } from "../memory/session-memory-index-service.ts";
import type { DetachedSpawner, ProcessLivenessChecker } from "../ingest/runtime.ts";
import { isProcessAlive } from "../ingest/runtime.ts";
import { IngestService, type IngestProvider, type IngestServiceDeps } from "../ingest/ingest-service.ts";
import { loadConfig, selectActiveEmbeddingContract, type AutoMemoryMaintenanceConfig } from "../runtime/config.ts";
import { projectPath } from "../runtime/fs.ts";
import { createId } from "../runtime/ids.ts";

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
  last_counts?: {
    queued_count?: number;
    indexed?: number;
    index_failed?: number;
    pending_remaining?: number;
  };
};

export type AutoMemoryMaintenanceDeps = IngestServiceDeps & {
  now?: () => Date;
  spawn?: DetachedSpawner;
  isProcessAlive?: ProcessLivenessChecker;
  sleep?: (ms: number) => Promise<void>;
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

  async maybeSchedule(projectKey: string): Promise<AutoMemoryMaintenanceScheduleResult> {
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
      if (runningJobs.count > 0) return this.skip(projectKey, "ingest already running", { queuedCount });
    } finally {
      db.close();
    }

    if (queuedCount < maintenance.minCapturedEvents) {
      return this.skip(projectKey, "below captured event threshold", { queuedCount });
    }
    if (await this.isInCooldown(projectKey, maintenance)) {
      return this.skip(projectKey, "cooldown active", { queuedCount });
    }

    const runId = `auto_memory_${createId()}`;
    let lock = await tryAcquireLock(this.root, projectKey, runId, this.now());
    if (!lock && await this.clearDeadLock(projectKey)) {
      lock = await tryAcquireLock(this.root, projectKey, runId, this.now());
    }
    if (!lock) return this.skip(projectKey, "maintenance already locked", { queuedCount });

    const logPath = autoMemoryLogPath(this.root, projectKey, runId);
    try {
      await mkdir(dirname(logPath), { recursive: true });
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

    try {
      await writeState(this.root, projectKey, {
        ...(await readState(this.root, projectKey)),
        project_key: projectKey,
        last_run_id: runId,
        last_started_at: this.now(),
        last_status: "running",
      });

      const config = await loadConfig(this.root);
      const ingestResult = await new IngestService(this.root, this.deps).start({
        projectKey,
        provider: config.defaultProvider as IngestProvider,
      });
      await this.waitForDrain(projectKey, config.autoMemoryMaintenance);

      const db = openMemoryDb(this.root);
      try {
        const contract = selectActiveEmbeddingContract(config, "retrieval_document");
        const provider = new EmbeddingProviderFactory(config).create();
        const indexResult = await new SessionMemoryIndexService({
          db,
          contract,
          provider,
        }).indexPending({
          projectKey,
          limit: config.autoMemoryMaintenance.indexLimit,
          batchSize: config.embedding.batchSize,
          retryFailed: false,
        });
        await writeState(this.root, projectKey, {
          ...(await readState(this.root, projectKey)),
          project_key: projectKey,
          last_run_id: runId,
          last_finished_at: this.now(),
          last_status: "completed",
          last_counts: {
            queued_count: ingestResult.queued_count,
            indexed: indexResult.indexed,
            index_failed: indexResult.failed,
            pending_remaining: indexResult.pending_remaining,
          },
        });
        return {
          status: "completed",
          project_key: projectKey,
          run_id: runId,
          ingest_started: ingestResult.kind === "started",
          indexed: indexResult.indexed,
          index_failed: indexResult.failed,
          pending_remaining: indexResult.pending_remaining,
        };
      } finally {
        db.close();
      }
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
      await lock.release();
    }
  }

  private async waitForDrain(projectKey: string, config: AutoMemoryMaintenanceConfig): Promise<void> {
    const started = Date.now();
    const service = new IngestService(this.root, {
      ...this.deps,
      isProcessAlive: this.deps.isProcessAlive ?? isProcessAlive,
    });
    while (Date.now() - started <= config.drainTimeoutMs) {
      const result = await service.status({ projectKey });
      if (result.kind === "project" && result.status.counts.running_jobs === 0) return;
      await (this.deps.sleep ?? sleep)(config.drainPollIntervalMs);
    }
    throw new Error(`Auto memory maintenance timed out waiting for ingest drain for ${projectKey}`);
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
    input: { queuedCount?: number } = {},
  ): Promise<AutoMemoryMaintenanceScheduleResult> {
    await writeState(this.root, projectKey, {
      ...(await readState(this.root, projectKey)),
      project_key: projectKey,
      last_status: "skipped",
      last_reason: reason,
      last_finished_at: this.now(),
      last_counts: { queued_count: input.queuedCount },
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
  return projectPath(root, projectKey, "logs", `${runId}.log`);
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
