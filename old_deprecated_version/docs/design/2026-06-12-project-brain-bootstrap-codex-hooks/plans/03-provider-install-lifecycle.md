# Chunk 03: Provider Install Lifecycle

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** None
**Enables:** `05-codex-capture-adapter.md`, `06-class-kit-verification.md`

## Goal

Add provider-agnostic install/uninstall commands that preview by default, write only with `--apply`, safely manage Myelin-owned Codex hook entries and shim artifacts under a provider root, preserve unrelated user hooks, pass the active Myelin checkout root into the hook shim, and test all write behavior against temporary provider roots before any real `~/.codex` mutation is considered.

## Source Artifacts

- `../spec.md`: Integrations, Permissions / Security.
- `../agenda.md`: Questions 11, 12, 17, 18, 19, 37, 38, 39, 40.
- `../../../CONTEXT.md`: Install Command, Capture Provider, Capture Adapter.
- `../../../docs/adr/0054-use-provider-agnostic-capture-adapters.md`
- `../../../docs/adr/0055-use-global-install-with-per-repo-capture-opt-in.md`
- Existing code: `src/cli.ts`, `src/commands/registry.ts`, `src/runtime/fs.ts`, `package.json`.

## Relationships

- **Depends on:** no prior chunks.
- **Enables:** Codex adapter can be invoked through a stable shim; manual `class-kit` verification can install real global hooks after explicit approval.
- **Shared contracts:** commands `myelin install`, `myelin install --apply`, `myelin install --apply --provider codex`, `myelin uninstall`; Myelin provider state under `~/.codex/.myelin/`; shim under `~/.codex/.myelin/shim/`; backups under `~/.codex/.myelin/backups/`; shim sets `MYELIN_ROOT` to the active Myelin checkout before invoking `capture codex-hook`.
- **Integration points:** user-level Codex `hooks.json`, generated shim, CLI command registry, temp provider roots for tests.

## File Responsibility Map

**Create:**
- `src/install/types.ts` - provider install types and plan result shapes.
- `src/install/codex.ts` - Codex provider detection, preview, apply, uninstall, backup, and hook merge/removal logic.
- `src/install/codex.test.ts` - temp-root tests for create/update/uninstall and preserving unrelated hooks.
- `src/commands/install.ts` - CLI parser for install/uninstall and provider selection behavior.
- `src/commands/install.test.ts` - command-level tests with temp provider roots.

**Modify:**
- `src/cli.ts` - register install commands.

**Test:**
- `src/install/codex.test.ts`
- `src/commands/install.test.ts`

## Implementation Tasks

### Task 1: Define Install Types

**Files:**
- Create: `src/install/types.ts`

- [ ] **Step 1: Add shared install types**

```ts
export type InstallMode = "preview" | "apply" | "uninstall";

export type ProviderName = "codex";

export type ProviderInstallPlan = {
  provider: ProviderName;
  detected: boolean;
  provider_root: string;
  hooks_path: string;
  state_dir: string;
  actions: string[];
  warnings: string[];
};

export type ProviderInstallOptions = {
  providerRoot?: string;
  myelinRoot: string;
  mode: InstallMode;
};
```

### Task 2: Implement Codex Provider Install Planner

**Files:**
- Create: `src/install/codex.ts`
- Create: `src/install/codex.test.ts`

- [ ] **Step 1: Add temp-root install tests**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyCodexInstall, planCodexInstall, uninstallCodex } from "./codex.ts";

let root: string;
let codexRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-install-"));
  codexRoot = join(root, ".codex");
  await mkdir(codexRoot, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("preview reports create actions without writing", async () => {
  const plan = await planCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "preview" });

  expect(plan.detected).toBe(true);
  expect(plan.actions).toContain("create hooks.json");
  expect(await Bun.file(join(codexRoot, "hooks.json")).exists()).toBe(false);
});

test("apply creates hooks, shim, manifest, and backup directory", async () => {
  await applyCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "apply" });

  const hooks = JSON.parse(await readFile(join(codexRoot, "hooks.json"), "utf8"));
  expect(JSON.stringify(hooks)).toContain(".myelin/shim/codex-hook");
  expect(await Bun.file(join(codexRoot, ".myelin", "shim", "codex-hook")).exists()).toBe(true);
  expect(await readFile(join(codexRoot, ".myelin", "shim", "codex-hook"), "utf8")).toContain(`MYELIN_ROOT=${JSON.stringify(root)}`);
  expect(await Bun.file(join(codexRoot, ".myelin", "install-manifest.json")).exists()).toBe(true);
});

