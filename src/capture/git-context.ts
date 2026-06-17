import { resolve } from "node:path";
import { runProcess, type RunProcessResult } from "../runtime/process.ts";

export type GitWorktreeContext = {
  repo_path: string | null;
  git_branch: string | null;
  git_commit: string | null;
  git_worktree_id: string | null;
};

export type GitContextRunner = (command: string[], options?: { cwd?: string }) => Promise<RunProcessResult>;

export async function readGitWorktreeContext(
  repoPath: string | null,
  runner: GitContextRunner = (command, options) => runProcess(command, options),
): Promise<GitWorktreeContext> {
  if (!repoPath) {
    return { repo_path: null, git_branch: null, git_commit: null, git_worktree_id: null };
  }

  const resolvedRepoPath = resolve(repoPath);
  const [branch, commit] = await Promise.all([
    readGitValue(["git", "branch", "--show-current"], resolvedRepoPath, runner),
    readGitValue(["git", "rev-parse", "HEAD"], resolvedRepoPath, runner),
  ]);

  return {
    repo_path: resolvedRepoPath,
    git_branch: branch,
    git_commit: commit,
    git_worktree_id: resolvedRepoPath,
  };
}

async function readGitValue(command: string[], cwd: string, runner: GitContextRunner): Promise<string | null> {
  try {
    const result = await runner(command, { cwd });
    if (result.exitCode !== 0) return null;
    const value = result.stdout.trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}
