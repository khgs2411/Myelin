import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCli } from "../../src/commands/registry.ts";
import {
  registerIngestCommands as registerIngestCommandsWithContext,
  type IngestCommandDeps,
} from "../../src/commands/ingest.ts";
import { createIngestJob, getIngestJob, updateIngestJobStatus } from "../../src/ingest/jobs.ts";
import type { DetachedSpawner } from "../../src/ingest/runtime.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { leaseExperienceEvents, recordExperienceEvent } from "../../src/memory/experience.ts";
import { writeJson } from "../../src/runtime/json.ts";
import { registerInitialActiveEmbeddingContract } from "../../src/memory/embedding-contract-store.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import { acquireProjectSessionMutationFence } from "../../src/memory/project-session-mutation-fence.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  seedIndexedMemory,
} from "../helpers/smc-preparation.ts";

let root: string;
let previousCwd: string;
let previousMyelinRoot: string | undefined;

function registerIngestCommands(cli: ReturnType<typeof createCli>, deps: Omit<IngestCommandDeps, "context"> = {}): void {
  registerIngestCommandsWithContext(cli, { ...deps, context: testContext() });
}

function testContext() {
  return {
    myelinRoot: root,
    callerCwd: join(root, "caller"),
    invocationKind: "test",
    rootSource: "test_dependency",
    launcherPath: null,
    locatorPath: null,
  } as const;
}

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

