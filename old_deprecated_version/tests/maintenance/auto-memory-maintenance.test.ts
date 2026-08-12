import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutoMemoryMaintenanceService, readState } from "../../src/maintenance/auto-memory-maintenance.ts";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import { stubEmbeddingFilename } from "../../src/memory/providers/stub-embedding-provider.ts";
import { recordExperienceEvent } from "../../src/memory/experience.ts";
import { INGEST_COMPLETION_LAYERS, type IngestJobRow } from "../../src/memory/ingest-types.ts";
import { createSessionMemory } from "../helpers/session-mutation-authority.ts";
import { normalizeSessionMemoryForEmbedding } from "../../src/memory/session-memory-text.ts";
import type { DetachedSpawner } from "../../src/ingest/runtime.ts";
import { bootstrapProject } from "../../src/runtime/bootstrap.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import { registerInitialActiveEmbeddingContract } from "../../src/memory/embedding-contract-store.ts";

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-auto-memory-"));
  repo = join(root, "repos", "demo");
  await mkdir(repo, { recursive: true });
  await bootstrapProject(root, "demo", repo);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("auto memory maintenance stays disabled unless explicitly configured", async () => {
  seedExperienceEvents(5);

  const result = await new AutoMemoryMaintenanceService(root).maybeSchedule("demo");

  expect(result).toEqual({ status: "disabled", reason: "AUTO_MEMORY_MAINTENANCE is not enabled" });
});

test("auto memory maintenance schedules a detached worker when threshold is reached", async () => {
  await writeConfig(["AUTO_MEMORY_MAINTENANCE=1", "AUTO_MEMORY_MIN_CAPTURED_EVENTS=2", "AUTO_MEMORY_COOLDOWN_MS=0"]);
  seedExperienceEvents(2);
  const spawned: Array<Parameters<DetachedSpawner>[0]> = [];

  const result = await new AutoMemoryMaintenanceService(root, {
    now: () => new Date("2026-06-17T20:00:00.000Z"),
    spawn: (options) => {
      spawned.push(options);
      return { pid: 1234, unref: () => {} };
    },
  }).maybeSchedule("demo");

  expect(result).toMatchObject({
    status: "scheduled",
    project_key: "demo",
    pid: 1234,
    queued_count: 2,
  });
  expect(spawned).toHaveLength(1);
  expect(spawned[0].cmd).toEqual([
    process.execPath,
    join(root, "src", "cli.ts"),
    "maintenance",
    "worker",
    "session",
    "demo",
  ]);
  expect(spawned[0].cwd).toBe(repo);
  expect(spawned[0].env.MYELIN_INTERNAL_INVOCATION_KIND).toBe("worker");
  expect(spawned[0].env.MYELIN_CAPTURE_DISABLED).toBe("1");
  expect(spawned[0].env.MYELIN_AUTO_MEMORY_MAINTENANCE_WORKER).toBe("1");
  expect(spawned[0].env.MYELIN_AUTO_MEMORY_RUN_ID).toBeString();
  await expect(Bun.file(join(root, "state", "demo", ".auto-memory-maintenance.lock", "owner.json")).exists()).resolves.toBe(true);
  await expect(readState(root, "demo")).resolves.toMatchObject({
    project_key: "demo",
    last_status: "scheduled",
    last_pid: 1234,
    last_counts: { queued_count: 2 },
  });
});

test("auto memory maintenance skips below threshold without starting cooldown", async () => {
  await writeConfig([
    "AUTO_MEMORY_MAINTENANCE=1",
    "AUTO_MEMORY_MIN_CAPTURED_EVENTS=2",
    "AUTO_MEMORY_COOLDOWN_MS=300000",
  ]);
  seedExperienceEvents(1);
  const spawned: Array<Parameters<DetachedSpawner>[0]> = [];
  const service = new AutoMemoryMaintenanceService(root, {
    now: () => new Date("2026-06-17T20:00:00.000Z"),
    spawn: (options) => {
      spawned.push(options);
      return { pid: 1234, unref: () => {} };
    },
  });

  const skipped = await service.maybeSchedule("demo");
  seedExperienceEvents(1, 2);
  const scheduled = await service.maybeSchedule("demo");

  expect(skipped).toMatchObject({ status: "skipped", reason: "no eligible Session Memory work" });
  expect(scheduled.status).toBe("scheduled");
  expect(spawned).toHaveLength(1);
});

