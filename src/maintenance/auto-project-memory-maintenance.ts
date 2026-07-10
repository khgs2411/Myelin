import type { Database } from "bun:sqlite";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DetachedSpawner, ProcessLivenessChecker } from "../ingest/runtime.ts";
import { isProcessAlive } from "../ingest/runtime.ts";
import { openMemoryDb } from "../memory/db.ts";
import { ProjectService } from "../project/project-service.ts";
import { loadConfig, type AutoProjectMemoryMaintenanceConfig } from "../runtime/config.ts";
import { projectPath } from "../runtime/fs.ts";
import { createId } from "../runtime/ids.ts";
import { prepareProjectLogFile, projectLogPath } from "../runtime/project-logs.ts";

export type AutoProjectMemoryMaintenanceTrigger = "runtime_inbox_created" | "session_memory_candidate_created";

export type AutoProjectMemoryMaintenanceCounts = {
  pending_inbox_items: number;
  pending_project_candidates: number;
};

export type AutoProjectMemoryMaintenanceScheduleResult =
  | { status: "disabled"; reason: string }
  | { status: "skipped"; reason: string; counts?: AutoProjectMemoryMaintenanceCounts }
  | {
    status: "scheduled";
    project_key: string;
    run_id: string;
    pid: number | null;
    log_path: string;
    trigger: AutoProjectMemoryMaintenanceTrigger;
    counts: AutoProjectMemoryMaintenanceCounts;
  };

export type AutoProjectMemoryMaintenanceRunResult = {
  status: "completed" | "failed";
  project_key: string;
  run_id: string;
  maintenance_status?: string;
  changed_files: string[];
  counts_before: AutoProjectMemoryMaintenanceCounts;
  counts_after: AutoProjectMemoryMaintenanceCounts;
  error_message?: string;
};

export type AutoProjectMemoryMaintenanceState = {
  project_key: string;
  last_run_id?: string;
  last_scheduled_at?: string;
  last_started_at?: string;
  last_finished_at?: string;
  last_status?: "scheduled" | "running" | "completed" | "failed" | "skipped";
  last_reason?: string;
  last_trigger?: AutoProjectMemoryMaintenanceTrigger;
  last_log_path?: string;
  last_pid?: number | null;
  last_counts?: Partial<AutoProjectMemoryMaintenanceCounts> & {
    pending_inbox_items_after?: number;
    pending_project_candidates_after?: number;
  };
};

export type AutoProjectMemoryMaintenanceScheduler = {
  maybeSchedule: (
    projectKey: string,
    trigger: AutoProjectMemoryMaintenanceTrigger,
  ) => Promise<AutoProjectMemoryMaintenanceScheduleResult>;
};

type AutoProjectMemoryMaintenanceDeps = {
  now?: () => Date;
  spawn?: DetachedSpawner;
  isProcessAlive?: ProcessLivenessChecker;
  runMaintenance?: (projectKey: string) => Promise<{ status: string; changed_files?: string[]; stopped_reason?: string }>;
};

type LockHandle = {
  runId: string;
  release: () => Promise<void>;
};

export class AutoProjectMemoryMaintenanceService implements AutoProjectMemoryMaintenanceScheduler {
  constructor(
    private readonly root: string,
    private readonly deps: AutoProjectMemoryMaintenanceDeps = {},
  ) {}

  async maybeSchedule(
    projectKey: string,
    trigger: AutoProjectMemoryMaintenanceTrigger,
  ): Promise<AutoProjectMemoryMaintenanceScheduleResult> {
    const config = await loadConfig(this.root);
    const maintenance = config.autoProjectMemoryMaintenance;
    if (!maintenance.enabled) {
      return { status: "disabled", reason: "AUTO_PROJECT_MEMORY_MAINTENANCE is not enabled" };
    }
    if (process.env.MYELIN_AUTO_PROJECT_MEMORY_MAINTENANCE_WORKER === "1") {
      return { status: "skipped", reason: "project memory maintenance worker cannot schedule itself" };
    }

    const counts = await this.countPending(projectKey);
    if (
      counts.pending_inbox_items < maintenance.minPendingItems &&
      counts.pending_project_candidates < maintenance.minPendingItems
    ) {
      return this.skip(projectKey, "below project memory maintenance threshold", { counts, trigger });
    }
    if (await this.isInCooldown(projectKey, maintenance)) {
      return this.skip(projectKey, "cooldown active", { counts, trigger });
    }

    return this.scheduleDetachedWorker(projectKey, trigger, counts);
  }

