import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectLock } from "../../src/status/lock-inspector.ts";
import { projectRetrievalState, sessionRetrievalState } from "../../src/status/severity.ts";

let root: string;
let lockPath: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "myelin-status-inspector-")); lockPath = join(root, "projects", "demo", "state", ".lock"); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("retrieval severity follows the approved usable-index matrix", () => {
  expect([
    sessionRetrievalState(0, 0, 0, 0),
    sessionRetrievalState(1, 1, 0, 0),
    sessionRetrievalState(1, 1, 1, 0),
    sessionRetrievalState(1, 0, 1, 0),
    projectRetrievalState(false, 0, 0, 0),
    projectRetrievalState(true, 2, 1, 0),
    projectRetrievalState(true, 0, 0, 1),
  ]).toEqual(["healthy", "healthy", "attention", "blocked", "healthy", "attention", "blocked"]);
});

test("lock coherence is based on run ownership, active state, and liveness", async () => {
  expect((await inspectLock({ root, lockPath, state: null, isAlive: () => false })).lock.lifecycle).toBe("absent");
  await mkdir(lockPath, { recursive: true });
  await writeFile(join(lockPath, "owner.json"), JSON.stringify({ run_id: "run-1", created_at: "2020-01-01T00:00:00.000Z" }));
  const active = await inspectLock({ root, lockPath, state: { last_run_id: "run-1", last_status: "running", last_pid: 42 }, isAlive: () => true });
  expect(active.lock.lifecycle).toBe("active");
  const dead = await inspectLock({ root, lockPath, state: { last_run_id: "run-1", last_status: "running", last_pid: 42 }, isAlive: () => false });
  expect(dead).toMatchObject({ state: "blocked", lock: { lifecycle: "stale" } });
  const mismatch = await inspectLock({ root, lockPath, state: { last_run_id: "run-2", last_status: "running", last_pid: 42 }, isAlive: () => true });
  expect(mismatch.lock.lifecycle).toBe("stale");
});

test("active state without a lock is stale and malformed ownership never throws", async () => {
  const missing = await inspectLock({ root, lockPath, state: { last_run_id: "run-1", last_status: "scheduled", last_pid: 42 }, isAlive: () => true });
  expect(missing.lock.lifecycle).toBe("stale");
  await mkdir(lockPath, { recursive: true });
  await writeFile(join(lockPath, "owner.json"), "not-json");
  expect((await inspectLock({ root, lockPath, state: { last_status: "running" }, isAlive: () => true })).lock.lifecycle).toBe("stale");
});
