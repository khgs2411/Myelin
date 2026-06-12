import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderInstallOptions, ProviderInstallPlan } from "./types.ts";

const EVENTS = ["SessionStart", "UserPromptSubmit", "Stop"] as const;
const MANIFEST = "install-manifest.json";

type HookEntry = {
  command?: string;
  [key: string]: unknown;
};

type HooksJson = {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
};

export async function planCodexInstall(options: ProviderInstallOptions): Promise<ProviderInstallPlan> {
  const providerRoot = options.providerRoot ?? join(process.env.HOME ?? "", ".codex");
  const detected = await isDirectory(providerRoot);
  const hooksPath = join(providerRoot, "hooks.json");
  const stateDir = join(providerRoot, ".myelin");
  const hooksExists = await exists(hooksPath);

  return {
    provider: "codex",
    detected,
    provider_root: providerRoot,
    hooks_path: hooksPath,
    state_dir: stateDir,
    actions: [
      hooksExists ? "merge myelin hook entries" : "create hooks.json",
      "write .myelin/shim/codex-hook",
      "write .myelin/install-manifest.json",
    ],
    warnings: detected ? [] : ["Codex provider root was not detected"],
  };
}

export async function applyCodexInstall(options: ProviderInstallOptions): Promise<ProviderInstallPlan> {
  const plan = await planCodexInstall(options);
  const command = join(plan.state_dir, "shim", "codex-hook");

  await mkdir(plan.provider_root, { recursive: true });
  await mkdir(join(plan.state_dir, "shim"), { recursive: true });
  await mkdir(join(plan.state_dir, "backups"), { recursive: true });

  if (await exists(plan.hooks_path)) {
    await copyFile(plan.hooks_path, join(plan.state_dir, "backups", `hooks-${Date.now()}.json`));
  }

  const hooks = await readHooks(plan.hooks_path);
  hooks.hooks ??= {};

  for (const event of EVENTS) {
    const existing = Array.isArray(hooks.hooks[event]) ? hooks.hooks[event] : [];
    hooks.hooks[event] = [...existing.filter((entry) => !isMyelinEntry(entry)), { command }];
  }

  await writeFile(plan.hooks_path, `${JSON.stringify(hooks, null, 2)}\n`, "utf8");
  await writeFile(command, shimScript(options.myelinRoot), { encoding: "utf8", mode: 0o755 });
  await writeFile(
    join(plan.state_dir, MANIFEST),
    `${JSON.stringify({ provider: "codex", command }, null, 2)}\n`,
    "utf8",
  );

  return plan;
}

export async function uninstallCodex(options: ProviderInstallOptions): Promise<ProviderInstallPlan> {
  const plan = await planCodexInstall(options);

  if (await exists(plan.hooks_path)) {
    const hooks = await readHooks(plan.hooks_path);
    if (hooks.hooks) {
      for (const event of Object.keys(hooks.hooks)) {
        const entries = hooks.hooks[event];
        if (Array.isArray(entries)) {
          hooks.hooks[event] = entries.filter((entry) => !isMyelinEntry(entry));
        }
      }
    }
    await writeFile(plan.hooks_path, `${JSON.stringify(hooks, null, 2)}\n`, "utf8");
  }

  await rm(join(plan.state_dir, "shim"), { recursive: true, force: true });
  await rm(join(plan.state_dir, MANIFEST), { force: true });

  return plan;
}

async function readHooks(path: string): Promise<HooksJson> {
  if (!(await exists(path))) return {};
  return JSON.parse(await readFile(path, "utf8")) as HooksJson;
}

function isMyelinEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object" || !("command" in entry)) return false;
  const command = (entry as HookEntry).command;
  return typeof command === "string" && command.includes(".myelin/shim/codex-hook");
}

function shimScript(myelinRoot: string): string {
  return [
    "#!/usr/bin/env bash",
    `export MYELIN_ROOT=${JSON.stringify(myelinRoot)}`,
    `exec bun ${JSON.stringify(join(myelinRoot, "src", "cli.ts"))} capture codex-hook`,
    "",
  ].join("\n");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
