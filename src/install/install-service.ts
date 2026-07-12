import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import type { MachineLocatorV1 } from "../runtime/launch-context.ts";
import {
  createInstallJournal,
  markInstallActionComplete,
  readInstallJournalIfExists,
  removeInstallJournal,
  writeInstallJournal,
} from "./install-journal.ts";
import { inspectLauncher, launcherSha256, promoteLauncher, renderLauncher } from "./launcher.ts";
import { promoteMachineLocator, readMachineLocatorIfExists } from "./machine-locator.ts";
import {
  applyCodexProvider,
  codexProviderRootFromManifest,
  inspectCodexProvider,
  removeCodexProvider,
} from "./codex.ts";
import { ProviderRegistry } from "./provider-registry.ts";
import type {
  InstallJournalV1,
  MachineInstallAction,
  MachineInstallOperation,
  MachineInstallPlan,
} from "./types.ts";

export type InstallFailurePoint =
  | "before_launcher_promotion"
  | "after_launcher_promotion"
  | "before_locator_promotion";

export type InstallServiceDeps = {
  myelinRoot: string;
  homeDir?: string;
  binDir?: string;
  locatorPath?: string;
  journalPath?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  sourceRevision?: string | null;
  failAt?: (point: InstallFailurePoint) => void | Promise<void>;
  codexRoot?: string;
  detectedProviders?: string[];
  supportedProviders?: string[];
};

export type InstallInput = {
  apply: boolean;
  rebind: boolean;
  binDir: string | null;
  commandOnly: boolean;
  providers: string[];
};

export type UninstallInput = {
  apply: boolean;
  providers: string[];
};

export type InstallResult = {
  mode: "preview" | "apply";
  plan: MachineInstallPlan;
};

export class InstallService {
  constructor(private readonly deps: InstallServiceDeps) {}

  async install(input: InstallInput): Promise<InstallResult> {
    const paths = this.paths(input.binDir);
    const selection = await this.registry(paths.home).select({ explicit: input.providers, commandOnly: input.commandOnly });
    const existingJournal = await readInstallJournalIfExists(paths.journalPath);
    if (existingJournal) {
      this.assertMatchingJournal(existingJournal, "install", paths.launcherPath, paths.locatorPath);
      const plan = this.planFromJournal(existingJournal, paths, input.apply);
      if (!input.apply) return { mode: "preview", plan };
      await this.applyJournal(existingJournal, paths.journalPath);
      return { mode: "apply", plan: { ...plan, mode: "apply" } };
    }

    const plan = await this.planInstall(input, paths, selection.selected, selection.warnings);
    if (!input.apply || plan.actions.length === 0) return { mode: input.apply ? "apply" : "preview", plan };
    if (plan.rebind && !input.rebind) {
      throw new Error(`Installation is bound to ${plan.current_root}. Re-run with --rebind --apply to bind ${plan.myelin_root}.`);
    }
    const journal = createInstallJournal({
      transactionId: crypto.randomUUID(),
      operation: "install",
      myelinRoot: plan.myelin_root,
      launcherPath: plan.launcher_path,
      locatorPath: plan.locator_path,
      desiredManifest: plan.desired_manifest,
      actions: plan.actions,
      createdAt: this.now(),
    });
    await writeInstallJournal(paths.journalPath, journal);
    await this.applyJournal(journal, paths.journalPath);
    return { mode: "apply", plan: { ...plan, mode: "apply" } };
  }

  async uninstall(input: UninstallInput): Promise<InstallResult> {
    const paths = this.paths(null);
    const existingJournal = await readInstallJournalIfExists(paths.journalPath);
    if (existingJournal) {
      this.assertMatchingJournal(existingJournal, "uninstall", existingJournal.launcher_path, paths.locatorPath);
      const journalPaths = { ...paths, launcherPath: existingJournal.launcher_path };
      const plan = this.planFromJournal(existingJournal, journalPaths, input.apply);
      if (!input.apply) return { mode: "preview", plan };
      await this.applyJournal(existingJournal, paths.journalPath);
      return { mode: "apply", plan: { ...plan, mode: "apply" } };
    }

    const plan = await this.planUninstall(input, paths);
    if (!input.apply || plan.actions.length === 0) return { mode: input.apply ? "apply" : "preview", plan };
    const journal = createInstallJournal({
      transactionId: crypto.randomUUID(),
      operation: "uninstall",
      myelinRoot: plan.myelin_root,
      launcherPath: plan.launcher_path,
      locatorPath: plan.locator_path,
      desiredManifest: plan.desired_manifest,
      actions: plan.actions,
      createdAt: this.now(),
    });
    await writeInstallJournal(paths.journalPath, journal);
    await this.applyJournal(journal, paths.journalPath);
    return { mode: "apply", plan: { ...plan, mode: "apply" } };
  }

