import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IngestService } from "../../src/ingest/ingest-service.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { recordExperienceEvent } from "../../src/memory/experience.ts";
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
    target_branch: "master",
    jobs: [],
  });
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

async function seedProject(): Promise<void> {
  const repo = join(root, "repos", "demo");
  await mkdir(repo, { recursive: true });
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
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
