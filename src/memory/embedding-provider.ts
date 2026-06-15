import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";

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

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function createGeminiEmbeddingProvider(input: { apiKey?: string; fetch?: FetchLike }): EmbeddingProviderClient {
  return {
    async embed(request) {
      if (!input.apiKey) throw new Error("Gemini API key is required for embedding requests");
      const fetcher = input.fetch ?? fetch;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        request.contract.model,
      )}:embedContent?key=${encodeURIComponent(input.apiKey)}`;
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
    },
    async embedBatch(requests) {
      if (requests.length === 0) return [];
      if (!input.apiKey) throw new Error("Gemini API key is required for embedding requests");
      assertCompatibleBatch(requests);
      const fetcher = input.fetch ?? fetch;
      const contract = requests[0].contract;
      const modelName = `models/${contract.model}`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        contract.model,
      )}:batchEmbedContents?key=${encodeURIComponent(input.apiKey)}`;
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
        return {
          embedding: values,
          model: requests[index].contract.model,
          dimensions: values.length,
        };
      });
    },
  };
}

export function createStubEmbeddingProvider(dir: string): EmbeddingProviderClient {
  const provider: EmbeddingProviderClient = {
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

function assertDimensions(label: "Gemini" | "Stub", expected: number, actual: number): void {
  if (expected !== actual) throw new Error(`${label} embedding dimensions mismatch: expected ${expected}, got ${actual}`);
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
