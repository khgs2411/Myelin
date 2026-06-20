import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProjectCommands } from "../../src/commands/project.ts";
import { createCli } from "../../src/commands/registry.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;
let oldCwd: string;

beforeEach(async () => {
  oldCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), "myelin-project-cli-"));
  process.chdir(root);
});

afterEach(async () => {
  process.chdir(oldCwd);
  await rm(root, { recursive: true, force: true });
});

test("project list shows active projects by default and legacy projects on request", async () => {
  await seedProject("active", "active");
  await seedProject("old-v1", "legacy");
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const active = await cli.run(["project", "list"]);
  expect(active.exitCode).toBe(0);
  expect(active.message).toContain("Active projects:");
  expect(active.message).toContain("- active [active]");
  expect(active.message).not.toContain("old-v1");
  expect(active.message).toContain("Use --include-legacy");

  const all = await cli.run(["project", "list", "--include-legacy"]);
  expect(all.exitCode).toBe(0);
  expect(all.message).toContain("- active [active]");
  expect(all.message).toContain("- old-v1 [legacy]");
});

test("project list --json emits active or legacy-aware project inventory", async () => {
  await seedProject("active", "active");
  await seedProject("old-v1", "legacy");
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const active = JSON.parse((await cli.run(["project", "list", "--json"])).message);
  expect(active.projects.map((project: { key: string }) => project.key)).toEqual(["active"]);

  const all = JSON.parse((await cli.run(["project", "list", "--include-legacy", "--json"])).message);
  expect(all.projects.map((project: { key: string; lifecycle: string }) => [project.key, project.lifecycle])).toEqual([
    ["active", "active"],
    ["old-v1", "legacy"],
  ]);
});

test("project list rejects unknown options", async () => {
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const result = await cli.run(["project", "list", "--all"]);

  expect(result.exitCode).toBe(1);
  expect(result.message).toContain("Unknown project list option: --all");
});

async function seedProject(key: string, lifecycle: "active" | "legacy"): Promise<void> {
  await writeJson(join(root, "projects", key, "state", "project.json"), {
    key,
    name: key,
    lifecycle,
    repo_paths: [join(root, "repos", key)],
  });
}
