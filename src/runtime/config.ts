import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolveInside } from "./fs.ts";

export type Provider = "codex" | "claude";
export type Workload = "pipeline" | "query";

export type ModelProfile = {
  provider: Provider;
  model?: string;
  reasoningEffort?: string;
};

export type MyelinConfig = {
  defaultProvider: Provider;
  profiles: Record<Workload, Partial<Record<Provider, ModelProfile>>>;
  values: Record<string, string>;
};

const DEFAULT_CONFIG: MyelinConfig = {
  defaultProvider: "codex",
  profiles: {
    pipeline: {
      codex: { provider: "codex" },
      claude: { provider: "claude" },
    },
    query: {
      codex: { provider: "codex" },
      claude: { provider: "claude" },
    },
  },
  values: {},
};

export async function loadConfig(root: string, env: NodeJS.ProcessEnv = process.env): Promise<MyelinConfig> {
  const path = configPath(root);
  const values = path ? parseDotenv(await readFile(path, "utf8")) : {};
  const merged = { ...values, ...definedEnv(env) };
  const defaultProvider = parseProvider(merged.DEFAULT_PROVIDER ?? DEFAULT_CONFIG.defaultProvider);

  return {
    defaultProvider,
    profiles: {
      pipeline: {
        codex: profile("pipeline", "codex", merged),
        claude: profile("pipeline", "claude", merged),
      },
      query: {
        codex: profile("query", "codex", merged),
        claude: profile("query", "claude", merged),
      },
    },
    values: merged,
  };
}

export function selectModelProfile(
  config: MyelinConfig,
  workload: Workload,
  overrideProvider?: Provider,
): ModelProfile {
  const provider = overrideProvider ?? config.defaultProvider;
  const selected = config.profiles[workload][provider];
  return selected ?? { provider };
}

function configPath(root: string): string | null {
  const myelin = resolveInside(root, "myelin.config");
  if (existsSync(myelin)) return myelin;
  return null;
}

function profile(workload: Workload, provider: Provider, values: Record<string, string>): ModelProfile {
  const prefix = `${workload}_${provider}`.toUpperCase();
  return {
    provider,
    model: values[`${prefix}_MODEL`],
    reasoningEffort: values[`${prefix}_REASONING_EFFORT`],
  };
}

function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return values;
}

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== "") values[key] = value;
  }
  return values;
}

function parseProvider(value: string): Provider {
  if (value === "codex" || value === "claude") return value;
  throw new Error(`Unsupported provider: ${value}`);
}
