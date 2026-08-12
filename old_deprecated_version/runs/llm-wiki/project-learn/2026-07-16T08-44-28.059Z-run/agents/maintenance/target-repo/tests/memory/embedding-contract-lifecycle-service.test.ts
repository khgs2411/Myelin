import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDb } from "../../src/memory/db.ts";
import { EmbeddingContractLifecycleService } from "../../src/memory/embedding-contract-lifecycle-service.ts";
import {
  readActiveEmbeddingContract,
  readPreviousEmbeddingContract,
  registerInitialActiveEmbeddingContract,
} from "../../src/memory/embedding-contract-store.ts";
import { stubEmbeddingFilename } from "../../src/memory/providers/stub-embedding-provider.ts";
import { createSessionMemory } from "../../src/memory/session-memories.ts";
import { markSessionMemoryEmbeddingIndexed } from "../../src/memory/session-memory-embeddings.ts";
import { normalizeSessionMemoryForEmbedding } from "../../src/memory/session-memory-text.ts";

const nomic = {
  provider: "ollama_nomic" as const,
  model: "nomic-embed-text:v1.5",
  dimensions: 768,
  formatVersion: 1,
};

test("embedding migration stages and activates explicit desired contracts without data loss", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-migrate-"));
  const stubDir = join(root, "stubs");
  await mkdir(stubDir, { recursive: true });
  await writeFile(
    join(root, "myelin.config"),
    `EMBEDDING_PROVIDER=ollama_qwen\nEMBEDDING_STUB_RESPONSES_DIR=${stubDir}\n`,
  );
  const db = openMemoryDb(root);
  registerInitialActiveEmbeddingContract(db, { scope: "session_memory", contract: nomic });
  registerInitialActiveEmbeddingContract(db, { scope: "project_memory", contract: nomic });
  createSessionMemory(db, {
    id: "memory-migrate",
    project_key: "demo",
    source_event_refs: [],
    memory_kind: "continuity",
    summary: "The staged embedding query must work before activation.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-07-13T00:00:00.000Z",
    embedding_contract: { ...nomic, purpose: "retrieval_document" },
  });
  db.close();
  const text = normalizeSessionMemoryForEmbedding({
    title: null,
    summary: "The staged embedding query must work before activation.",
    memory_kind: "continuity",
    payload_json: "{}",
  });
  await writeFile(join(stubDir, stubEmbeddingFilename({
    contract: {
      provider: "ollama_qwen",
      model: "qwen3-embedding:4b",
      dimensions: 768,
      purpose: "retrieval_document",
      formatVersion: 1,
    },
    text,
  })), JSON.stringify({ embedding: Array(768).fill(0.25) }));

  const service = new EmbeddingContractLifecycleService(root);
  const preview = await service.migrate({ apply: false });
  expect(preview.scopes.map((scope) => scope.action)).toEqual(["migrate", "migrate"]);

  const applied = await service.migrate({ apply: true });
  expect(applied.scopes.every((scope) => scope.activated)).toBe(true);
  expect(applied.scopes[0]?.indexed).toBe(1);
  const check = openMemoryDb(root);
  try {
    expect(readActiveEmbeddingContract(check, "session_memory")?.provider).toBe("ollama_qwen");
    expect(readActiveEmbeddingContract(check, "project_memory")?.provider).toBe("ollama_qwen");
    expect(readPreviousEmbeddingContract(check, "session_memory")?.provider).toBe("ollama_nomic");
    expect(readPreviousEmbeddingContract(check, "project_memory")?.provider).toBe("ollama_nomic");
  } finally {
    check.close();
  }

  const rolledBack = await service.rollback({ apply: true });
  expect(rolledBack.scopes.every((scope) => scope.rolled_back)).toBe(true);
  const rollbackCheck = openMemoryDb(root);
  try {
    expect(readActiveEmbeddingContract(rollbackCheck, "session_memory")?.provider).toBe("ollama_nomic");
    expect(readPreviousEmbeddingContract(rollbackCheck, "session_memory")?.provider).toBe("ollama_qwen");
  } finally {
    rollbackCheck.close();
  }
});

