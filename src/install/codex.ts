import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MachineLocatorProvider } from "../runtime/launch-context.ts";
import { INTERNAL_INVOCATION_KIND_ENV, INTERNAL_LAUNCHER_PATH_ENV } from "../runtime/launch-context.ts";
import type { ProviderInstallOptions, ProviderInstallPlan } from "./types.ts";

const EVENTS = ["SessionStart", "UserPromptSubmit", "Stop"] as const;
const MANIFEST = "install-manifest.json";

type HookEntry = {
  command?: string;
  hooks?: unknown;
  [key: string]: unknown;
};

type HooksJson = {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
};

type CodexManifestV1 = {
  schema_version: 1;
  provider: "codex";
  hooks_path: string;
  command: string;
  shim: { path: string; sha256: string };
};

type LegacyManifest = { provider: "codex"; command: string };

export type CodexProviderInspection = {
  ownership: MachineLocatorProvider;
  detected: boolean;
  needsApply: boolean;
};

export async function inspectCodexProvider(input: {
  providerRoot: string;
  myelinRoot: string;
  launcherPath?: string;
}): Promise<CodexProviderInspection> {
  const paths = codexPaths(input.providerRoot);
  const manifest = await readManifestIfExists(paths.manifest_path);
  const shimExists = await exists(paths.shim_path);
  if (!manifest) {
    if (shimExists) throw new Error(`Unowned Codex shim exists at ${paths.shim_path}; refusing to overwrite it.`);
    return { ownership: paths, detected: await isDirectory(input.providerRoot), needsApply: true };
  }
  if (manifest.command !== paths.shim_path) throw new Error(`Codex manifest owns an unexpected command: ${manifest.command}`);
  if (!shimExists) return { ownership: paths, detected: true, needsApply: true };

  const currentShim = await readFile(paths.shim_path, "utf8");
  const currentHash = sha256(currentShim);
  if ("schema_version" in manifest) {
    if (
      manifest.hooks_path !== paths.hooks_path ||
      manifest.shim.path !== paths.shim_path ||
      manifest.shim.sha256 !== currentHash
    ) {
      throw new Error(`Codex owned artifact mismatch at ${paths.manifest_path}; refusing provider repair.`);
    }
  } else if (!currentShim.includes(`MYELIN_ROOT=${JSON.stringify(input.myelinRoot)}`)) {
    throw new Error(`Legacy Codex shim ownership cannot be verified at ${paths.shim_path}.`);
  }

  const hooks = await readHooks(paths.hooks_path);
  const hooksCurrent = EVENTS.every((event) => countOwnedCommands(hooks, event, paths.shim_path) === 1);
  const desiredShim = shimScript(input.myelinRoot, input.launcherPath);
  const manifestCurrent = "schema_version" in manifest && manifest.shim.sha256 === sha256(desiredShim);
  return {
    ownership: paths,
    detected: true,
    needsApply: !hooksCurrent || currentShim !== desiredShim || !manifestCurrent,
  };
}

