import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolveInside } from "./fs.ts";
import type { SMCEvidenceBatchBudgets } from "../session-maintenance/evidence-batch-planner.ts";
import type { SMCWorkflowBudgets } from "../session-maintenance/manifest.ts";

export type Provider = "codex" | "claude";
export type Workload = "pipeline" | "query" | "ingest";
export type EmbeddingProvider = "ollama_nomic" | "ollama_qwen" | "gemini";
export type EmbeddingProviderMode = EmbeddingProvider | "auto";
export type EmbeddingPurpose = "retrieval_document" | "retrieval_query";

export type ModelProfile = {
  provider: Provider;
  model?: string;
  reasoningEffort?: string;
};

export type EmbeddingConfig = {
  provider: EmbeddingProviderMode;
  providers: Record<EmbeddingProvider, {
    model: string;
    dimensions: number;
  }>;
  ollamaUrl: string;
  batchSize: number;
  stubResponsesDir?: string;
};

export type IngestConfig = {
  evidenceChunkSize: number;
  llmTimeoutMs: number;
  promptCharLimit: number;
};

export type SessionMaintenanceConfig = {
  /** Null keeps destructive forensic cleanup disabled. */
  forensicRetentionMs: number | null;
  /** Null fails closed before any Session Memory maintenance state is persisted. */
  planConfig: SMCPlanConfig | null;
};

export type SMCPlanConfig = Readonly<{
  auditPartitionLimit: number;
  evidenceBudgets: SMCEvidenceBatchBudgets;
  workflowBudgets: SMCWorkflowBudgets;
}>;

export type AutoMemoryMaintenanceConfig = {
  enabled: boolean;
  minCapturedEvents: number;
  maxPendingAgeMs: number;
  cooldownMs: number;
  drainPollIntervalMs: number;
  drainTimeoutMs: number;
  indexLimit: number;
};

export type AutoProjectMemoryMaintenanceConfig = {
  enabled: boolean;
  minPendingItems: number;
  cooldownMs: number;
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
  sessionMaintenance: SessionMaintenanceConfig;
  autoMemoryMaintenance: AutoMemoryMaintenanceConfig;
  autoProjectMemoryMaintenance: AutoProjectMemoryMaintenanceConfig;
  values: Record<string, string>;
};

