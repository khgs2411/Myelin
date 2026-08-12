import type {
  EmbeddingClient,
  EmbeddingClientInitialization,
  EmbeddingRequest,
  EmbeddingResult,
  FetchLike,
} from "../embedding-types.ts";
import {
  assertCompatibleEmbeddingBatch,
  parseEmbeddingVector,
  validateEmbeddingVector,
} from "../embedding-validation.ts";
import { wrapEmbeddingProviderTransportError } from "../embedding-provider-errors.ts";

export class GeminiEmbeddingProvider implements EmbeddingClient {
  readonly provider = "gemini" as const;
  readonly priority = 3;

  constructor(private readonly input: { apiKey?: string; fetch?: FetchLike }) {}

  async initialize(): Promise<EmbeddingClientInitialization> {
    return this.input.apiKey
      ? { available: true }
      : {
        available: false,
        failure_kind: "configuration",
        reason: "Gemini API key is required",
      };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const apiKey = this.requireApiKey();
    let response: Response;
    try {
      response = await (this.input.fetch ?? fetch)(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.contract.model)}:embedContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content: { parts: [{ text: formatGeminiEmbeddingText(request) }] },
            outputDimensionality: request.contract.dimensions,
          }),
        },
      );
    } catch (error) {
      throw wrapEmbeddingProviderTransportError(error, {
        provider: this.provider,
        operation: "embedding request",
      });
    }
    if (!response.ok) throw new Error(await httpError("Gemini embedding request failed", response));
    const embedding = parseSingleResponse(await response.json());
    validateEmbeddingVector(embedding, request.contract.dimensions);
    return { embedding, model: request.contract.model, dimensions: embedding.length };
  }

  async embedBatch(requests: EmbeddingRequest[]): Promise<EmbeddingResult[]> {
    if (requests.length === 0) return [];
    assertCompatibleEmbeddingBatch(requests);
    const apiKey = this.requireApiKey();
    const contract = requests[0]!.contract;
    let response: Response;
    try {
      response = await (this.input.fetch ?? fetch)(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(contract.model)}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requests: requests.map((request) => ({
              model: `models/${contract.model}`,
              content: { parts: [{ text: formatGeminiEmbeddingText(request) }] },
              outputDimensionality: contract.dimensions,
            })),
          }),
        },
      );
    } catch (error) {
      throw wrapEmbeddingProviderTransportError(error, {
        provider: this.provider,
        operation: "embedding batch request",
      });
    }
    if (!response.ok) throw new Error(await httpError("Gemini embedding batch request failed", response));
    const embeddings = parseBatchResponse(await response.json());
    if (embeddings.length !== requests.length) {
      throw new Error(
        `Gemini embedding batch response count mismatch: expected ${requests.length}, got ${embeddings.length}`,
      );
    }
    return embeddings.map((embedding) => {
      validateEmbeddingVector(embedding, contract.dimensions);
      return { embedding, model: contract.model, dimensions: embedding.length };
    });
  }

  private requireApiKey(): string {
    if (!this.input.apiKey) throw new Error("Gemini API key is required for embedding requests");
    return this.input.apiKey;
  }
}

export function createGeminiEmbeddingProvider(input: {
  apiKey?: string;
  fetch?: FetchLike;
}): GeminiEmbeddingProvider {
  return new GeminiEmbeddingProvider(input);
}

function formatGeminiEmbeddingText(request: EmbeddingRequest): string {
  if (request.contract.purpose === "retrieval_query") {
    return `task: search result | query: ${request.text}`;
  }
  return `title: ${request.title?.trim() || "none"} | text: ${request.text}`;
}

function parseSingleResponse(body: unknown): number[] {
  if (!isRecord(body) || !isRecord(body.embedding)) {
    throw new Error("Gemini embedding response missing embedding.values");
  }
  return parseEmbeddingVector(body.embedding.values, "Gemini embedding response embedding.values");
}

function parseBatchResponse(body: unknown): number[][] {
  if (!isRecord(body) || !Array.isArray(body.embeddings)) {
    throw new Error("Gemini embedding batch response missing embeddings");
  }
  return body.embeddings.map((embedding) => {
    if (!isRecord(embedding)) throw new Error("Gemini embedding batch response missing embedding values");
    return parseEmbeddingVector(embedding.values, "Gemini embedding batch response embedding values");
  });
}

async function httpError(label: string, response: Response): Promise<string> {
  const detail = (await response.text()).trim().replace(/\s+/g, " ").slice(0, 500);
  return detail ? `${label}: HTTP ${response.status}: ${detail}` : `${label}: HTTP ${response.status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
