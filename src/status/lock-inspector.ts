import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { LockStatus, OperationalState } from "./contracts.ts";

export type MaintenanceStateRecord = {
  last_run_id?: string;
  last_status?: string;
  last_pid?: number | null;
  last_log_path?: string;
};

export type LockInspection = { lock: LockStatus; state: OperationalState; reason: string | null; createdAt: string | null };

export async function inspectLock(input: {
  root: string;
  lockPath: string;
  state: MaintenanceStateRecord | null;
  isAlive: (pid: number) => boolean;
}): Promise<LockInspection> {
  const renderedPath = relative(input.root, input.lockPath);
  const activeState = input.state?.last_status === "scheduled" || input.state?.last_status === "running";
  let exists = false;
  try {
    exists = (await stat(input.lockPath)).isDirectory();
  } catch (error) {
    if (!hasCode(error, "ENOENT")) {
      return stale(renderedPath, null, null, `Cannot inspect lock: ${message(error)}`);
    }
  }

  if (!exists) {
    if (activeState) return stale(renderedPath, input.state?.last_run_id ?? null, input.state?.last_pid ?? null, "Active maintenance state has no lock.");
    return { lock: { lifecycle: "absent", path: renderedPath, run_id: null, pid: null }, state: "healthy", reason: null, createdAt: null };
  }

  let owner: { run_id?: unknown; created_at?: unknown };
  try {
    const parsed = JSON.parse(await readFile(join(input.lockPath, "owner.json"), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("owner is not an object");
    owner = parsed;
  } catch (error) {
    return stale(renderedPath, null, input.state?.last_pid ?? null, `Malformed lock owner: ${message(error)}`);
  }
  const runId = typeof owner.run_id === "string" && owner.run_id ? owner.run_id : null;
  const createdAt = typeof owner.created_at === "string" ? owner.created_at : null;
  const pid = Number.isInteger(input.state?.last_pid) && (input.state?.last_pid ?? 0) > 0 ? input.state!.last_pid! : null;
  if (!runId) return stale(renderedPath, null, pid, "Lock owner has no run id.", createdAt);
  if (!activeState) return stale(renderedPath, runId, pid, "Lock exists while maintenance state is not active.", createdAt);
  if (runId !== input.state?.last_run_id) return stale(renderedPath, runId, pid, "Lock run id does not match maintenance state.", createdAt);
  if (pid === null) return stale(renderedPath, runId, null, "Active lock has no recorded PID.", createdAt);
  if (!input.isAlive(pid)) return stale(renderedPath, runId, pid, "Recorded maintenance owner is not alive.", createdAt);
  return { lock: { lifecycle: "active", path: renderedPath, run_id: runId, pid }, state: "healthy", reason: null, createdAt };
}

function stale(path: string, runId: string | null, pid: number | null, reason: string, createdAt: string | null = null): LockInspection {
  return { lock: { lifecycle: "stale", path, run_id: runId, pid }, state: "blocked", reason, createdAt };
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
