import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RunProcessResult } from "../runtime/process.ts";
import { runProcess } from "../runtime/process.ts";
import { findProject } from "../runtime/projects.ts";
import { updateIngestJobStatus } from "./jobs.ts";

export type RuntimeProcessRunner = (command: string[], options?: { cwd?: string }) => Promise<RunProcessResult>;

export type DetachedIngestSpawnResult = {
  pid: number | null;
  logPath: string;
};

export type DetachedSpawner = (options: {
  cmd: string[];
  cwd: string;
  stdout: ReturnType<typeof Bun.file>;
  stderr: ReturnType<typeof Bun.file>;
  stdin: "ignore";
  env: Record<string, string | undefined>;
}) => {
  pid?: number;
  unref: () => void;
};

export async function resolveIngestTargetRepo(root: string, projectKey: string): Promise<string> {
  const project = await findProject(root, projectKey);
  const repoPath = project.config.repo_paths?.[0];
  if (!repoPath) throw new Error(`Project ${projectKey} has no repo_paths entry`);
  return repoPath;
}

export async function currentGitBranch(
  cwd: string,
  runner: RuntimeProcessRunner = (command, options) => runProcess(command, options),
): Promise<string> {
  const result = await runner(["git", "branch", "--show-current"], { cwd });
  if (result.exitCode !== 0) throw new Error(`Unable to read git branch in ${cwd}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export async function assertMasterBranch(
  cwd: string,
  runner?: RuntimeProcessRunner,
): Promise<{ ok: true; branch: "master" } | { ok: false; branch: string }> {
  const branch = await currentGitBranch(cwd, runner);
  return branch === "master" ? { ok: true, branch: "master" } : { ok: false, branch };
}

export function ingestJobLogPath(root: string, projectKey: string, jobId: string): string {
  return join(root, "projects", projectKey, "logs", `ingest-${jobId}.log`);
}

export async function spawnDetachedIngestWorker(input: {
  root: string;
  projectKey: string;
  jobId: string;
  targetRepo: string;
  logPath: string;
  env?: NodeJS.ProcessEnv;
  spawn?: DetachedSpawner;
}): Promise<DetachedIngestSpawnResult> {
  await mkdir(join(input.logPath, ".."), { recursive: true });

  const spawn = input.spawn ?? ((options) => Bun.spawn(options));
  const proc = spawn({
    cmd: ["bun", join(input.root, "src", "cli.ts"), "ingest", "worker", input.jobId],
    cwd: input.targetRepo,
    stdout: Bun.file(input.logPath),
    stderr: Bun.file(input.logPath),
    stdin: "ignore",
    env: {
      ...(input.env ?? process.env),
      MYELIN_ROOT: input.root,
      MYELIN_INGEST_JOB_ID: input.jobId,
      MYELIN_INGEST_PROJECT: input.projectKey,
    },
  });
  proc.unref();
  return { pid: proc.pid ?? null, logPath: input.logPath };
}

export async function launchDetachedIngestWorker(input: {
  db: Database;
  root: string;
  projectKey: string;
  jobId: string;
  now: string;
  env?: NodeJS.ProcessEnv;
  runner?: RuntimeProcessRunner;
  spawn?: DetachedSpawner;
}): Promise<{ status: "running"; pid: number | null; logPath: string } | { status: "failed"; branch: string }> {
  const targetRepo = await resolveIngestTargetRepo(input.root, input.projectKey);
  const branch = await assertMasterBranch(targetRepo, input.runner);

  if (!branch.ok) {
    updateIngestJobStatus(input.db, {
      id: input.jobId,
      status: "failed",
      updated_at: input.now,
      finished_at: input.now,
      error: {
        code: "target_branch_mismatch",
        expected_branch: "master",
        actual_branch: branch.branch,
        target_repo: targetRepo,
      },
    });
    return { status: "failed", branch: branch.branch };
  }

  const logPath = ingestJobLogPath(input.root, input.projectKey, input.jobId);
  const spawned = await spawnDetachedIngestWorker({
    root: input.root,
    projectKey: input.projectKey,
    jobId: input.jobId,
    targetRepo,
    logPath,
    env: input.env,
    spawn: input.spawn,
  });

  updateIngestJobStatus(input.db, {
    id: input.jobId,
    status: "running",
    updated_at: input.now,
    started_at: input.now,
    followup_state: {
      pid: spawned.pid,
      log_path: spawned.logPath,
      target_repo: targetRepo,
      branch: "master",
    },
  });

  return { status: "running", pid: spawned.pid, logPath: spawned.logPath };
}
