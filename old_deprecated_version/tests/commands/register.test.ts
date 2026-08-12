import { expect, test } from "bun:test";
import { registerCommands, type CommandRegistrars } from "../../src/commands/register.ts";
import { createCli, type Cli } from "../../src/commands/registry.ts";
import type { LaunchContext } from "../../src/runtime/launch-context.ts";

test("central bootstrap registers the complete command surface without mutating context", async () => {
  const context = Object.freeze<LaunchContext>({
    myelinRoot: "/tmp/myelin",
    callerCwd: "/tmp/caller",
    invocationKind: "test",
    rootSource: "test_dependency",
    launcherPath: null,
    locatorPath: null,
  });
  const cli = createCli("myelin");

  registerCommands(cli, context);

  const help = (await cli.run(["--help"])).message;
  for (const command of [
    "bootstrap",
    "capture codex-hook",
    "ingest",
    "install",
    "maintenance worker session",
    "maintenance worker project",
    "memory query",
    "project list",
    "schema check",
    "session start",
    "smc status",
    "status",
    "uninstall",
  ]) {
    expect(help).toContain(`myelin ${command}`);
  }
  expect(context).toEqual({
    myelinRoot: "/tmp/myelin",
    callerCwd: "/tmp/caller",
    invocationKind: "test",
    rootSource: "test_dependency",
    launcherPath: null,
    locatorPath: null,
  });
});

test("central bootstrap forwards the exact context object to every command registrar", () => {
  const context: LaunchContext = {
    myelinRoot: "/tmp/myelin",
    callerCwd: "/tmp/external-repo",
    invocationKind: "test",
    rootSource: "test_dependency",
    launcherPath: null,
    locatorPath: null,
  };
  const seen: LaunchContext[] = [];
  const spy = (_cli: Cli, deps: { context: LaunchContext }): void => {
    seen.push(deps.context);
  };
  const registrars: CommandRegistrars = {
    status: spy,
    bootstrap: spy,
    capture: spy,
    install: spy,
    ingest: spy,
    memory: spy,
    maintenance: spy,
    project: spy,
    session: spy,
    schema: spy,
    smc: spy,
  };

  registerCommands(createCli("myelin"), context, registrars);

  expect(seen).toHaveLength(11);
  expect(seen.every((received) => received === context)).toBe(true);
});