test("apply preserves unrelated hooks and is idempotent", async () => {
  await writeFile(
    join(codexRoot, "hooks.json"),
    JSON.stringify({ hooks: { Stop: [{ command: "echo unrelated" }] } }, null, 2),
    "utf8",
  );

  await applyCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "apply" });
  await applyCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "apply" });

  const hooksText = await readFile(join(codexRoot, "hooks.json"), "utf8");
  expect(hooksText.match(/echo unrelated/g)?.length).toBe(1);
  expect(hooksText.match(/codex-hook/g)?.length).toBe(3);
});

test("uninstall removes only myelin-owned hook entries", async () => {
  await writeFile(
    join(codexRoot, "hooks.json"),
    JSON.stringify({ hooks: { Stop: [{ command: "echo unrelated" }] } }, null, 2),
    "utf8",
  );
  await applyCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "apply" });
  await uninstallCodex({ providerRoot: codexRoot, myelinRoot: root, mode: "uninstall" });

  const hooksText = await readFile(join(codexRoot, "hooks.json"), "utf8");
  expect(hooksText).toContain("echo unrelated");
  expect(hooksText).not.toContain("codex-hook");
});
```

- [ ] **Step 2: Run install tests**

Run: `bun test src/install/codex.test.ts`  
Expected: fails because `src/install/codex.ts` does not exist.

- [ ] **Step 3: Implement Codex install logic**

Implement these exports in `src/install/codex.ts`:

```ts
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderInstallOptions, ProviderInstallPlan } from "./types.ts";

const EVENTS = ["SessionStart", "UserPromptSubmit", "Stop"] as const;
const MANIFEST = "install-manifest.json";

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
  await mkdir(plan.provider_root, { recursive: true });
  await mkdir(join(plan.state_dir, "shim"), { recursive: true });
  await mkdir(join(plan.state_dir, "backups"), { recursive: true });
  if (await exists(plan.hooks_path)) {
    await copyFile(plan.hooks_path, join(plan.state_dir, "backups", `hooks-${Date.now()}.json`));
  }

  const hooks = await readHooks(plan.hooks_path);
  const command = join(plan.state_dir, "shim", "codex-hook");
  hooks.hooks ??= {};
  for (const event of EVENTS) {
    const existing = Array.isArray(hooks.hooks[event]) ? hooks.hooks[event] : [];
    hooks.hooks[event] = [...existing.filter((entry) => !isMyelinEntry(entry)), { command }];
  }

  await writeFile(plan.hooks_path, `${JSON.stringify(hooks, null, 2)}\n`, "utf8");
  await writeFile(command, shimScript(options.myelinRoot), { encoding: "utf8", mode: 0o755 });
  await writeFile(join(plan.state_dir, MANIFEST), `${JSON.stringify({ provider: "codex", command }, null, 2)}\n`, "utf8");
  return plan;
}

export async function uninstallCodex(options: ProviderInstallOptions): Promise<ProviderInstallPlan> {
  const plan = await planCodexInstall(options);
  const hooks = await readHooks(plan.hooks_path);
  if (hooks.hooks) {
    for (const event of Object.keys(hooks.hooks)) {
      hooks.hooks[event] = Array.isArray(hooks.hooks[event])
        ? hooks.hooks[event].filter((entry) => !isMyelinEntry(entry))
        : hooks.hooks[event];
    }
  }
  await writeFile(plan.hooks_path, `${JSON.stringify(hooks, null, 2)}\n`, "utf8");
  await rm(join(plan.state_dir, "shim"), { recursive: true, force: true });
  await rm(join(plan.state_dir, MANIFEST), { force: true });
  return plan;
}

type HooksJson = { hooks?: Record<string, Array<{ command?: string; [key: string]: unknown }>>; [key: string]: unknown };

async function readHooks(path: string): Promise<HooksJson> {
  if (!(await exists(path))) return {};
  return JSON.parse(await readFile(path, "utf8")) as HooksJson;
}

function isMyelinEntry(entry: { command?: string }): boolean {
  return typeof entry.command === "string" && entry.command.includes(".myelin/shim/codex-hook");
}

function shimScript(myelinRoot: string): string {
  return `#!/usr/bin/env bash\nexport MYELIN_ROOT=${JSON.stringify(myelinRoot)}\nexec bun ${JSON.stringify(join(myelinRoot, "src", "cli.ts"))} capture codex-hook\n`;
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
```

- [ ] **Step 4: Run install tests**

Run: `bun test src/install/codex.test.ts`  
Expected: passes.

### Task 3: Add Install CLI

**Files:**
- Create: `src/commands/install.ts`
- Create: `src/commands/install.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Add CLI tests**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "./registry.ts";
import { registerInstallCommands } from "./install.ts";

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
});

