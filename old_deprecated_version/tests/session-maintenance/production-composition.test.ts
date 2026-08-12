import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCli } from "../../src/commands/registry.ts";
import { defaultRegistrars, registerCommands, type CommandRegistrars } from "../../src/commands/register.ts";
import { registerIngestCommands, type IngestCommandDeps } from "../../src/commands/ingest.ts";
import { AutoMemoryMaintenanceService } from "../../src/maintenance/auto-memory-maintenance.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import type { DetachedSpawner } from "../../src/ingest/runtime.ts";
import { loadConfig } from "../../src/runtime/config.ts";
import { writeJson } from "../../src/runtime/json.ts";
import { transitionSessionMemoryAnchorJob } from "../../src/session-maintenance/job-lifecycle.ts";
import { createAcceptedFinalizationContext } from "../helpers/smc-finalization.ts";
import {
  configureSMCTestContract,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_NOW,
} from "../helpers/smc-preparation.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "smc-production-composition-"));
  const repo = join(root, "repos", "demo");
  await mkdir(repo, { recursive: true });
  await writeJson(join(root, "state", "demo", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [repo],
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("Session Memory plan config is all-or-nothing and has no implicit defaults", async () => {
  expect((await loadConfig(root, {})).sessionMaintenance.planConfig).toBeNull();
  await expect(loadConfig(root, { SMC_MAX_ITEMS_PER_BATCH: "10" }))
    .rejects.toThrow("Invalid Session Memory plan config: missing");

  await writePlanConfig();
  expect((await loadConfig(root, {})).sessionMaintenance.planConfig).toEqual({
    auditPartitionLimit: 10,
    evidenceBudgets: {
      max_items_per_batch: 10,
      max_encoded_bytes_per_batch: 100_000,
      max_encoded_bytes_per_item: 100_000,
    },
    workflowBudgets: {
      max_affected_work_set_size: 1_000,
      max_cumulative_returned_result_bytes: 100_000,
      max_provider_envelope_bytes: 180_000,
      max_queries: 20,
      max_turns: 20,
      retrieval_page_item_limit: 100,
      semantic_distance_threshold_micros: 800_000,
      semantic_qualifying_result_ceiling: 1_000,
    },
  });
});

test("registered manual ingest loads the repository plan and launches one companion anchor", async () => {
  await writePlanConfig();
  const db = openMemoryDb(root);
  configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-start" });
  seedEvidence(db, "evt-start");
  db.close();
  const spawned: Parameters<DetachedSpawner>[0][] = [];
  const cli = createCli("myelin");
  registerCommands(cli, launchContext(), registrarsWithIngestDeps({
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
    spawn: fakeSpawn(spawned),
    now: fixedNow,
  }));

  const result = await cli.run(["ingest", "demo", "--json"]);
  expect(result.exitCode).toBe(0);
  const response = JSON.parse(result.message);
  expect(response.contract_version).toBe("myelin.ingest.start.v1");
  expect(response.job_id).toBeTruthy();
  expect(response.jobs).toBeUndefined();
  expect(spawned).toHaveLength(1);
  expect(spawned[0].cmd.slice(-3)).toEqual(["ingest", "worker", response.job_id]);
  const verified = openMemoryDb(root);
  expect(verified.query("SELECT count(*) AS n FROM ingest_jobs").get()).toEqual({ n: 1 });
  const budgets = verified.query("SELECT evidence_budgets_json, workflow_budgets_json FROM smc_manifests").get() as {
    evidence_budgets_json: string;
    workflow_budgets_json: string;
  };
  expect(JSON.parse(budgets.evidence_budgets_json).max_items_per_batch).toBe(10);
  expect(JSON.parse(budgets.workflow_budgets_json).max_provider_envelope_bytes).toBe(180_000);
  verified.close();
});

test("automatic maintenance supplies the same repository plan to the real ingest service", async () => {
  await writePlanConfig(["AUTO_MEMORY_MAINTENANCE=1", "AUTO_MEMORY_MIN_CAPTURED_EVENTS=1"]);
  const db = openMemoryDb(root);
  configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-auto" });
  seedEvidence(db, "evt-auto");
  db.close();
  const service = new AutoMemoryMaintenanceService(root, {
    now: fixedNow,
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
    smcFailureInjection: { afterPreparationBeforeSpawn: () => { throw new Error("prepared-with-config"); } },
  });

  const result = await service.run("demo", "auto-plan-composition");
  expect(result).toMatchObject({ status: "failed", error_message: "prepared-with-config" });
  const verified = openMemoryDb(root);
  expect(verified.query("SELECT count(*) AS n FROM session_memory_anchor_jobs").get()).toEqual({ n: 1 });
  expect(verified.query("SELECT count(*) AS n FROM ingest_jobs").get()).toEqual({ n: 1 });
  verified.close();
});

test("registered resume relaunches the same anchor through only the companion worker", async () => {
  await writePlanConfig(["INGEST_CODEX_MODEL=gpt-test", "INGEST_CODEX_REASONING_EFFORT=medium"]);
  const db = openMemoryDb(root);
  const context = await createAcceptedFinalizationContext(db, { jobId: "job-resume-production" });
  const followup = transitionSessionMemoryAnchorJob(db, {
    jobId: context.job_id,
    projectKey: context.project_key,
    expectedPhase: "running",
    expectedOwnerEpoch: context.owner_epoch,
    nextPhase: "needs_followup",
    now: SMC_TEST_NOW,
    reasonCode: "provider_interrupted",
  });
  if (followup.kind !== "updated") throw new Error(JSON.stringify(followup));
  db.close();
  const spawned: Parameters<DetachedSpawner>[0][] = [];
  const cli = createCli("myelin");
  registerCommands(cli, launchContext(), registrarsWithIngestDeps({ spawn: fakeSpawn(spawned), now: fixedNow }));

  const result = await cli.run([
    "ingest", "resume", "demo", context.job_id,
    "--owner-epoch", String(followup.anchor.owner_epoch),
    "--attempt-id", "attempt-production-resume", "--json",
  ]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.message)).toMatchObject({
    contract_version: "myelin.smc.cli.v1",
    kind: "resume",
    result: { kind: "launched", anchor: { job_id: context.job_id } },
  });
  expect(spawned).toHaveLength(1);
  expect(spawned[0].cmd.slice(-3)).toEqual(["ingest", "worker", context.job_id]);
  const verified = openMemoryDb(root);
  expect(verified.query("SELECT count(*) AS n FROM ingest_jobs").get()).toEqual({ n: 1 });
  expect(verified.query("SELECT count(*) AS n FROM session_memory_anchor_attempts WHERE job_id = ?")
    .get(context.job_id)).toEqual({ n: 2 });
  verified.close();
});

function fixedNow(): Date { return new Date(SMC_TEST_NOW); }

function launchContext() {
  return {
    myelinRoot: root,
    callerCwd: join(root, "repos", "demo"),
    invocationKind: "test",
    rootSource: "test_dependency",
    launcherPath: null,
    locatorPath: null,
  } as const;
}

function fakeSpawn(calls: Parameters<DetachedSpawner>[0][]): DetachedSpawner {
  return (options) => {
    calls.push(options);
    return { pid: 4321, unref: () => {} };
  };
}

function registrarsWithIngestDeps(deps: Omit<IngestCommandDeps, "context">): CommandRegistrars {
  return {
    ...defaultRegistrars,
    ingest: (cli, base) => registerIngestCommands(cli, { ...base, ...deps }),
  };
}

async function writePlanConfig(extra: string[] = []): Promise<void> {
  await writeFile(join(root, "myelin.config"), [
    "DEFAULT_PROVIDER=codex",
    "INGEST_EVIDENCE_CHUNK_SIZE=10",
    "SMC_AUDIT_PARTITION_LIMIT=10",
    "SMC_MAX_ITEMS_PER_BATCH=10",
    "SMC_MAX_ENCODED_BYTES_PER_BATCH=100000",
    "SMC_MAX_ENCODED_BYTES_PER_ITEM=100000",
    "SMC_MAX_AFFECTED_WORK_SET_SIZE=1000",
    "SMC_MAX_CUMULATIVE_RETURNED_RESULT_BYTES=100000",
    "SMC_MAX_PROVIDER_ENVELOPE_BYTES=180000",
    "SMC_MAX_QUERIES=20",
    "SMC_MAX_TURNS=20",
    "SMC_RETRIEVAL_PAGE_ITEM_LIMIT=100",
    "SMC_SEMANTIC_DISTANCE_THRESHOLD_MICROS=800000",
    "SMC_SEMANTIC_QUALIFYING_RESULT_CEILING=1000",
    ...extra,
  ].join("\n"), "utf8");
}
