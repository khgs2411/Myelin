import type { Database } from "bun:sqlite";
import { readdir } from "node:fs/promises";
import { isProcessAlive, resolveIngestTargetRepo } from "../ingest/runtime.ts";
import { openMemoryDb } from "../memory/db.ts";
import { discoverIndexedEmbeddingContract, readActiveEmbeddingContract } from "../memory/embedding-contract-store.ts";
import { ProjectMemoryRetrievalIndexCoordinator } from "../memory/project-memory-retrieval-index-service.ts";
import { ProjectService } from "../project/project-service.ts";
import { loadConfig, type AutoProjectMemoryMaintenanceConfig } from "../runtime/config.ts";
import { projectSourcesPath, projectStatePath } from "../runtime/fs.ts";
import { createId } from "../runtime/ids.ts";
import { prepareProjectLogFile, projectLogPath } from "../runtime/project-logs.ts";
import {
  backgroundInvocationEnv,
  backgroundLaunchContext,
  resolveMyelinCommandInvocation,
} from "../runtime/command-invocation.ts";
import {
  type AutoProjectMemoryMaintenanceCounts,
  type AutoProjectMemoryMaintenanceDeps,
  type AutoProjectMemoryMaintenanceRunResult,
  type AutoProjectMemoryMaintenanceScheduleResult,
  type AutoProjectMemoryMaintenanceScheduler,
  type AutoProjectMemoryMaintenanceState,
  type AutoProjectMemoryMaintenanceTrigger,
} from "./maintenance-contracts.ts";
import { MaintenanceRunRuntime, spawnDetachedMaintenanceWorker } from "./maintenance-run-runtime.ts";

