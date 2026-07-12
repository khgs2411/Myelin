import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type InvocationKind = "installed" | "source" | "hook" | "worker" | "test";
export type RootSource = "machine_locator" | "source_entrypoint" | "internal_env" | "test_dependency";

export type LaunchContext = {
  myelinRoot: string;
  callerCwd: string;
  invocationKind: InvocationKind;
  rootSource: RootSource;
  launcherPath: string | null;
  locatorPath: string | null;
};

export type MachineLocatorProvider = {
  hooks_path: string;
  shim_path: string;
  manifest_path: string;
};

export type MachineLocatorV1 = {
  schema_version: 1;
  myelin_root: string;
  launcher: {
    path: string;
    sha256: string;
  };
  providers: Record<string, MachineLocatorProvider>;
  installed_at: string;
  updated_at: string;
  source_revision: string | null;
};

export const INTERNAL_INVOCATION_KIND_ENV = "MYELIN_INTERNAL_INVOCATION_KIND";
export const INTERNAL_LAUNCHER_PATH_ENV = "MYELIN_INTERNAL_LAUNCHER_PATH";
export const INTERNAL_LOCATOR_PATH_ENV = "MYELIN_INTERNAL_LOCATOR_PATH";

type PathStat = {
  isDirectory(): boolean;
  isFile(): boolean;
};

export type LaunchContextDeps = {
  context?: LaunchContext;
  callerCwd?: string;
  entrypointPath?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  locatorPath?: string;
  readText?: (path: string) => Promise<string>;
  statPath?: (path: string) => Promise<PathStat>;
};

export async function resolveLaunchContext(deps: LaunchContextDeps = {}): Promise<LaunchContext> {
  const readText = deps.readText ?? ((path) => readFile(path, "utf8"));
  const statPath = deps.statPath ?? stat;
  const callerCwd = deps.callerCwd ?? process.cwd();

  if (deps.context) {
    await validateContext(deps.context, statPath);
    return deps.context;
  }

  assertAbsolute(callerCwd, "caller working directory");
  const env = deps.env ?? process.env;
  const internalKind = parseInternalKind(env[INTERNAL_INVOCATION_KIND_ENV]);
  const defaultLocatorPath = deps.locatorPath ?? join(deps.homeDir ?? homedir(), ".myelin", "install.json");

  if (internalKind === "hook" || internalKind === "worker") {
    const myelinRoot = env.MYELIN_ROOT;
    if (!myelinRoot) throw new Error(`${internalKind} invocation is missing internal MYELIN_ROOT.`);
    assertAbsolute(myelinRoot, "internal MYELIN_ROOT");

    const launcherPath = nullableAbsolute(env[INTERNAL_LAUNCHER_PATH_ENV], "internal launcher path");
    const locatorPath = nullableAbsolute(env[INTERNAL_LOCATOR_PATH_ENV], "internal locator path");
    if (locatorPath) {
      const locator = await readMachineLocator(locatorPath, { readText });
      if (resolve(locator.myelin_root) !== resolve(myelinRoot)) {
        throw new Error(
          `Internal MYELIN_ROOT ${myelinRoot} does not match the machine locator root ${locator.myelin_root}. Re-run myelin install --apply.`,
        );
      }
      if (launcherPath && resolve(locator.launcher.path) !== resolve(launcherPath)) {
        throw new Error(`Internal launcher path does not match ${locatorPath}. Re-run myelin install --apply.`);
      }
    }

    const context: LaunchContext = {
      myelinRoot: resolve(myelinRoot),
      callerCwd: resolve(callerCwd),
      invocationKind: internalKind,
      rootSource: "internal_env",
      launcherPath,
      locatorPath,
    };
    await validateContext(context, statPath);
    return context;
  }

  if (internalKind === "installed") {
    const locatorPath = nullableAbsolute(env[INTERNAL_LOCATOR_PATH_ENV], "internal locator path") ?? defaultLocatorPath;
    const locator = await readMachineLocator(locatorPath, { readText });
    if (env.MYELIN_ROOT) {
      assertAbsolute(env.MYELIN_ROOT, "internal MYELIN_ROOT");
      if (resolve(env.MYELIN_ROOT) !== resolve(locator.myelin_root)) {
        throw new Error(
          `Internal MYELIN_ROOT ${env.MYELIN_ROOT} does not match the machine locator root ${locator.myelin_root}. Re-run myelin install --apply.`,
        );
      }
    }
    const markedLauncher = nullableAbsolute(env[INTERNAL_LAUNCHER_PATH_ENV], "internal launcher path");
    if (markedLauncher && resolve(markedLauncher) !== resolve(locator.launcher.path)) {
      throw new Error(`Installed launcher path does not match ${locatorPath}. Re-run myelin install --apply.`);
    }

    const context: LaunchContext = {
      myelinRoot: resolve(locator.myelin_root),
      callerCwd: resolve(callerCwd),
      invocationKind: "installed",
      rootSource: "machine_locator",
      launcherPath: resolve(locator.launcher.path),
      locatorPath: resolve(locatorPath),
    };
    await validateContext(context, statPath);
    return context;
  }

  const entrypointPath = deps.entrypointPath;
  if (!entrypointPath) throw new Error("Cannot resolve Myelin source root without an absolute CLI entrypoint path.");
  assertAbsolute(entrypointPath, "CLI entrypoint path");
  const myelinRoot = dirname(dirname(resolve(entrypointPath)));
  if (resolve(entrypointPath) !== join(myelinRoot, "src", "cli.ts")) {
    throw new Error(`Source entrypoint must be <myelin-root>/src/cli.ts: ${entrypointPath}`);
  }

  const context: LaunchContext = {
    myelinRoot,
    callerCwd: resolve(callerCwd),
    invocationKind: "source",
    rootSource: "source_entrypoint",
    launcherPath: null,
    locatorPath: null,
  };
  await validateContext(context, statPath);
  return context;
}

