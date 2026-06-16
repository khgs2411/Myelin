import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EmbeddingProviderFactory } from "../../src/memory/embedding-provider-factory.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT, loadConfig } from "../../src/runtime/config.ts";
import { stubEmbeddingFilename, type EmbeddingRequest } from "../../src/memory/embedding-provider.ts";

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
    const provider = new EmbeddingProviderFactory(config).create();
    const result = await provider.embed(request);

    expect(result.dimensions).toBe(request.contract.dimensions);
    expect(result.embedding[0]).toBe(0.25);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function mkdirp(path: string): Promise<void> {
  await import("node:fs/promises").then((fs) => fs.mkdir(path, { recursive: true }));
}
