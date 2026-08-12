import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCompatiblePurposeEmbeddingTransport,
  EmbeddingService,
} from "../../src/memory/embedding-service.ts";
import type { EmbeddingRequest } from "../../src/memory/embedding-types.ts";
import { createGeminiEmbeddingProvider } from "../../src/memory/providers/gemini-embedding-provider.ts";
import { createNomicEmbeddingProvider } from "../../src/memory/providers/nomic-embedding-provider.ts";
import { createQwenEmbeddingProvider } from "../../src/memory/providers/qwen-embedding-provider.ts";
import {
  createStubEmbeddingProvider,
  stubEmbeddingFilename,
} from "../../src/memory/providers/stub-embedding-provider.ts";

const documentRequest: EmbeddingRequest = {
  contract: {
    provider: "gemini",
    model: "gemini-embedding-2",
    dimensions: 3,
    purpose: "retrieval_document",
    formatVersion: 1,
  },
  title: "Review",
  text: "normalized",
};

test("gemini provider formats document embedding requests", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const provider = createGeminiEmbeddingProvider({
    apiKey: "key",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ embedding: { values: [0.1, 0.2, 0.3] } });
    },
  });

  await expect(provider.embed(documentRequest)).resolves.toEqual({
    embedding: [0.1, 0.2, 0.3],
    model: "gemini-embedding-2",
    dimensions: 3,
  });
  expect(calls[0].url).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=key",
  );
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({
    content: { parts: [{ text: "title: Review | text: normalized" }] },
    outputDimensionality: 3,
  });
});

test("gemini provider formats query embedding requests", async () => {
  const bodies: unknown[] = [];
  const provider = createGeminiEmbeddingProvider({
    apiKey: "key",
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ embedding: { values: [0.1, 0.2, 0.3] } });
    },
  });

  await provider.embed({
    contract: { ...documentRequest.contract, purpose: "retrieval_query" },
    text: "what happened?",
  });

  expect(bodies[0]).toEqual({
    content: { parts: [{ text: "task: search result | query: what happened?" }] },
    outputDimensionality: 3,
  });
});

test("gemini provider formats batch embedding requests and preserves result order", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const provider = createGeminiEmbeddingProvider({
    apiKey: "key",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        embeddings: [
          { values: [0.1, 0.2, 0.3] },
          { values: [0.4, 0.5, 0.6] },
        ],
      });
    },
  });

  await expect(
    provider.embedBatch?.([
      documentRequest,
      { ...documentRequest, title: "Next", text: "second normalized" },
    ]),
  ).resolves.toEqual([
    { embedding: [0.1, 0.2, 0.3], model: "gemini-embedding-2", dimensions: 3 },
    { embedding: [0.4, 0.5, 0.6], model: "gemini-embedding-2", dimensions: 3 },
  ]);
  expect(calls[0].url).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents?key=key",
  );
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({
    requests: [
      {
        model: "models/gemini-embedding-2",
        content: { parts: [{ text: "title: Review | text: normalized" }] },
        outputDimensionality: 3,
      },
      {
        model: "models/gemini-embedding-2",
        content: { parts: [{ text: "title: Next | text: second normalized" }] },
        outputDimensionality: 3,
      },
    ],
  });
});

test("gemini batch provider validates response count and dimensions", async () => {
  await expect(
    createGeminiEmbeddingProvider({
      apiKey: "key",
      fetch: async () => Response.json({ embeddings: [{ values: [0.1, 0.2, 0.3] }] }),
    }).embedBatch?.([documentRequest, { ...documentRequest, text: "second" }]),
  ).rejects.toThrow("Gemini embedding batch response count mismatch");

  await expect(
    createGeminiEmbeddingProvider({
      apiKey: "key",
      fetch: async () => Response.json({ embeddings: [{ values: [0.1] }] }),
    }).embedBatch?.([documentRequest]),
  ).rejects.toThrow("Embedding vector length mismatch: expected 3, got 1");
});

test("gemini provider requires an api key and validates dimensions", async () => {
  await expect(createGeminiEmbeddingProvider({}).embed(documentRequest)).rejects.toThrow(
    "Gemini API key is required for embedding requests",
  );

  const provider = createGeminiEmbeddingProvider({
    apiKey: "key",
    fetch: async () => Response.json({ embedding: { values: [0.1] } }),
  });
  await expect(provider.embed(documentRequest)).rejects.toThrow(
    "Embedding vector length mismatch: expected 3, got 1",
  );
});

