import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "../memory/db.ts";
import { writeJson } from "../runtime/json.ts";
import { createIngestJob, getIngestJob } from "./jobs.ts";
import {
  assertMasterBranch,
  ingestJobLogPath,
  launchDetachedIngestWorker,
  resolveIngestTargetRepo,
  spawnDetachedIngestWorker,
  type DetachedSpawner,
} from "./runtime.ts";

let root: string;
let db: MemoryDb;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-ingest-runtime-"));
  db = openMemoryDbAt(join(root, "state", "memory.db"));
});

afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});

test("resolves target repository from project metadata", async () => {
  const repo = join(root, "repos", "class-kit");
  await mkdir(repo, { recursive: true });
  await writeJson(join(root, "projects", "class-kit", "state", "project.json"), {
    key: "class-kit",
    repo_paths: [repo],
  });

  await expect(resolveIngestTargetRepo(root, "class-kit")).resolves.toBe(repo);
});

test("branch preflight accepts master", async () => {
  const result = await assertMasterBranch("/repo", async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }));
  expect(result).toEqual({ ok: true, branch: "master" });
});

test("branch preflight rejects non-master", async () => {
  const result = await assertMasterBranch("/repo", async () => ({ exitCode: 0, stdout: "feature/auth\n", stderr: "" }));
  expect(result).toEqual({ ok: false, branch: "feature/auth" });
});

test("detached spawn runs worker from target repo and returns pid plus log path", async () => {
  const calls: unknown[] = [];
  let unrefCalled = false;
  const spawn: DetachedSpawner = (options) => {
    calls.push(options);
    return {
      pid: 4321,
      unref: () => {
        unrefCalled = true;
      },
    };
  };

  const logPath = join(root, "projects", "class-kit", "logs", "ingest-job_1.log");
  const result = await spawnDetachedIngestWorker({
    root,
    projectKey: "class-kit",
    jobId: "job_1",
    targetRepo: "/target/repo",
    logPath,
    env: { PATH: "/bin" },
    spawn,
  });

  expect(result).toEqual({ pid: 4321, logPath });
  expect(unrefCalled).toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    cmd: ["bun", join(root, "src", "cli.ts"), "ingest", "worker", "job_1"],
    cwd: "/target/repo",
    stdin: "ignore",
    env: {
      PATH: "/bin",
      MYELIN_ROOT: root,
      MYELIN_INGEST_JOB_ID: "job_1",
      MYELIN_INGEST_PROJECT: "class-kit",
    },
  });
});

test("launch fails job on non-master before spawning", async () => {
  const repo = join(root, "repos", "class-kit");
  await mkdir(repo, { recursive: true });
  await writeJson(join(root, "projects", "class-kit", "state", "project.json"), {
    key: "class-kit",
    repo_paths: [repo],
  });
  createIngestJob(db, {
    id: "job_2",
    project_key: "class-kit",
    provider: "codex",
    input: {},
    now: "2026-06-13T10:00:00.000Z",
  });

  let spawned = false;
  const result = await launchDetachedIngestWorker({
    db,
    root,
    projectKey: "class-kit",
    jobId: "job_2",
    now: "2026-06-13T10:01:00.000Z",
    runner: async () => ({ exitCode: 0, stdout: "feature/auth\n", stderr: "" }),
    spawn: () => {
      spawned = true;
      return { pid: 1, unref: () => {} };
    },
  });

  const job = getIngestJob(db, "job_2");
  expect(result).toEqual({ status: "failed", branch: "feature/auth" });
  expect(spawned).toBe(false);
  expect(job?.status).toBe("failed");
  expect(JSON.parse(job?.error_json ?? "{}")).toMatchObject({
    code: "target_branch_mismatch",
    expected_branch: "master",
    actual_branch: "feature/auth",
  });
});

test("launch records detached pid and log path in followup state without provider session id", async () => {
  const repo = join(root, "repos", "class-kit");
  await mkdir(repo, { recursive: true });
  await writeJson(join(root, "projects", "class-kit", "state", "project.json"), {
    key: "class-kit",
    repo_paths: [repo],
  });
  createIngestJob(db, {
    id: "job_3",
    project_key: "class-kit",
    provider: "codex",
    input: {},
    now: "2026-06-13T10:00:00.000Z",
  });

  const result = await launchDetachedIngestWorker({
    db,
    root,
    projectKey: "class-kit",
    jobId: "job_3",
    now: "2026-06-13T10:01:00.000Z",
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
    spawn: () => ({ pid: 9876, unref: () => {} }),
  });

  const job = getIngestJob(db, "job_3");
  expect(result).toEqual({ status: "running", pid: 9876, logPath: ingestJobLogPath(root, "class-kit", "job_3") });
  expect(job?.status).toBe("running");
  expect(job?.provider_session_id).toBeNull();
  expect(JSON.parse(job?.followup_state_json ?? "{}")).toEqual({
    pid: 9876,
    log_path: ingestJobLogPath(root, "class-kit", "job_3"),
    target_repo: repo,
    branch: "master",
  });
});
