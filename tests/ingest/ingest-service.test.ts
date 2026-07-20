import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IngestService } from "../../src/ingest/ingest-service.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import {
  listExperienceEvents,
  recordExperienceEvent,
  tombstoneExperienceEvent,
} from "../../src/memory/experience.ts";
import { writeJson } from "../../src/runtime/json.ts";

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
    jobs: [],
  });
});

test("IngestService reconciles terminally tombstoned replay rows before creating jobs", async () => {
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
    reconciled_count: 1,
    jobs: [],
  });
  expect(spawned).toBe(false);

  const db = openMemoryDb(root);
  expect(listExperienceEvents(db, "demo")).toEqual([]);
  db.close();
});

test("IngestService starts workers on non-master and returns branch metadata", async () => {
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
    kind: "started",
    project_key: "demo",
    target_branch: "feature/refactor",
  });
  expect(spawned).toBe(true);
  if (result.kind !== "started") throw new Error("expected started");
  expect(result.job.status).toBe("running");
  expect(JSON.parse(result.job.input_json)).toMatchObject({ target_branch: "feature/refactor" });
});

test.each([
  ["limit", { limit: 0 }, "Invalid ingest limit: 0. Expected a positive integer"],
  ["negative limit", { limit: -1 }, "Invalid ingest limit: -1. Expected a positive integer"],
  ["fractional limit", { limit: 1.5 }, "Invalid ingest limit: 1.5. Expected a positive integer"],
  ["batch size", { batchSize: 0 }, "Invalid ingest batch size: 0. Expected an integer between 1 and 500"],
  ["negative batch size", { batchSize: -1 }, "Invalid ingest batch size: -1. Expected an integer between 1 and 500"],
  ["fractional batch size", { batchSize: 1.5 }, "Invalid ingest batch size: 1.5. Expected an integer between 1 and 500"],
  ["oversized batch size", { batchSize: 501 }, "Invalid ingest batch size: 501. Expected an integer between 1 and 500"],
] as const)("IngestService rejects an invalid %s at the service boundary", async (_name, input, message) => {
  const service = new IngestService(root, {
    runner: async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }),
  });

  await expect(service.start({ projectKey: "demo", provider: "codex", ...input })).rejects.toThrow(message);
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

function seedExperienceEvent(): void {
  const db = openMemoryDb(root);
  try {
    recordExperienceEvent(db, {
      id: "evt_1",
      project_key: "demo",
      occurred_at: "2026-06-15T09:00:00.000Z",
      provider: "codex",
      raw_payload_json: "{}",
      source: "codex-hook",
      status: "valid",
    });
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