test("Ollama client initializes only an installed, working model and embeds batches", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createQwenEmbeddingProvider({
    baseUrl: "http://ollama.local/",
    model: "qwen3-embedding:4b",
    dimensions: 3,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "qwen3-embedding:4b" }] });
      if (calls.length === 2) return Response.json({ embeddings: [[0.1, 0.2, 0.3]] });
      return Response.json({ embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]] });
    },
  });
  const request = { ...documentRequest, contract: { ...documentRequest.contract, provider: "ollama_qwen" as const, model: "qwen3-embedding:4b" } };

  await expect(client.initialize()).resolves.toEqual({ available: true });
  await expect(client.embedBatch?.([request, { ...request, text: "second" }])).resolves.toEqual([
    { embedding: [0.1, 0.2, 0.3], model: "qwen3-embedding:4b", dimensions: 3 },
    { embedding: [0.4, 0.5, 0.6], model: "qwen3-embedding:4b", dimensions: 3 },
  ]);
  expect(calls.map((call) => call.url)).toEqual([
    "http://ollama.local/api/tags",
    "http://ollama.local/api/embed",
    "http://ollama.local/api/embed",
  ]);
  expect(JSON.parse(String(calls[2].init?.body))).toEqual({
    model: "qwen3-embedding:4b",
    input: ["title: Review\ntext: normalized", "title: Review\ntext: second"],
    dimensions: 3,
    keep_alive: "0",
  });
});

test("Ollama Nomic client uses retrieval task prefixes and unloads after each request", async () => {
  const bodies: unknown[] = [];
  const client = createNomicEmbeddingProvider({
    baseUrl: "http://ollama.local",
    model: "nomic-embed-text:v1.5",
    dimensions: 3,
    fetch: async (url, init) => {
      if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "nomic-embed-text:v1.5" }] });
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ embeddings: [[0.1, 0.2, 0.3]] });
    },
  });
  const document = {
    ...documentRequest,
    contract: {
      ...documentRequest.contract,
      provider: "ollama_nomic" as const,
      model: "nomic-embed-text:v1.5",
    },
  };
  const query = {
    ...document,
    title: null,
    text: "What changed?",
    contract: { ...document.contract, purpose: "retrieval_query" as const },
  };

  await expect(client.initialize()).resolves.toEqual({ available: true });
  await client.embed(document);
  await client.embed(query);

  expect(bodies).toEqual([
    {
      model: "nomic-embed-text:v1.5",
      input: "Myelin embedding availability check.",
      dimensions: 3,
      keep_alive: "0",
    },
    {
      model: "nomic-embed-text:v1.5",
      input: ["search_document: title: Review\nnormalized"],
      dimensions: 3,
      keep_alive: "0",
    },
    {
      model: "nomic-embed-text:v1.5",
      input: ["search_query: What changed?"],
      dimensions: 3,
      keep_alive: "0",
    },
  ]);
});

test("Ollama client reports a missing model without attempting an embedding", async () => {
  const client = createQwenEmbeddingProvider({
    baseUrl: "http://ollama.local",
    model: "qwen3-embedding:4b",
    dimensions: 3,
    fetch: async () => Response.json({ models: [] }),
  });

  await expect(client.initialize()).resolves.toEqual({
    available: false,
    failure_kind: "configuration",
    reason: "Ollama model is not installed: qwen3-embedding:4b",
  });
});

test("Ollama client classifies a blocked socket as unreachable from the current process", async () => {
  const socketError = Object.assign(new Error("Was there a typo in the url or port?"), {
    code: "FailedToOpenSocket",
  });
  const client = createQwenEmbeddingProvider({
    baseUrl: "http://ollama.local",
    model: "qwen3-embedding:4b",
    dimensions: 3,
    fetch: async () => {
      throw socketError;
    },
  });

  await expect(client.initialize()).resolves.toEqual({
    available: false,
    failure_kind: "unreachable",
    reason: "Was there a typo in the url or port?",
  });
  await expect(client.embed({
    ...documentRequest,
    contract: {
      ...documentRequest.contract,
      provider: "ollama_qwen",
      model: "qwen3-embedding:4b",
    },
  })).rejects.toThrow("Embedding provider is unreachable from the current process");
});

