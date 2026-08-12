import { createHash } from "node:crypto";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { EmbeddingTransport } from "../memory/embedding-types.ts";
import { embeddingProviderFailureCode } from "../memory/embedding-provider-errors.ts";
import { embeddingContractId } from "../memory/embedding-contract-store.ts";
import { executeTrustedCoordinatorEmbedding } from "../memory/embedding-service.ts";
import {
  normalizeSessionMemoryForEmbedding,
  sessionMemoryNormalizedTextHash,
} from "../memory/session-memory-text.ts";
import { stableJson } from "../runtime/json.ts";
import type { SMCOverlayDeltaRecord } from "./overlay-store.ts";

export type SMCOverlaySearchIndex = Readonly<{
  schema_version: 1;
  normalized_text: string;
  normalized_text_hash: string;
  embedding_contract: Readonly<{
    id: string;
    provider: ActiveEmbeddingContract["provider"];
    model: string;
    dimensions: number;
    purpose: "retrieval_document";
    format_version: number;
  }>;
  vector: readonly number[];
  vector_digest: string;
}>;

export type IndexSMCOverlayResult =
  | { kind: "indexed"; records: readonly SMCOverlayDeltaRecord[] }
  | {
    kind: "blocked";
    code:
      | "overlay_memory_payload_invalid"
      | "embedding_provider_configuration"
      | "embedding_provider_unreachable"
      | "embedding_provider_unavailable";
    reason: string;
    retryable: boolean;
  };

export async function indexSMCOverlayDelta(input: {
  records: readonly SMCOverlayDeltaRecord[];
  contract: ActiveEmbeddingContract;
  transport: EmbeddingTransport;
}): Promise<IndexSMCOverlayResult> {
  if (input.contract.purpose !== "retrieval_document") {
    return {
      kind: "blocked",
      code: "overlay_memory_payload_invalid",
      reason: "overlay indexing requires the frozen retrieval_document contract",
      retryable: false,
    };
  }
  const indexed: SMCOverlayDeltaRecord[] = [];
  for (const record of input.records) {
    if (record.record_kind !== "memory" || record.operation === "discard") {
      indexed.push(record);
      continue;
    }
    const memory = parseOverlayMemoryTextInput(record.payload);
    if (!memory) {
      return {
        kind: "blocked",
        code: "overlay_memory_payload_invalid",
        reason: `staged memory ${record.stable_key} lacks summary, memory_kind, or a JSON payload`,
        retryable: false,
      };
    }
    const normalizedText = normalizeSessionMemoryForEmbedding(memory);
    try {
      const result = await executeTrustedCoordinatorEmbedding({
        contract: input.contract,
        transport: input.transport,
        text: normalizedText,
        title: memory.title,
      });
      indexed.push({
        ...record,
        search_index: Object.freeze({
          schema_version: 1,
          normalized_text: normalizedText,
          normalized_text_hash: sessionMemoryNormalizedTextHash(normalizedText),
          embedding_contract: Object.freeze({
            id: embeddingContractId("session_memory", input.contract),
            provider: input.contract.provider,
            model: input.contract.model,
            dimensions: input.contract.dimensions,
            purpose: "retrieval_document",
            format_version: input.contract.formatVersion,
          }),
          vector: Object.freeze([...result.embedding]),
          vector_digest: digestVector(result.embedding),
        }),
      });
    } catch (error) {
      const code = embeddingProviderFailureCode(error) ?? "embedding_provider_unavailable";
      return {
        kind: "blocked",
        code,
        reason: error instanceof Error ? error.message : String(error),
        retryable: code !== "embedding_provider_configuration",
      };
    }
  }
  return { kind: "indexed", records: indexed };
}

export function validateSMCOverlaySearchIndex(input: {
  payload: unknown;
  search_index: SMCOverlaySearchIndex | undefined;
  contract: ActiveEmbeddingContract;
}): boolean {
  const memory = parseOverlayMemoryTextInput(input.payload);
  const index = input.search_index;
  if (!memory || !index || index.schema_version !== 1) return false;
  const normalized = normalizeSessionMemoryForEmbedding(memory);
  return index.normalized_text === normalized
    && index.normalized_text_hash === sessionMemoryNormalizedTextHash(normalized)
    && index.embedding_contract.provider === input.contract.provider
    && index.embedding_contract.id === embeddingContractId("session_memory", input.contract)
    && index.embedding_contract.model === input.contract.model
    && index.embedding_contract.dimensions === input.contract.dimensions
    && index.embedding_contract.purpose === "retrieval_document"
    && index.embedding_contract.format_version === input.contract.formatVersion
    && index.vector.length === input.contract.dimensions
    && index.vector.every(Number.isFinite)
    && index.vector_digest === digestVector(index.vector);
}

function parseOverlayMemoryTextInput(value: unknown): {
  title: string | null;
  summary: string;
  memory_kind: string;
  payload_json: string;
} | null {
  if (!isRecord(value) || typeof value.summary !== "string" || typeof value.memory_kind !== "string") return null;
  if (value.title !== undefined && value.title !== null && typeof value.title !== "string") return null;
  let payloadJson: string;
  if (typeof value.payload_json === "string") {
    try {
      JSON.parse(value.payload_json);
    } catch {
      return null;
    }
    payloadJson = value.payload_json;
  } else if (isRecord(value.payload)) {
    payloadJson = stableJson(value.payload);
  } else {
    payloadJson = "{}";
  }
  return {
    title: typeof value.title === "string" ? value.title : null,
    summary: value.summary,
    memory_kind: value.memory_kind,
    payload_json: payloadJson,
  };
}

function digestVector(values: readonly number[]): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(new Uint8Array(new Float32Array(values).buffer)).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
