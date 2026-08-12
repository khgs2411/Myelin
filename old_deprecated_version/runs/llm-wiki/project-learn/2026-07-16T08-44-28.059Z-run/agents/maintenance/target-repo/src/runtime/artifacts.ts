import { mkdir } from "node:fs/promises";
import { projectRunsPath, resolveInside } from "./fs.ts";

export function runsRoot(root: string, projectKey: string): string {
  return projectRunsPath(root, projectKey);
}

export function runDir(root: string, projectKey: string, runId: string, command?: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
  if (!command) return resolveInside(runsRoot(root, projectKey), runId);
  assertRunCommand(command);
  return resolveInside(runsRoot(root, projectKey), command, runId);
}

export async function createRunDir(
  root: string,
  projectKey: string,
  runId = timestampRunId(),
  command?: string,
): Promise<string> {
  const dir = runDir(root, projectKey, runId, command);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function timestampRunId(date = new Date()): string {
  return `${date.toISOString().replaceAll(":", "-")}-run`;
}

function assertRunCommand(command: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(command)) {
    throw new Error(`Invalid run command: ${command}`);
  }
}
