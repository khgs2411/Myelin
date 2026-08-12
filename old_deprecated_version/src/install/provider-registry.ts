import { stat } from "node:fs/promises";
import type { ProviderName } from "./types.ts";

export type ProviderRegistryDeps = {
  codexRoot: string;
  detectedProviders?: string[];
  supportedProviders?: string[];
};

export class ProviderRegistry {
  constructor(private readonly deps: ProviderRegistryDeps) {}

  async detected(): Promise<string[]> {
    if (this.deps.detectedProviders) return [...new Set(this.deps.detectedProviders)].sort();
    return (await isDirectory(this.deps.codexRoot)) ? ["codex"] : [];
  }

  async select(input: { explicit: string[]; commandOnly: boolean }): Promise<{ selected: ProviderName[]; warnings: string[] }> {
    if (input.commandOnly) return { selected: [], warnings: [] };
    const supported = new Set(this.deps.supportedProviders ?? ["codex"]);
    if (input.explicit.length > 0) {
      const selected = [...new Set(input.explicit)];
      for (const provider of selected) {
        if (!supported.has(provider) || provider !== "codex") throw new Error(`Unsupported provider: ${provider}`);
      }
      const detected = new Set(await this.detected());
      for (const provider of selected) {
        if (!detected.has(provider)) throw new Error(`Requested provider ${provider} is not available on this machine.`);
      }
      return { selected: selected as ProviderName[], warnings: [] };
    }

    const detected = (await this.detected()).filter((provider) => supported.has(provider));
    if (detected.length === 0) {
      return { selected: [], warnings: ["No supported Capture Provider was detected; installing command only."] };
    }
    if (detected.length > 1) {
      throw new Error(`Multiple providers detected (${detected.join(", ")}). Re-run with --provider <name>.`);
    }
    if (detected[0] !== "codex") throw new Error(`Unsupported provider: ${detected[0]}`);
    return { selected: ["codex"], warnings: [] };
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
