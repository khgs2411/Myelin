import type { Database } from "bun:sqlite";
import { appendFile } from "node:fs/promises";
import type { IngestJobRow } from "../memory/ingest-types.ts";
import type { RunProcessResult } from "../runtime/process.ts";
import { runProcess } from "../runtime/process.ts";
import { prepareProjectLogFile, projectLogPath } from "../runtime/project-logs.ts";
import { findProject } from "../runtime/projects.ts";
import { getIngestJob, updateIngestJobStatus } from "./jobs.ts";
import type { LaunchContext } from "../runtime/launch-context.ts";
import {
  backgroundInvocationEnv,
  backgroundLaunchContext,
  resolveMyelinCommandInvocation,
} from "../runtime/command-invocation.ts";

export type RuntimeProcessRunner = (command: string[], options?: { cwd?: string }) => Promise<RunProcessResult>;
export type ProcessLivenessChecker = (pid: number) => boolean;

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
  detached: true;
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

export async function readCurrentGitBranch(cwd: string, runner?: RuntimeProcessRunner): Promise<string | null> {
  try {
    return await currentGitBranch(cwd, runner);
  } catch {
    return null;
  }
}

export function ingestJobLogPath(root: string, projectKey: string, jobId: string): string {
  return projectLogPath(root, projectKey, `ingest-${jobId}.log`);
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    );
  }
}

export function refreshDetachedIngestJobStatus(input: {
  db: Database;
  job: IngestJobRow;
  now: string;
  isAlive?: ProcessLivenessChecker;
}): IngestJobRow {
  if (input.job.status !== "running") return input.job;

  const followup = parseFollowupState(input.job.followup_state_json);
  const pid = typeof followup?.pid === "number" ? followup.pid : null;
  if (pid === null || (input.isAlive ?? isProcessAlive)(pid)) return input.job;

  return updateIngestJobStatus(input.db, {
    id: input.job.id,
    status: "failed",
    updated_at: input.now,
    finished_at: input.now,
    error: {
      code: "detached_worker_exited",
      message: "Detached ingest worker PID is no longer running before the job reached a terminal status.",
      pid,
      log_path: followup?.log_path,
    },
  });
}

export async function spawnDetachedIngestWorker(input: {
  root: string;
  projectKey: string;
  jobId: string;
  targetRepo: string;
  logPath: string;
  env?: NodeJS.ProcessEnv;
  spawn?: DetachedSpawner;
  context?: LaunchContext;
}): Promise<DetachedIngestSpawnResult> {
  await prepareProjectLogFile(input.root, input.projectKey, input.logPath);

  const spawn = input.spawn ?? ((options) => Bun.spawn(options));
  const context = backgroundLaunchContext({
    myelinRoot: input.root,
    callerCwd: input.targetRepo,
    context: input.context,
    env: input.env,
  });
  const proc = spawn({
    cmd: resolveMyelinCommandInvocation(context, ["ingest", "worker", input.jobId]),
    cwd: input.targetRepo,
    stdout: Bun.file(input.logPath),
    stderr: Bun.file(input.logPath),
    stdin: "ignore",
    detached: true,
    env: {
      ...(input.env ?? process.env),
      ...backgroundInvocationEnv(context, "worker"),
      MYELIN_INGEST_JOB_ID: input.jobId,
      MYELIN_INGEST_PROJECT: input.projectKey,
      MYELIN_CAPTURE_DISABLED: "1",
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
  context?: LaunchContext;
}): Promise<{ status: "running"; pid: number | null; logPath: string; branch: string | null }> {
  const targetRepo = await resolveIngestTargetRepo(input.root, input.projectKey);
  const branch = await readCurrentGitBranch(targetRepo, input.runner);

  const logPath = ingestJobLogPath(input.root, input.projectKey, input.jobId);
  let spawned: DetachedIngestSpawnResult;
  try {
    spawned = await spawnDetachedIngestWorker({
      root: input.root,
      projectKey: input.projectKey,
      jobId: input.jobId,
      targetRepo,
      logPath,
      env: input.env,
      spawn: input.spawn,
      context: input.context,
  });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendLaunchFailure(logPath, message);
    updateIngestJobStatus(input.db, {
      id: input.jobId,
      status: "failed",
      updated_at: input.now,
      finished_at: input.now,
      error: {
        code: "detached_worker_launch_failed",
        message,
        log_path: logPath,
        target_repo: targetRepo,
      },
    });
    throw error;
  }

  const latest = getIngestJob(input.db, input.jobId);
  if (latest?.status === "starting" || latest?.status === "running") {
    updateIngestJobStatus(input.db, {
      id: input.jobId,
      status: "running",
      updated_at: input.now,
      started_at: input.now,
      followup_state: {
        pid: spawned.pid,
        log_path: spawned.logPath,
        target_repo: targetRepo,
        branch,
      },
    });
  }

  return { status: "running", pid: spawned.pid, logPath: spawned.logPath, branch };
}

function parseFollowupState(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function appendLaunchFailure(logPath: string, message: string): Promise<void> {
  try {
    await appendFile(logPath, `Failed to launch detached ingest worker: ${message}\n`);
  } catch {
    // error_json is the fallback operator signal when the log path cannot be written.
  }
}
