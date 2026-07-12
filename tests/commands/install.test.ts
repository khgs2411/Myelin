import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerInstallCommands } from "../../src/commands/install.ts";
import { createCli } from "../../src/commands/registry.ts";

let sandbox: string;
let root: string;
let homeDir: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "myelin-install-cli-"));
  root = join(sandbox, "checkout");
  homeDir = join(sandbox, "home");
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

test("install previews command lifecycle without writing", async () => {
  const result = await cli().run(["install", "--command-only"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Mode: preview");
  expect(result.message).toContain("install copied Myelin launcher");
  expect(await Bun.file(join(homeDir, ".myelin", "install.json")).exists()).toBe(false);
});

test("install applies only with --apply and reports PATH state", async () => {
  const result = await cli().run(["install", "--apply", "--command-only"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Mode: apply");
  expect(result.message).toContain("PATH active: yes");
  expect(await Bun.file(join(homeDir, ".local", "bin", "myelin")).exists()).toBe(true);
});

test("install parses custom bin and rejects conflicting or incomplete options", async () => {
  const customBin = join(sandbox, "custom-bin");
  expect((await cli().run(["install", "--bin-dir", customBin])).message).toContain(join(customBin, "myelin"));
  expect((await cli().run(["install", "--bin-dir"])).message).toContain("--bin-dir requires a value");
  expect((await cli().run(["install", "--command-only", "--provider", "codex"])).message).toContain(
    "cannot be combined",
  );
  expect((await cli().run(["install", "--codex"])).message).toContain("Unknown install option");
});

test("uninstall is preview-first and requires --apply to remove", async () => {
  const command = cli();
  await command.run(["install", "--apply", "--command-only"]);

  const preview = await command.run(["uninstall"]);
  expect(preview.exitCode).toBe(0);
  expect(preview.message).toContain("Mode: preview");
  expect(await Bun.file(join(homeDir, ".myelin", "install.json")).exists()).toBe(true);

  const applied = await command.run(["uninstall", "--apply"]);
  expect(applied.exitCode).toBe(0);
  expect(await Bun.file(join(homeDir, ".myelin", "install.json")).exists()).toBe(false);
});

test("repeatable explicit Codex selection and provider-only uninstall share the lifecycle", async () => {
  await mkdir(join(homeDir, ".codex"), { recursive: true });
  const command = cli();
  const installed = await command.run([
    "install",
    "--apply",
    "--provider",
    "codex",
    "--provider",
    "codex",
  ]);
  expect(installed.exitCode).toBe(0);
  expect(await Bun.file(join(homeDir, ".codex", ".myelin", "install-manifest.json")).exists()).toBe(true);

  const preview = await command.run(["uninstall", "--provider", "codex"]);
  expect(preview.exitCode).toBe(0);
  expect(preview.message).toContain("remove verified Codex provider integration");
  await command.run(["uninstall", "--apply", "--provider", "codex"]);
  expect(await Bun.file(join(homeDir, ".local", "bin", "myelin")).exists()).toBe(true);
  expect(await Bun.file(join(homeDir, ".myelin", "install.json")).exists()).toBe(true);
});

test("explicit unavailable Codex fails before install mutation", async () => {
  const result = await cli().run(["install", "--apply", "--provider", "codex"]);
  expect(result.exitCode).toBe(1);
  expect(result.message).toContain("not available");
  expect(await Bun.file(join(homeDir, ".myelin", "install-journal.json")).exists()).toBe(false);
});

function cli() {
  const command = createCli("myelin");
  registerInstallCommands(command, {
    context: {
      myelinRoot: root,
      callerCwd: join(sandbox, "caller"),
      invocationKind: "test",
      rootSource: "test_dependency",
      launcherPath: null,
      locatorPath: null,
    },
    service: {
      homeDir,
      env: { PATH: join(homeDir, ".local", "bin") },
      sourceRevision: null,
      now: () => new Date("2026-07-10T10:00:00.000Z"),
    },
  });
  return command;
}
