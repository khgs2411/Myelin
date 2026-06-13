import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCli } from "./registry.ts";
import { registerIngestCommands } from "./ingest.ts";
import { getIngestJob } from "../ingest/jobs.ts";
import type { DetachedSpawner } from "../ingest/runtime.ts";
import { openMemoryDb } from "../memory/db.ts";
import { writeJson } from "../runtime/json.ts";

let root: string;
let previousCwd: string;
let previousMyelinRoot: string | undefined;

beforeEach(async () => {
  previousCwd = process.cwd();
  previousMyelinRoot = process.env.MYELIN_ROOT;
  root = await mkdtemp(join(tmpdir(), "myelin-ingest-command-"));
  process.chdir(root);
  await seedProject();
});

afterEach(async () => {
  process.chdir(previousCwd);
  if (previousMyelinRoot === undefined) delete process.env.MYELIN_ROOT;
  else process.env.MYELIN_ROOT = previousMyelinRoot;
  await rm(root, { recursive: true, force: true });
});

test("top-level ingest starts a detached worker and reports durable job information", async () => {
  const spawned: unknown[] = [];
  const spawn: DetachedSpawner = (options) => {
    spawned.push(options);
    return { pid: 2468, unref: () => {} };
  };
  const cli = createCli("myelin");
  registerIngestCommands(cli, {
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
    spawn,
  });

  const result = await cli.run(["ingest", "demo", "--limit", "3", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.job.id).toStartWith("ingest_");
  expect(response.job.status).toBe("running");
  expect(JSON.parse(response.job.input_json)).toMatchObject({ limit: 3, target_repo: join(root, "repos", "demo") });
  expect(JSON.parse(response.job.followup_state_json)).toMatchObject({
    pid: 2468,
    target_repo: join(root, "repos", "demo"),
    branch: "master",
  });
  expect(spawned).toHaveLength(1);
});

test("top-level ingest records a failed job on branch mismatch before spawn", async () => {
  let spawned = false;
  const cli = createCli("myelin");
  registerIngestCommands(cli, {
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "feature/cli\n", stderr: "" }),
    spawn: () => {
      spawned = true;
      return { pid: 1, unref: () => {} };
    },
  });

  const result = await cli.run(["ingest", "demo", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.job.status).toBe("failed");
  expect(JSON.parse(response.job.error_json)).toMatchObject({
    code: "target_branch_mismatch",
    expected_branch: "master",
    actual_branch: "feature/cli",
  });
  expect(spawned).toBe(false);
});

test("ingest status reads stored job status", async () => {
  const cli = createCli("myelin");
  registerIngestCommands(cli, {
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "feature/cli\n", stderr: "" }),
  });
  const started = await cli.run(["ingest", "demo", "--json"]);
  const jobId = JSON.parse(started.message).job.id;

  const status = await cli.run(["ingest", "status", jobId, "--json"]);
  const response = JSON.parse(status.message);

  expect(status.exitCode).toBe(0);
  expect(response.job.id).toBe(jobId);
  expect(response.job.status).toBe("failed");
});

test("ingest status marks detached running job failed when stored pid is dead", async () => {
  const cli = createCli("myelin");
  registerIngestCommands(cli, {
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
    spawn: () => ({ pid: 2468, unref: () => {} }),
  });
  const started = await cli.run(["ingest", "demo", "--json"]);
  const jobId = JSON.parse(started.message).job.id;

  const statusCli = createCli("myelin");
  registerIngestCommands(statusCli, {
    now: () => new Date("2026-06-13T10:05:00.000Z"),
    isProcessAlive: () => false,
  });
  const status = await statusCli.run(["ingest", "status", jobId, "--json"]);
  const response = JSON.parse(status.message);

  expect(status.exitCode).toBe(0);
  expect(response.job.id).toBe(jobId);
  expect(response.job.status).toBe("failed");
  expect(JSON.parse(response.job.followup_state_json)).toMatchObject({ pid: 2468 });
  expect(JSON.parse(response.job.error_json)).toMatchObject({
    code: "detached_worker_exited",
    pid: 2468,
  });
});

test("ingest worker dispatches stored job input to the worker runtime", async () => {
  const cli = createCli("myelin");
  registerIngestCommands(cli, {
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "feature/cli\n", stderr: "" }),
  });
  const started = await cli.run(["ingest", "demo", "--limit", "2", "--json"]);
  const jobId = JSON.parse(started.message).job.id;
  const calls: unknown[] = [];
  process.env.MYELIN_ROOT = root;

  const workerCli = createCli("myelin");
  registerIngestCommands(workerCli, {
    runWorker: async (input) => {
      calls.push(input);
    },
  });

  const result = await workerCli.run(["ingest", "worker", jobId]);

  expect(result.exitCode).toBe(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    root,
    projectKey: "demo",
    jobId,
    targetRepo: join(root, "repos", "demo"),
    provider: "codex",
    limit: 2,
  });

  const db = openMemoryDb(root);
  try {
    expect(getIngestJob(db, jobId)?.status).toBe("failed");
  } finally {
    db.close();
  }
});

async function seedProject(): Promise<void> {
  const repo = join(root, "repos", "demo");
  await mkdir(repo, { recursive: true });
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [repo],
  });
}
