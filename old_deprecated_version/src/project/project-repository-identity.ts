import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess } from "../runtime/process.ts";

export const PROJECT_REPOSITORY_IDENTITY_REF = "repository-identity.json" as const;

export type ProjectRepositoryIdentity = {
  schema_version: 1;
  project_key: string;
  registered_repo_path: string;
  status: "available" | "unavailable";
  repository_root: string | null;
  remotes: Array<{ name: string; urls: string[] }>;
  current_branch: string | null;
  head_commit: string | null;
  diagnostics: string[];
};

export async function collectProjectRepositoryIdentity(
  projectKey: string,
  repoPath: string,
): Promise<ProjectRepositoryIdentity> {
  const base: ProjectRepositoryIdentity = {
    schema_version: 1,
    project_key: projectKey,
    registered_repo_path: resolve(repoPath),
    status: "unavailable",
    repository_root: null,
    remotes: [],
    current_branch: null,
    head_commit: null,
    diagnostics: [],
  };
  const inside = await git(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside || inside !== "true") {
    base.diagnostics.push("registered repository is not a readable Git worktree");
    return base;
  }
  base.status = "available";
  base.repository_root = await git(repoPath, ["rev-parse", "--show-toplevel"]);
  base.current_branch = await git(repoPath, ["branch", "--show-current"]);
  base.head_commit = await git(repoPath, ["rev-parse", "HEAD"]);
  const remoteNames = (await git(repoPath, ["remote"]))?.split("\n").map((name) => name.trim()).filter(Boolean) ?? [];
  for (const name of remoteNames.sort()) {
    const urls = (await git(repoPath, ["remote", "get-url", "--all", name]))
      ?.split("\n")
      .map((url) => sanitizeRemoteUrl(url.trim()))
      .filter(Boolean) ?? [];
    base.remotes.push({ name, urls: [...new Set(urls)] });
  }
  return base;
}

export async function assertRepositoryIdentityClaims(
  draftWikiDir: string,
  identity: ProjectRepositoryIdentity,
): Promise<void> {
  if (identity.remotes.length === 0) return;
  for (const file of await listMarkdownFiles(draftWikiDir)) {
    const markdown = await readFile(file, "utf8");
    for (const paragraph of markdown.split(/\n\s*\n/)) {
      if (!contradictoryNoRemoteClaim(paragraph)) continue;
      if (/\b(?:stale|outdated|contradict(?:s|ed|ory|ing)?|conflict(?:s|ed|ing)?|incorrect|unverified)\b/i.test(paragraph)) continue;
      if (/\bneeds?\b[^.\n]{0,80}\breview\b/i.test(paragraph)) continue;
      throw new Error(
        `repository identity contradiction must be labeled in ${file}: live metadata includes ${identity.remotes.map((remote) => remote.name).join(", ")} remote`,
      );
    }
  }
}

function contradictoryNoRemoteClaim(paragraph: string): boolean {
  return /\b(?:has|with)\s+no\s+(?:git\s+)?remote\b/i.test(paragraph) ||
    /\blocal-only\b[^.\n]{0,120}\b(?:repository|repo|documentation shell)\b/i.test(paragraph) ||
    /\bnot\s+a\s+remote\s+(?:product\s+)?repository\b/i.test(paragraph);
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  const result = await runProcess(["git", ...args], { cwd, timeoutMs: 10_000 });
  if (result.exitCode !== 0) return null;
  const value = result.stdout.trim();
  return value || null;
}

function sanitizeRemoteUrl(value: string): string {
  if (!value) return value;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    const scpLike = value.match(/^[^@/]+@([^:]+):(.+)$/);
    if (scpLike) return `${scpLike[1]}:${scpLike[2]}`;
    return value.replace(/(\/\/)[^/@]+@/, "$1");
  }
}

async function listMarkdownFiles(path: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const next = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await listMarkdownFiles(next));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(next);
  }
  return files;
}
