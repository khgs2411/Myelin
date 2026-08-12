import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type RepoRoot = {
  root: string;
};

export function repoRoot(root: string): RepoRoot {
  return { root: resolve(root) };
}

export function resolveInside(root: string, ...segments: string[]): string {
  const base = resolve(root);
  const target = resolve(base, ...segments);
  const rel = relative(base, target);

  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return target;
  }

  throw new Error(`Path escapes repository root: ${segments.join("/")}`);
}

export async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export function projectPath(root: string, key: string, ...segments: string[]): string {
  assertProjectKey(key);
  return resolveInside(root, "projects", key, ...segments);
}

export function projectStatePath(root: string, key: string, ...segments: string[]): string {
  assertProjectKey(key);
  return resolveInside(root, "state", key, ...segments);
}

export function projectSourcesPath(root: string, key: string, ...segments: string[]): string {
  assertProjectKey(key);
  return resolveInside(root, "sources", key, ...segments);
}

export function projectRunsPath(root: string, key: string, ...segments: string[]): string {
  assertProjectKey(key);
  return resolveInside(root, "runs", key, ...segments);
}

export function normalizeRecordedProjectPath(path: string): string {
  return path
    .replace(/^projects\/([^/]+)\/logs\//, "runs/$1/logs/")
    .replace(/^projects\/([^/]+)\/runs\//, "runs/$1/")
    .replace(/^projects\/([^/]+)\/sources\//, "sources/$1/")
    .replace(/^projects\/([^/]+)\/state\//, "state/$1/")
    .replace(/^projects\/([^/]+)\/wiki\//, "projects/$1/")
    .replace(/^state\/memory\.db(?=$|-)/, "state/memory/memory.db");
}

export function normalizeRecordedCheckoutPath(root: string, path: string | null): string | null {
  if (!path) return null;
  const checkoutPath = isAbsolute(path) ? relative(root, path) : path;
  return normalizeRecordedProjectPath(checkoutPath);
}

export function assertProjectKey(key: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(key)) {
    throw new Error(`Invalid project key: ${key}`);
  }
}