test("auto memory maintenance schedules active embedding work below the capture threshold", async () => {
  await writeConfig([
    "AUTO_MEMORY_MAINTENANCE=1",
    "AUTO_MEMORY_MIN_CAPTURED_EVENTS=25",
    "AUTO_MEMORY_COOLDOWN_MS=0",
  ]);
  const db = openMemoryDbAt(join(root, "state", "memory", "memory.db"));
  registerInitialActiveEmbeddingContract(db, {
    scope: "session_memory",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
  });
  createSessionMemory(db, {
    id: "mem_pending_below_capture_threshold",
    project_key: "demo",
    source_event_refs: ["tomb_pending"],
    memory_kind: "continuity",
    title: "Pending embedding",
    summary: "This row should schedule indexing independently of capture pressure.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-07-13T00:00:00.000Z",
  });
  db.query("DELETE FROM session_memory_embeddings WHERE session_memory_id = ?")
    .run("mem_pending_below_capture_threshold");
  db.close();
  const spawned: Array<Parameters<DetachedSpawner>[0]> = [];

  const result = await new AutoMemoryMaintenanceService(root, {
    spawn: (options) => {
      spawned.push(options);
      return { pid: 9876, unref: () => {} };
    },
  }).maybeSchedule("demo");

  expect(result).toMatchObject({ status: "scheduled", queued_count: 0 });
  expect(spawned).toHaveLength(1);
  expect(spawned[0].env.MYELIN_AUTO_MEMORY_FORCE_INGEST).toBeUndefined();
});

test("SessionStart can force maintenance below the threshold and through cooldown", async () => {
  await writeConfig([
    "AUTO_MEMORY_MAINTENANCE=1",
    "AUTO_MEMORY_MIN_CAPTURED_EVENTS=25",
    "AUTO_MEMORY_COOLDOWN_MS=300000",
  ]);
  seedExperienceEvents(1);
  const spawned: Array<Parameters<DetachedSpawner>[0]> = [];
  const service = new AutoMemoryMaintenanceService(root, {
    now: () => new Date("2026-06-17T20:00:00.000Z"),
    spawn: (options) => {
      spawned.push(options);
      return { pid: 1234, unref: () => {} };
    },
  });

  const result = await service.maybeSchedule("demo", { forceIngest: true });

  expect(result).toMatchObject({ status: "scheduled", queued_count: 1 });
  expect(spawned[0].env.MYELIN_SESSION_MAINTENANCE_WAKE_KIND).toBe("session_start");
});

test("auto memory maintenance lock prevents duplicate scheduling", async () => {
  await writeConfig(["AUTO_MEMORY_MAINTENANCE=1", "AUTO_MEMORY_MIN_CAPTURED_EVENTS=1", "AUTO_MEMORY_COOLDOWN_MS=0"]);
  seedExperienceEvents(1);
  const service = new AutoMemoryMaintenanceService(root, {
    spawn: () => ({ pid: 1234, unref: () => {} }),
    isProcessAlive: () => true,
  });

  await service.maybeSchedule("demo");
  const duplicate = await service.maybeSchedule("demo");

  expect(duplicate).toMatchObject({ status: "skipped", reason: "maintenance already locked" });
});

test("auto memory maintenance recovers a dead detached worker lock", async () => {
  await writeConfig(["AUTO_MEMORY_MAINTENANCE=1", "AUTO_MEMORY_MIN_CAPTURED_EVENTS=1", "AUTO_MEMORY_COOLDOWN_MS=0"]);
  seedExperienceEvents(1);
  let pid = 1234;
  const service = new AutoMemoryMaintenanceService(root, {
    spawn: () => ({ pid, unref: () => {} }),
    isProcessAlive: (candidate) => candidate !== 1234,
  });

  await service.maybeSchedule("demo");
  pid = 2468;
  const recovered = await service.maybeSchedule("demo");

  expect(recovered).toMatchObject({
    status: "scheduled",
    project_key: "demo",
    pid: 2468,
  });
  await expect(readState(root, "demo")).resolves.toMatchObject({
    last_status: "scheduled",
    last_pid: 2468,
  });
});