export async function applyCodexProvider(input: {
  providerRoot: string;
  myelinRoot: string;
  launcherPath?: string;
  backupPath?: string | null;
}): Promise<MachineLocatorProvider> {
  const inspection = await inspectCodexProvider(input);
  const paths = inspection.ownership;
  await mkdir(join(input.providerRoot, ".myelin", "shim"), { recursive: true });
  await mkdir(join(input.providerRoot, ".myelin", "backups"), { recursive: true });

  const hooks = await readHooks(paths.hooks_path);
  hooks.hooks ??= {};
  for (const event of EVENTS) {
    const existing = Array.isArray(hooks.hooks[event]) ? hooks.hooks[event] : [];
    hooks.hooks[event] = [...removeOwnedEntries(existing, paths.shim_path), hookGroup(paths.shim_path)];
  }
  const desiredHooks = `${JSON.stringify(hooks, null, 2)}\n`;
  if ((await exists(paths.hooks_path)) && (await readFile(paths.hooks_path, "utf8")) !== desiredHooks) {
    await copyFile(
      paths.hooks_path,
      input.backupPath ?? join(input.providerRoot, ".myelin", "backups", `hooks-${crypto.randomUUID()}.json`),
    );
  }
  await writeFile(paths.hooks_path, desiredHooks, "utf8");

  const shim = shimScript(input.myelinRoot, input.launcherPath);
  await writeFile(paths.shim_path, shim, { encoding: "utf8", mode: 0o755 });
  const manifest: CodexManifestV1 = {
    schema_version: 1,
    provider: "codex",
    hooks_path: paths.hooks_path,
    command: paths.shim_path,
    shim: { path: paths.shim_path, sha256: sha256(shim) },
  };
  await writeFile(paths.manifest_path, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return paths;
}

export async function removeCodexProvider(input: {
  providerRoot: string;
  backupPath?: string | null;
}): Promise<MachineLocatorProvider> {
  const paths = codexPaths(input.providerRoot);
  const manifest = await readManifestIfExists(paths.manifest_path);
  if (!manifest) {
    if (await exists(paths.shim_path)) throw new Error(`Codex shim exists without an ownership manifest at ${paths.shim_path}.`);
    return paths;
  }
  if (manifest.command !== paths.shim_path) throw new Error(`Codex manifest owns an unexpected command: ${manifest.command}`);
  if (await exists(paths.shim_path)) {
    const currentHash = sha256(await readFile(paths.shim_path, "utf8"));
    if ("schema_version" in manifest && currentHash !== manifest.shim.sha256) {
      throw new Error(`Codex shim hash mismatch at ${paths.shim_path}; refusing provider uninstall.`);
    }
  }

  if (await exists(paths.hooks_path)) {
    const hooks = await readHooks(paths.hooks_path);
    if (hooks.hooks) {
      for (const event of Object.keys(hooks.hooks)) {
        const entries = hooks.hooks[event];
        if (Array.isArray(entries)) hooks.hooks[event] = removeOwnedEntries(entries, paths.shim_path);
      }
    }
    const desired = `${JSON.stringify(hooks, null, 2)}\n`;
    if ((await readFile(paths.hooks_path, "utf8")) !== desired) {
      await mkdir(join(input.providerRoot, ".myelin", "backups"), { recursive: true });
      await copyFile(
        paths.hooks_path,
        input.backupPath ?? join(input.providerRoot, ".myelin", "backups", `hooks-${crypto.randomUUID()}.json`),
      );
      await writeFile(paths.hooks_path, desired, "utf8");
    }
  }
  await rm(paths.shim_path, { force: true });
  await rm(paths.manifest_path, { force: true });
  return paths;
}

export function codexProviderRootFromManifest(path: string): string {
  return dirname(dirname(path));
}

export async function planCodexInstall(options: ProviderInstallOptions): Promise<ProviderInstallPlan> {
  const providerRoot = options.providerRoot ?? join(process.env.HOME ?? "", ".codex");
  const inspection = await inspectCodexProvider({ providerRoot, myelinRoot: options.myelinRoot });
  return {
    provider: "codex",
    detected: inspection.detected,
    provider_root: providerRoot,
    hooks_path: inspection.ownership.hooks_path,
    state_dir: join(providerRoot, ".myelin"),
    actions: inspection.needsApply
      ? [
          (await exists(inspection.ownership.hooks_path)) ? "merge myelin hook entries" : "create hooks.json",
          "write .myelin/shim/codex-hook",
          "write .myelin/install-manifest.json",
        ]
      : [],
    warnings: inspection.detected ? [] : ["Codex provider root was not detected"],
  };
}

export async function applyCodexInstall(options: ProviderInstallOptions): Promise<ProviderInstallPlan> {
  const plan = await planCodexInstall(options);
  await applyCodexProvider({ providerRoot: plan.provider_root, myelinRoot: options.myelinRoot });
  return plan;
}

export async function uninstallCodex(options: ProviderInstallOptions): Promise<ProviderInstallPlan> {
  const providerRoot = options.providerRoot ?? join(process.env.HOME ?? "", ".codex");
  const paths = codexPaths(providerRoot);
  const plan: ProviderInstallPlan = {
    provider: "codex",
    detected: await isDirectory(providerRoot),
    provider_root: providerRoot,
    hooks_path: paths.hooks_path,
    state_dir: join(providerRoot, ".myelin"),
    actions: ["remove myelin hook entries", "remove .myelin/shim/codex-hook", "remove .myelin/install-manifest.json"],
    warnings: [],
  };
  await removeCodexProvider({ providerRoot });
  return plan;
}

function codexPaths(providerRoot: string): MachineLocatorProvider {
  return {
    hooks_path: join(providerRoot, "hooks.json"),
    shim_path: join(providerRoot, ".myelin", "shim", "codex-hook"),
    manifest_path: join(providerRoot, ".myelin", MANIFEST),
  };
}

async function readManifestIfExists(path: string): Promise<CodexManifestV1 | LegacyManifest | null> {
  if (!(await exists(path))) return null;
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`Codex ownership manifest is malformed at ${path}.`);
  }
  if (!value || typeof value !== "object" || (value as { provider?: unknown }).provider !== "codex") {
    throw new Error(`Codex ownership manifest is invalid at ${path}.`);
  }
  const candidate = value as Partial<CodexManifestV1 & LegacyManifest>;
  if (typeof candidate.command !== "string") throw new Error(`Codex ownership manifest is missing its command at ${path}.`);
  if (candidate.schema_version === undefined) return { provider: "codex", command: candidate.command };
  if (
    candidate.schema_version !== 1 ||
    typeof candidate.hooks_path !== "string" ||
    !candidate.shim ||
    typeof candidate.shim.path !== "string" ||
    typeof candidate.shim.sha256 !== "string"
  ) {
    throw new Error(`Codex ownership manifest schema is invalid at ${path}.`);
  }
  return candidate as CodexManifestV1;
}

