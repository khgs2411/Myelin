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
