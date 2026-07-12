import type { MachineLocatorV1 } from "../runtime/launch-context.ts";

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

export type MachineInstallOperation = "install" | "uninstall";

export type MachineActionId =
  | "promote_launcher"
  | "promote_locator"
  | "remove_launcher"
  | "remove_locator"
  | `apply_provider:${ProviderName}`
  | `remove_provider:${ProviderName}`;

export type MachineActionState = "pending" | "complete";

export type MachineInstallAction = {
  id: MachineActionId;
  description: string;
  path: string;
  expected_sha256: string | null;
  backup_path: string | null;
};

export type MachineInstallPlan = {
  operation: MachineInstallOperation;
  mode: "preview" | "apply";
  myelin_root: string;
  launcher_path: string;
  locator_path: string;
  journal_path: string;
  current_root: string | null;
  rebind: boolean;
  path_active: boolean;
  actions: MachineInstallAction[];
  warnings: string[];
  desired_manifest: MachineLocatorV1 | null;
};

export type InstallJournalV1 = {
  schema_version: 1;
  transaction_id: string;
  operation: MachineInstallOperation;
  myelin_root: string;
  launcher_path: string;
  locator_path: string;
  desired_manifest: MachineLocatorV1 | null;
  actions: Array<MachineInstallAction & { state: MachineActionState }>;
  created_at: string;
};
