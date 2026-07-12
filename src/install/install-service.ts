import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import {
  machineLocatorDataRoot,
  type MachineLocator,
  type MachineLocatorV2,
} from "./machine-locator-contracts.ts";
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
import {
  planInstalledVersion,
  promoteInstalledVersion,
  pruneInstalledVersions,
  removeOwnedVersionStore,
  verifyInstalledVersion,
} from "./version-store.ts";
import type {
  InstallFailurePoint,
  InstallInput,
  InstallJournalV1,
  InstallResult,
  InstallServiceDeps,
  MachineInstallAction,
  MachineInstallOperation,
  MachineInstallPlan,
  UninstallInput,
} from "./types.ts";
import type { PlannedInstalledVersion } from "./version-contracts.ts";
export type { InstallFailurePoint, InstallInput, InstallResult, InstallServiceDeps, UninstallInput } from "./types.ts";

export class InstallService {
  constructor(private readonly deps: InstallServiceDeps) {}

  async install(input: InstallInput): Promise<InstallResult> {
    const paths = this.paths(input.binDir);
    const existingJournal = await readInstallJournalIfExists(paths.journalPath);
    if (existingJournal) {
      this.assertMatchingJournal(existingJournal, "install", paths.launcherPath, paths.locatorPath);
      const plan = this.planFromJournal(existingJournal, paths, input.apply);
      if (!input.apply) return { mode: "preview", plan };
      await this.applyJournal(existingJournal, paths.journalPath);
      return { mode: "apply", plan: { ...plan, mode: "apply" } };
    }
    if (input.rollback) return await this.rollback(input, paths);
    const selection = await this.registry(paths.home).select({ explicit: input.providers, commandOnly: input.commandOnly });

    const plan = await this.planInstall(input, paths, selection.selected, selection.warnings);
    if (!input.apply || plan.actions.length === 0) return { mode: input.apply ? "apply" : "preview", plan };
    if (plan.rebind && !input.rebind) {
      throw new Error(`Installation is bound to ${plan.current_root}. Re-run with --rebind --apply to bind ${plan.myelin_root}.`);
    }
    const current = await readMachineLocatorIfExists(paths.locatorPath);
    const versionPlan = await planInstalledVersion({
      sourceRoot: this.sourceRoot(),
      storeRoot: paths.storeRoot,
      installedAt: plan.desired_manifest?.schema_version === 2
        ? plan.desired_manifest.active_version.installed_at
        : this.now(),
    });
    if (plan.desired_manifest?.schema_version !== 2 || plan.desired_manifest.active_version.id !== versionPlan.version.id) {
      throw new Error("Myelin source changed after install planning. Re-run the preview before applying.");
    }
    const journal = createInstallJournal({
      transactionId: crypto.randomUUID(),
      operation: "install",
      myelinRoot: plan.myelin_root,
      sourceRoot: this.sourceRoot(),
      launcherPath: plan.launcher_path,
      locatorPath: plan.locator_path,
      desiredManifest: plan.desired_manifest,
      previousManifest: current,
      versionPlan,
      prune: input.prune ?? false,
      actions: plan.actions,
      createdAt: this.now(),
    });
    await writeInstallJournal(paths.journalPath, journal);
    await this.applyJournal(journal, paths.journalPath);
    return { mode: "apply", plan: { ...plan, mode: "apply" } };
  }

