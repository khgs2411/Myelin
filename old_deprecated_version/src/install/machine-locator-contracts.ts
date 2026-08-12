import type { InstalledVersion } from "./version-contracts.ts";

export type MachineLocatorProvider = {
  hooks_path: string;
  shim_path: string;
  manifest_path: string;
};

export type MachineLauncherOwnership = {
  path: string;
  sha256: string;
};

export type MachineLocatorV1 = {
  schema_version: 1;
  myelin_root: string;
  launcher: MachineLauncherOwnership;
  providers: Record<string, MachineLocatorProvider>;
  installed_at: string;
  updated_at: string;
  source_revision: string | null;
};

export type MachineLocatorV2 = {
  schema_version: 2;
  data_root: string;
  store_root: string;
  active_version: InstalledVersion;
  previous_version: InstalledVersion | null;
  launcher: MachineLauncherOwnership;
  providers: Record<string, MachineLocatorProvider>;
  installed_at: string;
  updated_at: string;
};

export type MachineLocator = MachineLocatorV1 | MachineLocatorV2;

export function machineLocatorDataRoot(locator: MachineLocator): string {
  return locator.schema_version === 1 ? locator.myelin_root : locator.data_root;
}

export function machineLocatorRuntimeRoot(locator: MachineLocator): string {
  return locator.schema_version === 1 ? locator.myelin_root : locator.active_version.path;
}
