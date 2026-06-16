import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerInstallCommands } from "../../src/commands/install.ts";
import { createCli } from "../../src/commands/registry.ts";

let root: string;
let codexRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-install-cli-"));
  codexRoot = join(root, ".codex");
  await mkdir(codexRoot, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("install previews without writing", async () => {
  const cli = createCli("myelin");
  registerInstallCommands(cli, { myelinRoot: root, codexRoot });

  const result = await cli.run(["install"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Provider: codex");
  expect(result.message).toContain("Mode: preview");
  expect(await Bun.file(join(codexRoot, "hooks.json")).exists()).toBe(false);
});

test("install apply writes only when provider is explicit in non-interactive tests", async () => {
  const cli = createCli("myelin");
  registerInstallCommands(cli, { myelinRoot: root, codexRoot, isInteractive: false });

  const result = await cli.run(["install", "--apply", "--provider", "codex"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Mode: apply");
  expect(await Bun.file(join(codexRoot, "hooks.json")).exists()).toBe(true);
});

test("non-interactive multi-provider apply requires explicit provider", async () => {
  const cli = createCli("myelin");
  registerInstallCommands(cli, {
    myelinRoot: root,
    codexRoot,
    isInteractive: false,
    detectedProviders: ["codex", "future-provider"],
  });

  const result = await cli.run(["install", "--apply"]);

  expect(result.exitCode).toBe(1);
  expect(result.message).toContain("Multiple providers detected");
  expect(result.message).toContain("--provider <name>");
  expect(await Bun.file(join(codexRoot, "hooks.json")).exists()).toBe(false);
});

test("uninstall removes myelin-owned entries", async () => {
  const cli = createCli("myelin");
  registerInstallCommands(cli, { myelinRoot: root, codexRoot, isInteractive: false });

  await cli.run(["install", "--apply", "--provider", "codex"]);
  const result = await cli.run(["uninstall", "--provider", "codex"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Mode: uninstall");
});
