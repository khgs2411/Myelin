import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCli } from "./registry.ts";
import { registerIngestCommands } from "./ingest.ts";
import { getIngestJob } from "../ingest/jobs.ts";
import type { DetachedSpawner } from "../ingest/runtime.ts";
import { openMemoryDb } from "../memory/db.ts";
import { claimExperienceEvents, recordExperienceEvent } from "../memory/experience.ts";
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

test("top-level ingest starts one detached worker per configured batch", async () => {
  await seedExperienceEvents(5);
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

  const result = await cli.run(["ingest", "demo", "--batch-size", "2", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.batch_size).toBe(2);
  expect(response.batch_count).toBe(3);
  expect(response.jobs).toHaveLength(3);
  expect(response.job.id).toStartWith("ingest_");
  expect(response.job.status).toBe("running");
  expect(response.jobs.map((job: { input_json: string }) => JSON.parse(job.input_json).limit)).toEqual([2, 2, 1]);
  expect(JSON.parse(response.job.input_json)).toMatchObject({
    limit: 2,
    batch_size: 2,
    batch_index: 1,
    batch_count: 3,
    target_repo: join(root, "repos", "demo"),
  });
  expect(JSON.parse(response.job.followup_state_json)).toMatchObject({
    pid: 2468,
    target_repo: join(root, "repos", "demo"),
    branch: "master",
  });
  expect(spawned).toHaveLength(3);
  expect(spawned.map((item) => (item as { env: Record<string, string | undefined> }).env.MYELIN_INGEST_START_DELAY_MS)).toEqual([
    "750",
    "1500",
    "2250",
  ]);
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
  await seedExperienceEvents(1);
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

test("ingest status finalizes claimed tombstones when detached running job pid is dead", async () => {
  await seedExperienceEvents(1);
  const cli = createCli("myelin");
  registerIngestCommands(cli, {
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
    spawn: () => ({ pid: 2469, unref: () => {} }),
  });
  const started = await cli.run(["ingest", "demo", "--limit", "1", "--json"]);
  const jobId = JSON.parse(started.message).job.id;
  const db = openMemoryDb(root);
  try {
    recordExperienceEvent(db, {
      id: "evt_1",
      project_key: "demo",
      occurred_at: "2026-06-13T10:01:00.000Z",
      provider: "codex",
      raw_payload_json: "{}",
      source: "codex-hook",
      status: "valid",
    });
    claimExperienceEvents(db, {
      ingest_job_id: jobId,
      project_key: "demo",
      limit: 1,
      claimed_at: "2026-06-13T10:01:30.000Z",
      tombstone_id_for: () => "tomb_1",
    });
  } finally {
    db.close();
  }

  const statusCli = createCli("myelin");
  registerIngestCommands(statusCli, {
    now: () => new Date("2026-06-13T10:05:00.000Z"),
    isProcessAlive: () => false,
  });
  const status = await statusCli.run(["ingest", "status", jobId, "--json"]);
  const response = JSON.parse(status.message);

  expect(status.exitCode).toBe(0);
  expect(response.job.status).toBe("failed");
  expect(JSON.parse(response.job.error_json)).toMatchObject({ code: "detached_worker_exited" });

  const readDb = openMemoryDb(root);
  try {
    expect(
      readDb
        .query("SELECT COUNT(*) AS count FROM experience_event_tombstones WHERE ingest_job_id = ? AND state = 'claimed'")
        .get(jobId),
    ).toEqual({ count: 0 });
    expect(
      readDb
        .query(
          "SELECT state, terminal_decision, finalized_at, output_references_json FROM experience_event_tombstones WHERE ingest_job_id = ?",
        )
        .get(jobId),
    ).toEqual({
      state: "failed",
      terminal_decision: "detached_worker_exited",
      finalized_at: "2026-06-13T10:05:00.000Z",
      output_references_json: "[]",
    });
  } finally {
    readDb.close();
  }
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

async function seedExperienceEvents(count: number): Promise<void> {
  const db = openMemoryDb(root);
  try {
    for (let index = 0; index < count; index += 1) {
      recordExperienceEvent(db, {
        id: `evt_${index + 1}`,
        project_key: "demo",
        occurred_at: `2026-06-13T10:${String(index).padStart(2, "0")}:00.000Z`,
        provider: "codex",
        raw_payload_json: "{}",
        source: "codex-hook",
        status: "valid",
      });
    }
  } finally {
    db.close();
  }
}
