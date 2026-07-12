import type {
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

export type OllamaProviderName = "ollama_nomic" | "ollama_qwen";

export class OllamaEmbeddingTransport {
  constructor(private readonly input: {
    provider: OllamaProviderName;
    baseUrl: string;
    model: string;
    dimensions: number;
    format: (request: EmbeddingRequest) => string;
    fetch?: FetchLike;
  }) {}

  async initialize(): Promise<EmbeddingClientInitialization> {
    try {
      const fetcher = this.input.fetch ?? fetch;
      const tagsResponse = await fetcher(ollamaUrl(this.input.baseUrl, "/api/tags"));
      if (!tagsResponse.ok) {
        return { available: false, reason: `Ollama tags request failed: HTTP ${tagsResponse.status}` };
      }
      if (!hasOllamaModel(await tagsResponse.json(), this.input.model)) {
        return { available: false, reason: `Ollama model is not installed: ${this.input.model}` };
      }
      const response = await fetcher(ollamaUrl(this.input.baseUrl, "/api/embed"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.input.model,
          input: "Myelin embedding availability check.",
          dimensions: this.input.dimensions,
          keep_alive: "0",
        }),
      });
      if (!response.ok) {
        return {
          available: false,
          reason: `Ollama embedding availability check failed: HTTP ${response.status}`,
        };
      }
      const embeddings = parseOllamaEmbeddings(await response.json());
      if (embeddings.length !== 1) {
        return {
          available: false,
          reason: "Ollama embedding availability check returned an invalid result count",
        };
      }
      validateEmbeddingVector(embeddings[0], this.input.dimensions);
      return { available: true };
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const [result] = await this.embedBatch([request]);
    if (!result) throw new Error("Ollama embedding response was empty");
    return result;
  }

  async embedBatch(requests: EmbeddingRequest[]): Promise<EmbeddingResult[]> {
    if (requests.length === 0) return [];
    assertCompatibleEmbeddingBatch(requests);
    const contract = requests[0]!.contract;
    if (contract.provider !== this.input.provider) {
      throw new Error(`Ollama provider mismatch: expected ${this.input.provider}, got ${contract.provider}`);
    }
    const response = await (this.input.fetch ?? fetch)(ollamaUrl(this.input.baseUrl, "/api/embed"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: contract.model,
        input: requests.map(this.input.format),
        dimensions: contract.dimensions,
        keep_alive: "0",
      }),
    });
    if (!response.ok) throw new Error(await httpError("Ollama embedding request failed", response));
    const embeddings = parseOllamaEmbeddings(await response.json());
    if (embeddings.length !== requests.length) {
      throw new Error(
        `Ollama embedding batch response count mismatch: expected ${requests.length}, got ${embeddings.length}`,
      );
    }
    return embeddings.map((embedding) => {
      validateEmbeddingVector(embedding, contract.dimensions);
      return { embedding, model: contract.model, dimensions: embedding.length };
    });
  }
}

function ollamaUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function hasOllamaModel(body: unknown, model: string): boolean {
  return isRecord(body) && Array.isArray(body.models) && body.models.some(
    (entry) => isRecord(entry) && (entry.name === model || entry.model === model),
  );
}

function parseOllamaEmbeddings(body: unknown): number[][] {
  if (!isRecord(body) || !Array.isArray(body.embeddings)) {
    throw new Error("Ollama embedding response missing embeddings");
  }
  return body.embeddings.map((embedding) =>
    parseEmbeddingVector(embedding, "Ollama embedding response embedding")
  );
}

async function httpError(label: string, response: Response): Promise<string> {
  const detail = (await response.text()).trim().replace(/\s+/g, " ").slice(0, 500);
  return detail ? `${label}: HTTP ${response.status}: ${detail}` : `${label}: HTTP ${response.status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