export type {
  AutoProjectMemoryMaintenanceCounts,
  AutoProjectMemoryMaintenanceDeps,
  AutoProjectMemoryMaintenanceRunResult,
  AutoProjectMemoryMaintenanceScheduleResult,
  AutoProjectMemoryMaintenanceScheduler,
  AutoProjectMemoryMaintenanceState,
  AutoProjectMemoryMaintenanceTrigger,
} from "./maintenance-contracts.ts";

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
    const pendingRetrievalRows = this.countPendingRetrieval(projectKey);
    if (
      counts.pending_inbox_items < maintenance.minPendingItems &&
      counts.pending_project_candidates < maintenance.minPendingItems &&
      pendingRetrievalRows === 0
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
    const lock = await this.runtime(projectKey).adoptOrAcquireLock(runId);
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

      const config = await loadConfig(this.root);
      const stateBefore = await readState(this.root, projectKey);
      const retrievalOnly = stateBefore.last_trigger === "retrieval_index_pending"
        && countsBefore.pending_inbox_items < config.autoProjectMemoryMaintenance.minPendingItems
        && countsBefore.pending_project_candidates < config.autoProjectMemoryMaintenance.minPendingItems;
      const shouldCurate = !retrievalOnly;
      const result = shouldCurate
        ? await this.runMaintenance(projectKey)
        : { status: "retrieval_only", changed_files: [] };
      if (result.status === "failed") {
        throw new Error(result.stopped_reason ?? "Project Memory maintenance failed.");
      }
      if (this.countPendingRetrieval(projectKey) > 0) {
        const indexResult = await this.indexProject(projectKey);
        if (indexResult.degraded || indexResult.failed > 0 || indexResult.pending_remaining > 0) {
          throw new Error(
            indexResult.degraded_reason
              ?? `Project Memory retrieval indexing incomplete: ${indexResult.failed} failed, ${indexResult.pending_remaining} pending`,
          );
        }
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
    const runtime = this.runtime(projectKey);
    let lock = await runtime.tryAcquireLock(runId);
    if (!lock && await runtime.clearDeadLock("Detached auto project memory maintenance worker PID is no longer running.")) {
      lock = await runtime.tryAcquireLock(runId);
    }
    if (!lock) return this.skip(projectKey, "project memory maintenance already locked", { counts, trigger, preserveActiveState: true });

    const logPath = autoProjectMemoryLogPath(this.root, projectKey, runId);
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
        command: resolveMyelinCommandInvocation(context, ["maintenance", "worker", "project", projectKey]),
        cwd: targetRepo,
        logPath,
        env: {
          ...process.env,
          ...backgroundInvocationEnv(context, "worker"),
          MYELIN_CAPTURE_DISABLED: "1",
          MYELIN_AUTO_PROJECT_MEMORY_MAINTENANCE_WORKER: "1",
          MYELIN_AUTO_PROJECT_MEMORY_RUN_ID: runId,
        },
      });
      await writeState(this.root, projectKey, {
        project_key: projectKey,
        last_run_id: runId,
        last_scheduled_at: this.now(),
        last_status: "scheduled",
        last_trigger: trigger,
        last_log_path: logPath,
        last_pid: proc.pid,
        last_counts: counts,
      });
      return {
        status: "scheduled",
        project_key: projectKey,
        run_id: runId,
        pid: proc.pid,
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

  private countPendingRetrieval(projectKey: string): number {
    const db = openMemoryDb(this.root);
    try {
      const active = readActiveEmbeddingContract(db, "project_memory")
        ?? discoverIndexedEmbeddingContract(db, "project_memory")?.contract;
      if (!active) return 0;
      return (db.query(
        `SELECT count(*) AS count
         FROM project_memory_retrieval_embeddings
         WHERE project_key = ?
           AND embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ?
           AND embedding_purpose = 'retrieval_document' AND format_version = ?
           AND status = 'pending'`,
      ).get(projectKey, active.provider, active.model, active.dimensions, active.formatVersion) as { count: number }).count;
    } finally {
      db.close();
    }
  }

  private async isInCooldown(projectKey: string, config: AutoProjectMemoryMaintenanceConfig): Promise<boolean> {
    return await this.runtime(projectKey).isInCooldown(config.cooldownMs);
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

  private async indexProject(projectKey: string): Promise<{ indexed: number; failed: number; pending_remaining: number; degraded: boolean; degraded_reason?: string }> {
    if (this.deps.indexProject) return this.deps.indexProject(projectKey);
    let indexed = 0;
    while (true) {
      const result = await new ProjectMemoryRetrievalIndexCoordinator({ root: this.root }).indexProject({
        projectKey,
        limit: 500,
        retryFailed: false,
      });
      indexed += result.indexed;
      if (result.degraded || result.failed > 0 || result.pending_remaining === 0 || result.indexed === 0) {
        return { ...result, indexed };
      }
    }
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }

  private runtime(projectKey: string): MaintenanceRunRuntime<AutoProjectMemoryMaintenanceState> {
    return maintenanceRuntime(this.root, projectKey, () => this.now(), this.deps.isProcessAlive ?? isProcessAlive);
  }
}

export async function readState(root: string, projectKey: string): Promise<AutoProjectMemoryMaintenanceState> {
  return await maintenanceRuntime(root, projectKey).readState();
}

export async function writeState(root: string, projectKey: string, state: AutoProjectMemoryMaintenanceState): Promise<void> {
  await maintenanceRuntime(root, projectKey).writeState(state);
}

export function statePath(root: string, projectKey: string): string {
  return projectStatePath(root, projectKey, "auto-project-memory-maintenance.json");
}

export function autoProjectMemoryLogPath(root: string, projectKey: string, runId: string): string {
  return projectLogPath(root, projectKey, `${runId}.log`);
}

async function countPendingRuntimeInboxItems(root: string, projectKey: string, db: Database): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(projectSourcesPath(root, projectKey, "inbox"));
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

function lockPath(root: string, projectKey: string): string {
  return projectStatePath(root, projectKey, ".auto-project-memory-maintenance.lock");
}

function maintenanceRuntime(
  root: string,
  projectKey: string,
  now: () => string = () => new Date().toISOString(),
  alive: (pid: number) => boolean = isProcessAlive,
): MaintenanceRunRuntime<AutoProjectMemoryMaintenanceState> {
  return new MaintenanceRunRuntime({
    projectKey,
    statePath: statePath(root, projectKey),
    lockPath: lockPath(root, projectKey),
    initialState: () => ({ project_key: projectKey }),
    now,
    isProcessAlive: alive,
  });
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