  async run(
    projectKey: string,
    runId = process.env.MYELIN_AUTO_PROJECT_MEMORY_RUN_ID ?? `auto_project_memory_${createId()}`,
  ): Promise<AutoProjectMemoryMaintenanceRunResult> {
    const lock = await adoptOrAcquireLock(this.root, projectKey, runId, this.now());
    if (!lock) {
      return {
        status: "failed",
        project_key: projectKey,
        run_id: runId,
        changed_files: [],
        counts_before: { pending_inbox_items: 0, pending_project_candidates: 0 },
        counts_after: { pending_inbox_items: 0, pending_project_candidates: 0 },
        error_message: "maintenance already locked",
      };
    }

    const countsBefore = await this.countPending(projectKey);
    try {
      await writeState(this.root, projectKey, {
        ...(await readState(this.root, projectKey)),
        project_key: projectKey,
        last_run_id: runId,
        last_started_at: this.now(),
        last_status: "running",
        last_counts: countsBefore,
      });

      const result = await this.runMaintenance(projectKey);
      if (result.status === "failed") {
        throw new Error(result.stopped_reason ?? "Project Memory maintenance failed.");
      }
      const countsAfter = await this.countPending(projectKey);
      await writeState(this.root, projectKey, {
        ...(await readState(this.root, projectKey)),
        project_key: projectKey,
        last_run_id: runId,
        last_finished_at: this.now(),
        last_status: "completed",
        last_counts: {
          ...countsBefore,
          pending_inbox_items_after: countsAfter.pending_inbox_items,
          pending_project_candidates_after: countsAfter.pending_project_candidates,
        },
      });
      return {
        status: "completed",
        project_key: projectKey,
        run_id: runId,
        maintenance_status: result.status,
        changed_files: result.changed_files ?? [],
        counts_before: countsBefore,
        counts_after: countsAfter,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const countsAfter = await this.countPending(projectKey).catch(() => countsBefore);
      await writeState(this.root, projectKey, {
        ...(await readState(this.root, projectKey)),
        project_key: projectKey,
        last_run_id: runId,
        last_finished_at: this.now(),
        last_status: "failed",
        last_reason: message,
        last_counts: {
          ...countsBefore,
          pending_inbox_items_after: countsAfter.pending_inbox_items,
          pending_project_candidates_after: countsAfter.pending_project_candidates,
        },
      });
      return {
        status: "failed",
        project_key: projectKey,
        run_id: runId,
        changed_files: [],
        counts_before: countsBefore,
        counts_after: countsAfter,
        error_message: message,
      };
    } finally {
      await lock.release();
    }
  }

  private async scheduleDetachedWorker(
    projectKey: string,
    trigger: AutoProjectMemoryMaintenanceTrigger,
    counts: AutoProjectMemoryMaintenanceCounts,
  ): Promise<AutoProjectMemoryMaintenanceScheduleResult> {
    const runId = `auto_project_memory_${createId()}`;
    let lock = await tryAcquireLock(this.root, projectKey, runId, this.now());
    if (!lock && await this.clearDeadLock(projectKey)) {
      lock = await tryAcquireLock(this.root, projectKey, runId, this.now());
    }
    if (!lock) return this.skip(projectKey, "project memory maintenance already locked", { counts, trigger, preserveActiveState: true });

    const logPath = autoProjectMemoryLogPath(this.root, projectKey, runId);
    try {
      await prepareProjectLogFile(this.root, projectKey, logPath);
      const spawn = this.deps.spawn ?? ((options) => Bun.spawn(options));
      const proc = spawn({
        cmd: ["bun", join(this.root, "src", "maintenance", "project-memory-worker.ts"), projectKey],
        cwd: this.root,
        stdout: Bun.file(logPath),
        stderr: Bun.file(logPath),
        stdin: "ignore",
        detached: true,
        env: {
          ...process.env,
          MYELIN_ROOT: this.root,
          MYELIN_CAPTURE_DISABLED: "1",
          MYELIN_AUTO_PROJECT_MEMORY_MAINTENANCE_WORKER: "1",
          MYELIN_AUTO_PROJECT_MEMORY_RUN_ID: runId,
        },
      });
      proc.unref();
      await writeState(this.root, projectKey, {
        project_key: projectKey,
        last_run_id: runId,
        last_scheduled_at: this.now(),
        last_status: "scheduled",
        last_trigger: trigger,
        last_log_path: logPath,
        last_pid: proc.pid ?? null,
        last_counts: counts,
      });
      return {
        status: "scheduled",
        project_key: projectKey,
        run_id: runId,
        pid: proc.pid ?? null,
        log_path: logPath,
        trigger,
        counts,
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
        last_trigger: trigger,
        last_log_path: logPath,
        last_counts: counts,
      });
      return { status: "skipped", reason: `launch failed: ${message}`, counts };
    }
  }