async function readHooks(path: string): Promise<HooksJson> {
  if (!(await exists(path))) return {};
  try {
    return JSON.parse(await readFile(path, "utf8")) as HooksJson;
  } catch {
    throw new Error(`Codex hooks file is malformed at ${path}; refusing provider changes.`);
  }
}

function hookGroup(command: string): HookEntry {
  return { hooks: [{ type: "command", command }] };
}

function removeOwnedEntries(entries: unknown[], command: string): unknown[] {
  return entries.map((entry) => removeOwnedEntry(entry, command)).filter((entry) => entry !== null);
}

function removeOwnedEntry(entry: unknown, command: string): unknown | null {
  if (isExactCommand(entry, command)) return null;
  if (!entry || typeof entry !== "object") return entry;
  const group = entry as HookEntry;
  if (!Array.isArray(group.hooks)) return entry;
  const filtered = group.hooks.filter((handler) => !isExactCommand(handler, command));
  if (filtered.length === group.hooks.length) return entry;
  if (filtered.length === 0) return null;
  return { ...group, hooks: filtered };
}

function countOwnedCommands(hooks: HooksJson, event: string, command: string): number {
  const entries = hooks.hooks?.[event];
  if (!Array.isArray(entries)) return 0;
  return entries.reduce((count, entry) => {
    if (isExactCommand(entry, command)) return count + 1;
    if (!entry || typeof entry !== "object" || !Array.isArray((entry as HookEntry).hooks)) return count;
    const handlers = (entry as HookEntry).hooks as unknown[];
    return count + handlers.filter((handler) => isExactCommand(handler, command)).length;
  }, 0);
}

function isExactCommand(entry: unknown, command: string): boolean {
  return Boolean(
    entry &&
      typeof entry === "object" &&
      "command" in entry &&
      (entry as { command?: unknown }).command === command,
  );
}

function shimScript(myelinRoot: string, launcherPath?: string): string {
  const command = launcherPath
    ? `exec ${JSON.stringify(launcherPath)} capture codex-hook "$@"`
    : `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(myelinRoot, "src", "cli.ts"))} capture codex-hook "$@"`;
  return [
    "#!/usr/bin/env bash",
    `export MYELIN_ROOT=${JSON.stringify(myelinRoot)}`,
    `export ${INTERNAL_INVOCATION_KIND_ENV}=hook`,
    ...(launcherPath ? [`export ${INTERNAL_LAUNCHER_PATH_ENV}=${JSON.stringify(launcherPath)}`] : []),
    command,
    "",
  ].join("\n");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
