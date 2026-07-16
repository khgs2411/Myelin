import { projectStatePath } from "./fs.ts";
import { readJson, readJsonIfExists, writeJson } from "./json.ts";

export function statePath(root: string, projectKey: string, name: string): string {
  if (name.includes("/") || name.includes("\\")) throw new Error(`State file must be a file name: ${name}`);
  if (!name.endsWith(".json")) throw new Error(`State file must be JSON: ${name}`);
  return projectStatePath(root, projectKey, name);
}

export async function readProjectState<T>(root: string, projectKey: string, name: string): Promise<T> {
  return await readJson<T>(statePath(root, projectKey, name));
}

export async function readProjectStateIfExists<T>(
  root: string,
  projectKey: string,
  name: string,
): Promise<T | null> {
  return await readJsonIfExists<T>(statePath(root, projectKey, name));
}

export async function writeProjectState(root: string, projectKey: string, name: string, value: unknown): Promise<void> {
  await writeJson(statePath(root, projectKey, name), value);
}