test("uninstall removes myelin-owned entries", async () => {
  const cli = createCli("myelin");
  registerInstallCommands(cli, { myelinRoot: root, codexRoot, isInteractive: false });

  await cli.run(["install", "--apply", "--provider", "codex"]);
  const result = await cli.run(["uninstall", "--provider", "codex"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Mode: uninstall");
});
```

- [ ] **Step 2: Implement CLI command**

```ts
import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { repoRoot } from "../runtime/fs.ts";
import { applyCodexInstall, planCodexInstall, uninstallCodex } from "../install/codex.ts";

export type InstallCommandDeps = {
  myelinRoot?: string;
  codexRoot?: string;
  isInteractive?: boolean;
  detectedProviders?: string[];
};

export function registerInstallCommands(cli: Cli, deps: InstallCommandDeps = {}): void {
  cli.command(["install"], async (args) => {
    const parsed = parseInstallArgs(args);
    if (parsed.error) return fail(parsed.error);
    if (parsed.provider && parsed.provider !== "codex") return fail("--provider must be codex");
    const detectedProviders = deps.detectedProviders ?? ["codex"];
    if (parsed.apply && !parsed.provider && detectedProviders.length > 1 && deps.isInteractive === false) {
      return fail(`Multiple providers detected (${detectedProviders.join(", ")}). Re-run with --provider <name>.`);
    }

    const options = {
      providerRoot: deps.codexRoot,
      myelinRoot: deps.myelinRoot ?? repoRoot().root,
      mode: parsed.apply ? "apply" as const : "preview" as const,
    };
    const plan = parsed.apply ? await applyCodexInstall(options) : await planCodexInstall(options);
    return ok(render("install", parsed.apply ? "apply" : "preview", plan));
  });

  cli.command(["uninstall"], async (args) => {
    const parsed = parseInstallArgs(args);
    if (parsed.error) return fail(parsed.error);
    if (parsed.provider && parsed.provider !== "codex") return fail("--provider must be codex");
    const plan = await uninstallCodex({
      providerRoot: deps.codexRoot,
      myelinRoot: deps.myelinRoot ?? repoRoot().root,
      mode: "uninstall",
    });
    return ok(render("uninstall", "uninstall", plan));
  });
}

function parseInstallArgs(args: string[]): { apply: boolean; provider: string | null; error?: string } {
  let apply = false;
  let provider: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--provider") provider = args[++index] ?? null;
    else return { apply, provider, error: `Unknown install option: ${arg}` };
  }
  return { apply, provider };
}

function render(command: string, mode: string, plan: { provider: string; detected: boolean; actions: string[] }): string {
  return [`Command: ${command}`, `Provider: ${plan.provider}`, `Mode: ${mode}`, `Detected: ${plan.detected}`, ...plan.actions.map((action) => `- ${action}`)].join("\n");
}
```

This v0 command supports one implemented provider, `codex`. Because only one provider can be applied today, `myelin install --apply` may apply Codex without `--provider` when Codex is the only detected supported provider. The non-interactive multi-provider failure path is still implemented and tested through dependency injection so future supported providers cannot silently change the write contract.

- [ ] **Step 3: Register commands in `src/cli.ts`**

```ts
import { registerInstallCommands } from "./commands/install.ts";
```

Add:

```ts
registerInstallCommands(cli);
```

- [ ] **Step 4: Run CLI tests**

Run: `bun test src/commands/install.test.ts src/install/codex.test.ts`  
Expected: passes.

## Verification

Run: `bun test src/install/codex.test.ts src/commands/install.test.ts`  
Expected: all tests pass using only temp provider roots.

Run: `bun run typecheck`  
Expected: TypeScript completes without errors.

Run: `bun src/cli.ts install`  
Expected: previews Codex provider state and does not write unless later run with `--apply`.

## Acceptance Criteria Covered

- `myelin install` previews by default.
- `myelin install --apply --provider codex` writes Myelin-owned Codex hook entries and shim artifacts.
- `myelin uninstall --provider codex` removes Myelin-owned artifacts/entries only.
- Existing unrelated hooks are preserved.
- Backups and manifest live under `.codex/.myelin/`.
- Temp provider-root tests pass before any real provider write.

## Risks And Rollback

- Risk: accidental real `~/.codex` mutation during tests. Tests must pass explicit `codexRoot` temp dirs.
- Rollback for real runs: `myelin uninstall --provider codex` removes Myelin-owned entries; backups are under `~/.codex/.myelin/backups/`.
- Risk: CLI prompt behavior can grow. Keep v0 Codex-only application explicit in tests, and keep the non-interactive multi-provider failure test so future providers cannot bypass the approved selection contract.

## Non-Goals

- Do not implement the `capture codex-hook` command here.
- Do not parse Codex hook payloads.
- Do not write Experience Log rows.
- Do not touch real `~/.codex` during automated tests.

## Type And Name Consistency

- Command registration: `registerInstallCommands`.
- Provider planner: `planCodexInstall`.
- Apply function: `applyCodexInstall`.
- Removal function: `uninstallCodex`.
- Provider name: `codex`.
- Shim environment handoff: `MYELIN_ROOT`.
