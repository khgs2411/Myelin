import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerBootstrapCommand } from "../../src/commands/bootstrap.ts";
import { createCli } from "../../src/commands/registry.ts";

let root: string;
let repo: string;
let oldCwd: string;

beforeEach(async () => {
  oldCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), "myelin-bootstrap-cli-"));
  repo = join(root, "repos", "class-kit");
  await mkdir(repo, { recursive: true });
  process.chdir(root);
});

afterEach(async () => {
  process.chdir(oldCwd);
  await rm(root, { recursive: true, force: true });
});

test("bootstrap command creates a project shell", async () => {
  const cli = createCli("myelin");
  registerBootstrapCommand(cli);

  const result = await cli.run(["bootstrap", "class-kit", "--repo", repo]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Bootstrapped project class-kit.");
  expect(result.message).toContain("repo:");
});

test("bootstrap command requires key and repo", async () => {
  const cli = createCli("myelin");
  registerBootstrapCommand(cli);

  expect((await cli.run(["bootstrap"])).message).toContain(
    "Usage: myelin bootstrap <project-key> --repo <absolute-path>",
  );
  expect((await cli.run(["bootstrap", "class-kit"])).message).toContain(
    "Usage: myelin bootstrap <project-key> --repo <absolute-path>",
  );
  expect((await cli.run(["bootstrap", "class-kit", "--repo"])).message).toContain(
    "--repo requires an absolute path",
  );
});
