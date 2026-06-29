import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDb, type MemoryDb } from "../../src/memory/db.ts";
import {
  createProjectMemoryHintJob,
  listProjectMemoryHintJobs,
  markProjectMemoryHintJobCompleted,
  markProjectMemoryHintJobFailed,
  markProjectMemoryHintJobRunning,
} from "../../src/memory/project-memory-hint-jobs.ts";

let root: string;
let db: MemoryDb;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-pm-hint-jobs-"));
  db = openMemoryDb(root);
});

afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});

test("creates and completes Project Memory hint jobs", () => {
  const job = createProjectMemoryHintJob(db, {
    project_key: "demo",
    category: "architecture",
    required: true,
    section_refs: ["wiki/architecture/ranking.md#ranking"],
    provider: "codex",
    model: "stub-hints",
    now: "2026-06-28T10:00:00.000Z",
  });

  const running = markProjectMemoryHintJobRunning(db, {
    id: job.id,
    run_ref: "projects/demo/runs/project-learn/hints-run",
    now: "2026-06-28T10:01:00.000Z",
  });
  const completed = markProjectMemoryHintJobCompleted(db, {
    id: job.id,
    run_ref: "projects/demo/runs/project-learn/hints-run",
    now: "2026-06-28T10:02:00.000Z",
  });

  expect(job.status).toBe("pending");
  expect(job.required).toBe(1);
  expect(JSON.parse(job.section_refs_json)).toEqual(["wiki/architecture/ranking.md#ranking"]);
  expect(running.status).toBe("running");
  expect(completed.status).toBe("completed");
  expect(completed.completed_at).toBe("2026-06-28T10:02:00.000Z");
});

test("marks failed hint jobs and lists by status", () => {
  const job = createProjectMemoryHintJob(db, {
    project_key: "demo",
    category: null,
    required: false,
    section_refs: ["wiki/index.md#demo"],
    now: "2026-06-28T10:00:00.000Z",
  });

  const failed = markProjectMemoryHintJobFailed(db, {
    id: job.id,
    failure_reason: "provider failed",
    now: "2026-06-28T10:03:00.000Z",
  });

  expect(failed.status).toBe("failed");
  expect(failed.failure_reason).toBe("provider failed");
  expect(listProjectMemoryHintJobs(db, { project_key: "demo", status: "failed" }).map((row) => row.id)).toEqual([job.id]);
});
