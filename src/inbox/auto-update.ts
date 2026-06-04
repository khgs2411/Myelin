import { constants } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { projectPath, resolveInside } from "../runtime/fs.ts";

export type AutoUpdateLock = {
  acquired: boolean;
  lockPath: string;
  release: () => Promise<void>;
};

export type AutoUpdateSpawnResult = {
  status: "spawned" | "skipped:already-running";
  lockPath: string;
  logPath?: string;
  pid?: number;
};

export function autoUpdateLockPath(root: string, projectKey: string): string {
  return projectPath(root, projectKey, "state", ".update.lock");
}

export function autoUpdateLogPath(root: string, projectKey: string, now: Date = new Date()): string {
  const timestamp = now.toISOString().replace(/:/g, "-");
  return projectPath(root, projectKey, "logs", `auto-update-${timestamp}.log`);
}

export async function acquireAutoUpdateLock(root: string, projectKey: string, now: Date = new Date()): Promise<AutoUpdateLock> {
  const lockPath = autoUpdateLockPath(root, projectKey);
  await mkdir(join(lockPath, ".."), { recursive: true });

  try {
    const handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    await handle.writeFile(JSON.stringify({ project_key: projectKey, pid: process.pid, acquired_at: now.toISOString() }, null, 2));
    await handle.close();
    return { acquired: true, lockPath, release: () => releaseAutoUpdateLock(root, projectKey) };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      return { acquired: false, lockPath, release: async () => {} };
    }
    throw error;
  }
}

export async function releaseAutoUpdateLock(root: string, projectKey: string): Promise<void> {
  await rm(autoUpdateLockPath(root, projectKey), { force: true });
}

export async function spawnDetachedProjectIngest(root: string, projectKey: string, now: Date = new Date()): Promise<AutoUpdateSpawnResult> {
  const lock = await acquireAutoUpdateLock(root, projectKey, now);
  if (!lock.acquired) return { status: "skipped:already-running", lockPath: lock.lockPath };

  const logPath = autoUpdateLogPath(root, projectKey, now);
  await mkdir(join(logPath, ".."), { recursive: true });

  const proc = Bun.spawn({
    cmd: ["bun", resolveInside(root, "src", "cli.ts"), "project", "ingest", projectKey],
    cwd: root,
    stdout: Bun.file(logPath),
    stderr: Bun.file(logPath),
    stdin: "ignore",
    env: {
      ...process.env,
      MYELIN_AUTO_UPDATE_LOCK: lock.lockPath,
      MYELIN_AUTO_UPDATE_PROJECT: projectKey,
    },
  });

  proc.exited.finally(async () => {
    await lock.release();
  });

  proc.unref();
  return { status: "spawned", lockPath: lock.lockPath, logPath, pid: proc.pid };
}
