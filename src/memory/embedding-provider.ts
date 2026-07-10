import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActiveEmbeddingContract, EmbeddingProvider } from "../runtime/config.ts";

export type EmbeddingRequest = {
  contract: ActiveEmbeddingContract;
  text: string;
  title?: string | null;
};

export type EmbeddingResult = {
  embedding: number[];
  model: string;
  dimensions: number;
};

export type EmbeddingProviderClient = {
  embed: (request: EmbeddingRequest) => Promise<EmbeddingResult>;
  embedBatch?: (requests: EmbeddingRequest[]) => Promise<EmbeddingResult[]>;
};

export type EmbeddingClient = EmbeddingProviderClient & {
  readonly provider: EmbeddingProvider | "stub";
  readonly priority: number;
  initialize: () => Promise<EmbeddingClientInitialization>;
};

export type EmbeddingClientInitialization = { available: true } | { available: false; reason: string };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class GoogleEmbeddingClient implements EmbeddingClient {
  readonly provider = "gemini" as const;
  readonly priority = 2;

  constructor(private readonly input: { apiKey?: string; fetch?: FetchLike }) {}

  async initialize(): Promise<EmbeddingClientInitialization> {
    return { available: true };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
      if (!this.input.apiKey) throw new Error("Gemini API key is required for embedding requests");
      const fetcher = this.input.fetch ?? fetch;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        request.contract.model,
      )}:embedContent?key=${encodeURIComponent(this.input.apiKey)}`;
      const response = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text: formatGeminiEmbeddingText(request) }] },
          outputDimensionality: request.contract.dimensions,
        }),
      });
      if (!response.ok) throw new Error(await geminiHttpError("Gemini embedding request failed", response));
      const body = await response.json();
      const values = parseGeminiEmbeddingValues(body);
      assertDimensions("Gemini", request.contract.dimensions, values.length);
      return { embedding: values, model: request.contract.model, dimensions: values.length };
  }

  async embedBatch(requests: EmbeddingRequest[]): Promise<EmbeddingResult[]> {
      if (requests.length === 0) return [];
      if (!this.input.apiKey) throw new Error("Gemini API key is required for embedding requests");
      assertCompatibleBatch(requests);
      const fetcher = this.input.fetch ?? fetch;
      const contract = requests[0].contract;
      const modelName = `models/${contract.model}`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        contract.model,
      )}:batchEmbedContents?key=${encodeURIComponent(this.input.apiKey)}`;
      const response = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requests: requests.map((request) => ({
            model: modelName,
            content: { parts: [{ text: formatGeminiEmbeddingText(request) }] },
            outputDimensionality: request.contract.dimensions,
          })),
        }),
      });
      if (!response.ok) throw new Error(await geminiHttpError("Gemini embedding batch request failed", response));
      const body = await response.json();
      const embeddings = parseGeminiBatchEmbeddingValues(body);
      if (embeddings.length !== requests.length) {
        throw new Error(`Gemini embedding batch response count mismatch: expected ${requests.length}, got ${embeddings.length}`);
      }
      return embeddings.map((values, index) => {
        assertDimensions("Gemini", requests[index].contract.dimensions, values.length);
        return { embedding: values, model: requests[index].contract.model, dimensions: values.length };
      });
  }
}

export function createGeminiEmbeddingProvider(input: { apiKey?: string; fetch?: FetchLike }): GoogleEmbeddingClient {
  return new GoogleEmbeddingClient(input);
}

export class OllamaEmbeddingClient implements EmbeddingClient {
  readonly provider = "ollama" as const;
  readonly priority = 1;

  constructor(private readonly input: { baseUrl: string; model: string; dimensions: number; fetch?: FetchLike }) {}

  async initialize(): Promise<EmbeddingClientInitialization> {
    try {
      const fetcher = this.input.fetch ?? fetch;
      const tagsResponse = await fetcher(ollamaUrl(this.input.baseUrl, "/api/tags"));
      if (!tagsResponse.ok) return { available: false, reason: `Ollama tags request failed: HTTP ${tagsResponse.status}` };
      const tags = await tagsResponse.json();
      if (!hasOllamaModel(tags, this.input.model)) return { available: false, reason: `Ollama model is not installed: ${this.input.model}` };

      const response = await fetcher(ollamaUrl(this.input.baseUrl, "/api/embed"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.input.model, input: "Myelin embedding availability check.", dimensions: this.input.dimensions }),
      });
      if (!response.ok) return { available: false, reason: `Ollama embedding availability check failed: HTTP ${response.status}` };
      const embeddings = parseOllamaEmbeddings(await response.json());
      if (embeddings.length !== 1) return { available: false, reason: "Ollama embedding availability check returned an invalid result count" };
      assertDimensions("Ollama", this.input.dimensions, embeddings[0].length);
      return { available: true };
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const [result] = await this.embedBatch([request]);
    return result;
  }

  async embedBatch(requests: EmbeddingRequest[]): Promise<EmbeddingResult[]> {
    if (requests.length === 0) return [];
    assertCompatibleBatch(requests);
    const contract = requests[0].contract;
    const response = await (this.input.fetch ?? fetch)(ollamaUrl(this.input.baseUrl, "/api/embed"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: contract.model,
        input: requests.map(formatOllamaEmbeddingText),
        dimensions: contract.dimensions,
      }),
    });
    if (!response.ok) throw new Error(await ollamaHttpError("Ollama embedding request failed", response));
    const embeddings = parseOllamaEmbeddings(await response.json());
    if (embeddings.length !== requests.length) {
      throw new Error(`Ollama embedding batch response count mismatch: expected ${requests.length}, got ${embeddings.length}`);
    }
    return embeddings.map((embedding, index) => {
      assertDimensions("Ollama", requests[index].contract.dimensions, embedding.length);
      return { embedding, model: requests[index].contract.model, dimensions: embedding.length };
    });
  }
}

