import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INTERNAL_INVOCATION_KIND_ENV,
  INTERNAL_LAUNCHER_PATH_ENV,
  INTERNAL_LOCATOR_PATH_ENV,
  readMachineLocator,
  resolveLaunchContext,
  type LaunchContext,
  type MachineLocatorV1,
} from "../../src/runtime/launch-context.ts";

let dir: string;
let root: string;
let callerCwd: string;
let locatorPath: string;
let launcherPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "myelin-launch-context-"));
  root = join(dir, "checkout");
  callerCwd = join(dir, "caller");
  locatorPath = join(dir, "home", ".myelin", "install.json");
  launcherPath = join(dir, "bin", "myelin");
  await seedCheckout(root);
  await mkdir(callerCwd, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("complete test context has highest precedence and preserves object identity", async () => {
  const context = Object.freeze<LaunchContext>({
    myelinRoot: root,
    callerCwd,
    invocationKind: "test",
    rootSource: "test_dependency",
    launcherPath: null,
    locatorPath: null,
  });

  const resolved = await resolveLaunchContext({
    context,
    env: { [INTERNAL_INVOCATION_KIND_ENV]: "installed" },
    locatorPath: join(dir, "missing.json"),
  });

  expect(resolved).toBe(context);
});

test("source invocation derives root from the absolute CLI entrypoint and never changes cwd", async () => {
  const before = process.cwd();
  const context = await resolveLaunchContext({
    callerCwd,
    entrypointPath: join(root, "src", "cli.ts"),
    env: {},
  });

  expect(context).toEqual({
    myelinRoot: root,
    callerCwd,
    invocationKind: "source",
    rootSource: "source_entrypoint",
    launcherPath: null,
    locatorPath: null,
  });
  expect(process.cwd()).toBe(before);
});

test("installed invocation resolves only from the versioned machine locator", async () => {
  await writeLocator(locator());
  const context = await resolveLaunchContext({
    callerCwd,
    entrypointPath: join(dir, "wrong", "src", "cli.ts"),
    locatorPath,
    env: {
      [INTERNAL_INVOCATION_KIND_ENV]: "installed",
      [INTERNAL_LAUNCHER_PATH_ENV]: launcherPath,
      MYELIN_ROOT: root,
    },
  });

  expect(context).toMatchObject({
    myelinRoot: root,
    callerCwd,
    invocationKind: "installed",
    rootSource: "machine_locator",
    launcherPath,
    locatorPath,
  });
});

test("installed invocation validates but never selects a propagated internal root", async () => {
  await writeLocator(locator());
  await expect(
    resolveLaunchContext({
      callerCwd,
      locatorPath,
      env: {
        [INTERNAL_INVOCATION_KIND_ENV]: "installed",
        MYELIN_ROOT: join(dir, "different-checkout"),
      },
    }),
  ).rejects.toThrow("does not match the machine locator root");
});

test("hook and worker contexts accept only an absolute internal root", async () => {
  for (const invocationKind of ["hook", "worker"] as const) {
    const context = await resolveLaunchContext({
      callerCwd,
      entrypointPath: join(dir, "ignored", "src", "cli.ts"),
      env: { [INTERNAL_INVOCATION_KIND_ENV]: invocationKind, MYELIN_ROOT: root },
    });
    expect(context).toMatchObject({ invocationKind, rootSource: "internal_env", myelinRoot: root, callerCwd });
  }

  await expect(
    resolveLaunchContext({
      callerCwd,
      env: { [INTERNAL_INVOCATION_KIND_ENV]: "worker", MYELIN_ROOT: "relative" },
    }),
  ).rejects.toThrow("internal MYELIN_ROOT must be absolute");
});

test("internal contexts validate propagated root and launcher against a locator", async () => {
  await writeLocator(locator());
  const env = {
    [INTERNAL_INVOCATION_KIND_ENV]: "worker",
    [INTERNAL_LOCATOR_PATH_ENV]: locatorPath,
    [INTERNAL_LAUNCHER_PATH_ENV]: launcherPath,
    MYELIN_ROOT: join(dir, "different-checkout"),
  };

  await expect(resolveLaunchContext({ callerCwd, env })).rejects.toThrow("does not match the machine locator root");
});

test("locator failures are actionable and fail closed", async () => {
  await expect(
    resolveLaunchContext({
      callerCwd,
      locatorPath,
      env: { [INTERNAL_INVOCATION_KIND_ENV]: "installed" },
    }),
  ).rejects.toThrow(`machine locator is missing at ${locatorPath}`);

  await mkdir(join(dir, "home", ".myelin"), { recursive: true });
  await writeFile(locatorPath, "not json\n", "utf8");
  await expect(readMachineLocator(locatorPath)).rejects.toThrow("machine locator is malformed");

  await writeLocator({ ...locator(), schema_version: 2 } as unknown as MachineLocatorV1);
  await expect(readMachineLocator(locatorPath)).rejects.toThrow("Unsupported or missing");
});

test("relative paths, invalid roots, and inconsistent test contexts are rejected", async () => {
  await expect(
    resolveLaunchContext({ callerCwd: "relative", entrypointPath: join(root, "src", "cli.ts"), env: {} }),
  ).rejects.toThrow("caller working directory must be absolute");
  await expect(resolveLaunchContext({ callerCwd, entrypointPath: "src/cli.ts", env: {} })).rejects.toThrow(
    "CLI entrypoint path must be absolute",
  );
  await expect(
    resolveLaunchContext({
      context: {
        myelinRoot: join(dir, "missing"),
        callerCwd,
        invocationKind: "test",
        rootSource: "test_dependency",
        launcherPath: null,
        locatorPath: null,
      },
    }),
  ).rejects.toThrow("Invalid Myelin root");
  await expect(
    resolveLaunchContext({
      context: {
        myelinRoot: root,
        callerCwd,
        invocationKind: "source",
        rootSource: "test_dependency",
        launcherPath: null,
        locatorPath: null,
      },
    }),
  ).rejects.toThrow("test_dependency root requires invocationKind test");
});

async function seedCheckout(path: string): Promise<void> {
  await mkdir(join(path, "src"), { recursive: true });
  await writeFile(join(path, "myelin.config"), "", "utf8");
  await writeFile(join(path, "package.json"), "{}\n", "utf8");
  await writeFile(join(path, "src", "cli.ts"), "", "utf8");
}

function locator(): MachineLocatorV1 {
  return {
    schema_version: 1,
    myelin_root: root,
    launcher: { path: launcherPath, sha256: "abc123" },
    providers: {},
    installed_at: "2026-07-10T10:00:00.000Z",
    updated_at: "2026-07-10T10:00:00.000Z",
    source_revision: null,
  };
}

async function writeLocator(value: MachineLocatorV1): Promise<void> {
  await mkdir(join(dir, "home", ".myelin"), { recursive: true });
  await writeFile(locatorPath, `${JSON.stringify(value)}\n`, "utf8");
}
