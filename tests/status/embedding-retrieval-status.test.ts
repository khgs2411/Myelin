import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDb } from "../../src/memory/db.ts";
import { registerInitialActiveEmbeddingContract } from "../../src/memory/embedding-contract-store.ts";
import { markSessionMemoryEmbeddingIndexed } from "../../src/memory/session-memory-embeddings.ts";
import { createSessionMemory } from "../helpers/session-mutation-authority.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT, loadConfig } from "../../src/runtime/config.ts";
import { inspectEmbeddingRetrievalStatus } from "../../src/status/embedding-retrieval-status.ts";

test("retrieval status separates active health from historical embedding rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-retrieval-status-"));
  const db = openMemoryDb(root);
  try {
    registerInitialActiveEmbeddingContract(db, {
      scope: "session_memory",
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    });
    createSessionMemory(db, {
      id: "memory-1",
      project_key: "demo",
      source_event_refs: [],
      memory_kind: "continuity",
      summary: "Active Nomic memory.",
      payload: {},
      confidence: "high",
      risk: "low",
      now: "2026-07-13T00:00:00.000Z",
    });
    const activeRow = db.query(
      "SELECT id FROM session_memory_embeddings WHERE session_memory_id = 'memory-1'",
    ).get() as { id: string };
    markSessionMemoryEmbeddingIndexed(db, {
      id: activeRow.id,
      normalized_text_hash: "sha256:active",
      now: "2026-07-13T00:01:00.000Z",
    });
    db.query(
      `INSERT INTO session_memory_embeddings
        (id, session_memory_id, project_key, embedding_provider, embedding_model, embedding_dimensions,
         embedding_purpose, format_version, status, retry_count, created_at, updated_at)
       VALUES ('historical', 'memory-1', 'demo', 'gemini', 'gemini-embedding-2', 768,
         'retrieval_document', 1, 'failed', 1, ?, ?)`,
    ).run("2026-07-13T00:00:00.000Z", "2026-07-13T00:00:00.000Z");
    const config = await loadConfig(root);

    const status = inspectEmbeddingRetrievalStatus({
      db,
      projectKey: "demo",
      scope: "session_memory",
      config: config.embedding,
    });

    expect(status).toMatchObject({
      active_contract: { provider: "ollama_nomic" },
      indexed_count: 1,
      pending_count: 0,
      failed_count: 0,
      historical: { contract_count: 1, row_count: 1 },
    });
    expect(inspectEmbeddingRetrievalStatus({
      db,
      projectKey: "demo",
      scope: "session_memory",
      config: { ...config.embedding, provider: "ollama_qwen" },
    }).migration_required).toBe(true);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
