import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseMachineLocator } from "../runtime/launch-context.ts";
import { machineLocatorDataRoot } from "../install/machine-locator-contracts.ts";
import { verifyInstalledVersion } from "../install/version-store.ts";
import type { EvidenceRegistry, InstallationStatusSection, StatusInspection } from "./contracts.ts";
import { warning } from "./severity.ts";

export async function inspectInstallation(input: {
  root: string;
  evidence: EvidenceRegistry;
  locatorPath?: string | null;
}): Promise<{ section: InstallationStatusSection } & StatusInspection> {
  const locatorPath = input.locatorPath ?? join(homedir(), ".myelin", "install.json");
  const evidenceId = input.evidence.add("file", locatorPath, true);
  let text: string;
  try {
    text = await readFile(locatorPath, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return {
        section: base("attention", "not_installed", input.root, null, locatorPath, null, [], [evidenceId]),
        warnings: [warning("INSTALLATION_NOT_INSTALLED", "attention", "installation", "No machine installation is recorded.", [evidenceId])],
        actions: [{ command: "./install --apply", reason: "Install the managed Myelin runtime.", section: "installation" }],
      };
    }
    return blocked(input.root, locatorPath, evidenceId, `Cannot read machine locator: ${message(error)}`);
  }

  try {
    const locator = parseMachineLocator(JSON.parse(text), locatorPath);
    const providers = Object.entries(locator.providers).sort(([a], [b]) => a.localeCompare(b)).map(([name, provider]) => ({
      name,
      lifecycle: "installed",
      hooks_path: provider.hooks_path,
      shim_path: provider.shim_path,
    }));
    if (resolve(machineLocatorDataRoot(locator)) !== resolve(input.root)) {
      return blocked(input.root, locatorPath, evidenceId, `Machine locator is bound to ${machineLocatorDataRoot(locator)}.`, locator.launcher.path, providers);
    }
    const versionEvidence: string[] = [];
    let rollbackProblem: { message: string; evidence: string } | null = null;
    if (locator.schema_version === 2) {
      const activeEvidence = input.evidence.add("file", locator.active_version.manifest_path, true);
      versionEvidence.push(activeEvidence);
      try {
        await verifyInstalledVersion(locator.active_version);
      } catch (error) {
        return blocked(
          input.root,
          locatorPath,
          evidenceId,
          `Active immutable version is invalid: ${message(error)}`,
          locator.launcher.path,
          providers,
          activeEvidence,
        );
      }
      if (locator.previous_version) {
        const previousEvidence = input.evidence.add("file", locator.previous_version.manifest_path, true);
        versionEvidence.push(previousEvidence);
        try {
          await verifyInstalledVersion(locator.previous_version);
        } catch (error) {
          rollbackProblem = { message: `Previous immutable version is unavailable: ${message(error)}`, evidence: previousEvidence };
        }
      }
    }
    for (const [name, provider] of Object.entries(locator.providers)) {
      for (const path of [provider.hooks_path, provider.shim_path, provider.manifest_path]) {
        try { await stat(path); } catch (error) {
          return blocked(input.root, locatorPath, evidenceId, `Recorded ${name} provider artifact is unavailable at ${path}: ${message(error)}`, locator.launcher.path, providers);
        }
      }
    }
    let launcher: Buffer;
    try {
      const info = await stat(locator.launcher.path);
      if (!info.isFile()) throw new Error("launcher is not a file");
      launcher = await readFile(locator.launcher.path);
    } catch (error) {
      return blocked(input.root, locatorPath, evidenceId, `Recorded launcher is unavailable: ${message(error)}`, locator.launcher.path, providers);
    }
    const launcherEvidence = input.evidence.add("file", locator.launcher.path, true);
    const hash = createHash("sha256").update(launcher).digest("hex");
    if (hash !== locator.launcher.sha256) {
      return blocked(input.root, locatorPath, evidenceId, "Recorded launcher ownership hash does not match.", locator.launcher.path, providers, launcherEvidence);
    }
    return {
      section: base(
        rollbackProblem ? "attention" : "healthy",
        locator.schema_version === 2 ? "installed_managed" : "installed_legacy",
        input.root,
        locator.launcher.path,
        locatorPath,
        locator.schema_version,
        providers,
        [evidenceId, launcherEvidence, ...versionEvidence],
      ),
      warnings: rollbackProblem
        ? [warning("INSTALLATION_ROLLBACK_UNAVAILABLE", "attention", "installation", rollbackProblem.message, [rollbackProblem.evidence])]
        : [],
      actions: rollbackProblem
        ? [{ command: "./install --prune --apply", reason: "Discard the unavailable rollback reference.", section: "installation" }]
        : [],
    };
  } catch (error) {
    return blocked(input.root, locatorPath, evidenceId, `Machine locator is invalid: ${message(error)}`);
  }
}

function base(state: "healthy" | "attention" | "blocked", lifecycle: string, root: string, launcher: string | null, locator: string | null, version: number | null, providers: InstallationStatusSection["providers"], evidenceIds: string[]): InstallationStatusSection {
  return { state, lifecycle, evidence_ids: evidenceIds, myelin_root: root, launcher_path: launcher, locator_path: locator, locator_schema_version: version, providers };
}

function blocked(root: string, locator: string, evidenceId: string, reason: string, launcher: string | null = null, providers: InstallationStatusSection["providers"] = [], launcherEvidence?: string): { section: InstallationStatusSection } & StatusInspection {
  const evidenceIds = [evidenceId, ...(launcherEvidence ? [launcherEvidence] : [])];
  return {
    section: base("blocked", "invalid_ownership", root, launcher, locator, null, providers, evidenceIds),
    warnings: [warning("INSTALLATION_INVALID_OWNERSHIP", "blocked", "installation", reason, evidenceIds)],
    actions: [{ command: "./install --apply", reason: "Repair or rebind the recorded installation.", section: "installation" }],
  };
}

function hasCode(error: unknown, code: string): boolean { return Boolean(error && typeof error === "object" && "code" in error && error.code === code); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
