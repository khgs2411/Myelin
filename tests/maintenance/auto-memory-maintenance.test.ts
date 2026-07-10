import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutoMemoryMaintenanceService, readState } from "../../src/maintenance/auto-memory-maintenance.ts";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import { stubEmbeddingFilename } from "../../src/memory/embedding-provider.ts";
import { recordExperienceEvent } from "../../src/memory/experience.ts";
import { INGEST_COMPLETION_LAYERS, type IngestJobRow } from "../../src/memory/ingest-types.ts";
import { createSessionMemory } from "../../src/memory/session-memories.ts";
import { normalizeSessionMemoryForEmbedding } from "../../src/memory/session-memory-text.ts";
import type { DetachedSpawner } from "../../src/ingest/runtime.ts";
import { bootstrapProject } from "../../src/runtime/bootstrap.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";

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
  expect(spawned[0].cmd).toEqual(["bun", join(root, "src", "maintenance", "worker.ts"), "demo"]);
  expect(spawned[0].env.MYELIN_CAPTURE_DISABLED).toBe("1");
  expect(spawned[0].env.MYELIN_AUTO_MEMORY_MAINTENANCE_WORKER).toBe("1");
  expect(spawned[0].env.MYELIN_AUTO_MEMORY_RUN_ID).toBeString();
  await expect(Bun.file(join(root, "projects", "demo", "state", ".auto-memory-maintenance.lock", "owner.json")).exists()).resolves.toBe(true);
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

  expect(skipped).toMatchObject({ status: "skipped", reason: "below captured event threshold" });
  expect(scheduled.status).toBe("scheduled");
  expect(spawned).toHaveLength(1);
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
  await expect(Bun.file(join(root, "projects", "demo", "state", ".auto-memory-maintenance.lock", "owner.json")).exists()).resolves.toBe(false);

  await service.maybeSchedule("demo");
  await expect(readState(root, "demo")).resolves.toMatchObject({
    last_run_id: "auto_memory_test",
    last_status: "completed",
    last_check_status: "skipped",
    last_check_reason: "below captured event threshold",
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
  const dbPath = join(root, "state", "memory.db");
  const db = openMemoryDbAt(dbPath);
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

test("auto memory maintenance runs one bounded drain window and schedules continuation above threshold", async () => {
  await writeConfig([
    "AUTO_MEMORY_MAINTENANCE=1",
    "AUTO_MEMORY_MIN_CAPTURED_EVENTS=2",
    "AUTO_MEMORY_DRAIN_POLL_INTERVAL_MS=1",
    "AUTO_MEMORY_DRAIN_TIMEOUT_MS=1000",
    "INGEST_BATCH_SIZE=4",
  ]);
  seedExperienceEvents(10);

  const starts: Array<{ limit?: number; batchSize?: number }> = [];
  const indexCalls: Array<{ projectKey: string; limit: number; batchSize: number; retryFailed: boolean }> = [];
  const spawned: Array<Parameters<DetachedSpawner>[0]> = [];
  let statusReads = 0;

  const result = await new AutoMemoryMaintenanceService(root, {
    now: () => new Date("2026-06-17T20:00:00.000Z"),
    sleep: async () => {},
    ingestService: {
      async start(input) {
        starts.push({ limit: input.limit, batchSize: input.batchSize });
        return {
          kind: "started",
          project_key: input.projectKey,
          queued_count: 10,
          selected_count: input.limit ?? 10,
          batch_size: input.batchSize ?? 4,
          batch_count: 1,
          target_branch: "master",
          job: fakeIngestJob(),
          jobs: [],
          launches: [],
        };
      },
      async status() {
        statusReads += 1;
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
    indexed: 3,
    queued_remaining: 10,
    rescheduled: true,
  });
  expect(starts).toEqual([{ limit: 4, batchSize: 4 }]);
  expect(indexCalls).toEqual([{ projectKey: "demo", limit: 500, batchSize: 50, retryFailed: false }]);
  expect(spawned).toHaveLength(1);
  expect(spawned[0].cmd).toEqual(["bun", join(root, "src", "maintenance", "worker.ts"), "demo"]);
  await expect(readState(root, "demo")).resolves.toMatchObject({
    project_key: "demo",
    last_status: "scheduled",
    last_pid: 4321,
    last_counts: { queued_count: 10 },
  });
});

test("auto memory maintenance schedules continuation while active embeddings remain pending", async () => {
  await writeConfig([
    "AUTO_MEMORY_MAINTENANCE=1",
    "AUTO_MEMORY_MIN_CAPTURED_EVENTS=2",
    "AUTO_MEMORY_COOLDOWN_MS=0",
  ]);
  const spawned: Array<Parameters<DetachedSpawner>[0]> = [];

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
    status: "completed",
    queued_remaining: 0,
    pending_remaining: 1,
    rescheduled: true,
  });
  expect(spawned).toHaveLength(1);
});

async function writeConfig(lines: string[]): Promise<void> {
  await writeFile(join(root, "myelin.config"), `${lines.join("\n")}\n`, "utf8");
}

function seedExperienceEvents(count: number, offset = 0): void {
  const db = openMemoryDbAt(join(root, "state", "memory.db"));
  try {
    for (let index = 0; index < count; index += 1) {
      const id = `evt_${offset + index + 1}`;
      recordExperienceEvent(db, {
        id,
        project_key: "demo",
        occurred_at: `2026-06-17T20:00:${String(offset + index).padStart(2, "0")}.000Z`,
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
