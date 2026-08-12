import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapProject } from "../../src/runtime/bootstrap.ts";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import { recordExperienceEvent } from "../../src/memory/experience.ts";
import { DefaultSessionMaintenanceScheduler } from "../../src/maintenance/session-maintenance-scheduler.ts";
import { createSessionMemory } from "../helpers/session-mutation-authority.ts";
import { registerInitialActiveEmbeddingContract } from "../../src/memory/embedding-contract-store.ts";
import { readActiveEmbeddingContract } from "../../src/memory/embedding-contract-store.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import { ensureSessionMemoryVectorTable } from "../../src/memory/sqlite-vec.ts";

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-session-scheduler-"));
  repo = join(root, "repos", "demo");
  await mkdir(repo, { recursive: true });
  await bootstrapProject(root, "demo", repo);
  await writeFile(join(root, "myelin.config"), `${planConfig()}\nAUTO_MEMORY_MIN_CAPTURED_EVENTS=25\nAUTO_MEMORY_MAX_PENDING_AGE_MS=86400000\n`, "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("root threshold and independent audit partition limit are used for manual starts", async () => {
  seedExperience("event-1");
  const starts: unknown[] = [];
  const scheduler = new DefaultSessionMaintenanceScheduler(root, {
    startAnchor: async (input) => {
      starts.push(input);
      return noWork();
    },
  });

  expect(await scheduler.evaluate("demo", "capture")).toMatchObject({
    evidence: { queued_count: 1, count_threshold_reached: false, due: false },
  });
  expect(await scheduler.run("demo", "manual")).toMatchObject({ kind: "anchor" });
  expect(starts).toEqual([{
    projectKey: "demo",
    triggerReason: "manual",
    includeAudit: false,
    auditPartitionLimit: 10,
    auditDueCount: 0,
  }]);
});

test("indexing completes before an eligible anchor starts", async () => {
  seedExperience("event-1");
  const db = openMemoryDbAt(join(root, "state", "memory", "memory.db"));
  registerInitialActiveEmbeddingContract(db, { scope: "session_memory", contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT });
  createSessionMemory(db, {
    id: "memory-1", project_key: "demo", source_event_refs: ["source-1"], memory_kind: "continuity",
    summary: "Pending index", payload: {}, confidence: "high", risk: "low", now: "2026-08-10T00:00:00.000Z",
  });
  db.close();
  const order: string[] = [];
  const scheduler = new DefaultSessionMaintenanceScheduler(root, {
    indexPending: async () => {
      order.push("index");
      const update = openMemoryDbAt(join(root, "state", "memory", "memory.db"));
      update.query("UPDATE session_memory_embeddings SET status = 'indexed'").run();
      const active = readActiveEmbeddingContract(update, "session_memory")!;
      ensureSessionMemoryVectorTable(update, { dimensions: active.dimensions, table: active.vectorTable });
      update.close();
      return { indexed: 1, failed: 0, pending_remaining: 0 };
    },
    startAnchor: async () => {
      order.push("anchor");
      return noWork();
    },
  });

  expect(await scheduler.run("demo", "manual")).toMatchObject({ kind: "anchor", indexing: { indexed: 1 } });
  expect(order).toEqual(["index", "anchor"]);
});

test("incomplete indexing blocks before anchor creation and index-only creates no anchor", async () => {
  const db = openMemoryDbAt(join(root, "state", "memory", "memory.db"));
  registerInitialActiveEmbeddingContract(db, { scope: "session_memory", contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT });
  createSessionMemory(db, {
    id: "memory-1", project_key: "demo", source_event_refs: ["source-1"], memory_kind: "continuity",
    summary: "Pending index", payload: {}, confidence: "high", risk: "low", now: "2026-08-10T00:00:00.000Z",
  });
  db.close();
  let starts = 0;
  const blocked = new DefaultSessionMaintenanceScheduler(root, {
    indexPending: async () => ({ indexed: 0, failed: 1, pending_remaining: 1 }),
    startAnchor: async () => { starts += 1; return noWork(); },
  });
  expect(await blocked.run("demo", "manual")).toMatchObject({
    kind: "blocked", code: "session_memory_indexing_incomplete",
  });
  expect(starts).toBe(0);

  const indexed = new DefaultSessionMaintenanceScheduler(root, {
    indexPending: async () => {
      const update = openMemoryDbAt(join(root, "state", "memory", "memory.db"));
      update.query("UPDATE session_memory_embeddings SET status = 'indexed'").run();
      const active = readActiveEmbeddingContract(update, "session_memory")!;
      ensureSessionMemoryVectorTable(update, { dimensions: active.dimensions, table: active.vectorTable });
      update.close();
      return { indexed: 1, failed: 0, pending_remaining: 0 };
    },
    startAnchor: async () => { starts += 1; return noWork(); },
  });
  expect(await indexed.run("demo", "index_request")).toMatchObject({ kind: "index_only", indexing: { indexed: 1 } });
  expect(starts).toBe(0);
});

test("indexing exceptions become typed blockers before anchor creation", async () => {
  const db = openMemoryDbAt(join(root, "state", "memory", "memory.db"));
  registerInitialActiveEmbeddingContract(db, { scope: "session_memory", contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT });
  createSessionMemory(db, {
    id: "memory-1", project_key: "demo", source_event_refs: ["source-1"], memory_kind: "continuity",
    summary: "Pending index", payload: {}, confidence: "high", risk: "low", now: "2026-08-10T00:00:00.000Z",
  });
  db.close();
  let starts = 0;
  const scheduler = new DefaultSessionMaintenanceScheduler(root, {
    indexPending: async () => { throw new Error("provider unavailable"); },
    startAnchor: async () => { starts += 1; return noWork(); },
  });

  expect(await scheduler.run("demo", "manual")).toMatchObject({
    kind: "blocked",
    code: "session_memory_indexing_incomplete",
    reason: "Session Memory indexing failed before anchor creation: provider unavailable",
  });
  expect(starts).toBe(0);
});

function seedExperience(id: string): void {
  const db = openMemoryDbAt(join(root, "state", "memory", "memory.db"));
  recordExperienceEvent(db, {
    id, project_key: "demo", occurred_at: "2026-08-11T00:00:00.000Z", event_kind: "user.prompt",
    provider: "codex", raw_text: "content", raw_payload_json: "{}", source: "test", status: "valid",
  });
  db.close();
}

function noWork() {
  return {
    kind: "no_work" as const, project_key: "demo", queued_count: 0, reconciled_count: 0,
    target_branch: "master", workload: { evidence_count: 0, audit_count: 0 },
  };
}

function planConfig(): string {
  return [
    "SMC_AUDIT_PARTITION_LIMIT=10", "SMC_MAX_ITEMS_PER_BATCH=100", "SMC_MAX_ENCODED_BYTES_PER_BATCH=1000000",
    "SMC_MAX_ENCODED_BYTES_PER_ITEM=100000", "SMC_MAX_AFFECTED_WORK_SET_SIZE=50",
    "SMC_MAX_CUMULATIVE_RETURNED_RESULT_BYTES=1000000", "SMC_MAX_PROVIDER_ENVELOPE_BYTES=1000000",
    "SMC_MAX_QUERIES=20", "SMC_MAX_TURNS=20", "SMC_RETRIEVAL_PAGE_ITEM_LIMIT=50",
    "SMC_SEMANTIC_DISTANCE_THRESHOLD_MICROS=500000", "SMC_SEMANTIC_QUALIFYING_RESULT_CEILING=100",
  ].join("\n");
}
