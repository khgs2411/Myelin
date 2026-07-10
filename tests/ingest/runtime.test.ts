import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { leaseExperienceEvents, recordExperienceEvent } from "../../src/memory/experience.ts";
import { writeJson } from "../../src/runtime/json.ts";
import { createIngestJob, getIngestJob, updateIngestJobStatus } from "../../src/ingest/jobs.ts";
import {
  ingestJobLogPath,
  launchDetachedIngestWorker,
  readCurrentGitBranch,
  refreshDetachedIngestJobStatus,
  resolveIngestTargetRepo,
  spawnDetachedIngestWorker,
  type DetachedSpawner,
} from "../../src/ingest/runtime.ts";

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

test("branch metadata reads the current branch", async () => {
  const result = await readCurrentGitBranch("/repo", async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }));
  expect(result).toBe("master");
});

test("branch metadata allows non-master branches", async () => {
  const result = await readCurrentGitBranch("/repo", async () => ({ exitCode: 0, stdout: "feature/auth\n", stderr: "" }));
  expect(result).toBe("feature/auth");
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
  await seedProjectLogs("class-kit", 30);
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
  expect((await readdir(join(root, "projects", "class-kit", "logs"))).filter((entry) => entry.endsWith(".log"))).toHaveLength(24);
  expect(unrefCalled).toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    cmd: ["bun", join(root, "src", "cli.ts"), "ingest", "worker", "job_1"],
    cwd: "/target/repo",
    stdin: "ignore",
    detached: true,
    env: {
      PATH: "/bin",
      MYELIN_ROOT: root,
      MYELIN_INGEST_JOB_ID: "job_1",
      MYELIN_INGEST_PROJECT: "class-kit",
      MYELIN_CAPTURE_DISABLED: "1",
    },
  });
});

async function seedProjectLogs(projectKey: string, count: number): Promise<void> {
  const logsDir = join(root, "projects", projectKey, "logs");
  await mkdir(logsDir, { recursive: true });
  for (let i = 0; i < count; i += 1) {
    const path = join(logsDir, `old-${i.toString().padStart(2, "0")}.log`);
    await writeFile(path, `${i}\n`, "utf8");
    const time = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
    await utimes(path, time, time);
  }
}