test("auto memory maintenance run records completed state when no work remains", async () => {
  await writeConfig([
    "AUTO_MEMORY_MAINTENANCE=1",
    "AUTO_MEMORY_MIN_CAPTURED_EVENTS=1",
    "AUTO_MEMORY_DRAIN_POLL_INTERVAL_MS=1",
    "AUTO_MEMORY_DRAIN_TIMEOUT_MS=1000",
  ]);
  const service = new AutoMemoryMaintenanceService(root, {
    now: () => new Date("2026-06-17T20:00:00.000Z"),
    sleep: async () => {},
  });

  const result = await service.run("demo", "auto_memory_test");

  expect(result).toMatchObject({
    status: "completed",
    project_key: "demo",
    run_id: "auto_memory_test",
    ingest_started: false,
    indexed: 0,
    index_failed: 0,
    pending_remaining: 0,
  });
  await expect(readState(root, "demo")).resolves.toMatchObject({
    project_key: "demo",
    last_run_id: "auto_memory_test",
    last_status: "completed",
    last_counts: {
      queued_count: 0,
      indexed: 0,
      index_failed: 0,
      pending_remaining: 0,
    },
  });
  await expect(Bun.file(join(root, "state", "demo", ".auto-memory-maintenance.lock", "owner.json")).exists()).resolves.toBe(false);

  await service.maybeSchedule("demo");
  await expect(readState(root, "demo")).resolves.toMatchObject({
    last_run_id: "auto_memory_test",
    last_status: "completed",
    last_check_status: "skipped",
    last_check_reason: "no eligible Session Memory work",
  });
});

test("auto memory maintenance keeps SQLite open until asynchronous indexing completes", async () => {
  const stubDir = join(root, "embedding-stubs");
  await mkdir(stubDir, { recursive: true });
  await writeConfig([
    "AUTO_MEMORY_MAINTENANCE=1",
    "AUTO_MEMORY_MIN_CAPTURED_EVENTS=1",
    `EMBEDDING_STUB_RESPONSES_DIR=${stubDir}`,
  ]);
  const dbPath = join(root, "state", "memory", "memory.db");
  const db = openMemoryDbAt(dbPath);
  registerInitialActiveEmbeddingContract(db, {
    scope: "session_memory",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
  });
  const memory = createSessionMemory(db, {
    id: "mem_pending",
    project_key: "demo",
    source_event_refs: ["tomb_1"],
    memory_kind: "continuity",
    title: "Pending memory",
    summary: "Index this memory after asynchronous provider work.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-17T20:00:00.000Z",
  });
  db.close();
  const text = normalizeSessionMemoryForEmbedding(memory);
  await writeFile(
    join(stubDir, stubEmbeddingFilename({
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      title: memory.title,
      text,
    })),
    JSON.stringify({
      embedding: Array(DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.dimensions).fill(0.01),
      model: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.model,
      dimensions: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.dimensions,
    }),
    "utf8",
  );

  const result = await new AutoMemoryMaintenanceService(root).run("demo", "auto_memory_async_index");

  expect(result).toMatchObject({ status: "completed", indexed: 1, index_failed: 0, pending_remaining: 0 });
  const verificationDb = openMemoryDbAt(dbPath);
  expect(verificationDb.query(
    "SELECT status FROM session_memory_embeddings WHERE session_memory_id = 'mem_pending'",
  ).get()).toEqual({ status: "indexed" });
  verificationDb.close();
});