  async countPending(projectKey: string): Promise<AutoProjectMemoryMaintenanceCounts> {
    const db = openMemoryDb(this.root);
    try {
      return {
        pending_inbox_items: await countPendingRuntimeInboxItems(this.root, projectKey, db),
        pending_project_candidates: countPendingProjectCandidates(db, projectKey),
      };
    } finally {
      db.close();
    }
  }

  private async isInCooldown(projectKey: string, config: AutoProjectMemoryMaintenanceConfig): Promise<boolean> {
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
      last_reason: "Detached auto project memory maintenance worker PID is no longer running.",
    });
    return true;
  }

  private async skip(
    projectKey: string,
    reason: string,
    input: {
      counts?: AutoProjectMemoryMaintenanceCounts;
      trigger?: AutoProjectMemoryMaintenanceTrigger;
      preserveActiveState?: boolean;
    } = {},
  ): Promise<AutoProjectMemoryMaintenanceScheduleResult> {
    const state = await readState(this.root, projectKey);
    const preserveStatus = input.preserveActiveState && (state.last_status === "scheduled" || state.last_status === "running");
    await writeState(this.root, projectKey, {
      ...state,
      project_key: projectKey,
      last_status: preserveStatus ? state.last_status : "skipped",
      last_reason: reason,
      last_trigger: input.trigger,
      last_finished_at: this.now(),
      last_counts: input.counts,
    });
    return { status: "skipped", reason, counts: input.counts };
  }

  private async runMaintenance(projectKey: string): Promise<{ status: string; changed_files?: string[]; stopped_reason?: string }> {
    if (this.deps.runMaintenance) return this.deps.runMaintenance(projectKey);
    const config = await loadConfig(this.root);
    return await new ProjectService(this.root).runProjectMaintenance({
      projectKey,
      dryRun: false,
      review: false,
      provider: config.defaultProvider,
    });
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }
}

export async function readState(root: string, projectKey: string): Promise<AutoProjectMemoryMaintenanceState> {
  try {
    const text = await readFile(statePath(root, projectKey), "utf8");
    const parsed = JSON.parse(text) as AutoProjectMemoryMaintenanceState;
    return parsed && typeof parsed === "object" ? parsed : { project_key: projectKey };
  } catch {
    return { project_key: projectKey };
  }
}

export async function writeState(root: string, projectKey: string, state: AutoProjectMemoryMaintenanceState): Promise<void> {
  const path = statePath(root, projectKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function statePath(root: string, projectKey: string): string {
  return projectPath(root, projectKey, "state", "auto-project-memory-maintenance.json");
}

export function autoProjectMemoryLogPath(root: string, projectKey: string, runId: string): string {
  return projectLogPath(root, projectKey, `${runId}.log`);
}

async function countPendingRuntimeInboxItems(root: string, projectKey: string, db: Database): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(projectPath(root, projectKey, "sources", "inbox"));
  } catch (error) {
    if (isNotFound(error)) return 0;
    throw error;
  }

  let count = 0;
  for (const entry of entries) {
    const itemId = runtimeInboxItemId(entry);
    if (!itemId) continue;
    const candidateId = `project_inbox:${projectKey}:${itemId}`;
    const existing = db.query("SELECT status FROM memory_candidates WHERE id = ? AND project_key = ?").get(candidateId, projectKey) as { status: string } | null;
    if (!existing) count += 1;
  }
  return count;
}

function countPendingProjectCandidates(db: Database, projectKey: string): number {
  const row = db
    .query(
      "SELECT count(*) AS count FROM memory_candidates WHERE project_key = ? AND scope = 'project' AND status IN ('pending', 'needs_review')",
    )
    .get(projectKey) as { count: number };
  return row.count;
}

function runtimeInboxItemId(filename: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d{3})?Z_[0-9a-f]{6}\.json$/.test(filename)) return null;
  return filename.slice(0, -".json".length);
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
  return projectPath(root, projectKey, "state", ".auto-project-memory-maintenance.lock");
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
