import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AutoProjectMemoryMaintenanceService,
  readState,
} from "../../src/maintenance/auto-project-memory-maintenance.ts";
import type { DetachedSpawner } from "../../src/ingest/runtime.ts";
import { createMemoryCandidate } from "../../src/memory/candidates.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { registerInitialActiveEmbeddingContract } from "../../src/memory/embedding-contract-store.ts";
import { createRuntimeInboxItem } from "../../src/inbox/runtime-inbox-items.ts";
import { bootstrapProject } from "../../src/runtime/bootstrap.ts";

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-auto-project-memory-"));
  repo = join(root, "repos", "demo");
  await mkdir(repo, { recursive: true });
  await bootstrapProject(root, "demo", repo);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("auto project memory maintenance stays disabled unless explicitly configured", async () => {
  seedProjectCandidate("cand_1");

  const result = await new AutoProjectMemoryMaintenanceService(root).maybeSchedule(
    "demo",
    "session_memory_candidate_created",
  );

  expect(result).toEqual({
    status: "disabled",
    reason: "AUTO_PROJECT_MEMORY_MAINTENANCE is not enabled",
  });
});

test("auto project memory maintenance schedules a detached worker when project candidates reach threshold", async () => {
  await writeConfig([
    "AUTO_PROJECT_MEMORY_MAINTENANCE=1",
    "AUTO_PROJECT_MEMORY_MIN_PENDING_ITEMS=2",
    "AUTO_PROJECT_MEMORY_COOLDOWN_MS=0",
  ]);
  seedProjectCandidate("cand_1");
  seedProjectCandidate("cand_2");
  const spawned: Array<Parameters<DetachedSpawner>[0]> = [];

  const result = await new AutoProjectMemoryMaintenanceService(root, {
    now: () => new Date("2026-07-07T10:00:00.000Z"),
    spawn: (options) => {
      spawned.push(options);
      return { pid: 2468, unref: () => {} };
    },
  }).maybeSchedule("demo", "session_memory_candidate_created");

  expect(result).toMatchObject({
    status: "scheduled",
    project_key: "demo",
    pid: 2468,
    trigger: "session_memory_candidate_created",
    counts: { pending_inbox_items: 0, pending_project_candidates: 2 },
  });
  expect(spawned).toHaveLength(1);
  expect(spawned[0].cmd).toEqual([
    process.execPath,
    join(root, "src", "cli.ts"),
    "maintenance",
    "worker",
    "project",
    "demo",
  ]);
  expect(spawned[0].cwd).toBe(repo);
  expect(spawned[0].env.MYELIN_INTERNAL_INVOCATION_KIND).toBe("worker");
  expect(spawned[0].env.MYELIN_CAPTURE_DISABLED).toBe("1");
  expect(spawned[0].env.MYELIN_AUTO_PROJECT_MEMORY_MAINTENANCE_WORKER).toBe("1");
  expect(spawned[0].env.MYELIN_AUTO_PROJECT_MEMORY_RUN_ID).toBeString();
  await expect(readState(root, "demo")).resolves.toMatchObject({
    project_key: "demo",
    last_status: "scheduled",
    last_pid: 2468,
    last_trigger: "session_memory_candidate_created",
    last_counts: { pending_inbox_items: 0, pending_project_candidates: 2 },
  });
});

test("auto project memory maintenance counts only un-intaked inbox items", async () => {
  await writeConfig([
    "AUTO_PROJECT_MEMORY_MAINTENANCE=1",
    "AUTO_PROJECT_MEMORY_MIN_PENDING_ITEMS=2",
    "AUTO_PROJECT_MEMORY_COOLDOWN_MS=0",
  ]);
  const first = await createInbox("2026-07-07T10-00-00.000Z_aaaaaa");
  await createInbox("2026-07-07T10-00-01.000Z_bbbbbb");
  seedProjectCandidate(`project_inbox:demo:${first}`, "processed");
  const service = new AutoProjectMemoryMaintenanceService(root);

  await expect(service.countPending("demo")).resolves.toEqual({
    pending_inbox_items: 1,
    pending_project_candidates: 0,
  });
});

test("auto project memory maintenance schedules retrieval indexing below the curation threshold", async () => {
  await writeConfig([
    "AUTO_PROJECT_MEMORY_MAINTENANCE=1",
    "AUTO_PROJECT_MEMORY_MIN_PENDING_ITEMS=5",
    "AUTO_PROJECT_MEMORY_COOLDOWN_MS=0",
  ]);
  const db = openMemoryDb(root);
  try {
    registerInitialActiveEmbeddingContract(db, {
      scope: "project_memory",
      contract: {
        provider: "ollama_nomic",
        model: "nomic-embed-text:v1.5",
        dimensions: 768,
        formatVersion: 1,
      },
    });
    db.query(
      `INSERT INTO project_memory_retrieval_embeddings
        (id, project_key, wiki_path, section_id, section_hash, hint_hash_key,
         embedding_provider, embedding_model, embedding_dimensions, embedding_purpose,
         format_version, status, created_at, updated_at)
       VALUES ('row_1', 'demo', 'wiki/topic.md', 'topic', 'hash', '',
         'ollama_nomic', 'nomic-embed-text:v1.5', 768, 'retrieval_document',
         1, 'pending', ?, ?)`,
    ).run("2026-07-07T10:00:00.000Z", "2026-07-07T10:00:00.000Z");
  } finally {
    db.close();
  }
  const spawned: Array<Parameters<DetachedSpawner>[0]> = [];

  const result = await new AutoProjectMemoryMaintenanceService(root, {
    spawn: (options) => {
      spawned.push(options);
      return { pid: 2468, unref: () => {} };
    },
  }).maybeSchedule("demo", "retrieval_index_pending");

  expect(result).toMatchObject({ status: "scheduled", trigger: "retrieval_index_pending" });
  expect(spawned).toHaveLength(1);
});