test("auto memory maintenance starts one durable anchor without polling or continuation", async () => {
  await writeConfig([
    "AUTO_MEMORY_MAINTENANCE=1",
    "AUTO_MEMORY_MIN_CAPTURED_EVENTS=2",
    "AUTO_MEMORY_DRAIN_POLL_INTERVAL_MS=1",
    "AUTO_MEMORY_DRAIN_TIMEOUT_MS=1000",
    "INGEST_BATCH_SIZE=4",
  ]);
  seedExperienceEvents(10);

  const starts: Array<{ limit?: number; evidenceChunkSize?: number }> = [];
  const indexCalls: Array<{ projectKey: string; limit: number; batchSize: number; retryFailed: boolean }> = [];
  const spawned: Array<Parameters<DetachedSpawner>[0]> = [];
  let statusReads = 0;

  const result = await new AutoMemoryMaintenanceService(root, {
    now: () => new Date("2026-06-17T20:00:00.000Z"),
    sleep: async () => {},
    ingestService: {
      async start(input) {
        starts.push({ limit: input.limit, evidenceChunkSize: input.evidenceChunkSize });
        return {
          kind: "started",
          project_key: input.projectKey,
          queued_count: 10,
          reconciled_count: 0,
          selected_count: input.limit ?? 10,
          evidence_chunk_size: input.evidenceChunkSize ?? 4,
          target_branch: "master",
          job: fakeIngestJob(),
          workload: { evidence_count: input.limit ?? 10, audit_count: 0 },
          launches: [],
        };
      },
      async status() {
        statusReads += 1;
        if (statusReads === 2) deleteExperienceEvents(6);
        return {
          kind: "project",
          status: ingestProjectStatus(statusReads === 1 ? 1 : 0),
        };
      },
    },
    async indexPending(input) {
      indexCalls.push(input);
      return { indexed: 3, failed: 0, pending_remaining: 0 };
    },
    spawn: (options) => {
      spawned.push(options);
      return { pid: 4321, unref: () => {} };
    },
  }).run("demo", "auto_memory_test");

  expect(result).toMatchObject({
    status: "completed",
    ingest_started: true,
    indexed: 0,
    queued_remaining: 10,
    rescheduled: false,
  });
  expect(starts).toEqual([{ limit: undefined, evidenceChunkSize: undefined }]);
  expect(statusReads).toBe(0);
  expect(indexCalls).toEqual([]);
  expect(spawned).toHaveLength(0);
  await expect(readState(root, "demo")).resolves.toMatchObject({
    project_key: "demo",
    last_status: "completed",
    last_counts: { queued_count: 10, queued_remaining: 10, rescheduled: false },
  });
});

test("auto memory maintenance does not infer failure from an asynchronously owned queue", async () => {
  await writeConfig([
    "AUTO_MEMORY_MAINTENANCE=1",
    "AUTO_MEMORY_MIN_CAPTURED_EVENTS=2",
    "AUTO_MEMORY_DRAIN_POLL_INTERVAL_MS=1",
    "AUTO_MEMORY_DRAIN_TIMEOUT_MS=1000",
    "INGEST_BATCH_SIZE=4",
  ]);
  seedExperienceEvents(4);
  const spawned: Array<Parameters<DetachedSpawner>[0]> = [];

  const result = await new AutoMemoryMaintenanceService(root, {
    ingestService: {
      async start(input) {
        return {
          kind: "started",
          project_key: input.projectKey,
          queued_count: 4,
          reconciled_count: 0,
          selected_count: 4,
          evidence_chunk_size: 4,
          target_branch: "master",
          job: fakeIngestJob(),
          workload: { evidence_count: 4, audit_count: 0 },
          launches: [],
        };
      },
      async status() {
        return { kind: "project", status: ingestProjectStatus(0) };
      },
    },
    async indexPending() {
      return { indexed: 0, failed: 0, pending_remaining: 0 };
    },
    spawn: (options) => {
      spawned.push(options);
      return { pid: 4321, unref: () => {} };
    },
  }).run("demo", "auto_memory_no_progress");

  expect(result).toMatchObject({
    status: "completed",
    ingest_started: true,
    queued_remaining: 4,
    rescheduled: false,
  });
  expect(spawned).toHaveLength(0);
  await expect(readState(root, "demo")).resolves.toMatchObject({
    last_status: "completed",
    last_counts: { queued_count: 4, queued_remaining: 4, rescheduled: false },
  });
});

test("forced SessionStart worker ingests a below-threshold queue", async () => {
  await writeConfig([
    "AUTO_MEMORY_MAINTENANCE=1",
    "AUTO_MEMORY_MIN_CAPTURED_EVENTS=25",
    "AUTO_MEMORY_DRAIN_POLL_INTERVAL_MS=1",
    "AUTO_MEMORY_DRAIN_TIMEOUT_MS=1000",
  ]);
  seedExperienceEvents(1);
  let starts = 0;
  process.env.MYELIN_SESSION_MAINTENANCE_WAKE_KIND = "session_start";
  try {
    const result = await new AutoMemoryMaintenanceService(root, {
      sleep: async () => {},
      ingestService: {
        async start(input) {
          starts += 1;
          return {
            kind: "started",
            project_key: input.projectKey,
            queued_count: 1,
            reconciled_count: 0,
            selected_count: 1,
            evidence_chunk_size: input.evidenceChunkSize ?? 1,
            target_branch: "master",
            job: fakeIngestJob(),
            workload: { evidence_count: 1, audit_count: 0 },
            launches: [],
          };
        },
        async status() {
          return { kind: "project", status: ingestProjectStatus(0) };
        },
      },
      async indexPending() {
        return { indexed: 0, failed: 0, pending_remaining: 0 };
      },
    }).run("demo", "auto_memory_forced_start");

    expect(result).toMatchObject({ status: "completed", ingest_started: true, queued_remaining: 1 });
    expect(starts).toBe(1);
  } finally {
    delete process.env.MYELIN_SESSION_MAINTENANCE_WAKE_KIND;
  }
});