test("top-level ingest starts one durable anchor with the configured evidence chunk size", async () => {
  await seedExperienceEvents(5);
  await writeFile(join(root, "myelin.config"), `INGEST_EVIDENCE_CHUNK_SIZE=2\n${smcPlanConfig()}\nEMBEDDING_STUB_RESPONSES_DIR=${join(root, "embedding-stubs")}\n`, "utf8");
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

  const result = await cli.run(["ingest", "demo", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.contract_version).toBe("myelin.ingest.start.v1");
  expect(response.ok).toBe(true);
  expect(response.reason_code).toBeNull();
  expect(response.evidence_chunk_size).toBe(2);
  expect(response.job_id).toStartWith("ingest_");
  expect(response).not.toHaveProperty("job");
  expect(response).not.toHaveProperty("jobs");
  expect(response).not.toHaveProperty("batch_size");
  const db = openMemoryDb(root);
  try {
    const job = getIngestJob(db, response.job_id);
    expect(job?.status).toBe("starting");
    expect(JSON.parse(job?.input_json ?? "{}")).toMatchObject({
      evidence_budgets: { max_items_per_batch: 2 },
      target_context: { repo_path: join(root, "repos", "demo") },
    });
  } finally {
    db.close();
  }
  expect(spawned).toHaveLength(1);
});

test("deprecated batch-size remains a reported boundary alias, not a second job grouping", async () => {
  await seedExperienceEvents(3);
  const cli = createCli("myelin");
  registerIngestCommands(cli, {
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
    spawn: () => ({ pid: 2468, unref: () => {} }),
  });

  const result = await cli.run(["ingest", "demo", "--batch-size", "2", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.contract_version).toBe("myelin.ingest.start.v1");
  expect(response.compatibility).toMatchObject({ deprecated_alias_used: "batch_size" });
  expect(response.evidence_chunk_size).toBe(2);
  expect(response.job_id).toStartWith("ingest_");
  expect(response).not.toHaveProperty("jobs");
});

test("no-work JSON is a stable successful outcome and does not imply progress", async () => {
  const cli = createCli("myelin");
  registerIngestCommands(cli, {
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
  });

  const result = await cli.run(["ingest", "demo", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response).toMatchObject({
    contract_version: "myelin.ingest.start.v1",
    ok: true,
    kind: "no_work",
    reason_code: "smc_no_work",
    trigger: { reason: "manual", workload: { evidence_count: 0, audit_count: 0 } },
  });
  expect(response.job_id).toBeNull();
});

test("machine argument failures and recovery aliases keep versioned envelopes", async () => {
  const cli = createCli("myelin");
  registerIngestCommands(cli);

  const invalidStart = await cli.run(["ingest", "--json"]);
  expect(invalidStart.exitCode).toBe(1);
  expect(JSON.parse(invalidStart.message)).toMatchObject({
    contract_version: "myelin.ingest.start.v1",
    ok: false,
    reason_code: "ingest_start_invalid_arguments",
  });

  const missingValue = await cli.run(["ingest", "demo", "--limit", "--json"]);
  expect(missingValue.exitCode).toBe(1);
  expect(JSON.parse(missingValue.message)).toMatchObject({
    contract_version: "myelin.ingest.start.v1",
    reason_code: "ingest_start_invalid_arguments",
  });

  const invalidResume = await cli.run(["ingest", "resume", "--json"]);
  expect(invalidResume.exitCode).toBe(1);
  expect(JSON.parse(invalidResume.message)).toMatchObject({
    contract_version: "myelin.smc.cli.v1",
    ok: false,
    reason_code: "smc_cli_invalid_arguments",
  });
});

test("blocked audit-only ingest preserves the due audit workload without creating an anchor", async () => {
  const db = openMemoryDb(root);
  try {
    configureSMCTestContract(db);
    seedIndexedMemory(db, { id: "memory-audit-only" });
    activateSMCAuthority(db);
    const acquired = acquireProjectSessionMutationFence(db, {
      projectKey: "demo",
      ownerId: "repair-owner",
      ownerKind: "repair",
      phase: "running",
      now: "2026-08-12T00:00:00.000Z",
    });
    if (acquired.kind !== "acquired") throw new Error(JSON.stringify(acquired));
  } finally {
    db.close();
  }

  const cli = createCli("myelin");
  registerIngestCommands(cli, { now: () => new Date("2026-08-12T00:01:00.000Z") });
  const result = await cli.run(["ingest", "demo", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(1);
  expect(response).toMatchObject({
    contract_version: "myelin.ingest.start.v1",
    ok: false,
    kind: "blocked",
    trigger: { reason: "manual_audit", workload: { evidence_count: 0, audit_count: 1 } },
  });
  const verified = openMemoryDb(root);
  try {
    expect(verified.query("SELECT count(*) AS count FROM session_memory_anchor_jobs").get()).toEqual({ count: 0 });
  } finally {
    verified.close();
  }
});

test("top-level ingest warns and starts on non-master branches", async () => {
  await seedExperienceEvents(1);
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
  expect(response.target_branch).toBe("feature/cli");
  const db = openMemoryDb(root);
  try {
    expect(JSON.parse(getIngestJob(db, response.job_id)?.input_json ?? "{}")).toMatchObject({
      target_context: { git_branch: "feature/cli" },
    });
  } finally {
    db.close();
  }
  expect(spawned).toBe(true);
});

test("ingest status reads stored job status", async () => {
  const cli = createCli("myelin");
  registerIngestCommands(cli, {
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "feature/cli\n", stderr: "" }),
    spawn: () => ({ pid: 2469, unref: () => {} }),
    isProcessAlive: () => true,
  });
  await seedExperienceEvents(1);
  const started = await cli.run(["ingest", "demo", "--json"]);
  const jobId = JSON.parse(started.message).job_id;

  const status = await cli.run(["ingest", "status", jobId, "--json"]);
  const response = JSON.parse(status.message);

  expect(status.exitCode).toBe(0);
  expect(response.contract_version).toBe("myelin.ingest.status.v1");
  expect(response.job.id).toBe(jobId);
  expect(response.job.status).toBe("starting");
  expect(response.job).not.toHaveProperty("input_json");
});

test("ingest status leaves prepared anchors to durable recovery when the launcher pid is dead", async () => {
  await seedExperienceEvents(1);
  const cli = createCli("myelin");
  registerIngestCommands(cli, {
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
    spawn: () => ({ pid: 2468, unref: () => {} }),
  });
  const started = await cli.run(["ingest", "demo", "--json"]);
  const jobId = JSON.parse(started.message).job_id;

  const statusCli = createCli("myelin");
  registerIngestCommands(statusCli, {
    now: () => new Date("2026-06-13T10:05:00.000Z"),
    isProcessAlive: () => false,
  });
  const status = await statusCli.run(["ingest", "status", jobId, "--json"]);
  const response = JSON.parse(status.message);

  expect(status.exitCode).toBe(0);
  expect(response.job.id).toBe(jobId);
  expect(response.job.status).toBe("starting");
  expect(response.job).not.toHaveProperty("followup_state_json");
  expect(response.job).not.toHaveProperty("error_json");
});

test("ingest status --project reports layered counts", async () => {
  await seedExperienceEvents(2);
  const cli = createCli("myelin");
  registerIngestCommands(cli, { now: () => new Date("2026-06-15T10:00:00.000Z") });

  const result = await cli.run(["ingest", "status", "--project", "demo", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.status.project_key).toBe("demo");
  expect(response.status.counts.active_events).toBe(2);
  expect(response.status.completion_label).toBe("Experience Log ingest pending");
});

test("ingest status --project fails for unknown project keys", async () => {
  const cli = createCli("myelin");
  registerIngestCommands(cli, { now: () => new Date("2026-06-15T10:00:00.000Z") });

  const result = await cli.run(["ingest", "status", "--project", "missing", "--json"]);

  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.message)).toMatchObject({
    contract_version: "myelin.ingest.status.v1",
    ok: false,
    reason_code: "ingest_status_failed",
    detail: "Unknown project: missing",
  });
});

test("ingest status --project retains prepared anchors for durable recovery", async () => {
  await seedExperienceEvents(1);
  const cli = createCli("myelin");
  registerIngestCommands(cli, {
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
    spawn: () => ({ pid: 2468, unref: () => {} }),
  });
  const started = await cli.run(["ingest", "demo", "--json"]);
  const jobId = JSON.parse(started.message).job_id;

  const statusCli = createCli("myelin");
  registerIngestCommands(statusCli, {
    now: () => new Date("2026-06-13T10:05:00.000Z"),
    isProcessAlive: () => false,
  });
  const status = await statusCli.run(["ingest", "status", "--project", "demo", "--json"]);
  const response = JSON.parse(status.message);

  expect(status.exitCode).toBe(0);
  expect(response.status.counts.running_jobs).toBe(1);
  expect(response.status.counts.failed_jobs).toBe(0);

  const db = openMemoryDb(root);
  try {
    const job = getIngestJob(db, jobId);
    expect(job?.status).toBe("starting");
    expect(JSON.parse(job?.input_json ?? "{}")).toMatchObject({ target_context: { git_branch: "master" } });
  } finally {
    db.close();
  }
});

test("ingest status preserves prepared anchor leases when the detached launcher pid is dead", async () => {
  await seedExperienceEvents(1);
  const cli = createCli("myelin");
  registerIngestCommands(cli, {
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
    spawn: () => ({ pid: 2469, unref: () => {} }),
  });
  const started = await cli.run(["ingest", "demo", "--limit", "1", "--json"]);
  const jobId = JSON.parse(started.message).job_id;
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
    leaseExperienceEvents(db, {
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
  expect(response.job.status).toBe("starting");
  expect(response.job).not.toHaveProperty("error_json");

  const readDb = openMemoryDb(root);
  try {
    expect(
      readDb
        .query("SELECT COUNT(*) AS count FROM experience_event_tombstones WHERE ingest_job_id = ? AND state = 'claimed'")
        .get(jobId),
    ).toEqual({ count: 1 });
    expect(readDb.query("SELECT id FROM experience_events WHERE id = ?").get("evt_1")).toEqual({ id: "evt_1" });
    expect(
      readDb
        .query(
          "SELECT state, terminal_decision, finalized_at, output_references_json FROM experience_event_tombstones WHERE ingest_job_id = ?",
        )
        .get(jobId),
    ).toEqual({
      state: "claimed",
      terminal_decision: null,
      finalized_at: null,
      output_references_json: "[]",
    });
  } finally {
    readDb.close();
  }
});

test("ingest jobs lists failed jobs for investigation", async () => {
  await seedFailedJob("job_env", { code: "detached_worker_exited", message: "worker died" });
  await seedFailedJob("job_provider", { code: "provider_failed", message: "provider failed" });
  const cli = createCli("myelin");
  registerIngestCommands(cli);

  const json = await cli.run(["ingest", "jobs", "demo", "--status", "failed", "--json"]);
  const text = await cli.run(["ingest", "jobs", "demo", "--status", "failed", "--limit", "1"]);

  expect(json.exitCode).toBe(0);
  expect(JSON.parse(json.message).jobs.map((job: { id: string }) => job.id)).toEqual(["job_provider", "job_env"]);
  expect(text.exitCode).toBe(0);
  expect(text.message).toContain("job_provider [failed]");
  expect(text.message).toContain("error=provider_failed");
  expect(text.message).not.toContain("job_env");
});

test("ingest jobs resolve can dry-run and filter failed jobs by error code", async () => {
  await seedFailedJob("job_env", { code: "detached_worker_exited", message: "worker died" });
  await seedFailedJob("job_provider", { code: "provider_failed", message: "provider failed" });
  const cli = createCli("myelin");
  registerIngestCommands(cli);

  const result = await cli.run([
    "ingest",
    "jobs",
    "resolve",
    "demo",
    "--all",
    "--code",
    "detached_worker_exited",
    "--reason",
    "environment cleanup",
    "--dry-run",
    "--json",
  ]);

  expect(result.exitCode).toBe(0);
  const response = JSON.parse(result.message);
  expect(response.contract_version).toBe("myelin.ingest.jobs-resolution.v1");
  expect(response.dry_run).toBe(true);
  expect(response.resolved.map((job: { id: string }) => job.id)).toEqual(["job_env"]);
  expect(response.resolved[0]).not.toHaveProperty("input_json");
  expect(response.resolved[0]).not.toHaveProperty("error_json");
  expect(response.resolved[0]).not.toHaveProperty("followup_state_json");

  const db = openMemoryDb(root);
  try {
    expect(getIngestJob(db, "job_env")?.status).toBe("failed");
    expect(getIngestJob(db, "job_provider")?.status).toBe("failed");
  } finally {
    db.close();
  }
});

test("ingest jobs resolve marks selected failed jobs completed and preserves previous error metadata", async () => {
  await seedFailedJob("job_env", { code: "detached_worker_exited", message: "worker died" });
  const cli = createCli("myelin");
  registerIngestCommands(cli, { now: () => new Date("2026-06-13T11:00:00.000Z") });

  const result = await cli.run([
    "ingest",
    "jobs",
    "resolve",
    "demo",
    "--id",
    "job_env",
    "--reason",
    "environment cleanup",
    "--json",
  ]);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.message).resolved.map((job: { id: string; status: string }) => [job.id, job.status])).toEqual([
    ["job_env", "completed"],
  ]);

  const db = openMemoryDb(root);
  try {
    const job = getIngestJob(db, "job_env");
    expect(job?.status).toBe("completed");
    expect(job?.error_json).toBeNull();
    expect(job?.terminal_summary).toBe("Resolved failed ingest job: environment cleanup");
    expect(JSON.parse(job?.followup_state_json ?? "{}")).toMatchObject({
      resolved_failed_job: {
        resolved_at: "2026-06-13T11:00:00.000Z",
        reason: "environment cleanup",
        previous_error: { code: "detached_worker_exited" },
      },
    });
  } finally {
    db.close();
  }
});

test("ingest jobs resolve requires an explicit target and reason", async () => {
  const cli = createCli("myelin");
  registerIngestCommands(cli);

  const missingTarget = await cli.run(["ingest", "jobs", "resolve", "demo", "--reason", "cleanup"]);
  const missingReason = await cli.run(["ingest", "jobs", "resolve", "demo", "--all"]);

  expect(missingTarget.exitCode).toBe(1);
  expect(missingTarget.message).toContain("Use --id <job-id> or --all");
  expect(missingReason.exitCode).toBe(1);
  expect(missingReason.message).toContain("--reason is required");
});

test("ingest worker dispatches stored job input to the worker runtime", async () => {
  const cli = createCli("myelin");
  registerIngestCommands(cli, {
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "feature/cli\n", stderr: "" }),
    spawn: () => ({ pid: 2470, unref: () => {} }),
  });
  await seedExperienceEvents(2);
  const started = await cli.run(["ingest", "demo", "--limit", "2", "--json"]);
  const jobId = JSON.parse(started.message).job_id;
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
    provider: "codex",
    providerSessionId: null,
  });

  const db = openMemoryDb(root);
  try {
    const job = getIngestJob(db, jobId);
    expect(job?.status).toBe("starting");
    expect(JSON.parse(job?.input_json ?? "{}")).toMatchObject({
      target_context: { git_branch: "feature/cli" },
    });
  } finally {
    db.close();
  }
});