export async function readMachineLocator(
  path: string,
  deps: Pick<LaunchContextDeps, "readText"> = {},
): Promise<MachineLocatorV1> {
  assertAbsolute(path, "machine locator path");
  let raw: string;
  try {
    raw = await (deps.readText ?? ((target) => readFile(target, "utf8")))(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      throw new Error(`Myelin machine locator is missing at ${path}. Run ./install --apply from the Myelin checkout.`);
    }
    throw new Error(`Cannot read Myelin machine locator at ${path}: ${errorMessage(error)}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Myelin machine locator is malformed at ${path}. Re-run ./install --apply.`);
  }
  return parseMachineLocator(value, path);
}

export function parseMachineLocator(value: unknown, path = "machine locator"): MachineLocatorV1 {
  if (!isRecord(value) || value.schema_version !== 1) {
    throw new Error(`Unsupported or missing Myelin machine locator schema at ${path}. Re-run ./install --apply.`);
  }
  if (!isAbsoluteString(value.myelin_root)) throw invalidLocator(path, "myelin_root must be absolute");
  if (!isRecord(value.launcher) || !isAbsoluteString(value.launcher.path) || !isNonEmptyString(value.launcher.sha256)) {
    throw invalidLocator(path, "launcher path/hash is invalid");
  }
  if (!isRecord(value.providers)) throw invalidLocator(path, "providers must be an object");
  for (const [provider, record] of Object.entries(value.providers)) {
    if (
      !provider ||
      !isRecord(record) ||
      !isAbsoluteString(record.hooks_path) ||
      !isAbsoluteString(record.shim_path) ||
      !isAbsoluteString(record.manifest_path)
    ) {
      throw invalidLocator(path, `provider ownership is invalid for ${provider || "<empty>"}`);
    }
  }
  if (!isNonEmptyString(value.installed_at) || !isNonEmptyString(value.updated_at)) {
    throw invalidLocator(path, "installation timestamps are invalid");
  }
  if (value.source_revision !== null && !isNonEmptyString(value.source_revision)) {
    throw invalidLocator(path, "source_revision must be a string or null");
  }
  return value as MachineLocatorV1;
}

async function validateContext(context: LaunchContext, statPath: (path: string) => Promise<PathStat>): Promise<void> {
  assertAbsolute(context.myelinRoot, "Myelin root");
  assertAbsolute(context.callerCwd, "caller working directory");
  if (context.launcherPath) assertAbsolute(context.launcherPath, "launcher path");
  if (context.locatorPath) assertAbsolute(context.locatorPath, "locator path");
  if (context.invocationKind === "test" && context.rootSource !== "test_dependency") {
    throw new Error("A test LaunchContext must use rootSource test_dependency.");
  }
  if (context.rootSource === "test_dependency" && context.invocationKind !== "test") {
    throw new Error("A test_dependency root requires invocationKind test.");
  }

  const root = resolve(context.myelinRoot);
  try {
    if (!(await statPath(root)).isDirectory()) throw new Error("not a directory");
    for (const marker of ["myelin.config", "package.json", join("src", "cli.ts")]) {
      if (!(await statPath(join(root, marker))).isFile()) throw new Error(`${marker} is not a file`);
    }
  } catch (error) {
    throw new Error(`Invalid Myelin root ${root}: ${errorMessage(error)}. Re-run myelin install --apply.`);
  }
}

function parseInternalKind(value: string | undefined): "installed" | "hook" | "worker" | null {
  if (value === undefined || value === "") return null;
  if (value === "installed" || value === "hook" || value === "worker") return value;
  throw new Error(`Invalid ${INTERNAL_INVOCATION_KIND_ENV}: ${value}`);
}

function nullableAbsolute(value: string | undefined, label: string): string | null {
  if (!value) return null;
  assertAbsolute(value, label);
  return resolve(value);
}

function assertAbsolute(path: string, label: string): void {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute: ${path}`);
}

function invalidLocator(path: string, detail: string): Error {
  return new Error(`Invalid Myelin machine locator at ${path}: ${detail}. Re-run ./install --apply.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isAbsoluteString(value: unknown): value is string {
  return isNonEmptyString(value) && isAbsolute(value);
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
