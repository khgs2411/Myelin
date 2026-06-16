import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IngestService } from "../../src/ingest/ingest-service.ts";
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
    jobs: [],
  });
});

test("IngestService records branch mismatch before worker launch", async () => {
  const service = new IngestService(root, {
    now: () => new Date("2026-06-15T10:00:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "feature/refactor\n", stderr: "" }),
    spawn: () => {
      throw new Error("spawn should not run");
    },
  });

  const result = await service.start({ projectKey: "demo", provider: "codex" });

  expect(result).toMatchObject({
    kind: "branch_mismatch",
    project_key: "demo",
    branch: "feature/refactor",
  });
  if (result.kind !== "branch_mismatch") throw new Error("expected branch_mismatch");
  expect(result.job.status).toBe("failed");
  expect(JSON.parse(result.job.error_json ?? "{}")).toMatchObject({
    code: "target_branch_mismatch",
    actual_branch: "feature/refactor",
  });
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
