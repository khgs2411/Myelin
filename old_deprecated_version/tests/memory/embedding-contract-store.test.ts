import { expect, test } from "bun:test";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import {
  activateEmbeddingContract,
  listEmbeddingContracts,
  readActiveEmbeddingContract,
  readPreviousEmbeddingContract,
  registerInitialActiveEmbeddingContract,
  rollbackEmbeddingContract,
  upsertStagingEmbeddingContract,
} from "../../src/memory/embedding-contract-store.ts";
import type { EmbeddingContractIdentity } from "../../src/memory/embedding-contract-types.ts";

const nomic: EmbeddingContractIdentity = {
  provider: "ollama_nomic",
  model: "nomic-embed-text:v1.5",
  dimensions: 768,
  formatVersion: 1,
};

const qwen: EmbeddingContractIdentity = {
  provider: "ollama_qwen",
  model: "qwen3-embedding:4b",
  dimensions: 768,
  formatVersion: 1,
};

test("embedding contract store activates, retains, and rolls back contracts by scope", () => {
  const db = openMemoryDbAt(":memory:");
  try {
    const active = registerInitialActiveEmbeddingContract(db, {
      scope: "session_memory",
      contract: nomic,
      now: "2026-07-13T00:00:00.000Z",
    });
    const staging = upsertStagingEmbeddingContract(db, {
      scope: "session_memory",
      contract: qwen,
      now: "2026-07-13T00:01:00.000Z",
    });

    activateEmbeddingContract(db, {
      scope: "session_memory",
      contractId: staging.id,
      now: "2026-07-13T00:02:00.000Z",
    });
    expect(readActiveEmbeddingContract(db, "session_memory")?.provider).toBe("ollama_qwen");
    expect(readPreviousEmbeddingContract(db, "session_memory")?.id).toBe(active.id);

    rollbackEmbeddingContract(db, "session_memory", "2026-07-13T00:03:00.000Z");
    expect(readActiveEmbeddingContract(db, "session_memory")?.provider).toBe("ollama_nomic");
    expect(listEmbeddingContracts(db, "session_memory").map((item) => item.lifecycle).sort()).toEqual([
      "active",
      "previous",
    ]);
  } finally {
    db.close();
  }
});

test("embedding contract store keeps Session and Project activation independent", () => {
  const db = openMemoryDbAt(":memory:");
  try {
    registerInitialActiveEmbeddingContract(db, { scope: "session_memory", contract: nomic });
    registerInitialActiveEmbeddingContract(db, { scope: "project_memory", contract: qwen });
    expect(readActiveEmbeddingContract(db, "session_memory")?.provider).toBe("ollama_nomic");
    expect(readActiveEmbeddingContract(db, "project_memory")?.provider).toBe("ollama_qwen");
  } finally {
    db.close();
  }
});
