import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { InstallService, type InstallFailurePoint } from "../../src/install/install-service.ts";
import { readMachineLocator } from "../../src/install/machine-locator.ts";

let sandbox: string;
let myelinRoot: string;
let homeDir: string;
let binDir: string;
let locatorPath: string;
let journalPath: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "myelin-machine-install-"));
  myelinRoot = join(sandbox, "checkout-a");
  homeDir = join(sandbox, "home");
  binDir = join(homeDir, ".local", "bin");
  locatorPath = join(homeDir, ".myelin", "install.json");
  journalPath = join(homeDir, ".myelin", "install-journal.json");
  await mkdir(myelinRoot, { recursive: true });
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

test("command-only install previews, applies, and reapplies without timestamp churn", async () => {
  const instance = service();
  const preview = await instance.install(input(false));
  expect(preview.plan.actions.map((item) => item.id)).toEqual(["promote_launcher", "promote_locator"]);
  expect(await Bun.file(locatorPath).exists()).toBe(false);

  await instance.install(input(true));
  const firstText = await readFile(locatorPath, "utf8");
  const reapplied = await instance.install(input(true));

  expect(reapplied.plan.actions).toEqual([]);
  expect(await readFile(locatorPath, "utf8")).toBe(firstText);
  expect((await stat(join(binDir, "myelin"))).mode & 0o777).toBe(0o755);
  expect((await stat(join(homeDir, ".myelin"))).mode & 0o777).toBe(0o700);
  expect((await stat(locatorPath)).mode & 0o777).toBe(0o600);
});

test("custom bin directory leaves locator and journal at their fixed machine paths", async () => {
  const customBin = join(sandbox, "custom-bin");
  const result = await service().install({ ...input(true), binDir: customBin });

  expect(result.plan.launcher_path).toBe(join(customBin, "myelin"));
  expect(result.plan.locator_path).toBe(locatorPath);
  expect(result.plan.journal_path).toBe(journalPath);
  expect((await readMachineLocator(locatorPath)).launcher.path).toBe(join(customBin, "myelin"));
});

test("rebind is visible in preview and requires explicit apply consent", async () => {
  await service().install(input(true));
  const otherRoot = join(sandbox, "checkout-b");
  await mkdir(otherRoot, { recursive: true });
  const rebound = service({ myelinRoot: otherRoot });

  const preview = await rebound.install(input(false));
  expect(preview.plan.rebind).toBe(true);
  expect(preview.plan.current_root).toBe(myelinRoot);
  await expect(rebound.install(input(true))).rejects.toThrow("--rebind");
  await rebound.install({ ...input(true), rebind: true });
  expect((await readMachineLocator(locatorPath)).myelin_root).toBe(otherRoot);
});

test("unowned and changed launcher collisions block overwrite and uninstall", async () => {
  await mkdir(binDir, { recursive: true });
  await writeFile(join(binDir, "myelin"), "unowned\n", "utf8");
  await expect(service().install(input(false))).rejects.toThrow("Unowned artifact");

  await rm(join(binDir, "myelin"));
  await service().install(input(true));
  await writeFile(join(binDir, "myelin"), "changed\n", "utf8");
  await expect(service().install(input(false))).rejects.toThrow("hash mismatch");
  await expect(service().uninstall({ apply: false, providers: [] })).rejects.toThrow("hash mismatch");
});

test("missing recorded launcher is repaired from locator ownership", async () => {
  await service().install(input(true));
  await rm(join(binDir, "myelin"));

  const preview = await service().install(input(false));
  expect(preview.plan.actions.map((item) => item.id)).toEqual(["promote_launcher", "promote_locator"]);
  await service().install(input(true));
  expect(await Bun.file(join(binDir, "myelin")).exists()).toBe(true);
});

