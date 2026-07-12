import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MaintenanceRunState } from "../../src/maintenance/maintenance-contracts.ts";
import { MaintenanceRunRuntime } from "../../src/maintenance/maintenance-run-runtime.ts";

test("maintenance runtime persists state atomically and rejects corrupt state", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-maintenance-runtime-"));
  const statePath = join(root, "state", "maintenance.json");
  const runtime = createRuntime(root, statePath);
  try {
    await runtime.writeState({
      project_key: "demo",
      last_status: "completed",
      last_finished_at: "2026-07-12T10:00:00.000Z",
    });
    await expect(runtime.readState()).resolves.toMatchObject({ project_key: "demo", last_status: "completed" });

    await writeFile(statePath, "{broken", "utf8");
    await expect(runtime.readState()).rejects.toThrow(`Invalid JSON in ${statePath}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("maintenance runtime owns, adopts, and releases only its own lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-maintenance-runtime-"));
  const runtime = createRuntime(root);
  try {
    const first = await runtime.tryAcquireLock("run_1");
    expect(first).not.toBeNull();
    await expect(runtime.tryAcquireLock("run_2")).resolves.toBeNull();
    await expect(runtime.adoptOrAcquireLock("run_1")).resolves.not.toBeNull();
    await expect(runtime.adoptOrAcquireLock("run_2")).resolves.toBeNull();

    await first?.release();
    await expect(runtime.tryAcquireLock("run_2")).resolves.not.toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("maintenance runtime centralizes cooldown and dead-worker recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-maintenance-runtime-"));
  const runtime = createRuntime(root, undefined, () => "2026-07-12T10:01:00.000Z", () => false);
  try {
    await runtime.writeState({
      project_key: "demo",
      last_status: "scheduled",
      last_scheduled_at: "2026-07-12T10:00:00.000Z",
      last_pid: 42,
    });
    await runtime.tryAcquireLock("run_1");

    await expect(runtime.isInCooldown(120_000)).resolves.toBe(true);
    await expect(runtime.clearDeadLock("worker exited")).resolves.toBe(true);
    await expect(runtime.readState()).resolves.toMatchObject({
      last_status: "failed",
      last_reason: "worker exited",
      last_finished_at: "2026-07-12T10:01:00.000Z",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function createRuntime(
  root: string,
  statePath = join(root, "state", "maintenance.json"),
  now: () => string = () => "2026-07-12T10:00:00.000Z",
  isProcessAlive: (pid: number) => boolean = () => true,
): MaintenanceRunRuntime<MaintenanceRunState> {
  return new MaintenanceRunRuntime<MaintenanceRunState>({
    projectKey: "demo",
    statePath,
    lockPath: join(root, "state", ".maintenance.lock"),
    initialState: () => ({ project_key: "demo" }),
    now,
    isProcessAlive,
  });
}