test("auto project memory maintenance run executes maintenance and releases the lock", async () => {
  await writeConfig(["AUTO_PROJECT_MEMORY_MAINTENANCE=1"]);
  const service = new AutoProjectMemoryMaintenanceService(root, {
    now: () => new Date("2026-07-07T10:00:00.000Z"),
    runMaintenance: async () => ({ status: "completed", changed_files: ["projects/demo/topic.md"] }),
  });

  const result = await service.run("demo", "auto_project_memory_test");

  expect(result).toMatchObject({
    status: "completed",
    project_key: "demo",
    run_id: "auto_project_memory_test",
    maintenance_status: "completed",
    changed_files: ["projects/demo/topic.md"],
  });
  await expect(
    Bun.file(join(root, "state", "demo", ".auto-project-memory-maintenance.lock", "owner.json")).exists(),
  ).resolves.toBe(false);
  await expect(readState(root, "demo")).resolves.toMatchObject({
    project_key: "demo",
    last_run_id: "auto_project_memory_test",
    last_status: "completed",
  });
});

test("auto project memory maintenance run records failed maintenance as failed", async () => {
  await writeConfig(["AUTO_PROJECT_MEMORY_MAINTENANCE=1"]);
  const service = new AutoProjectMemoryMaintenanceService(root, {
    now: () => new Date("2026-07-07T10:00:00.000Z"),
    runMaintenance: async () => ({ status: "failed", stopped_reason: "provider failed" }),
  });

  const result = await service.run("demo", "auto_project_memory_failed");

  expect(result).toMatchObject({
    status: "failed",
    project_key: "demo",
    run_id: "auto_project_memory_failed",
    error_message: "provider failed",
  });
  await expect(readState(root, "demo")).resolves.toMatchObject({
    project_key: "demo",
    last_run_id: "auto_project_memory_failed",
    last_status: "failed",
    last_reason: "provider failed",
  });
});

test("auto project memory maintenance treats explicit mutation contention as skipped", async () => {
  await writeConfig(["AUTO_PROJECT_MEMORY_MAINTENANCE=1"]);
  seedProjectCandidate("cand_1");
  const reason = "Project Memory mutation already running for demo: project_memory_project_maintenance_active. Wait for it to finish before starting project maintenance.";
  const service = new AutoProjectMemoryMaintenanceService(root, {
    now: () => new Date("2026-07-07T10:00:00.000Z"),
    runMaintenance: async () => {
      throw new Error(reason);
    },
  });

  const result = await service.run("demo", "auto_project_memory_contended");

  expect(result).toMatchObject({
    status: "skipped",
    project_key: "demo",
    run_id: "auto_project_memory_contended",
    reason,
    counts_after: { pending_project_candidates: 1 },
  });
  await expect(readState(root, "demo")).resolves.toMatchObject({
    last_run_id: "auto_project_memory_contended",
    last_status: "skipped",
    last_reason: reason,
  });
});

test("runtime inbox creation invokes project memory auto-maintenance scheduling", async () => {
  const scheduled: string[] = [];

  const result = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Document project maintenance",
    body: "Project maintenance should auto-run from inbox pressure.",
    rationale: "This should become durable project memory.",
    evidenceRefs: ["src/example.ts:1"],
    confidence: "high",
    risk: "low",
    creator: "test",
    now: new Date("2026-07-07T10:00:00.000Z"),
    autoProjectMaintenanceScheduler: {
      async maybeSchedule(projectKey, trigger) {
        scheduled.push(`${projectKey}:${trigger}`);
        return { status: "skipped", reason: "test scheduler" };
      },
    },
  });

  expect(result.status).toBe("created");
  expect(scheduled).toEqual(["demo:runtime_inbox_created"]);
});

async function writeConfig(lines: string[]): Promise<void> {
  await writeFile(join(root, "myelin.config"), `${lines.join("\n")}\n`, "utf8");
}

function seedProjectCandidate(id: string, status: "pending" | "needs_review" | "processed" | "rejected" = "pending"): void {
  const db = openMemoryDb(root);
  try {
    createMemoryCandidate(db, {
      id,
      project_key: "demo",
      scope: "project",
      status,
      candidate_type: "project.test",
      title: "Project candidate",
      summary: "Candidate summary",
      source_event_refs: ["test:source"],
      evidence: {},
      proposed_payload: {},
      confidence: "medium",
      risk: "low",
      reason: "test",
      now: "2026-07-07T10:00:00.000Z",
    });
  } finally {
    db.close();
  }
}

async function createInbox(id: string): Promise<string> {
  const result = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: `Inbox ${id}`,
    body: "Inbox body",
    rationale: "Inbox rationale",
    evidenceRefs: [],
    confidence: "medium",
    risk: "low",
    creator: "test",
    now: new Date("2026-07-07T10:00:00.000Z"),
    id,
    autoProjectMaintenanceScheduler: false,
  });
  if (result.status !== "created") throw new Error(`Failed to create inbox item: ${result.status}`);
  return result.item.id;
}