export const EMBEDDING_FORMAT_VERSION = 1;
export const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProviderMode = "auto";
export const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
export const DEFAULT_NOMIC_EMBEDDING_MODEL = "nomic-embed-text:v1.5";
export const DEFAULT_QWEN_EMBEDDING_MODEL = "qwen3-embedding:4b";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_NOMIC_EMBEDDING_DIMENSIONS = 768;
export const DEFAULT_QWEN_EMBEDDING_DIMENSIONS = 768;
export const DEFAULT_GEMINI_EMBEDDING_DIMENSIONS = 768;
export const DEFAULT_EMBEDDING_BATCH_SIZE = 50;
export const MAX_EMBEDDING_BATCH_SIZE = 500;
export const DEFAULT_INGEST_EVIDENCE_CHUNK_SIZE = 100;
export const MAX_INGEST_EVIDENCE_CHUNK_SIZE = 500;
export const DEFAULT_INGEST_LLM_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_INGEST_PROMPT_CHAR_LIMIT = 180_000;
export const DEFAULT_AUTO_MEMORY_MIN_CAPTURED_EVENTS = 60;
export const DEFAULT_AUTO_MEMORY_MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_AUTO_MEMORY_COOLDOWN_MS = 5 * 60 * 1000;
export const DEFAULT_AUTO_MEMORY_DRAIN_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_AUTO_MEMORY_DRAIN_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_AUTO_MEMORY_INDEX_LIMIT = 500;
export const DEFAULT_AUTO_PROJECT_MEMORY_MIN_PENDING_ITEMS = 5;
export const DEFAULT_AUTO_PROJECT_MEMORY_COOLDOWN_MS = 5 * 60 * 1000;
export const DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT: ActiveEmbeddingContract = {
  provider: "ollama_nomic",
  model: DEFAULT_NOMIC_EMBEDDING_MODEL,
  dimensions: DEFAULT_NOMIC_EMBEDDING_DIMENSIONS,
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
    ingest: {
      codex: { provider: "codex" },
      claude: { provider: "claude" },
    },
  },
  embedding: {
    provider: DEFAULT_EMBEDDING_PROVIDER,
    providers: {
      ollama_nomic: {
        model: DEFAULT_NOMIC_EMBEDDING_MODEL,
        dimensions: DEFAULT_NOMIC_EMBEDDING_DIMENSIONS,
      },
      ollama_qwen: {
        model: DEFAULT_QWEN_EMBEDDING_MODEL,
        dimensions: DEFAULT_QWEN_EMBEDDING_DIMENSIONS,
      },
      gemini: {
        model: DEFAULT_GEMINI_EMBEDDING_MODEL,
        dimensions: DEFAULT_GEMINI_EMBEDDING_DIMENSIONS,
      },
    },
    ollamaUrl: DEFAULT_OLLAMA_URL,
    batchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
  },
  ingest: {
    evidenceChunkSize: DEFAULT_INGEST_EVIDENCE_CHUNK_SIZE,
    llmTimeoutMs: DEFAULT_INGEST_LLM_TIMEOUT_MS,
    promptCharLimit: DEFAULT_INGEST_PROMPT_CHAR_LIMIT,
  },
  sessionMaintenance: {
    forensicRetentionMs: null,
    planConfig: null,
  },
  autoMemoryMaintenance: {
    enabled: false,
    minCapturedEvents: DEFAULT_AUTO_MEMORY_MIN_CAPTURED_EVENTS,
    maxPendingAgeMs: DEFAULT_AUTO_MEMORY_MAX_PENDING_AGE_MS,
    cooldownMs: DEFAULT_AUTO_MEMORY_COOLDOWN_MS,
    drainPollIntervalMs: DEFAULT_AUTO_MEMORY_DRAIN_POLL_INTERVAL_MS,
    drainTimeoutMs: DEFAULT_AUTO_MEMORY_DRAIN_TIMEOUT_MS,
    indexLimit: DEFAULT_AUTO_MEMORY_INDEX_LIMIT,
  },
  autoProjectMemoryMaintenance: {
    enabled: false,
    minPendingItems: DEFAULT_AUTO_PROJECT_MEMORY_MIN_PENDING_ITEMS,
    cooldownMs: DEFAULT_AUTO_PROJECT_MEMORY_COOLDOWN_MS,
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
      ingest: {
        codex: profile("ingest", "codex", merged),
        claude: profile("ingest", "claude", merged),
      },
    },
    embedding: embeddingConfig(merged),
    ingest: ingestConfig(merged),
    sessionMaintenance: sessionMaintenanceConfig(merged),
    autoMemoryMaintenance: autoMemoryMaintenanceConfig(merged),
    autoProjectMemoryMaintenance: autoProjectMemoryMaintenanceConfig(merged),
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

export function selectEmbeddingContract(
  config: MyelinConfig,
  provider: EmbeddingProvider,
  purpose: EmbeddingPurpose,
): ActiveEmbeddingContract {
  const selected = config.embedding.providers[provider];
  return {
    provider,
    model: selected.model,
    dimensions: selected.dimensions,
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
    providers: {
      ollama_nomic: {
        model: values.EMBEDDING_NOMIC_MODEL ?? DEFAULT_NOMIC_EMBEDDING_MODEL,
        dimensions: parseEmbeddingDimensions(
          values.EMBEDDING_NOMIC_DIMENSIONS ?? String(DEFAULT_NOMIC_EMBEDDING_DIMENSIONS),
          "Nomic",
        ),
      },
      ollama_qwen: {
        model: values.EMBEDDING_QWEN_MODEL ?? DEFAULT_QWEN_EMBEDDING_MODEL,
        dimensions: parseEmbeddingDimensions(
          values.EMBEDDING_QWEN_DIMENSIONS ?? String(DEFAULT_QWEN_EMBEDDING_DIMENSIONS),
          "Qwen",
        ),
      },
      gemini: {
        model: values.EMBEDDING_GEMINI_MODEL ?? DEFAULT_GEMINI_EMBEDDING_MODEL,
        dimensions: parseEmbeddingDimensions(
          values.EMBEDDING_GEMINI_DIMENSIONS ?? String(DEFAULT_GEMINI_EMBEDDING_DIMENSIONS),
          "Gemini",
        ),
      },
    },
    ollamaUrl: values.EMBEDDING_OLLAMA_URL ?? DEFAULT_OLLAMA_URL,
    batchSize: parseEmbeddingBatchSize(values.EMBEDDING_BATCH_SIZE ?? String(DEFAULT_EMBEDDING_BATCH_SIZE)),
    stubResponsesDir: values.EMBEDDING_STUB_RESPONSES_DIR,
  };
}