test("stub provider reads deterministic fixture names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "myelin-embeddings-"));
  try {
    await writeFile(
      join(dir, stubEmbeddingFilename(documentRequest)),
      JSON.stringify({ embedding: [0.4, 0.5, 0.6], model: "stub-model", dimensions: 3 }),
      "utf8",
    );

    await expect(createStubEmbeddingProvider(dir).embed(documentRequest)).resolves.toEqual({
      embedding: [0.4, 0.5, 0.6],
      model: "stub-model",
      dimensions: 3,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stub provider reads the checked-in live Gemini embedding fixture", async () => {
  const request: EmbeddingRequest = {
    contract: {
      provider: "gemini",
      model: "gemini-embedding-2",
      dimensions: 1536,
      purpose: "retrieval_document",
      formatVersion: 1,
    },
    title: "Fixture session memory embedding",
    text: "summary: Session memory embeddings are derived from trusted memory rows.\nkind: decision",
  };

  expect(stubEmbeddingFilename(request)).toBe("retrieval_document-e9597af63f6b78076be6f69c.json");
  const result = await createStubEmbeddingProvider(join(import.meta.dir, "fixtures", "embedding-stubs")).embed(request);

  expect(result.model).toBe("gemini-embedding-2");
  expect(result.dimensions).toBe(1536);
  expect(result.embedding).toHaveLength(1536);
});

test("stub provider validates dimensions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "myelin-embeddings-"));
  try {
    await writeFile(join(dir, stubEmbeddingFilename(documentRequest)), JSON.stringify({ embedding: [0.4] }), "utf8");
    await expect(createStubEmbeddingProvider(dir).embed(documentRequest)).rejects.toThrow(
      "Embedding vector length mismatch: expected 3, got 1",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gemini initialization fails closed without an API key", async () => {
  await expect(createGeminiEmbeddingProvider({}).initialize()).resolves.toEqual({
    available: false,
    failure_kind: "configuration",
    reason: "Gemini API key is required",
  });
});

test("embedding facade supplies batch fallback and enforces the active contract", async () => {
  const service = new EmbeddingService(documentRequest.contract, {
    async embed(request) {
      return {
        embedding: [0.1, 0.2, 0.3],
        model: request.contract.model,
        dimensions: request.contract.dimensions,
      };
    },
  });

  await expect(service.embedBatch([documentRequest, { ...documentRequest, text: "second" }])).resolves.toHaveLength(2);
  await expect(service.embed({
    ...documentRequest,
    contract: { ...documentRequest.contract, purpose: "retrieval_query" },
  })).rejects.toThrow("does not match the initialized embedding contract");

  const queryContract = { ...documentRequest.contract, purpose: "retrieval_query" as const };
  await expect(EmbeddingService.bind(queryContract, service).embed({
    ...documentRequest,
    contract: queryContract,
  })).resolves.toMatchObject({ model: queryContract.model, dimensions: queryContract.dimensions });
  expect(() => EmbeddingService.bind({ ...queryContract, model: "other" }, service))
    .toThrow("incompatible with the initialized provider");

  const coordinatorTransport = createCompatiblePurposeEmbeddingTransport(service);
  await expect(coordinatorTransport.embed({
    ...documentRequest,
    contract: queryContract,
  })).resolves.toMatchObject({ model: queryContract.model, dimensions: queryContract.dimensions });
  await expect(coordinatorTransport.embed({
    ...documentRequest,
    contract: { ...queryContract, model: "other" },
  })).rejects.toThrow("incompatible with the initialized provider");
});

test("embedding facade rejects model, declared dimension, vector length, and non-finite results", async () => {
  const result = (overrides: Partial<{ embedding: number[]; model: string; dimensions: number }>) =>
    new EmbeddingService(documentRequest.contract, {
      async embed() {
        return {
          embedding: [0.1, 0.2, 0.3],
          model: documentRequest.contract.model,
          dimensions: 3,
          ...overrides,
        };
      },
    }).embed(documentRequest);

  await expect(result({ model: "wrong-model" })).rejects.toThrow("Embedding model mismatch");
  await expect(result({ dimensions: 2 })).rejects.toThrow("Embedding dimensions mismatch");
  await expect(result({ embedding: [0.1] })).rejects.toThrow("Embedding vector length mismatch");
  await expect(result({ embedding: [0.1, Number.NaN, 0.3] })).rejects.toThrow("finite numbers");
});
