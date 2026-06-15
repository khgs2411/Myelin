import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGeminiEmbeddingProvider,
  createStubEmbeddingProvider,
  stubEmbeddingFilename,
  type EmbeddingRequest,
} from "./embedding-provider.ts";

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
  ).rejects.toThrow("Gemini embedding dimensions mismatch: expected 3, got 1");
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
    "Gemini embedding dimensions mismatch: expected 3, got 1",
  );
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
      "Stub embedding dimensions mismatch: expected 3, got 1",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