function ingestConfig(values: Record<string, string>): IngestConfig {
  return {
    evidenceChunkSize: parseIngestEvidenceChunkSize(
      values.INGEST_EVIDENCE_CHUNK_SIZE
        ?? values.INGEST_BATCH_SIZE
        ?? String(DEFAULT_INGEST_EVIDENCE_CHUNK_SIZE),
    ),
    llmTimeoutMs: parsePositiveInteger(
      values.INGEST_LLM_TIMEOUT_MS ?? String(DEFAULT_INGEST_LLM_TIMEOUT_MS),
      "Invalid ingest LLM timeout",
    ),
    promptCharLimit: parsePositiveInteger(
      values.INGEST_PROMPT_CHAR_LIMIT ?? String(DEFAULT_INGEST_PROMPT_CHAR_LIMIT),
      "Invalid ingest prompt char limit",
    ),
  };
}

function sessionMaintenanceConfig(values: Record<string, string>): SessionMaintenanceConfig {
  const configured = values.SESSION_MAINTENANCE_FORENSIC_RETENTION_MS;
  return {
    forensicRetentionMs: configured === undefined
      ? null
      : parseNonNegativeInteger(configured, "Invalid Session Memory forensic retention"),
    planConfig: sessionMaintenancePlanConfig(values),
  };
}

const SMC_PLAN_CONFIG_KEYS = [
  "SMC_AUDIT_PARTITION_LIMIT",
  "SMC_MAX_ITEMS_PER_BATCH",
  "SMC_MAX_ENCODED_BYTES_PER_BATCH",
  "SMC_MAX_ENCODED_BYTES_PER_ITEM",
  "SMC_MAX_AFFECTED_WORK_SET_SIZE",
  "SMC_MAX_CUMULATIVE_RETURNED_RESULT_BYTES",
  "SMC_MAX_PROVIDER_ENVELOPE_BYTES",
  "SMC_MAX_QUERIES",
  "SMC_MAX_TURNS",
  "SMC_RETRIEVAL_PAGE_ITEM_LIMIT",
  "SMC_SEMANTIC_DISTANCE_THRESHOLD_MICROS",
  "SMC_SEMANTIC_QUALIFYING_RESULT_CEILING",
] as const;

function sessionMaintenancePlanConfig(values: Record<string, string>): SMCPlanConfig | null {
  const configured = SMC_PLAN_CONFIG_KEYS.filter((key) => values[key] !== undefined);
  if (configured.length === 0) return null;
  if (configured.length !== SMC_PLAN_CONFIG_KEYS.length) {
    const missing = SMC_PLAN_CONFIG_KEYS.filter((key) => values[key] === undefined);
    throw new Error(`Invalid Session Memory plan config: missing ${missing.join(", ")}`);
  }
  const positive = (key: typeof SMC_PLAN_CONFIG_KEYS[number], max?: number) =>
    parsePositiveInteger(values[key]!, `Invalid Session Memory plan config ${key}`, max);
  const evidenceBudgets = {
    max_items_per_batch: positive("SMC_MAX_ITEMS_PER_BATCH", MAX_INGEST_EVIDENCE_CHUNK_SIZE),
    max_encoded_bytes_per_batch: positive("SMC_MAX_ENCODED_BYTES_PER_BATCH"),
    max_encoded_bytes_per_item: positive("SMC_MAX_ENCODED_BYTES_PER_ITEM"),
  };
  if (evidenceBudgets.max_encoded_bytes_per_item > evidenceBudgets.max_encoded_bytes_per_batch) {
    throw new Error("Invalid Session Memory plan config: item bytes exceed batch bytes");
  }
  return {
    auditPartitionLimit: positive("SMC_AUDIT_PARTITION_LIMIT"),
    evidenceBudgets,
    workflowBudgets: {
      max_affected_work_set_size: positive("SMC_MAX_AFFECTED_WORK_SET_SIZE"),
      max_cumulative_returned_result_bytes: positive("SMC_MAX_CUMULATIVE_RETURNED_RESULT_BYTES"),
      max_provider_envelope_bytes: positive("SMC_MAX_PROVIDER_ENVELOPE_BYTES"),
      max_queries: positive("SMC_MAX_QUERIES"),
      max_turns: positive("SMC_MAX_TURNS"),
      retrieval_page_item_limit: positive("SMC_RETRIEVAL_PAGE_ITEM_LIMIT"),
      semantic_distance_threshold_micros: positive("SMC_SEMANTIC_DISTANCE_THRESHOLD_MICROS", 2_000_000),
      semantic_qualifying_result_ceiling: positive("SMC_SEMANTIC_QUALIFYING_RESULT_CEILING"),
    },
  };
}

