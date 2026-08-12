import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ProjectMemoryMutationRuntime,
  projectMemoryMutationLockPath,
  projectMemoryMutationStatePath,
} from "../../src/project/project-memory-mutation-runtime.ts";

test("prevents overlapping Project Memory mutations from both reaching canonical writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-project-mutation-"));
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const writes: string[] = [];
  const runtime = new ProjectMemoryMutationRuntime(root);
  try {
    const first = runtime.run({
      projectKey: "demo",
      operation: "project learn",
      task: async () => {
        await firstGate;
        writes.push("first");
        return { status: "completed" };
      },
    });
    await waitForFile(projectMemoryMutationStatePath(root, "demo"));

    await expect(runtime.run({
      projectKey: "demo",
      operation: "project maintenance",
      task: async () => {
        writes.push("second");
        return { status: "completed" };
      },
    })).rejects.toThrow(/Project Memory mutation already running for demo: project_memory_project_learn_/);
    expect(writes).toEqual([]);

    releaseFirst();
    await first;
    expect(writes).toEqual(["first"]);
    await expect(Bun.file(projectMemoryMutationLockPath(root, "demo")).exists()).resolves.toBe(false);
  } finally {
    releaseFirst();
    await rm(root, { recursive: true, force: true });
  }
});

test("recovers a mutation lock only when its recorded process is dead", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-project-mutation-"));
  const lockPath = projectMemoryMutationLockPath(root, "demo");
  const statePath = projectMemoryMutationStatePath(root, "demo");
  try {
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({
      run_id: "dead_run",
      created_at: "2026-07-15T08:00:00.000Z",
    }), "utf8");
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({
      project_key: "demo",
      last_run_id: "dead_run",
      last_status: "running",
      last_pid: 4242,
    }), "utf8");

    const result = await new ProjectMemoryMutationRuntime(root, {
      isProcessAlive: () => false,
      now: () => new Date("2026-07-15T08:05:00.000Z"),
    }).run({
      projectKey: "demo",
      operation: "project learn",
      task: async () => ({ status: "completed" }),
    });

    expect(result).toEqual({ status: "completed" });
    await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await Bun.file(path).exists()) return;
    await Bun.sleep(5);
  }
  throw new Error(`Timed out waiting for ${path}`);
}
