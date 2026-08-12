import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectResetService } from "../../src/project/project-reset-service.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-project-reset-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("clean rebootstrap deletes project shell while preserving root memory db", async () => {
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  await mkdir(join(root, "state", "memory"), { recursive: true });
  await writeFile(join(root, "state", "memory", "memory.db"), "memory", "utf8");
  await writeJson(join(root, "state", "demo", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [repo],
  });
  await writeJson(join(root, "state", "demo", "project-memory.json"), { status: "curated" });
  await mkdir(join(root, "projects", "demo"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "old.md"), "# Old curated memory\n", "utf8");

  const result = await new ProjectResetService(root).cleanRebootstrap("demo");

  expect(result).toMatchObject({
    project_key: "demo",
    reset_scope: "project_shell",
    bootstrap_status: "rebootstrapped",
  });
  expect(await readFile(join(root, "state", "memory", "memory.db"), "utf8")).toBe("memory");
  expect(await Bun.file(join(root, "projects", "demo", "old.md")).exists()).toBe(false);
  expect(await Bun.file(join(root, "state", "demo", "project-memory.json")).exists()).toBe(false);
  expect(await Bun.file(join(root, "state", "demo", "bootstrap-state.json")).exists()).toBe(true);
  expect(JSON.parse(await readFile(join(root, "state", "demo", "project.json"), "utf8")).repo_paths).toEqual([repo]);
});
