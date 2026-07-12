import { isAbsolute, join, resolve } from "node:path";
import {
  INTERNAL_INVOCATION_KIND_ENV,
  INTERNAL_LAUNCHER_PATH_ENV,
  INTERNAL_LOCATOR_PATH_ENV,
  type LaunchContext,
} from "./launch-context.ts";

export type CommandInvocationDeps = {
  bunExecutable?: string;
};

export function resolveMyelinCommandInvocation(
  context: LaunchContext,
  args: string[],
  deps: CommandInvocationDeps = {},
): string[] {
  if (context.launcherPath && context.invocationKind !== "source" && context.invocationKind !== "test") {
    assertAbsolute(context.launcherPath, "launcher path");
    return [resolve(context.launcherPath), ...args];
  }

  const bunExecutable = deps.bunExecutable ?? process.execPath;
  assertAbsolute(bunExecutable, "Bun executable");
  return [resolve(bunExecutable), join(context.myelinRoot, "src", "cli.ts"), ...args];
}

export function backgroundLaunchContext(input: {
  myelinRoot: string;
  callerCwd: string;
  context?: LaunchContext;
  env?: NodeJS.ProcessEnv;
}): LaunchContext {
  if (input.context) return { ...input.context, callerCwd: resolve(input.callerCwd) };
  const env = input.env ?? process.env;
  const launcherPath = absoluteOrNull(env[INTERNAL_LAUNCHER_PATH_ENV]);
  const locatorPath = absoluteOrNull(env[INTERNAL_LOCATOR_PATH_ENV]);
  return {
    myelinRoot: resolve(input.myelinRoot),
    callerCwd: resolve(input.callerCwd),
    invocationKind: launcherPath ? "worker" : "source",
    rootSource: launcherPath ? "internal_env" : "source_entrypoint",
    launcherPath,
    locatorPath,
  };
}

export function backgroundInvocationEnv(
  context: LaunchContext,
  kind: "hook" | "worker",
): Record<string, string> {
  return {
    [INTERNAL_INVOCATION_KIND_ENV]: kind,
    MYELIN_ROOT: context.myelinRoot,
    ...(context.launcherPath ? { [INTERNAL_LAUNCHER_PATH_ENV]: context.launcherPath } : {}),
    ...(context.locatorPath ? { [INTERNAL_LOCATOR_PATH_ENV]: context.locatorPath } : {}),
  };
}

function assertAbsolute(path: string, label: string): void {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute: ${path}`);
}

function absoluteOrNull(path: string | undefined): string | null {
  if (!path) return null;
  assertAbsolute(path, "internal invocation path");
  return resolve(path);
}