  private async planInstall(
    input: InstallInput,
    paths: ReturnType<InstallService["paths"]>,
    selectedProviders: Array<"codex">,
    providerWarnings: string[],
  ): Promise<MachineInstallPlan> {
    const current = await readMachineLocatorIfExists(paths.locatorPath);
    const content = renderLauncher(paths.locatorPath);
    const desiredHash = launcherSha256(content);
    const warnings = [...this.pathWarnings(paths.binDir), ...providerWarnings];
    const rebind = Boolean(current && resolve(current.myelin_root) !== resolve(this.deps.myelinRoot));

    if (current && resolve(current.launcher.path) !== paths.launcherPath) {
      throw new Error(`The machine locator owns launcher ${current.launcher.path}; refusing a different --bin-dir target.`);
    }

    if (!current) {
      const unowned = await inspectLauncher(paths.launcherPath, desiredHash);
      if (unowned.status !== "missing") {
        throw new Error(`Unowned artifact exists at ${paths.launcherPath}; refusing to overwrite it without a machine locator.`);
      }
      const timestamp = this.now();
      const providerPlan = await this.planSelectedProviders(selectedProviders, {}, paths.home, paths.launcherPath);
      const desired = this.desiredManifest(paths, desiredHash, null, timestamp, timestamp, providerPlan.providers);
      return this.plan("install", input.apply, paths, null, false, warnings, desired, [
        action("promote_launcher", "install copied Myelin launcher", paths.launcherPath, desiredHash),
        ...providerPlan.actions,
        action("promote_locator", "write machine locator and ownership record", paths.locatorPath, null),
      ]);
    }

    const observed = await inspectLauncher(paths.launcherPath, current.launcher.sha256);
    if (observed.status === "symlink" || observed.status === "mismatch") {
      throw new Error(`Owned launcher hash mismatch at ${paths.launcherPath}; refusing repair or overwrite.`);
    }
    const launcherNeedsWrite = observed.status === "missing" || current.launcher.sha256 !== desiredHash;
    const providerPlan = await this.planSelectedProviders(selectedProviders, current.providers, paths.home, paths.launcherPath);
    const sourceRevision = this.sourceRevision();
    const locatorNeedsWrite =
      rebind ||
      launcherNeedsWrite ||
      current.source_revision !== sourceRevision ||
      providerPlan.actions.length > 0 ||
      JSON.stringify(current.providers) !== JSON.stringify(providerPlan.providers);
    if (!locatorNeedsWrite) {
      return this.plan("install", input.apply, paths, current.myelin_root, false, warnings, current, []);
    }

    const desired = this.desiredManifest(
      paths,
      desiredHash,
      current,
      current.installed_at,
      this.now(),
      providerPlan.providers,
    );
    const actions: MachineInstallAction[] = [];
    if (launcherNeedsWrite) actions.push(action("promote_launcher", "repair or update copied Myelin launcher", paths.launcherPath, desiredHash));
    actions.push(...providerPlan.actions);
    actions.push(action("promote_locator", rebind ? "rebind machine locator to this checkout" : "update machine locator", paths.locatorPath, null));
    return this.plan("install", input.apply, paths, current.myelin_root, rebind, warnings, desired, actions);
  }

