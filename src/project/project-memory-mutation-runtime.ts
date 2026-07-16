import type { ProcessLivenessChecker } from "../ingest/runtime.ts";
import { isProcessAlive } from "../ingest/runtime.ts";
import type { MaintenanceRunState } from "../maintenance/maintenance-contracts.ts";
import { MaintenanceRunRuntime } from "../maintenance/maintenance-run-runtime.ts";
import { projectPath } from "../runtime/fs.ts";
import { createId } from "../runtime/ids.ts";

export class ProjectMemoryMutationRuntime {
  constructor(
    private readonly root: string,
    private readonly deps: {
      now?: () => Date;
      isProcessAlive?: ProcessLivenessChecker;
    } = {},
  ) {}

  async run<T>(input: {
    projectKey: string;
    operation: "project learn" | "project maintenance";
    task: () => Promise<T>;
  }): Promise<T> {
    const runId = `project_memory_${input.operation.replaceAll(" ", "_")}_${createId()}`;
    const runtime = this.runtime(input.projectKey);
    let lock = await runtime.tryAcquireLock(runId);
    if (!lock && await runtime.clearDeadLock("Previous Project Memory mutation process is no longer running.")) {
      lock = await runtime.tryAcquireLock(runId);
    }
    if (!lock) {
      const state = await runtime.readState();
      const activeRun = state.last_run_id ?? "unknown run";
      throw new Error(
        `Project Memory mutation already running for ${input.projectKey}: ${activeRun}. Wait for it to finish before starting ${input.operation}.`,
      );
    }

    const startedAt = this.now();
    try {
      await runtime.writeState({
        project_key: input.projectKey,
        last_run_id: runId,
        last_started_at: startedAt,
        last_status: "running",
        last_reason: input.operation,
        last_pid: process.pid,
      });
      const result = await input.task();
      await runtime.writeState({
        project_key: input.projectKey,
        last_run_id: runId,
        last_started_at: startedAt,
        last_finished_at: this.now(),
        last_status: resultFailed(result) ? "failed" : "completed",
        last_reason: resultFailed(result) ? `${input.operation} returned failed` : input.operation,
        last_pid: process.pid,
      });
      return result;
    } catch (error) {
      await runtime.writeState({
        project_key: input.projectKey,
        last_run_id: runId,
        last_started_at: startedAt,
        last_finished_at: this.now(),
        last_status: "failed",
        last_reason: error instanceof Error ? error.message : String(error),
        last_pid: process.pid,
      });
      throw error;
    } finally {
      await lock.release();
    }
  }

  private runtime(projectKey: string): MaintenanceRunRuntime<MaintenanceRunState> {
    return new MaintenanceRunRuntime({
      projectKey,
      statePath: projectMemoryMutationStatePath(this.root, projectKey),
      lockPath: projectMemoryMutationLockPath(this.root, projectKey),
      initialState: () => ({ project_key: projectKey }),
      now: () => this.now(),
      isProcessAlive: this.deps.isProcessAlive ?? isProcessAlive,
    });
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }
}

export function projectMemoryMutationStatePath(root: string, projectKey: string): string {
  return projectPath(root, projectKey, "state", "project-memory-mutation.json");
}

export function projectMemoryMutationLockPath(root: string, projectKey: string): string {
  return projectPath(root, projectKey, "state", ".project-memory-mutation.lock");
}

function resultFailed(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "status" in value && value.status === "failed");
}
