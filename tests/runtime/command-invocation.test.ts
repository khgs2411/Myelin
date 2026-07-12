import { expect, test } from "bun:test";
import { isAbsolute, join } from "node:path";
import { resolveMyelinCommandInvocation } from "../../src/runtime/command-invocation.ts";
import type { LaunchContext } from "../../src/runtime/launch-context.ts";

const root = "/tmp/myelin-checkout";
const callerCwd = "/tmp/caller";
const bunExecutable = "/opt/myelin/bin/bun";
const launcherPath = "/tmp/bin/myelin";

test("installed contexts invoke the absolute recorded launcher", () => {
  expect(
    resolveMyelinCommandInvocation(context("installed", launcherPath), ["status", "demo"], { bunExecutable }),
  ).toEqual([launcherPath, "status", "demo"]);
});

test("source and test contexts invoke the absolute Bun executable and source entrypoint", () => {
  for (const invocationKind of ["source", "test"] as const) {
    expect(resolveMyelinCommandInvocation(context(invocationKind, null), ["status"], { bunExecutable })).toEqual([
      bunExecutable,
      join(root, "src", "cli.ts"),
      "status",
    ]);
  }
});

test("hook and worker contexts inherit launcher or source invocation explicitly", () => {
  expect(resolveMyelinCommandInvocation(context("hook", launcherPath), ["capture", "codex-hook"], { bunExecutable })).toEqual([
    launcherPath,
    "capture",
    "codex-hook",
  ]);
  expect(resolveMyelinCommandInvocation(context("worker", null), ["ingest", "worker", "job-1"], { bunExecutable })).toEqual([
    bunExecutable,
    join(root, "src", "cli.ts"),
    "ingest",
    "worker",
    "job-1",
  ]);
});

test("relative executable paths fail instead of using ambient PATH", () => {
  expect(() => resolveMyelinCommandInvocation(context("source", null), [], { bunExecutable: "bun" })).toThrow(
    "Bun executable must be absolute",
  );
  expect(() => resolveMyelinCommandInvocation(context("installed", "bin/myelin"), [])).toThrow(
    "launcher path must be absolute",
  );
});

test("production source invocation derives an absolute Bun executable from the current process", () => {
  const argv = resolveMyelinCommandInvocation(context("source", null), []);
  expect(argv[0]).toBe(process.execPath);
  expect(isAbsolute(argv[0]!)).toBe(true);
});

function context(invocationKind: LaunchContext["invocationKind"], launcherPathValue: string | null): LaunchContext {
  return {
    myelinRoot: root,
    callerCwd,
    invocationKind,
    rootSource: invocationKind === "installed"
      ? "machine_locator"
      : invocationKind === "test"
        ? "test_dependency"
        : invocationKind === "source"
          ? "source_entrypoint"
          : "internal_env",
    launcherPath: launcherPathValue,
    locatorPath: invocationKind === "installed" ? "/tmp/home/.myelin/install.json" : null,
  };
}