test("auto memory maintenance reports incomplete indexing instead of creating a continuation loop", async () => {
  await writeConfig([
    "AUTO_MEMORY_MAINTENANCE=1",
    "AUTO_MEMORY_MIN_CAPTURED_EVENTS=2",
    "AUTO_MEMORY_COOLDOWN_MS=0",
  ]);
  const spawned: Array<Parameters<DetachedSpawner>[0]> = [];
  const db = openMemoryDbAt(join(root, "state", "memory", "memory.db"));
  registerInitialActiveEmbeddingContract(db, {
    scope: "session_memory",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
  });
  createSessionMemory(db, {
    id: "mem_pending_remaining", project_key: "demo", source_event_refs: ["source"], memory_kind: "continuity",
    summary: "Pending", payload: {}, confidence: "high", risk: "low", now: "2026-06-17T20:00:00.000Z",
  });
  db.close();

  const result = await new AutoMemoryMaintenanceService(root, {
    async indexPending() {
      return { indexed: 500, failed: 0, pending_remaining: 1 };
    },
    spawn: (options) => {
      spawned.push(options);
      return { pid: 4321, unref: () => {} };
    },
  }).run("demo", "auto_memory_pending_index");

  expect(result).toMatchObject({
    status: "failed",
    error_message: expect.stringContaining("session_memory_indexing_incomplete"),
  });
  expect(spawned).toHaveLength(0);
});

async function writeConfig(lines: string[]): Promise<void> {
  await writeFile(join(root, "myelin.config"), `${lines.join("\n")}\n${smcPlanConfig()}\n`, "utf8");
}

function seedExperienceEvents(count: number, offset = 0): void {
  const db = openMemoryDbAt(join(root, "state", "memory", "memory.db"));
  try {
    for (let index = 0; index < count; index += 1) {
      const id = `evt_${offset + index + 1}`;
      recordExperienceEvent(db, {
        id,
        project_key: "demo",
        occurred_at: `2026-06-17T20:00:${String(offset + index).padStart(2, "0")}.000Z`,
        event_kind: index % 2 === 0 ? "user.prompt" : "assistant.response",
        raw_text: `captured content ${offset + index + 1}`,
        provider: "codex",
        source: "codex-hook",
        raw_payload_json: "{}",
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

function deleteExperienceEvents(count: number): void {
  const db = openMemoryDbAt(join(root, "state", "memory", "memory.db"));
  try {
    db.query(
      `DELETE FROM experience_events
       WHERE id IN (
         SELECT id FROM experience_events WHERE project_key = ? ORDER BY occurred_at, id LIMIT ?
       )`,
    ).run("demo", count);
  } finally {
    db.close();
  }
}

function ingestProjectStatus(runningJobs: number) {
  return {
    project_key: "demo",
    completion_layer: INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_PENDING,
    completion_label: runningJobs > 0 ? "Experience Log drain running" : "Experience Log retry pending",
    counts: {
      active_events: 10,
      unleased_events: 10,
      leased_events: 0,
      running_jobs: runningJobs,
      failed_jobs: 0,
      terminal_tombstones: 0,
      session_memories: 0,
      memory_candidates: 0,
      handoff_instructions: 0,
      pending_session_memory_embeddings: 0,
    },
  };
}

function fakeIngestJob(): IngestJobRow {
  return {
    id: "ingest_test",
    project_key: "demo",
    status: "running",
    provider: "codex",
    provider_session_id: null,
    requested_by: null,
    input_json: "{}",
    output_counts_json: "{}",
    terminal_summary: null,
    error_json: null,
    followup_state_json: null,
    started_at: "2026-06-17T20:00:00.000Z",
    finished_at: null,
    created_at: "2026-06-17T20:00:00.000Z",
    updated_at: "2026-06-17T20:00:00.000Z",
  };
}
