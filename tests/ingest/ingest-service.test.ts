import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IngestService } from "../../src/ingest/ingest-service.ts";
import { runIngestWorker } from "../../src/ingest/worker.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import {
  listExperienceEvents,
  recordExperienceEvent,
  tombstoneExperienceEvent,
} from "../../src/memory/experience.ts";
import { writeJson } from "../../src/runtime/json.ts";
import { configureSMCTestContract, SMC_TEST_WORKFLOW_BUDGETS } from "../helpers/smc-preparation.ts";
import { fixedTransport } from "../helpers/smc-finalization.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-ingest-service-"));
  await seedProject();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("IngestService reports no work when a project has no queued experience events", async () => {
  const service = new IngestService(root, {
    now: () => new Date("2026-06-15T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
  });

  const result = await service.start({ projectKey: "demo", provider: "codex" });

  expect(result).toMatchObject({
    kind: "no_work",
    project_key: "demo",
    queued_count: 0,
    reconciled_count: 0,
    target_branch: "master",
    workload: { evidence_count: 0, audit_count: 0 },
  });
});

test("IngestService leaves non-content replay rows untouched without creating an anchor", async () => {
  seedTerminalReplay();
  let spawned = false;
  const service = new IngestService(root, {
    now: () => new Date("2026-06-15T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
    spawn: () => {
      spawned = true;
      return { pid: 1234, unref: () => {} };
    },
  });

  const result = await service.start({ projectKey: "demo", provider: "codex" });

  expect(result).toMatchObject({
    kind: "no_work",
    project_key: "demo",
    queued_count: 0,
    reconciled_count: 0,
    workload: { evidence_count: 0, audit_count: 0 },
  });
  expect(spawned).toBe(false);

  const db = openMemoryDb(root);
  expect(listExperienceEvents(db, "demo")).toHaveLength(1);
  db.close();
});

test("IngestService returns the stable configuration blocker without launching a worker", async () => {
  seedExperienceEvent();
  let spawned = false;
  const service = new IngestService(root, {
    now: () => new Date("2026-06-15T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "feature/refactor\n", stderr: "" }),
    spawn: () => {
      spawned = true;
      return { pid: 1234, unref: () => {} };
    },
  });

  const result = await service.start({ projectKey: "demo", provider: "codex" });

  expect(result).toMatchObject({
    kind: "blocked",
    code: "session_memory_plan_config_unavailable",
    project_key: "demo",
    target_branch: null,
  });
  expect(spawned).toBe(false);
  const db = openMemoryDb(root);
  expect(db.query("SELECT count(*) AS count FROM ingest_jobs").get()).toEqual({ count: 0 });
  expect(db.query("SELECT count(*) AS count FROM project_session_mutation_fences").get()).toEqual({ count: 0 });
  db.close();
});

test("IngestService rejects legacy start after authority activation without persisting work", async () => {
  seedExperienceEvent();
  const db = openMemoryDb(root);
  db.query(
    "UPDATE session_memory_mutation_authority SET mode = 'smc_v1', updated_at = ? WHERE singleton_id = 1",
  ).run("2026-08-11T10:00:00.000Z");
  db.close();
  const service = new IngestService(root, {
    now: () => new Date("2026-08-11T10:01:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "feature/refactor\n", stderr: "" }),
    spawn: () => {
      throw new Error("legacy start must not spawn after activation");
    },
  });

  await expect(service.start({ projectKey: "demo", provider: "codex" }))
    .resolves.toMatchObject({ kind: "blocked", code: "session_memory_plan_config_unavailable" });

  const verified = openMemoryDb(root);
  try {
    expect(verified.query("SELECT count(*) AS count FROM ingest_jobs").get()).toEqual({ count: 0 });
    expect(verified.query("SELECT count(*) AS count FROM project_session_mutation_fences").get())
      .toEqual({ count: 0 });
  } finally {
    verified.close();
  }
});

test.each([
  ["limit", { limit: 0 }, "Invalid ingest limit: 0. Expected a positive integer"],
  ["negative limit", { limit: -1 }, "Invalid ingest limit: -1. Expected a positive integer"],
  ["fractional limit", { limit: 1.5 }, "Invalid ingest limit: 1.5. Expected a positive integer"],
  ["evidence chunk size", { evidenceChunkSize: 0 }, "Invalid ingest evidence chunk size: 0. Expected an integer between 1 and 500"],
  ["negative evidence chunk size", { evidenceChunkSize: -1 }, "Invalid ingest evidence chunk size: -1. Expected an integer between 1 and 500"],
  ["fractional evidence chunk size", { evidenceChunkSize: 1.5 }, "Invalid ingest evidence chunk size: 1.5. Expected an integer between 1 and 500"],
  ["oversized evidence chunk size", { evidenceChunkSize: 501 }, "Invalid ingest evidence chunk size: 501. Expected an integer between 1 and 500"],
] as const)("IngestService rejects an invalid %s at the service boundary", async (_name, input, message) => {
  const service = new IngestService(root, {
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
  });

  await expect(service.start({ projectKey: "demo", provider: "codex", ...input })).rejects.toThrow(message);
});

test("IngestService keeps compatibility selection limit distinct from internal evidence chunk size", async () => {
  seedExperienceEvent();
  const service = new IngestService(root, {
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
  });

  const result = await service.start({
    projectKey: "demo",
    provider: "codex",
    limit: 1,
    evidenceChunkSize: 2,
  });

  expect(result).toMatchObject({ kind: "blocked", code: "session_memory_plan_config_unavailable" });
  const db = openMemoryDb(root);
  expect(listExperienceEvents(db, "demo")).toHaveLength(1);
  expect(db.query("SELECT count(*) AS count FROM ingest_jobs").get()).toEqual({ count: 0 });
  db.close();
});

test("IngestService atomically prepares one anchor and launches only the companion worker", async () => {
  seedExperienceEvent("durable input");
  seedSMCContract();
  const spawns: string[][] = [];
  const service = new IngestService(root, {
    now: () => new Date("2026-08-11T12:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "feature/smc\n", stderr: "" }),
    spawn: (options) => {
      spawns.push(options.cmd);
      return { pid: 4321, unref: () => {} };
    },
    smcPlanConfig: smcPlanConfig(),
  });

  const result = await service.start({ projectKey: "demo", provider: "codex" });

  expect(result).toMatchObject({ kind: "started", selected_count: 1, target_branch: "feature/smc" });
  if (result.kind !== "started") throw new Error(JSON.stringify(result));
  expect(result.job.id).toStartWith("ingest_");
  expect(result.launches).toHaveLength(1);
  expect(spawns).toHaveLength(1);
  expect(spawns[0]?.slice(-3)).toEqual(["ingest", "worker", result.job.id]);
  const db = openMemoryDb(root);
  try {
    expect(db.query("SELECT count(*) AS count FROM ingest_jobs").get()).toEqual({ count: 1 });
    expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(result.job.id))
      .toEqual({ phase: "preparing" });
    expect(db.query("SELECT count(*) AS count FROM smc_manifests WHERE job_id = ?").get(result.job.id))
      .toEqual({ count: 1 });
    expect(db.query("SELECT state FROM experience_event_tombstones WHERE ingest_job_id = ?").get(result.job.id))
      .toEqual({ state: "claimed" });
  } finally {
    db.close();
  }
});

test("failure after preparation and before spawn leaves the same preparing anchor recoverable", async () => {
  seedExperienceEvent("durable input");
  seedSMCContract();
  let spawned = false;
  const service = new IngestService(root, {
    now: () => new Date("2026-08-11T12:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "feature/smc\n", stderr: "" }),
    spawn: () => { spawned = true; return { pid: 4321, unref: () => {} }; },
    smcPlanConfig: smcPlanConfig(),
    smcFailureInjection: {
      afterPreparationBeforeSpawn: () => { throw new Error("after preparation"); },
    },
  });

  await expect(service.start({ projectKey: "demo", provider: "codex" })).rejects.toThrow("after preparation");
  expect(spawned).toBe(false);
  assertOneRecoverablePreparingAnchor();
});

test("failure after spawn and before acknowledgement preserves one recoverable anchor", async () => {
  seedExperienceEvent("durable input");
  seedSMCContract();
  let spawnCount = 0;
  const service = new IngestService(root, {
    now: () => new Date("2026-08-11T12:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "feature/smc\n", stderr: "" }),
    spawn: () => { spawnCount += 1; return { pid: 4321, unref: () => {} }; },
    smcPlanConfig: smcPlanConfig(),
    smcFailureInjection: {
      afterSpawnBeforeAcknowledgement: () => { throw new Error("after spawn"); },
    },
  });

  await expect(service.start({ projectKey: "demo", provider: "codex" })).rejects.toThrow("after spawn");
  expect(spawnCount).toBe(1);
  assertOneRecoverablePreparingAnchor();
});

test("ordinary start ignores a legacy persisted SessionStart control row", async () => {
  seedControlEvent();
  const service = new IngestService(root, {
    now: () => new Date("2026-08-11T12:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "feature/smc\n", stderr: "" }),
    spawn: () => ({ pid: 4321, unref: () => {} }),
    smcPlanConfig: smcPlanConfig(),
  });
  const started = await service.start({ projectKey: "demo", provider: "codex" });
  expect(started).toMatchObject({ kind: "no_work", queued_count: 0 });

  const db = openMemoryDb(root);
  try {
    expect(db.query("SELECT count(*) AS count FROM session_memory_anchor_jobs").get()).toEqual({ count: 0 });
    expect(db.query("SELECT id FROM experience_events WHERE id = 'evt_control'").get()).toEqual({ id: "evt_control" });
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
}

function seedExperienceEvent(rawText?: string): void {
  const db = openMemoryDb(root);
  try {
    recordExperienceEvent(db, {
      id: "evt_1",
      project_key: "demo",
      occurred_at: "2026-06-15T09:00:00.000Z",
      event_kind: "user.prompt",
      provider: "codex",
      raw_text: rawText ?? "test content",
      raw_payload_json: "{}",
      source: "codex-hook",
      status: "valid",
    });
  } finally {
    db.close();
  }
}

function seedControlEvent(): void {
  const db = openMemoryDb(root);
  try {
    recordExperienceEvent(db, {
      id: "evt_control",
      project_key: "demo",
      occurred_at: "2026-08-11T11:59:00.000Z",
      hook_event_name: "SessionStart",
      event_kind: "session.start",
      provider: "codex",
      raw_payload_json: "{}",
      source: "codex-hook",
      status: "valid",
    });
  } finally {
    db.close();
  }
}

function smcPlanConfig() {
  return {
    auditPartitionLimit: 10,
    evidenceBudgets: {
      max_items_per_batch: 100,
      max_encoded_bytes_per_batch: 100_000,
      max_encoded_bytes_per_item: 100_000,
    },
    workflowBudgets: SMC_TEST_WORKFLOW_BUDGETS,
  };
}

function seedSMCContract() {
  const db = openMemoryDb(root);
  try {
    return configureSMCTestContract(db);
  } finally {
    db.close();
  }
}

function assertOneRecoverablePreparingAnchor(): void {
  const db = openMemoryDb(root);
  try {
    expect(db.query("SELECT count(*) AS count FROM ingest_jobs").get()).toEqual({ count: 1 });
    expect(db.query("SELECT phase FROM session_memory_anchor_jobs").get()).toEqual({ phase: "preparing" });
    expect(db.query("SELECT state FROM experience_event_tombstones").get()).toEqual({ state: "claimed" });
    expect(db.query("SELECT phase FROM project_session_mutation_fences").get()).toEqual({ phase: "preparing" });
  } finally {
    db.close();
  }
}

function seedTerminalReplay(): void {
  const db = openMemoryDb(root);
  try {
    recordExperienceEvent(db, {
      id: "evt_replayed",
      project_key: "demo",
      occurred_at: "2026-06-15T09:00:00.000Z",
      provider: "codex",
      raw_payload_json: "{}",
      source: "codex-hook",
      status: "valid",
    });
    tombstoneExperienceEvent(db, {
      id: "tomb_replayed",
      original_event_id: "evt_replayed",
      project_key: "demo",
      processed_at: "2026-06-15T09:05:00.000Z",
      terminal_decision: "accepted",
      output_references: ["session_memory:mem_replayed"],
    });
    db.query(
      `INSERT INTO experience_events
        (id, project_key, occurred_at, provider, raw_payload_json, source, status, inserted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "evt_replayed",
      "demo",
      "2026-06-15T09:00:00.000Z",
      "codex",
      "{}",
      "codex-hook",
      "valid",
      "2026-06-15T09:00:01.000Z",
    );
  } finally {
    db.close();
  }
}