  private async planUninstall(
    input: UninstallInput,
    paths: ReturnType<InstallService["paths"]>,
  ): Promise<MachineInstallPlan> {
    const current = await readMachineLocatorIfExists(paths.locatorPath);
    if (!current) {
      const unowned = await inspectLauncher(paths.launcherPath, launcherSha256(renderLauncher(paths.locatorPath)));
      if (unowned.status !== "missing") {
        throw new Error(`Launcher exists without ${paths.locatorPath}; it is unowned and will not be removed.`);
      }
      return this.plan("uninstall", input.apply, paths, null, false, this.pathWarnings(paths.binDir), null, []);
    }
    const requestedProviders = [...new Set(input.providers)];
    for (const provider of requestedProviders) {
      if (provider !== "codex") throw new Error(`Unsupported provider: ${provider}`);
      if (!current.providers[provider]) throw new Error(`Provider ${provider} is not recorded in the machine locator.`);
    }
    const removeProviders = requestedProviders.length > 0 ? requestedProviders : Object.keys(current.providers);
    const providerActions: MachineInstallAction[] = [];
    for (const provider of removeProviders) {
      if (provider !== "codex") throw new Error(`Unsupported recorded provider: ${provider}`);
      const ownership = current.providers.codex;
      const providerRoot = codexProviderRootFromManifest(ownership.manifest_path);
      const inspection = await inspectCodexProvider({ providerRoot, myelinRoot: current.myelin_root });
      if (JSON.stringify(inspection.ownership) !== JSON.stringify(ownership)) {
        throw new Error("Codex ownership paths do not match the machine locator; refusing uninstall.");
      }
      providerActions.push(action(
        "remove_provider:codex",
        "remove verified Codex provider integration",
        ownership.manifest_path,
        null,
        this.providerBackupPath(providerRoot),
      ));
    }
    if (requestedProviders.length > 0) {
      const providers = { ...current.providers };
      for (const provider of requestedProviders) delete providers[provider];
      const desired: MachineLocatorV1 = { ...current, providers, updated_at: this.now() };
      return this.plan(
        "uninstall",
        input.apply,
        { ...paths, launcherPath: current.launcher.path, binDir: dirname(current.launcher.path) },
        current.myelin_root,
        false,
        this.pathWarnings(dirname(current.launcher.path)),
        desired,
        [...providerActions, action("promote_locator", "update machine locator after provider removal", paths.locatorPath, null)],
      );
    }
    const observed = await inspectLauncher(current.launcher.path, current.launcher.sha256);
    if (observed.status === "symlink" || observed.status === "mismatch") {
      throw new Error(`Owned launcher hash mismatch at ${current.launcher.path}; refusing uninstall.`);
    }
    const actions: MachineInstallAction[] = [...providerActions];
    if (observed.status === "owned") actions.push(action("remove_launcher", "remove verified Myelin launcher", current.launcher.path, current.launcher.sha256));
    actions.push(action("remove_locator", "remove machine locator and ownership record", paths.locatorPath, null));
    return this.plan(
      "uninstall",
      input.apply,
      { ...paths, launcherPath: current.launcher.path, binDir: dirname(current.launcher.path) },
      current.myelin_root,
      false,
      this.pathWarnings(dirname(current.launcher.path)),
      null,
      actions,
    );
  }

  private async applyJournal(journal: InstallJournalV1, journalPath: string): Promise<void> {
    for (const pending of journal.actions) {
      if (pending.state === "complete") continue;
      if (pending.id === "promote_launcher") {
        await this.fail("before_launcher_promotion");
        await promoteLauncher(pending.path, renderLauncher(journal.locator_path));
        await markInstallActionComplete(journalPath, journal, pending.id);
        await this.fail("after_launcher_promotion");
      } else if (pending.id === "promote_locator") {
        await this.fail("before_locator_promotion");
        if (!journal.desired_manifest) throw new Error("Install journal is missing its desired manifest.");
        await promoteMachineLocator(pending.path, journal.desired_manifest);
        await markInstallActionComplete(journalPath, journal, pending.id);
      } else if (pending.id === "remove_launcher") {
        const observed = await inspectLauncher(pending.path, pending.expected_sha256 ?? "");
        if (observed.status === "mismatch" || observed.status === "symlink") {
          throw new Error(`Owned launcher hash mismatch at ${pending.path}; refusing uninstall recovery.`);
        }
        await rm(pending.path, { force: true });
        await markInstallActionComplete(journalPath, journal, pending.id);
      } else if (pending.id === "remove_locator") {
        await rm(pending.path, { force: true });
        await markInstallActionComplete(journalPath, journal, pending.id);
      } else if (pending.id === "apply_provider:codex") {
        await applyCodexProvider({
          providerRoot: codexProviderRootFromManifest(pending.path),
          myelinRoot: journal.desired_manifest?.myelin_root ?? journal.myelin_root,
          launcherPath: journal.desired_manifest?.launcher.path,
          backupPath: pending.backup_path,
        });
        await markInstallActionComplete(journalPath, journal, pending.id);
      } else if (pending.id === "remove_provider:codex") {
        await removeCodexProvider({
          providerRoot: codexProviderRootFromManifest(pending.path),
          backupPath: pending.backup_path,
        });
        await markInstallActionComplete(journalPath, journal, pending.id);
      }
    }
    await removeInstallJournal(journalPath);
  }

  private planFromJournal(
    journal: InstallJournalV1,
    paths: ReturnType<InstallService["paths"]>,
    apply: boolean,
  ): MachineInstallPlan {
    return this.plan(
      journal.operation,
      apply,
      paths,
      journal.operation === "install" ? journal.desired_manifest?.myelin_root ?? null : journal.myelin_root,
      false,
      ["An incomplete matching installation transaction will be resumed."],
      journal.desired_manifest,
      journal.actions.filter((item) => item.state === "pending"),
    );
  }

  private assertMatchingJournal(
    journal: InstallJournalV1,
    operation: MachineInstallOperation,
    launcherPath: string,
    locatorPath: string,
  ): void {
    if (
      journal.operation !== operation ||
      resolve(journal.myelin_root) !== resolve(this.deps.myelinRoot) ||
      resolve(journal.launcher_path) !== resolve(launcherPath) ||
      resolve(journal.locator_path) !== resolve(locatorPath)
    ) {
      throw new Error(
        `Incomplete ${journal.operation} transaction ${journal.transaction_id} must be recovered before ${operation}.`,
      );
    }
  }

