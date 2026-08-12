import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { createIngestJob, getIngestJob, updateIngestJobStatus } from "../../src/ingest/jobs.ts";

let dir: string;
let db: MemoryDb;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "myelin-ingest-jobs-"));
  db = openMemoryDbAt(join(dir, "memory.db"));
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

test("creates and updates an ingest job lifecycle row", () => {
  const job = createIngestJob(db, {
    id: "job_1",
    project_key: "class-kit",
    provider: "codex",
    input: { limit: 10 },
    now: "2026-06-13T10:00:00.000Z",
  });

  expect(job.status).toBe("starting");
  expect(job.provider_session_id).toBeNull();
  expect(JSON.parse(job.input_json)).toEqual({ limit: 10 });

  const running = updateIngestJobStatus(db, {
    id: "job_1",
    status: "running",
    provider_session_id: "sess_1",
    started_at: "2026-06-13T10:01:00.000Z",
    updated_at: "2026-06-13T10:01:00.000Z",
    followup_state: { pid: 1234, log_path: "/tmp/ingest.log" },
  });

  expect(running.status).toBe("running");
  expect(running.provider_session_id).toBe("sess_1");
  expect(JSON.parse(running.followup_state_json ?? "{}")).toEqual({ pid: 1234, log_path: "/tmp/ingest.log" });
  expect(getIngestJob(db, "job_1")?.status).toBe("running");
});

test("records completed and failed terminal job states", () => {
  createIngestJob(db, {
    id: "job_2",
    project_key: "class-kit",
    provider: "codex",
    input: {},
    now: "2026-06-13T10:00:00.000Z",
  });

  const completed = updateIngestJobStatus(db, {
    id: "job_2",
    status: "completed",
    finished_at: "2026-06-13T10:05:00.000Z",
    updated_at: "2026-06-13T10:05:00.000Z",
    output_counts: { session_memories: 1 },
    terminal_summary: "Created one memory.",
  });

  expect(completed.status).toBe("completed");
  expect(JSON.parse(completed.output_counts_json)).toEqual({ session_memories: 1 });
  expect(completed.terminal_summary).toBe("Created one memory.");

  const failed = updateIngestJobStatus(db, {
    id: "job_2",
    status: "failed",
    finished_at: "2026-06-13T10:06:00.000Z",
    updated_at: "2026-06-13T10:06:00.000Z",
    error: { code: "provider_failed" },
  });

  expect(failed.status).toBe("failed");
  expect(JSON.parse(failed.error_json ?? "{}")).toEqual({ code: "provider_failed" });
});

test("successful terminal updates can clear stale error state", () => {
  createIngestJob(db, {
    id: "job_3",
    project_key: "class-kit",
    provider: "codex",
    input: {},
    now: "2026-06-13T10:00:00.000Z",
  });

  updateIngestJobStatus(db, {
    id: "job_3",
    status: "failed",
    finished_at: "2026-06-13T10:05:00.000Z",
    updated_at: "2026-06-13T10:05:00.000Z",
    error: { code: "detached_worker_exited" },
  });

  const completed = updateIngestJobStatus(db, {
    id: "job_3",
    status: "completed",
    finished_at: "2026-06-13T10:06:00.000Z",
    updated_at: "2026-06-13T10:06:00.000Z",
    output_counts: { claimed: 1 },
    error: null,
  });

  expect(completed.status).toBe("completed");
  expect(completed.error_json).toBeNull();
});

test("throws when updating an unknown ingest job", () => {
  expect(() =>
    updateIngestJobStatus(db, {
      id: "missing",
      status: "failed",
      updated_at: "2026-06-13T10:00:00.000Z",
    }),
  ).toThrow("Unknown ingest job: missing");
});