test("embedding prune removes historical metadata but protects active contracts", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-prune-"));
  const db = openMemoryDb(root);
  registerInitialActiveEmbeddingContract(db, { scope: "session_memory", contract: nomic });
  registerInitialActiveEmbeddingContract(db, { scope: "project_memory", contract: nomic });
  createSessionMemory(db, {
    id: "memory-1",
    project_key: "demo",
    source_event_refs: [],
    memory_kind: "continuity",
    summary: "summary",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-07-13T00:00:00.000Z",
    embedding_contract: { ...nomic, purpose: "retrieval_document" },
  });
  const activeRow = db.query(
    "SELECT id FROM session_memory_embeddings WHERE session_memory_id = 'memory-1' AND embedding_provider = 'ollama_nomic'",
  ).get() as { id: string };
  markSessionMemoryEmbeddingIndexed(db, {
    id: activeRow.id,
    normalized_text_hash: "sha256:active",
    now: "2026-07-13T00:01:00.000Z",
  });
  db.query(
    `INSERT INTO project_memory_retrieval_embeddings
      (id, project_key, wiki_path, section_id, section_hash, hint_hash_key,
       embedding_provider, embedding_model, embedding_dimensions, embedding_purpose,
       format_version, status, retry_count, created_at, updated_at)
     VALUES ('gemini-project-row', 'demo', 'wiki/topic.md', 'topic', 'hash', '',
       'gemini', 'gemini-embedding-2', 768, 'retrieval_document',
       1, 'failed', 1, ?, ?)`,
  ).run("2026-07-13T00:00:00.000Z", "2026-07-13T00:00:00.000Z");
  db.query(
    `INSERT INTO session_memory_embeddings
      (id, session_memory_id, project_key, embedding_provider, embedding_model, embedding_dimensions,
       embedding_purpose, format_version, status, retry_count, created_at, updated_at)
     VALUES ('gemini-row', 'memory-1', 'demo', 'gemini', 'gemini-embedding-2', 768,
       'retrieval_document', 1, 'failed', 1, ?, ?)`,
  ).run("2026-07-13T00:00:00.000Z", "2026-07-13T00:00:00.000Z");
  db.close();

  const service = new EmbeddingContractLifecycleService(root);
  const preview = await service.prune({ apply: false });
  expect(preview.candidates).toHaveLength(2);
  expect(preview.candidates[0]?.contract.provider).toBe("gemini");

  const applied = await service.prune({ apply: true });
  expect(applied.removed_metadata_rows).toBe(2);
  const check = openMemoryDb(root);
  try {
    expect(check.query("SELECT embedding_provider, status FROM session_memory_embeddings").all()).toEqual([
      { embedding_provider: "ollama_nomic", status: "indexed" },
    ]);
    expect(check.query("SELECT count(*) AS count FROM project_memory_retrieval_embeddings").get()).toEqual({ count: 0 });
    expect(readActiveEmbeddingContract(check, "session_memory")?.provider).toBe("ollama_nomic");
  } finally {
    check.close();
  }
});

test("embedding prune refuses to remove rollback data before active coverage is complete", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-prune-guard-"));
  const db = openMemoryDb(root);
  registerInitialActiveEmbeddingContract(db, { scope: "session_memory", contract: nomic });
  createSessionMemory(db, {
    id: "memory-unindexed",
    project_key: "legacy-project",
    source_event_refs: [],
    memory_kind: "continuity",
    summary: "Canonical memory still needs the active index.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-07-13T00:00:00.000Z",
    embedding_contract: { ...nomic, purpose: "retrieval_document" },
  });
  db.query(
    `INSERT INTO session_memory_embeddings
      (id, session_memory_id, project_key, embedding_provider, embedding_model, embedding_dimensions,
       embedding_purpose, format_version, status, retry_count, created_at, updated_at)
     VALUES ('historical', 'memory-unindexed', 'legacy-project', 'gemini', 'gemini-embedding-2', 768,
       'retrieval_document', 1, 'indexed', 0, ?, ?)`,
  ).run("2026-07-13T00:00:00.000Z", "2026-07-13T00:00:00.000Z");
  db.close();

  await expect(new EmbeddingContractLifecycleService(root).prune({ apply: true }))
    .rejects.toThrow("1 active memories lack the active contract index");
});