function autoMemoryMaintenanceConfig(values: Record<string, string>): AutoMemoryMaintenanceConfig {
  return {
    enabled: values.AUTO_MEMORY_MAINTENANCE === "1",
    minCapturedEvents: parsePositiveInteger(
      values.AUTO_MEMORY_MIN_CAPTURED_EVENTS ?? String(DEFAULT_AUTO_MEMORY_MIN_CAPTURED_EVENTS),
      "Invalid auto memory min captured events",
    ),
    maxPendingAgeMs: parsePositiveInteger(
      values.AUTO_MEMORY_MAX_PENDING_AGE_MS ?? String(DEFAULT_AUTO_MEMORY_MAX_PENDING_AGE_MS),
      "Invalid auto memory max pending age",
    ),
    cooldownMs: parseNonNegativeInteger(
      values.AUTO_MEMORY_COOLDOWN_MS ?? String(DEFAULT_AUTO_MEMORY_COOLDOWN_MS),
      "Invalid auto memory cooldown",
    ),
    drainPollIntervalMs: parsePositiveInteger(
      values.AUTO_MEMORY_DRAIN_POLL_INTERVAL_MS ?? String(DEFAULT_AUTO_MEMORY_DRAIN_POLL_INTERVAL_MS),
      "Invalid auto memory drain poll interval",
    ),
    drainTimeoutMs: parsePositiveInteger(
      values.AUTO_MEMORY_DRAIN_TIMEOUT_MS ?? String(DEFAULT_AUTO_MEMORY_DRAIN_TIMEOUT_MS),
      "Invalid auto memory drain timeout",
    ),
    indexLimit: parsePositiveInteger(
      values.AUTO_MEMORY_INDEX_LIMIT ?? String(DEFAULT_AUTO_MEMORY_INDEX_LIMIT),
      "Invalid auto memory index limit",
    ),
  };
}

function autoProjectMemoryMaintenanceConfig(values: Record<string, string>): AutoProjectMemoryMaintenanceConfig {
  return {
    enabled: values.AUTO_PROJECT_MEMORY_MAINTENANCE === "1",
    minPendingItems: parsePositiveInteger(
      values.AUTO_PROJECT_MEMORY_MIN_PENDING_ITEMS ?? String(DEFAULT_AUTO_PROJECT_MEMORY_MIN_PENDING_ITEMS),
      "Invalid auto project memory min pending items",
    ),
    cooldownMs: parseNonNegativeInteger(
      values.AUTO_PROJECT_MEMORY_COOLDOWN_MS ?? String(DEFAULT_AUTO_PROJECT_MEMORY_COOLDOWN_MS),
      "Invalid auto project memory cooldown",
    ),
  };
}

function parsePositiveInteger(value: string, label: string, max?: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || (max !== undefined && parsed > max)) {
    throw new Error(`${label}: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label}: ${value}`);
  return parsed;
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

function parseEmbeddingProvider(value: string): EmbeddingProviderMode {
  if (value === "auto" || value === "ollama_nomic" || value === "ollama_qwen" || value === "gemini") return value;
  throw new Error(`Unsupported embedding provider: ${value}`);
}

function parseEmbeddingDimensions(value: string, provider: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${provider} embedding dimensions: ${value}`);
  return parsed;
}

function parseEmbeddingBatchSize(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_EMBEDDING_BATCH_SIZE) {
    throw new Error(`Invalid embedding batch size: ${value}. Expected an integer between 1 and ${MAX_EMBEDDING_BATCH_SIZE}`);
  }
  return parsed;
}

function parseIngestEvidenceChunkSize(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_INGEST_EVIDENCE_CHUNK_SIZE) {
    throw new Error(
      `Invalid ingest evidence chunk size: ${value}. Expected an integer between 1 and ${MAX_INGEST_EVIDENCE_CHUNK_SIZE}`,
    );
  }
  return parsed;
}