  private desiredManifest(
    paths: ReturnType<InstallService["paths"]>,
    sha256: string,
    current: MachineLocatorV1 | null,
    installedAt: string,
    updatedAt: string,
    providers: MachineLocatorV1["providers"] = current?.providers ?? {},
  ): MachineLocatorV1 {
    return {
      schema_version: 1,
      myelin_root: resolve(this.deps.myelinRoot),
      launcher: { path: paths.launcherPath, sha256 },
      providers,
      installed_at: installedAt,
      updated_at: updatedAt,
      source_revision: this.sourceRevision(),
    };
  }

  private plan(
    operation: MachineInstallOperation,
    apply: boolean,
    paths: ReturnType<InstallService["paths"]>,
    currentRoot: string | null,
    rebind: boolean,
    warnings: string[],
    desiredManifest: MachineLocatorV1 | null,
    actions: MachineInstallAction[],
  ): MachineInstallPlan {
    return {
      operation,
      mode: apply ? "apply" : "preview",
      myelin_root: resolve(this.deps.myelinRoot),
      launcher_path: paths.launcherPath,
      locator_path: paths.locatorPath,
      journal_path: paths.journalPath,
      current_root: currentRoot,
      rebind,
      path_active: warnings.length === 0,
      actions,
      warnings,
      desired_manifest: desiredManifest,
    };
  }

  private paths(inputBinDir: string | null) {
    const home = resolve(this.deps.homeDir ?? homedir());
    const binDir = inputBinDir ?? this.deps.binDir ?? join(home, ".local", "bin");
    if (!isAbsolute(binDir)) throw new Error(`--bin-dir must be absolute: ${binDir}`);
    const locatorPath = resolve(this.deps.locatorPath ?? join(home, ".myelin", "install.json"));
    const journalPath = resolve(this.deps.journalPath ?? join(home, ".myelin", "install-journal.json"));
    return { home, binDir: resolve(binDir), launcherPath: join(resolve(binDir), "myelin"), locatorPath, journalPath };
  }

  private pathWarnings(binDir: string): string[] {
    const entries = (this.deps.env ?? process.env).PATH?.split(delimiter).filter(Boolean).map((entry) => resolve(entry)) ?? [];
    return entries.includes(resolve(binDir))
      ? []
      : [`${resolve(binDir)} is not on PATH. Add it to your shell PATH before invoking myelin globally.`];
  }

  private sourceRevision(): string | null {
    if (this.deps.sourceRevision !== undefined) return this.deps.sourceRevision;
    const result = Bun.spawnSync(["git", "-C", this.deps.myelinRoot, "rev-parse", "HEAD"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    return result.exitCode === 0 ? result.stdout.toString().trim() || null : null;
  }

  private registry(home: string): ProviderRegistry {
    return new ProviderRegistry({
      codexRoot: resolve(this.deps.codexRoot ?? join(home, ".codex")),
      detectedProviders: this.deps.detectedProviders,
      supportedProviders: this.deps.supportedProviders,
    });
  }

  private async planSelectedProviders(
    selected: Array<"codex">,
    existing: MachineLocatorV1["providers"],
    home: string,
    launcherPath: string,
  ): Promise<{ providers: MachineLocatorV1["providers"]; actions: MachineInstallAction[] }> {
    const providers = { ...existing };
    const actions: MachineInstallAction[] = [];
    for (const provider of selected) {
      if (provider !== "codex") continue;
      const providerRoot = resolve(this.deps.codexRoot ?? join(home, ".codex"));
      const inspection = await inspectCodexProvider({
        providerRoot,
        myelinRoot: this.deps.myelinRoot,
        launcherPath,
      });
      providers.codex = inspection.ownership;
      if (inspection.needsApply) {
        actions.push(action(
          "apply_provider:codex",
          "install or repair Codex provider integration",
          inspection.ownership.manifest_path,
          null,
          this.providerBackupPath(providerRoot),
        ));
      }
    }
    return { providers, actions };
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  private providerBackupPath(providerRoot: string): string {
    return join(
      providerRoot,
      ".myelin",
      "backups",
      `hooks-${this.now().replaceAll(":", "-")}.json`,
    );
  }

  private async fail(point: InstallFailurePoint): Promise<void> {
    await this.deps.failAt?.(point);
  }
}

function action(
  id: MachineInstallAction["id"],
  description: string,
  path: string,
  expectedSha256: string | null,
  backupPath: string | null = null,
): MachineInstallAction {
  return { id, description, path, expected_sha256: expectedSha256, backup_path: backupPath };
}
