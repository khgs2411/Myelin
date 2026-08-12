import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { EmbeddingRequest, EmbeddingResult } from "./embedding-types.ts";

export function assertEmbeddingContract(
  expected: ActiveEmbeddingContract,
  actual: ActiveEmbeddingContract,
): void {
  if (
    expected.provider !== actual.provider ||
    expected.model !== actual.model ||
    expected.dimensions !== actual.dimensions ||
    expected.purpose !== actual.purpose ||
    expected.formatVersion !== actual.formatVersion
  ) {
    throw new Error("Embedding request does not match the initialized embedding contract");
  }
}

export function assertCompatibleEmbeddingBatch(requests: EmbeddingRequest[]): void {
  const first = requests[0];
  if (!first) return;
  for (const request of requests.slice(1)) assertEmbeddingContract(first.contract, request.contract);
}

export function validateEmbeddingResult(
  contract: ActiveEmbeddingContract,
  result: EmbeddingResult,
): EmbeddingResult {
  if (result.model !== contract.model) {
    throw new Error(`Embedding model mismatch: expected ${contract.model}, got ${result.model}`);
  }
  if (result.dimensions !== contract.dimensions) {
    throw new Error(
      `Embedding dimensions mismatch: expected ${contract.dimensions}, got ${result.dimensions}`,
    );
  }
  validateEmbeddingVector(result.embedding, contract.dimensions);
  return result;
}

export function validateEmbeddingVector(embedding: unknown, dimensions: number): number[] {
  if (!Array.isArray(embedding)) throw new Error("Embedding vector is not an array");
  if (embedding.length !== dimensions) {
    throw new Error(`Embedding vector length mismatch: expected ${dimensions}, got ${embedding.length}`);
  }
  for (const value of embedding) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Embedding vector must contain only finite numbers");
    }
  }
  return embedding;
}

export function parseEmbeddingVector(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`);
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(`${label} must contain only finite numbers`);
    }
  }
  return value;
}
