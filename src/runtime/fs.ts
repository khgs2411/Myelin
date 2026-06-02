import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type RepoRoot = {
  root: string;
};

export function repoRoot(root: string = process.cwd()): RepoRoot {
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

export function assertProjectKey(key: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(key)) {
    throw new Error(`Invalid project key: ${key}`);
  }
}
