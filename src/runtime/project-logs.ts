import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { projectPath } from "./fs.ts";

export const PROJECT_LOG_RETENTION_LIMIT = 25;

export function projectLogPath(root: string, projectKey: string, filename: string): string {
  return projectPath(root, projectKey, "logs", filename);
}

export async function prepareProjectLogFile(
  root: string,
  projectKey: string,
  logPath: string,
  limit = PROJECT_LOG_RETENTION_LIMIT,
): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await pruneProjectLogFiles(root, projectKey, logPath, limit);
}

async function pruneProjectLogFiles(
  root: string,
  projectKey: string,
  preservedPath: string,
  limit: number,
): Promise<void> {
  const logsDir = projectPath(root, projectKey, "logs");
  const preservedName = basename(preservedPath);
  const keepExisting = Math.max(0, limit - 1);

  let entries: string[];
  try {
    entries = await readdir(logsDir);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }

  const logs = [];
  for (const name of entries) {
    if (name === preservedName || !name.endsWith(".log")) continue;
    const path = join(logsDir, name);
    const info = await stat(path).catch((error) => {
      if (isNotFound(error)) return null;
      throw error;
    });
    if (!info?.isFile()) continue;
    logs.push({ name, path, mtimeMs: info.mtimeMs });
  }

  logs.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  await Promise.all(logs.slice(keepExisting).map((entry) => rm(entry.path, { force: true })));
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
