import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  EmbeddingClient,
  EmbeddingRequest,
  EmbeddingResult,
} from "../embedding-types.ts";
import { parseEmbeddingVector, validateEmbeddingVector } from "../embedding-validation.ts";

export class StubEmbeddingProvider implements EmbeddingClient {
  readonly provider = "stub" as const;
  readonly priority = 0;

  constructor(private readonly dir: string) {}

  async initialize() {
    return { available: true } as const;
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const path = join(this.dir, stubEmbeddingFilename(request));
    const body = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(body)) throw new Error(`Invalid embedding stub: ${path}`);
    const embedding = parseEmbeddingVector(body.embedding, `Invalid embedding stub: ${path}`);
    validateEmbeddingVector(embedding, request.contract.dimensions);
    return {
      embedding,
      model: typeof body.model === "string" ? body.model : request.contract.model,
      dimensions: typeof body.dimensions === "number" ? body.dimensions : embedding.length,
    };
  }

  async embedBatch(requests: EmbeddingRequest[]): Promise<EmbeddingResult[]> {
    return Promise.all(requests.map((request) => this.embed(request)));
  }
}

export function createStubEmbeddingProvider(dir: string): StubEmbeddingProvider {
  return new StubEmbeddingProvider(dir);
}

export function stubEmbeddingFilename(request: EmbeddingRequest): string {
  const hash = createHash("sha256").update(request.text).digest("hex").slice(0, 24);
  return `${request.contract.purpose}-${hash}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
