import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EmbeddingProviderFactory } from "../../src/memory/embedding-provider-factory.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT, loadConfig } from "../../src/runtime/config.ts";
import type { EmbeddingRequest } from "../../src/memory/embedding-types.ts";
import { stubEmbeddingFilename } from "../../src/memory/providers/stub-embedding-provider.ts";

test("EmbeddingProviderFactory prefers configured stub provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-provider-factory-"));
  try {
    const stubDir = join(root, "stubs");
    await writeFile(join(root, "myelin.config"), `EMBEDDING_STUB_RESPONSES_DIR=${stubDir}\n`, "utf8");
    await mkdirp(stubDir);
    const request: EmbeddingRequest = {
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      text: "factory test",
    };
    await writeFile(
      join(stubDir, stubEmbeddingFilename(request)),
      JSON.stringify({
        embedding: Array.from({ length: request.contract.dimensions }, () => 0.25),
        model: request.contract.model,
        dimensions: request.contract.dimensions,
      }),
      "utf8",
    );

    const config = await loadConfig(root);
    const selection = await new EmbeddingProviderFactory(config).initialize("retrieval_document");
    const result = await selection.client.embed(request);

    expect(result.dimensions).toBe(request.contract.dimensions);
    expect(result.embedding[0]).toBe(0.25);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("EmbeddingProviderFactory gives initialized Ollama Nomic priority in auto mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-provider-factory-"));
  try {
    const config = await loadConfig(root, { EMBEDDING_NOMIC_DIMENSIONS: "3" });
    const calls: string[] = [];
    const selection = await new EmbeddingProviderFactory(config, async (url) => {
      calls.push(url);
      if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "nomic-embed-text:v1.5" }] });
      return Response.json({ embeddings: [[0.1, 0.2, 0.3]] });
    }).initialize("retrieval_document");

    expect(selection.client.provider).toBe("ollama_nomic");
    expect(selection.contract).toMatchObject({
      provider: "ollama_nomic",
      model: "nomic-embed-text:v1.5",
      dimensions: 3,
    });
    expect(calls).toEqual(["http://localhost:11434/api/tags", "http://localhost:11434/api/embed"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("EmbeddingProviderFactory falls back from Ollama Nomic to Ollama Qwen", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-provider-factory-"));
  try {
    const config = await loadConfig(root, { EMBEDDING_QWEN_DIMENSIONS: "3" });
    const selection = await new EmbeddingProviderFactory(config, async (url) => {
      if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "qwen3-embedding:4b" }] });
      return Response.json({ embeddings: [[0.1, 0.2, 0.3]] });
    }).initialize("retrieval_document");

    expect(selection.client.provider).toBe("ollama_qwen");
    expect(selection.contract).toMatchObject({ provider: "ollama_qwen", dimensions: 3 });
    expect(selection.fallbackReason).toContain("ollama_nomic");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("EmbeddingProviderFactory falls back to Google when Ollama is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-provider-factory-"));
  try {
    const config = await loadConfig(root);
    const selection = await new EmbeddingProviderFactory(config, async () => {
      throw new Error("connection refused");
    }).initialize("retrieval_query");

    expect(selection.client.provider).toBe("gemini");
    expect(selection.contract).toMatchObject({ provider: "gemini", model: "gemini-embedding-2" });
    expect(selection.fallbackReason).toContain("connection refused");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("EmbeddingProviderFactory does not select Gemini without credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-provider-factory-"));
  try {
    await writeFile(join(root, "myelin.config"), "EMBEDDING_PROVIDER=gemini\n", "utf8");
    const config = await loadConfig(root, {});
    await expect(new EmbeddingProviderFactory(config).initialize("retrieval_query"))
      .rejects.toThrow("Gemini API key is required");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function mkdirp(path: string): Promise<void> {
  await import("node:fs/promises").then((fs) => fs.mkdir(path, { recursive: true }));
}