test("launch allows non-master and records branch metadata", async () => {
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
  expect(result).toEqual({ status: "running", pid: 1, logPath: ingestJobLogPath(root, "class-kit", "job_2"), branch: "feature/auth" });
  expect(spawned).toBe(true);
  expect(job?.status).toBe("running");
  expect(JSON.parse(job?.followup_state_json ?? "{}")).toMatchObject({
    target_repo: repo,
    branch: "feature/auth",
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
  expect(result).toEqual({ status: "running", pid: 9876, logPath: ingestJobLogPath(root, "class-kit", "job_3"), branch: "master" });
  expect(job?.status).toBe("running");
  expect(job?.provider_session_id).toBeNull();
  expect(JSON.parse(job?.followup_state_json ?? "{}")).toEqual({
    pid: 9876,
    log_path: ingestJobLogPath(root, "class-kit", "job_3"),
    target_repo: repo,
    branch: "master",
  });
});

test("launch does not overwrite a terminal state from a fast detached worker", async () => {
  const repo = join(root, "repos", "class-kit");
  await mkdir(repo, { recursive: true });
  await writeJson(join(root, "projects", "class-kit", "state", "project.json"), {
    key: "class-kit",
    repo_paths: [repo],
  });
  createIngestJob(db, {
    id: "job_fast",
    project_key: "class-kit",
    provider: "codex",
    input: {},
    now: "2026-06-13T10:00:00.000Z",
  });

  await launchDetachedIngestWorker({
    db,
    root,
    projectKey: "class-kit",
    jobId: "job_fast",
    now: "2026-06-13T10:01:00.000Z",
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
    spawn: () => {
      updateIngestJobStatus(db, {
        id: "job_fast",
        status: "completed",
        updated_at: "2026-06-13T10:01:01.000Z",
        finished_at: "2026-06-13T10:01:01.000Z",
        output_counts: { claimed: 0 },
      });
      return { pid: 9877, unref: () => {} };
    },
  });

  const job = getIngestJob(db, "job_fast");
  expect(job?.status).toBe("completed");
  expect(job?.finished_at).toBe("2026-06-13T10:01:01.000Z");
});

test("launch fails job and writes configured log when detached spawn throws", async () => {
  const repo = join(root, "repos", "class-kit");
  await mkdir(repo, { recursive: true });
  await writeJson(join(root, "projects", "class-kit", "state", "project.json"), {
    key: "class-kit",
    repo_paths: [repo],
  });
  createIngestJob(db, {
    id: "job_4",
    project_key: "class-kit",
    provider: "codex",
    input: {},
    now: "2026-06-13T10:00:00.000Z",
  });

  await expect(
    launchDetachedIngestWorker({
      db,
      root,
      projectKey: "class-kit",
      jobId: "job_4",
      now: "2026-06-13T10:01:00.000Z",
      runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
      spawn: () => {
        throw new Error("spawn failed");
      },
    }),
  ).rejects.toThrow("spawn failed");

  const job = getIngestJob(db, "job_4");
  const logPath = ingestJobLogPath(root, "class-kit", "job_4");
  expect(job?.status).toBe("failed");
  expect(JSON.parse(job?.error_json ?? "{}")).toMatchObject({
    code: "detached_worker_launch_failed",
    message: "spawn failed",
    log_path: logPath,
  });
  await expect(readFile(logPath, "utf8")).resolves.toContain("Failed to launch detached ingest worker: spawn failed");
});

test("refresh marks running detached job failed when stored pid is dead", async () => {
  createIngestJob(db, {
    id: "job_5",
    project_key: "class-kit",
    provider: "codex",
    input: {},
    now: "2026-06-13T10:00:00.000Z",
  });
  updateJobToRunning("job_5", {
    pid: 4567,
    log_path: ingestJobLogPath(root, "class-kit", "job_5"),
    target_repo: "/repo",
    branch: "master",
  });

  const job = getIngestJob(db, "job_5");
  if (!job) throw new Error("missing test job");
  const refreshed = refreshDetachedIngestJobStatus({
    db,
    job,
    now: "2026-06-13T10:02:00.000Z",
    isAlive: () => false,
  });

  expect(refreshed.status).toBe("failed");
  expect(refreshed.finished_at).toBe("2026-06-13T10:02:00.000Z");
  expect(JSON.parse(refreshed.followup_state_json ?? "{}")).toMatchObject({ pid: 4567 });
  expect(JSON.parse(refreshed.error_json ?? "{}")).toMatchObject({
    code: "detached_worker_exited",
    pid: 4567,
    log_path: ingestJobLogPath(root, "class-kit", "job_5"),
  });
});

test("refresh preserves retryable lease stubs when detached worker pid is dead", async () => {
  createIngestJob(db, {
    id: "job_6",
    project_key: "class-kit",
    provider: "codex",
    input: {},
    now: "2026-06-13T10:00:00.000Z",
  });
  updateJobToRunning("job_6", {
    pid: 4568,
    log_path: ingestJobLogPath(root, "class-kit", "job_6"),
    target_repo: "/repo",
    branch: "master",
  });
  recordExperienceEvent(db, {
    id: "evt_1",
    project_key: "class-kit",
    occurred_at: "2026-06-13T10:01:00.000Z",
    provider: "codex",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid",
  });
  leaseExperienceEvents(db, {
    ingest_job_id: "job_6",
    project_key: "class-kit",
    limit: 1,
    claimed_at: "2026-06-13T10:01:30.000Z",
    tombstone_id_for: () => "tomb_1",
  });

  const job = getIngestJob(db, "job_6");
  if (!job) throw new Error("missing test job");
  const refreshed = refreshDetachedIngestJobStatus({
    db,
    job,
    now: "2026-06-13T10:02:00.000Z",
    isAlive: () => false,
  });

  expect(refreshed.status).toBe("failed");
  expect(
    db
      .query("SELECT COUNT(*) AS count FROM experience_event_tombstones WHERE ingest_job_id = ? AND state = 'claimed'")
      .get("job_6"),
  ).toEqual({ count: 1 });
  expect(db.query("SELECT id FROM experience_events WHERE id = ?").get("evt_1")).toEqual({ id: "evt_1" });
  expect(
    db
      .query("SELECT state, terminal_decision, finalized_at, output_references_json FROM experience_event_tombstones")
      .get(),
  ).toEqual({
    state: "claimed",
    terminal_decision: null,
    finalized_at: null,
    output_references_json: "[]",
  });
});

function updateJobToRunning(jobId: string, followupState: Record<string, unknown>): void {
  db.query(
    `UPDATE ingest_jobs
     SET status = 'running',
         started_at = '2026-06-13T10:01:00.000Z',
         updated_at = '2026-06-13T10:01:00.000Z',
         followup_state_json = ?
     WHERE id = ?`,
  ).run(JSON.stringify(followupState), jobId);
}
