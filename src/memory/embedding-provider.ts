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
      if (!response.ok) throw new Error(`Gemini embedding request failed: HTTP ${response.status}`);
      const body = await response.json();
      const values = parseGeminiEmbeddingValues(body);
      assertDimensions("Gemini", request.contract.dimensions, values.length);
      return { embedding: values, model: request.contract.model, dimensions: values.length };
    },
  };
}

export function createStubEmbeddingProvider(dir: string): EmbeddingProviderClient {
  return {
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
  };
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

function assertDimensions(label: "Gemini" | "Stub", expected: number, actual: number): void {
  if (expected !== actual) throw new Error(`${label} embedding dimensions mismatch: expected ${expected}, got ${actual}`);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
