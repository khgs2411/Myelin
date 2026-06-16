import { applyCodexInstall, planCodexInstall, uninstallCodex } from "./codex.ts";
import type { ProviderInstallPlan } from "./types.ts";

export type InstallServiceDeps = {
  myelinRoot: string;
  codexRoot?: string;
  isInteractive?: boolean;
  detectedProviders?: string[];
};

export type InstallInput = {
  apply: boolean;
  provider: string | null;
};

export type InstallResult = {
  mode: "preview" | "apply" | "uninstall";
  plan: ProviderInstallPlan;
};

export class InstallService {
  constructor(private readonly deps: InstallServiceDeps) {}

  async install(input: InstallInput): Promise<InstallResult> {
    this.assertCodexProvider(input.provider);

    const detectedProviders = this.deps.detectedProviders ?? ["codex"];
    if (input.apply && !input.provider && detectedProviders.length > 1 && this.deps.isInteractive === false) {
      throw new Error(`Multiple providers detected (${detectedProviders.join(", ")}). Re-run with --provider <name>.`);
    }

    const mode = input.apply ? ("apply" as const) : ("preview" as const);
    const options = {
      providerRoot: this.deps.codexRoot,
      myelinRoot: this.deps.myelinRoot,
      mode,
    };
    const plan = input.apply ? await applyCodexInstall(options) : await planCodexInstall(options);
    return { mode, plan };
  }

  async uninstall(provider: string | null): Promise<InstallResult> {
    this.assertCodexProvider(provider);
    return {
      mode: "uninstall",
      plan: await uninstallCodex({
        providerRoot: this.deps.codexRoot,
        myelinRoot: this.deps.myelinRoot,
        mode: "uninstall",
      }),
    };
  }

  private assertCodexProvider(provider: string | null): void {
    if (provider && provider !== "codex") throw new Error("--provider must be codex");
  }
}