test("PATH state is reported without changing shell configuration", async () => {
  const active = await service().install(input(false));
  const inactive = await service({ env: { PATH: join(sandbox, "elsewhere") } }).install(input(false));

  expect(active.plan.path_active).toBe(true);
  expect(active.plan.warnings).toEqual([]);
  expect(inactive.plan.path_active).toBe(false);
  expect(inactive.plan.warnings[0]).toContain("Add it to your shell PATH");
});

for (const point of [
  "before_launcher_promotion",
  "after_launcher_promotion",
  "before_locator_promotion",
] as const) {
  test(`failure at ${point} leaves a journal and matching resume converges`, async () => {
    const failing = service({
      failAt: (observed) => {
        if (observed === point) throw new Error(`injected ${point}`);
      },
    });
    await expect(failing.install(input(true))).rejects.toThrow(`injected ${point}`);
    expect(await Bun.file(journalPath).exists()).toBe(true);

    const preview = await service().install(input(false));
    expect(preview.plan.warnings[0]).toContain("incomplete matching");
    await service().install(input(true));

    expect(await Bun.file(journalPath).exists()).toBe(false);
    expect((await readMachineLocator(locatorPath)).myelin_root).toBe(myelinRoot);
  });
}

test("different operation is blocked while a journal needs recovery", async () => {
  await expect(
    service({ failAt: () => { throw new Error("stop"); } }).install(input(true)),
  ).rejects.toThrow("stop");
  await expect(service().uninstall({ apply: false, providers: [] })).rejects.toThrow("must be recovered before uninstall");
});

test("uninstall is preview-first and preserves checkout state", async () => {
  for (const path of [
    "myelin.config",
    ".env",
    join("projects", "demo", "wiki", "index.md"),
    join("state", "memory.db"),
    join("projects", "demo", "logs", "latest.log"),
    join("projects", "demo", "runs", "run.json"),
  ]) {
    await mkdir(dirname(join(myelinRoot, path)), { recursive: true });
    await writeFile(join(myelinRoot, path), "preserve\n", "utf8");
  }
  await service().install(input(true));

  const preview = await service().uninstall({ apply: false, providers: [] });
  expect(preview.plan.actions.map((item) => item.id)).toEqual(["remove_launcher", "remove_locator"]);
  expect(await Bun.file(locatorPath).exists()).toBe(true);
  await service().uninstall({ apply: true, providers: [] });

  expect(await Bun.file(locatorPath).exists()).toBe(false);
  expect(await Bun.file(join(binDir, "myelin")).exists()).toBe(false);
  expect(await readFile(join(myelinRoot, "myelin.config"), "utf8")).toBe("preserve\n");
  expect(await Bun.file(join(myelinRoot, "state", "memory.db")).exists()).toBe(true);
  expect(await Bun.file(join(myelinRoot, "projects", "demo", "wiki", "index.md")).exists()).toBe(true);
});

