import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEmbeddingContract } from "../../src/memory/embedding-contract-resolver.ts";
import { readActiveEmbeddingContract } from "../../src/memory/embedding-contract-store.ts";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import { loadConfig, selectEmbeddingContract } from "../../src/runtime/config.ts";

test("auto embedding selection is persisted and not reprobed by later processes", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-contract-resolver-"));
  const config = await loadConfig(root, {});
  const db = openMemoryDbAt(":memory:");
  let probes = 0;
  try {
    const first = await resolveEmbeddingContract({
      db,
      config,
      scope: "session_memory",
      factory: {
        initializeLocalAuto: async () => {
          probes += 1;
          return { contract: selectEmbeddingContract(config, "ollama_nomic", "retrieval_document") } as never;
        },
      },
    });
    const second = await resolveEmbeddingContract({
      db,
      config,
      scope: "session_memory",
      factory: {
        initializeLocalAuto: async () => {
          probes += 1;
          throw new Error("must not probe after activation");
        },
      },
    });

    expect(probes).toBe(1);
    expect(second.active.id).toBe(first.active.id);
    expect(second.migrationRequired).toBe(false);
    expect(readActiveEmbeddingContract(db, "session_memory")?.provider).toBe("ollama_nomic");
  } finally {
    db.close();
  }
});

test("explicit configuration becomes desired state without replacing the active contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-contract-desired-"));
  const autoConfig = await loadConfig(root, {});
  const qwenConfig = await loadConfig(root, { EMBEDDING_PROVIDER: "ollama_qwen" });
  const db = openMemoryDbAt(":memory:");
  try {
    await resolveEmbeddingContract({
      db,
      config: autoConfig,
      scope: "project_memory",
      factory: {
        initializeLocalAuto: async () => ({
          contract: selectEmbeddingContract(autoConfig, "ollama_nomic", "retrieval_document"),
        } as never),
      },
    });
    const resolved = await resolveEmbeddingContract({ db, config: qwenConfig, scope: "project_memory" });
    expect(resolved.active.provider).toBe("ollama_nomic");
    expect(resolved.desired.provider).toBe("ollama_qwen");
    expect(resolved.migrationRequired).toBe(true);
  } finally {
    db.close();
  }
});