  private async rollback(
    input: InstallInput,
    paths: ReturnType<InstallService["paths"]>,
  ): Promise<InstallResult> {
    const current = await readMachineLocatorIfExists(paths.locatorPath);
    if (!current || current.schema_version !== 2) throw new Error("Rollback requires a managed V2 installation.");
    if (!current.previous_version) throw new Error("Rollback is unavailable because no previous managed version is recorded.");
    const ownedPaths = {
      ...paths,
      launcherPath: current.launcher.path,
      binDir: dirname(current.launcher.path),
      storeRoot: current.store_root,
    };
    await verifyInstalledVersion(current.previous_version);
    const desired: MachineLocatorV2 = {
      ...current,
      active_version: current.previous_version,
      previous_version: current.active_version,
      updated_at: this.now(),
    };
    const actions = [
      action("promote_locator", "activate the previous immutable Myelin version", ownedPaths.locatorPath, null),
      action("verify_activation", "verify the rolled-back version through the stable launcher", ownedPaths.launcherPath, null),
    ];
    const plan = this.plan("install", input.apply, ownedPaths, current.data_root, false, this.pathWarnings(ownedPaths.binDir), desired, actions);
    if (!input.apply) return { mode: "preview", plan };
    const journal = createInstallJournal({
      transactionId: crypto.randomUUID(),
      operation: "install",
      myelinRoot: current.data_root,
      sourceRoot: this.sourceRoot(),
      launcherPath: ownedPaths.launcherPath,
      locatorPath: ownedPaths.locatorPath,
      desiredManifest: desired,
      previousManifest: current,
      versionPlan: null,
      prune: false,
      actions,
      createdAt: this.now(),
    });
    await writeInstallJournal(ownedPaths.journalPath, journal);
    await this.applyJournal(journal, ownedPaths.journalPath);
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
    const current = await readMachineLocatorIfExists(paths.locatorPath);
    const journal = createInstallJournal({
      transactionId: crypto.randomUUID(),
      operation: "uninstall",
      myelinRoot: plan.myelin_root,
      sourceRoot: this.sourceRoot(),
      launcherPath: plan.launcher_path,
      locatorPath: plan.locator_path,
      desiredManifest: plan.desired_manifest,
      previousManifest: current,
      versionPlan: null,
      prune: false,
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
    const versionPlan = await planInstalledVersion({
      sourceRoot: this.sourceRoot(),
      storeRoot: paths.storeRoot,
      installedAt: this.now(),
    });
    const launcherContent = renderLauncher(paths.locatorPath);
    const desiredHash = launcherSha256(launcherContent);
    const warnings = [...this.pathWarnings(paths.binDir), ...providerWarnings];
    const rebind = Boolean(current && resolve(machineLocatorDataRoot(current)) !== resolve(this.deps.myelinRoot));

    if (current && resolve(current.launcher.path) !== paths.launcherPath) {
      throw new Error(`The machine locator owns launcher ${current.launcher.path}; refusing a different --bin-dir target.`);
    }
    if (current?.schema_version === 2 && resolve(current.store_root) !== paths.storeRoot) {
      throw new Error(`The machine locator owns version store ${current.store_root}; refusing a different store root.`);
    }

    if (!current) {
      const unowned = await inspectLauncher(paths.launcherPath, desiredHash);
      if (unowned.status !== "missing") {
        throw new Error(`Unowned artifact exists at ${paths.launcherPath}; refusing to overwrite it without a machine locator.`);
      }
      const timestamp = this.now();
      const providerPlan = await this.planSelectedProviders(selectedProviders, {}, paths.home, paths.launcherPath);
      const desired = this.desiredManifest(paths, versionPlan, null, timestamp, timestamp, providerPlan.providers);
      return this.plan("install", input.apply, paths, null, false, warnings, desired, [
        action("promote_version", "install immutable Myelin runtime version", versionPlan.version.path, versionPlan.version.content_sha256),
        action("promote_launcher", "install copied Myelin launcher", paths.launcherPath, desiredHash),
        ...providerPlan.actions,
        action("promote_locator", "activate immutable runtime through the machine locator", paths.locatorPath, null),
        action("verify_activation", "verify the activated version through the stable launcher", paths.launcherPath, null),
      ]);
    }

    const observed = await inspectLauncher(paths.launcherPath, current.launcher.sha256);
    if (observed.status === "symlink" || observed.status === "mismatch") {
      throw new Error(`Owned launcher hash mismatch at ${paths.launcherPath}; refusing repair or overwrite.`);
    }
    const launcherNeedsWrite = observed.status === "missing" || current.launcher.sha256 !== desiredHash;
    const providerPlan = await this.planSelectedProviders(selectedProviders, current.providers, paths.home, paths.launcherPath);
    const activeChanged = current.schema_version === 1 || current.active_version.id !== versionPlan.version.id;
    const pruneChangesLocator = Boolean(input.prune && current.schema_version === 2 && current.previous_version);
    const locatorNeedsWrite = rebind || activeChanged || launcherNeedsWrite || providerPlan.actions.length > 0 ||
      JSON.stringify(current.providers) !== JSON.stringify(providerPlan.providers) || pruneChangesLocator;
    if (!locatorNeedsWrite && !input.prune) {
      return this.plan("install", input.apply, paths, machineLocatorDataRoot(current), false, warnings, current, []);
    }

    const desired = this.desiredManifest(
      paths,
      versionPlan,
      current,
      current.installed_at,
      this.now(),
      providerPlan.providers,
    );
    if (input.prune) desired.previous_version = null;
    const actions: MachineInstallAction[] = [];
    if (activeChanged && !versionPlan.already_present) {
      actions.push(action("promote_version", "stage and promote immutable Myelin runtime version", versionPlan.version.path, versionPlan.version.content_sha256));
    }
    if (launcherNeedsWrite) actions.push(action("promote_launcher", "repair or update copied Myelin launcher", paths.launcherPath, desiredHash));
    actions.push(...providerPlan.actions);
    if (locatorNeedsWrite) {
      actions.push(action("promote_locator", rebind ? "rebind data root and activate version" : "activate immutable runtime version", paths.locatorPath, null));
      actions.push(action("verify_activation", "verify the activated version through the stable launcher", paths.launcherPath, null));
    }
    if (input.prune || activeChanged) {
      actions.push(action("prune_versions", input.prune ? "remove all inactive owned versions" : "remove obsolete owned versions", paths.storeRoot, null));
    }
    return this.plan("install", input.apply, paths, machineLocatorDataRoot(current), rebind, warnings, desired, actions);
  }

  private async planUninstall(input: UninstallInput, paths: ReturnType<InstallService["paths"]>): Promise<MachineInstallPlan> {
    const current = await readMachineLocatorIfExists(paths.locatorPath);
    if (!current) {
      const unowned = await inspectLauncher(paths.launcherPath, launcherSha256(renderLauncher(paths.locatorPath)));
      if (unowned.status !== "missing") throw new Error(`Launcher exists without ${paths.locatorPath}; it is unowned and will not be removed.`);
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
      const inspection = await inspectCodexProvider({
        providerRoot,
        myelinRoot: machineLocatorDataRoot(current),
        launcherPath: current.launcher.path,
      });
      if (JSON.stringify(inspection.ownership) !== JSON.stringify(ownership)) {
        throw new Error("Codex ownership paths do not match the machine locator; refusing uninstall.");
      }
      providerActions.push(action("remove_provider:codex", "remove verified Codex provider integration", ownership.manifest_path, null, this.providerBackupPath(providerRoot)));
    }
    if (requestedProviders.length > 0) {
      const providers = { ...current.providers };
      for (const provider of requestedProviders) delete providers[provider];
      const desired: MachineLocator = { ...current, providers, updated_at: this.now() };
      return this.plan(
        "uninstall",
        input.apply,
        { ...paths, launcherPath: current.launcher.path, binDir: dirname(current.launcher.path) },
        machineLocatorDataRoot(current),
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
    if (current.schema_version === 2) actions.push(action("remove_version_store", "remove manifest-owned immutable versions", current.store_root, null));
    return this.plan(
      "uninstall",
      input.apply,
      { ...paths, launcherPath: current.launcher.path, binDir: dirname(current.launcher.path), storeRoot: current.schema_version === 2 ? current.store_root : paths.storeRoot },
      machineLocatorDataRoot(current),
      false,
      this.pathWarnings(dirname(current.launcher.path)),
      null,
      actions,
    );
  }

  private async applyJournal(journal: InstallJournalV1, journalPath: string): Promise<void> {
    for (const pending of journal.actions) {
      if (pending.state === "complete") continue;
      if (pending.id === "promote_version") {
        if (!journal.version_plan) throw new Error("Install journal is missing its immutable version plan.");
        await promoteInstalledVersion({
          sourceRoot: journal.source_root,
          storeRoot: journal.desired_manifest?.schema_version === 2 ? journal.desired_manifest.store_root : dirname(dirname(pending.path)),
          transactionId: journal.transaction_id,
          plan: journal.version_plan,
        });
        await markInstallActionComplete(journalPath, journal, pending.id);
      } else if (pending.id === "promote_launcher") {
        await this.fail("before_launcher_promotion");
        await promoteLauncher(pending.path, renderLauncher(journal.locator_path));
        await markInstallActionComplete(journalPath, journal, pending.id);
        await this.fail("after_launcher_promotion");
      } else if (pending.id === "promote_locator") {
        await this.fail("before_locator_promotion");
        if (!journal.desired_manifest) throw new Error("Install journal is missing its desired manifest.");
        await promoteMachineLocator(pending.path, journal.desired_manifest);
        await markInstallActionComplete(journalPath, journal, pending.id);
      } else if (pending.id === "verify_activation") {
        try {
          if (!journal.desired_manifest || journal.desired_manifest.schema_version !== 2) throw new Error("Activation verification requires a V2 locator.");
          await verifyInstalledVersion(journal.desired_manifest.active_version);
          await this.verifyActivation(pending.path, journal.desired_manifest);
          await markInstallActionComplete(journalPath, journal, pending.id);
        } catch (error) {
          if (journal.previous_manifest) {
            await promoteMachineLocator(journal.locator_path, journal.previous_manifest);
          } else {
            if (journal.desired_manifest) {
              for (const [provider, ownership] of Object.entries(journal.desired_manifest.providers)) {
                if (provider === "codex") {
                  await removeCodexProvider({ providerRoot: codexProviderRootFromManifest(ownership.manifest_path) });
                }
              }
              const observed = await inspectLauncher(journal.launcher_path, journal.desired_manifest.launcher.sha256);
              if (observed.status === "owned") await rm(journal.launcher_path, { force: true });
              if (journal.desired_manifest.schema_version === 2) {
                await pruneInstalledVersions({ storeRoot: journal.desired_manifest.store_root, retainIds: [] });
              }
            }
            await rm(journal.locator_path, { force: true });
          }
          await removeInstallJournal(journalPath);
          throw new Error(
            journal.previous_manifest
              ? `Myelin activation failed and the previous locator was restored: ${message(error)}`
              : `Myelin activation failed and the incomplete installation was removed: ${message(error)}`,
          );
        }
      } else if (pending.id === "prune_versions") {
        if (!journal.desired_manifest || journal.desired_manifest.schema_version !== 2) throw new Error("Version pruning requires a V2 locator.");
        const retainIds = journal.prune
          ? [journal.desired_manifest.active_version.id]
          : [journal.desired_manifest.active_version.id, journal.desired_manifest.previous_version?.id].filter((id): id is string => Boolean(id));
        await pruneInstalledVersions({ storeRoot: journal.desired_manifest.store_root, retainIds });
        await markInstallActionComplete(journalPath, journal, pending.id);
      } else if (pending.id === "remove_version_store") {
        await removeOwnedVersionStore(pending.path);
        await markInstallActionComplete(journalPath, journal, pending.id);
      } else if (pending.id === "remove_launcher") {
        const observed = await inspectLauncher(pending.path, pending.expected_sha256 ?? "");
        if (observed.status === "mismatch" || observed.status === "symlink") throw new Error(`Owned launcher hash mismatch at ${pending.path}; refusing uninstall recovery.`);
        await rm(pending.path, { force: true });
        await markInstallActionComplete(journalPath, journal, pending.id);
      } else if (pending.id === "remove_locator") {
        await rm(pending.path, { force: true });
        await markInstallActionComplete(journalPath, journal, pending.id);
      } else if (pending.id === "apply_provider:codex") {
        await applyCodexProvider({
          providerRoot: codexProviderRootFromManifest(pending.path),
          myelinRoot: journal.myelin_root,
          launcherPath: journal.desired_manifest?.launcher.path,
          backupPath: pending.backup_path,
        });
        await markInstallActionComplete(journalPath, journal, pending.id);
      } else if (pending.id === "remove_provider:codex") {
        await removeCodexProvider({ providerRoot: codexProviderRootFromManifest(pending.path), backupPath: pending.backup_path });
        await markInstallActionComplete(journalPath, journal, pending.id);
      }
    }
    await removeInstallJournal(journalPath);
  }

  private planFromJournal(journal: InstallJournalV1, paths: ReturnType<InstallService["paths"]>, apply: boolean): MachineInstallPlan {
    return this.plan(
      journal.operation,
      apply,
      paths,
      journal.operation === "install" && journal.desired_manifest ? machineLocatorDataRoot(journal.desired_manifest) : journal.myelin_root,
      false,
      ["An incomplete matching installation transaction will be resumed."],
      journal.desired_manifest,
      journal.actions.filter((item) => item.state === "pending"),
    );
  }

  private assertMatchingJournal(journal: InstallJournalV1, operation: MachineInstallOperation, launcherPath: string, locatorPath: string): void {
    if (
      journal.operation !== operation ||
      resolve(journal.myelin_root) !== resolve(this.deps.myelinRoot) ||
      resolve(journal.source_root) !== resolve(this.sourceRoot()) ||
      resolve(journal.launcher_path) !== resolve(launcherPath) ||
      resolve(journal.locator_path) !== resolve(locatorPath)
    ) {
      throw new Error(`Incomplete ${journal.operation} transaction ${journal.transaction_id} must be recovered before ${operation}.`);
    }
  }

  private desiredManifest(
    paths: ReturnType<InstallService["paths"]>,
    versionPlan: PlannedInstalledVersion,
    current: MachineLocator | null,
    installedAt: string,
    updatedAt: string,
    providers: MachineLocator["providers"] = current?.providers ?? {},
  ): MachineLocatorV2 {
    const previousVersion = current?.schema_version === 2
      ? current.active_version.id === versionPlan.version.id ? current.previous_version : current.active_version
      : null;
    return {
      schema_version: 2,
      data_root: resolve(this.deps.myelinRoot),
      store_root: paths.storeRoot,
      active_version: versionPlan.version,
      previous_version: previousVersion,
      launcher: { path: paths.launcherPath, sha256: launcherSha256(renderLauncher(paths.locatorPath)) },
      providers,
      installed_at: installedAt,
      updated_at: updatedAt,
    };
  }

  private plan(
    operation: MachineInstallOperation,
    apply: boolean,
    paths: ReturnType<InstallService["paths"]>,
    currentRoot: string | null,
    rebind: boolean,
    warnings: string[],
    desiredManifest: MachineLocator | null,
    actions: MachineInstallAction[],
  ): MachineInstallPlan {
    return {
      operation,
      mode: apply ? "apply" : "preview",
      myelin_root: resolve(this.deps.myelinRoot),
      source_root: this.sourceRoot(),
      launcher_path: paths.launcherPath,
      locator_path: paths.locatorPath,
      journal_path: paths.journalPath,
      store_root: desiredManifest?.schema_version === 2 ? desiredManifest.store_root : paths.storeRoot,
      active_version: desiredManifest?.schema_version === 2 ? desiredManifest.active_version.id : null,
      previous_version: desiredManifest?.schema_version === 2 ? desiredManifest.previous_version?.id ?? null : null,
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
    const storeRoot = resolve(this.deps.storeRoot ?? join(home, ".local", "share", "myelin"));
    return { home, binDir: resolve(binDir), launcherPath: join(resolve(binDir), "myelin"), locatorPath, journalPath, storeRoot };
  }

  private pathWarnings(binDir: string): string[] {
    const entries = (this.deps.env ?? process.env).PATH?.split(delimiter).filter(Boolean).map((entry) => resolve(entry)) ?? [];
    return entries.includes(resolve(binDir)) ? [] : [`${resolve(binDir)} is not on PATH. Add it to your shell PATH before invoking myelin globally.`];
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
    existing: MachineLocator["providers"],
    home: string,
    launcherPath: string,
  ): Promise<{ providers: MachineLocator["providers"]; actions: MachineInstallAction[] }> {
    const providers = { ...existing };
    const actions: MachineInstallAction[] = [];
    for (const provider of selected) {
      if (provider !== "codex") continue;
      const providerRoot = resolve(this.deps.codexRoot ?? join(home, ".codex"));
      const inspection = await inspectCodexProvider({ providerRoot, myelinRoot: this.deps.myelinRoot, launcherPath });
      providers.codex = inspection.ownership;
      if (inspection.needsApply) {
        actions.push(action("apply_provider:codex", "install or repair Codex provider integration", inspection.ownership.manifest_path, null, this.providerBackupPath(providerRoot)));
      }
    }
    return { providers, actions };
  }

  private async verifyActivation(launcherPath: string, locator: MachineLocatorV2): Promise<void> {
    if (this.deps.activationVerifier) {
      await this.deps.activationVerifier({ launcherPath, locator });
      return;
    }
    const result = Bun.spawnSync([launcherPath, "--help"], {
      cwd: locator.data_root,
      env: this.deps.env ?? process.env,
      stdout: "ignore",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || `launcher exited ${result.exitCode}`);
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  private sourceRoot(): string {
    return resolve(this.deps.sourceRoot ?? this.deps.myelinRoot);
  }

  private providerBackupPath(providerRoot: string): string {
    return join(providerRoot, ".myelin", "backups", `hooks-${this.now().replaceAll(":", "-")}.json`);
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
