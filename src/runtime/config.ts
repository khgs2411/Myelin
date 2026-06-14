import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolveInside } from "./fs.ts";

export type Provider = "codex" | "claude";
export type Workload = "pipeline" | "query";
export type EmbeddingProvider = "gemini";
export type EmbeddingPurpose = "retrieval_document" | "retrieval_query";

export type ModelProfile = {
  provider: Provider;
  model?: string;
  reasoningEffort?: string;
};

export type EmbeddingConfig = {
  provider: EmbeddingProvider;
  geminiModel: string;
  dimensions: number;
  stubResponsesDir?: string;
};

export type IngestConfig = {
  batchSize: number;
};

export type ActiveEmbeddingContract = {
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
  purpose: EmbeddingPurpose;
  formatVersion: number;
};

export type MyelinConfig = {
  defaultProvider: Provider;
  profiles: Record<Workload, Partial<Record<Provider, ModelProfile>>>;
  embedding: EmbeddingConfig;
  ingest: IngestConfig;
  values: Record<string, string>;
};

export const EMBEDDING_FORMAT_VERSION = 1;
export const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProvider = "gemini";
export const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_INGEST_BATCH_SIZE = 100;
export const MAX_INGEST_BATCH_SIZE = 500;
export const DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT: ActiveEmbeddingContract = {
  provider: DEFAULT_EMBEDDING_PROVIDER,
  model: DEFAULT_GEMINI_EMBEDDING_MODEL,
  dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
  purpose: "retrieval_document",
  formatVersion: EMBEDDING_FORMAT_VERSION,
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
  embedding: {
    provider: DEFAULT_EMBEDDING_PROVIDER,
    geminiModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
  },
  ingest: {
    batchSize: DEFAULT_INGEST_BATCH_SIZE,
  },
  values: {},
};

export async function loadConfig(root: string, env: NodeJS.ProcessEnv = process.env): Promise<MyelinConfig> {
  const path = configPath(root);
  const envPath = dotenvPath(root);
  const values = path ? parseDotenv(await readFile(path, "utf8")) : {};
  const dotenvValues = envPath ? parseDotenv(await readFile(envPath, "utf8")) : {};
  const merged = { ...values, ...dotenvValues, ...definedEnv(env) };
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
    embedding: embeddingConfig(merged),
    ingest: ingestConfig(merged),
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

export function selectActiveEmbeddingContract(
  config: MyelinConfig,
  purpose: EmbeddingPurpose,
): ActiveEmbeddingContract {
  return {
    provider: config.embedding.provider,
    model: config.embedding.geminiModel,
    dimensions: config.embedding.dimensions,
    purpose,
    formatVersion: EMBEDDING_FORMAT_VERSION,
  };
}

function configPath(root: string): string | null {
  const myelin = resolveInside(root, "myelin.config");
  if (existsSync(myelin)) return myelin;
  return null;
}

function dotenvPath(root: string): string | null {
  const dotenv = resolveInside(root, ".env");
  if (existsSync(dotenv)) return dotenv;
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

function embeddingConfig(values: Record<string, string>): EmbeddingConfig {
  return {
    provider: parseEmbeddingProvider(values.EMBEDDING_PROVIDER ?? DEFAULT_EMBEDDING_PROVIDER),
    geminiModel: values.EMBEDDING_GEMINI_MODEL ?? DEFAULT_GEMINI_EMBEDDING_MODEL,
    dimensions: parseEmbeddingDimensions(values.EMBEDDING_DIMENSIONS ?? String(DEFAULT_EMBEDDING_DIMENSIONS)),
    stubResponsesDir: values.EMBEDDING_STUB_RESPONSES_DIR,
  };
}

function ingestConfig(values: Record<string, string>): IngestConfig {
  return {
    batchSize: parseIngestBatchSize(values.INGEST_BATCH_SIZE ?? String(DEFAULT_INGEST_BATCH_SIZE)),
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

function parseEmbeddingProvider(value: string): EmbeddingProvider {
  if (value === "gemini") return value;
  throw new Error(`Unsupported embedding provider: ${value}`);
}

function parseEmbeddingDimensions(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid embedding dimensions: ${value}`);
  return parsed;
}

function parseIngestBatchSize(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_INGEST_BATCH_SIZE) {
    throw new Error(`Invalid ingest batch size: ${value}. Expected an integer between 1 and ${MAX_INGEST_BATCH_SIZE}`);
  }
  return parsed;
}