test("provider preservation matrix keeps command and provider ownership conservative", async () => {
  const codexRoot = join(homeDir, ".codex");
  await mkdir(codexRoot, { recursive: true });
  const providerService = service({ codexRoot });

  // Bare install selects the sole detected provider.
  const barePreview = await providerService.install({ ...input(false), commandOnly: false });
  expect(barePreview.plan.actions.map((item) => item.id)).toEqual([
    "promote_launcher",
    "apply_provider:codex",
    "promote_locator",
  ]);
  await providerService.install({ ...input(true), commandOnly: false });
  expect(Object.keys((await readMachineLocator(locatorPath)).providers)).toEqual(["codex"]);

  // Explicit provider repair preserves the same provider map and converges.
  const explicit = await providerService.install({ ...input(true), commandOnly: false, providers: ["codex"] });
  expect(explicit.plan.actions).toEqual([]);
  expect(Object.keys((await readMachineLocator(locatorPath)).providers)).toEqual(["codex"]);

  // Command-only repair never drops an unselected recorded provider.
  await rm(join(binDir, "myelin"));
  await providerService.install(input(true));
  expect(Object.keys((await readMachineLocator(locatorPath)).providers)).toEqual(["codex"]);

  // Provider-only uninstall preserves launcher/locator and removes only Codex ownership.
  const providerPreview = await providerService.uninstall({ apply: false, providers: ["codex"] });
  expect(providerPreview.plan.actions.map((item) => item.id)).toEqual(["remove_provider:codex", "promote_locator"]);
  await providerService.uninstall({ apply: true, providers: ["codex"] });
  expect(await Bun.file(join(binDir, "myelin")).exists()).toBe(true);
  expect(Object.keys((await readMachineLocator(locatorPath)).providers)).toEqual([]);

  // Reinstall then full uninstall removes provider ownership before command ownership.
  await providerService.install({ ...input(true), commandOnly: false, providers: ["codex"] });
  const full = await providerService.uninstall({ apply: false, providers: [] });
  expect(full.plan.actions.map((item) => item.id)).toEqual([
    "remove_provider:codex",
    "remove_launcher",
    "remove_locator",
  ]);
  await providerService.uninstall({ apply: true, providers: [] });
  expect(await Bun.file(locatorPath).exists()).toBe(false);
  expect(await Bun.file(join(codexRoot, "hooks.json")).exists()).toBe(true);
  expect(await readFile(join(codexRoot, "hooks.json"), "utf8")).not.toContain("codex-hook");
});

test("explicit unavailable provider fails before journal or filesystem mutation", async () => {
  await expect(
    service({ detectedProviders: [] }).install({ ...input(true), commandOnly: false, providers: ["codex"] }),
  ).rejects.toThrow("not available");
  expect(await Bun.file(journalPath).exists()).toBe(false);
  expect(await Bun.file(locatorPath).exists()).toBe(false);
});

test("interrupted provider apply and uninstall resume before locator promotion", async () => {
  const codexRoot = join(homeDir, ".codex");
  await mkdir(codexRoot, { recursive: true });
  const failBeforeLocator = (point: InstallFailurePoint) => {
    if (point === "before_locator_promotion") throw new Error("stop before locator");
  };
  await expect(
    service({ codexRoot, failAt: failBeforeLocator }).install({ ...input(true), commandOnly: false }),
  ).rejects.toThrow("stop before locator");
  expect(await Bun.file(join(codexRoot, ".myelin", "install-manifest.json")).exists()).toBe(true);
  await service({ codexRoot }).install({ ...input(true), commandOnly: false });
  expect(Object.keys((await readMachineLocator(locatorPath)).providers)).toEqual(["codex"]);

  await expect(
    service({ codexRoot, failAt: failBeforeLocator }).uninstall({ apply: true, providers: ["codex"] }),
  ).rejects.toThrow("stop before locator");
  expect(await Bun.file(join(codexRoot, ".myelin", "install-manifest.json")).exists()).toBe(false);
  await service({ codexRoot }).uninstall({ apply: true, providers: ["codex"] });
  expect(Object.keys((await readMachineLocator(locatorPath)).providers)).toEqual([]);
});

function input(apply: boolean) {
  return { apply, rebind: false, binDir: null, commandOnly: true, providers: [] };
}

function service(overrides: Partial<{
  myelinRoot: string;
  env: NodeJS.ProcessEnv;
  failAt: (point: InstallFailurePoint) => void;
  codexRoot: string;
  detectedProviders: string[];
}> = {}): InstallService {
  return new InstallService({
    myelinRoot: overrides.myelinRoot ?? myelinRoot,
    homeDir,
    locatorPath,
    journalPath,
    env: overrides.env ?? { PATH: binDir },
    sourceRevision: null,
    now: () => new Date("2026-07-10T10:00:00.000Z"),
    failAt: overrides.failAt,
    codexRoot: overrides.codexRoot,
    detectedProviders: overrides.detectedProviders,
  });
}
