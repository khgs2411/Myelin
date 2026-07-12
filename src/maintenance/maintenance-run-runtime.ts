import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DetachedSpawner, ProcessLivenessChecker } from "../ingest/runtime.ts";
import { readJsonIfExists, writeJson } from "../runtime/json.ts";
import type { MaintenanceRunState } from "./maintenance-contracts.ts";

type LockOwner = {
  run_id: string;
  created_at: string;
};

export type MaintenanceRunLock = {
  runId: string;
  release: () => Promise<void>;
};

export function spawnDetachedMaintenanceWorker(input: {
  spawn: DetachedSpawner;
  command: string[];
  cwd: string;
  logPath: string;
  env: NodeJS.ProcessEnv;
}): { pid: number | null } {
  const proc = input.spawn({
    cmd: input.command,
    cwd: input.cwd,
    stdout: Bun.file(input.logPath),
    stderr: Bun.file(input.logPath),
    stdin: "ignore",
    detached: true,
    env: input.env,
  });
  proc.unref();
  return { pid: proc.pid ?? null };
}

export class MaintenanceRunRuntime<State extends MaintenanceRunState> {
  constructor(
    private readonly input: {
      projectKey: string;
      statePath: string;
      lockPath: string;
      initialState: () => State;
      now: () => string;
      isProcessAlive: ProcessLivenessChecker;
    },
  ) {}

  async readState(): Promise<State> {
    const value = await readJsonIfExists<unknown>(this.input.statePath);
    if (value === null) return this.input.initialState();
    if (!isRecord(value) || value.project_key !== this.input.projectKey) {
      throw new Error(`Invalid maintenance state: ${this.input.statePath}`);
    }
    return value as State;
  }

  async writeState(state: State): Promise<void> {
    if (state.project_key !== this.input.projectKey) {
      throw new Error(`Maintenance state project mismatch: expected ${this.input.projectKey}, got ${state.project_key}`);
    }
    await writeJson(this.input.statePath, state);
  }

  async isInCooldown(cooldownMs: number): Promise<boolean> {
    if (cooldownMs <= 0) return false;
    const state = await this.readState();
    const last = state.last_status === "completed" || state.last_status === "failed"
      ? state.last_finished_at
      : state.last_scheduled_at;
    if (!last) return false;
    const lastTime = Date.parse(last);
    const currentTime = Date.parse(this.input.now());
    if (!Number.isFinite(lastTime) || !Number.isFinite(currentTime)) {
      throw new Error(`Invalid maintenance timestamp in ${this.input.statePath}`);
    }
    return lastTime + cooldownMs > currentTime;
  }

  async tryAcquireLock(runId: string): Promise<MaintenanceRunLock | null> {
    await mkdir(dirname(this.input.lockPath), { recursive: true });
    try {
      await mkdir(this.input.lockPath, { recursive: false });
    } catch (error) {
      if (hasCode(error, "EEXIST")) return null;
      throw error;
    }

    try {
      await writeJson(join(this.input.lockPath, "owner.json"), {
        run_id: runId,
        created_at: this.input.now(),
      } satisfies LockOwner);
      return this.lockHandle(runId);
    } catch (error) {
      await rm(this.input.lockPath, { recursive: true, force: true });
      throw error;
    }
  }

  async adoptOrAcquireLock(runId: string): Promise<MaintenanceRunLock | null> {
    const owner = await readJsonIfExists<unknown>(join(this.input.lockPath, "owner.json"));
    if (owner === null) return await this.tryAcquireLock(runId);
    if (!isLockOwner(owner)) throw new Error(`Invalid maintenance lock owner: ${this.input.lockPath}`);
    return owner.run_id === runId ? this.lockHandle(runId) : null;
  }

  async clearDeadLock(reason: string): Promise<boolean> {
    const state = await this.readState();
    if (state.last_status !== "scheduled" && state.last_status !== "running") return false;
    if (typeof state.last_pid !== "number" || this.input.isProcessAlive(state.last_pid)) return false;
    await rm(this.input.lockPath, { recursive: true, force: true });
    await this.writeState({
      ...state,
      last_status: "failed",
      last_finished_at: this.input.now(),
      last_reason: reason,
    });
    return true;
  }

  private lockHandle(runId: string): MaintenanceRunLock {
    return {
      runId,
      release: async () => {
        const owner = await readJsonIfExists<unknown>(join(this.input.lockPath, "owner.json"));
        if (owner === null) return;
        if (!isLockOwner(owner)) throw new Error(`Invalid maintenance lock owner: ${this.input.lockPath}`);
        if (owner.run_id !== runId) return;
        await rm(this.input.lockPath, { recursive: true, force: true });
      },
    };
  }
}

function isLockOwner(value: unknown): value is LockOwner {
  return isRecord(value) && typeof value.run_id === "string" && typeof value.created_at === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
