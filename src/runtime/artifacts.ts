import { mkdir } from "node:fs/promises";
import { projectPath, resolveInside } from "./fs.ts";

export function runsRoot(root: string, projectKey: string): string {
  return projectPath(root, projectKey, "runs");
}

export function runDir(root: string, projectKey: string, runId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
  return resolveInside(runsRoot(root, projectKey), runId);
}

export async function createRunDir(root: string, projectKey: string, runId = timestampRunId()): Promise<string> {
  const dir = runDir(root, projectKey, runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function timestampRunId(date = new Date()): string {
  return `${date.toISOString().replaceAll(":", "-")}-run`;
}