async function seedProject(): Promise<void> {
  const repo = join(root, "repos", "demo");
  await mkdir(repo, { recursive: true });
  await writeJson(join(root, "state", "demo", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [repo],
  });
  const stubDir = join(root, "embedding-stubs");
  await mkdir(stubDir, { recursive: true });
  await writeFile(join(root, "myelin.config"), `${smcPlanConfig()}\nEMBEDDING_STUB_RESPONSES_DIR=${stubDir}\n`, "utf8");
  const db = openMemoryDb(root);
  registerInitialActiveEmbeddingContract(db, {
    scope: "session_memory",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
  });
  db.close();
}

async function seedExperienceEvents(count: number): Promise<void> {
  const db = openMemoryDb(root);
  try {
    for (let index = 0; index < count; index += 1) {
      recordExperienceEvent(db, {
        id: `evt_${index + 1}`,
        project_key: "demo",
        occurred_at: `2026-06-13T10:${String(index).padStart(2, "0")}:00.000Z`,
        event_kind: index % 2 === 0 ? "user.prompt" : "assistant.response",
        raw_text: `content ${index + 1}`,
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

function smcPlanConfig(): string {
  return [
    "SMC_AUDIT_PARTITION_LIMIT=10", "SMC_MAX_ITEMS_PER_BATCH=100", "SMC_MAX_ENCODED_BYTES_PER_BATCH=1000000",
    "SMC_MAX_ENCODED_BYTES_PER_ITEM=100000", "SMC_MAX_AFFECTED_WORK_SET_SIZE=50",
    "SMC_MAX_CUMULATIVE_RETURNED_RESULT_BYTES=1000000", "SMC_MAX_PROVIDER_ENVELOPE_BYTES=1000000",
    "SMC_MAX_QUERIES=20", "SMC_MAX_TURNS=20", "SMC_RETRIEVAL_PAGE_ITEM_LIMIT=50",
    "SMC_SEMANTIC_DISTANCE_THRESHOLD_MICROS=500000", "SMC_SEMANTIC_QUALIFYING_RESULT_CEILING=100",
  ].join("\n");
}

async function seedFailedJob(id: string, error: Record<string, unknown>): Promise<void> {
  const db = openMemoryDb(root);
  try {
    createIngestJob(db, {
      id,
      project_key: "demo",
      provider: "codex",
      input: {},
      now: id === "job_env" ? "2026-06-13T10:00:00.000Z" : "2026-06-13T10:01:00.000Z",
    });
    updateIngestJobStatus(db, {
      id,
      status: "failed",
      updated_at: id === "job_env" ? "2026-06-13T10:00:30.000Z" : "2026-06-13T10:01:30.000Z",
      finished_at: id === "job_env" ? "2026-06-13T10:00:30.000Z" : "2026-06-13T10:01:30.000Z",
      error,
    });
  } finally {
    db.close();
  }
}