export function createOllamaEmbeddingClient(input: {
  baseUrl: string;
  model: string;
  dimensions: number;
  fetch?: FetchLike;
}): OllamaEmbeddingClient {
  return new OllamaEmbeddingClient(input);
}

export function createStubEmbeddingProvider(dir: string): EmbeddingClient {
  const provider: EmbeddingClient = {
    provider: "stub",
    priority: 0,
    async initialize() {
      return { available: true };
    },
    async embed(request) {
      const path = join(dir, stubEmbeddingFilename(request));
      const body = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (!isRecord(body) || !Array.isArray(body.embedding)) throw new Error(`Invalid embedding stub: ${path}`);
      const embedding = body.embedding.map((value) => Number(value));
      assertDimensions("Stub", request.contract.dimensions, embedding.length);
      return {
        embedding,
        model: typeof body.model === "string" ? body.model : request.contract.model,
        dimensions: typeof body.dimensions === "number" ? body.dimensions : embedding.length,
      };
    },
    async embedBatch(requests) {
      return Promise.all(requests.map((request) => provider.embed(request)));
    },
  };
  return provider;
}

export function stubEmbeddingFilename(request: EmbeddingRequest): string {
  return `${request.contract.purpose}-${sha256(request.text).slice(0, 24)}.json`;
}

function formatGeminiEmbeddingText(request: EmbeddingRequest): string {
  if (request.contract.purpose === "retrieval_query") return `task: search result | query: ${request.text}`;
  return `title: ${request.title?.trim() || "none"} | text: ${request.text}`;
}

function formatOllamaEmbeddingText(request: EmbeddingRequest): string {
  if (request.contract.purpose === "retrieval_query") return `query: ${request.text}`;
  return `title: ${request.title?.trim() || "none"}\ntext: ${request.text}`;
}

function parseGeminiEmbeddingValues(body: unknown): number[] {
  if (!isRecord(body) || !isRecord(body.embedding) || !Array.isArray(body.embedding.values)) {
    throw new Error("Gemini embedding response missing embedding.values");
  }
  return body.embedding.values.map((value) => Number(value));
}

function parseGeminiBatchEmbeddingValues(body: unknown): number[][] {
  if (!isRecord(body) || !Array.isArray(body.embeddings)) {
    throw new Error("Gemini embedding batch response missing embeddings");
  }
  return body.embeddings.map((embedding) => {
    if (!isRecord(embedding) || !Array.isArray(embedding.values)) {
      throw new Error("Gemini embedding batch response missing embedding values");
    }
    return embedding.values.map((value) => Number(value));
  });
}

async function geminiHttpError(label: string, response: Response): Promise<string> {
  const text = await response.text();
  const detail = text.trim().replace(/\s+/g, " ").slice(0, 500);
  return detail ? `${label}: HTTP ${response.status}: ${detail}` : `${label}: HTTP ${response.status}`;
}

async function ollamaHttpError(label: string, response: Response): Promise<string> {
  const text = await response.text();
  const detail = text.trim().replace(/\s+/g, " ").slice(0, 500);
  return detail ? `${label}: HTTP ${response.status}: ${detail}` : `${label}: HTTP ${response.status}`;
}

function assertDimensions(label: "Gemini" | "Ollama" | "Stub", expected: number, actual: number): void {
  if (expected !== actual) throw new Error(`${label} embedding dimensions mismatch: expected ${expected}, got ${actual}`);
}

function ollamaUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function hasOllamaModel(body: unknown, model: string): boolean {
  return (
    isRecord(body) &&
    Array.isArray(body.models) &&
    body.models.some((entry) => isRecord(entry) && (entry.name === model || entry.model === model))
  );
}

function parseOllamaEmbeddings(body: unknown): number[][] {
  if (!isRecord(body) || !Array.isArray(body.embeddings)) throw new Error("Ollama embedding response missing embeddings");
  return body.embeddings.map((embedding) => {
    if (!Array.isArray(embedding)) throw new Error("Ollama embedding response contains an invalid embedding");
    return embedding.map((value) => Number(value));
  });
}

function assertCompatibleBatch(requests: EmbeddingRequest[]): void {
  const first = requests[0].contract;
  for (const request of requests) {
    const contract = request.contract;
    if (
      contract.provider !== first.provider ||
      contract.model !== first.model ||
      contract.dimensions !== first.dimensions ||
      contract.purpose !== first.purpose ||
      contract.formatVersion !== first.formatVersion
    ) {
      throw new Error("Embedding batch requests must use the same embedding contract");
    }
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
