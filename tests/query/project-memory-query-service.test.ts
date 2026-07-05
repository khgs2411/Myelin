import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import type { EmbeddingProviderClient } from "../../src/memory/embedding-provider.ts";
import {
  ensurePendingProjectMemoryRetrievalEmbedding,
  markProjectMemoryRetrievalEmbeddingIndexed,
} from "../../src/memory/project-memory-retrieval-storage.ts";
import { extractProjectMemorySections } from "../../src/project/project-memory-markdown-sections.ts";
import {
  queryProjectMemory,
  type ProjectMemoryQueryVectorStore,
} from "../../src/query/project-memory-query-service.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";

let root: string;
let db: MemoryDb;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-project-memory-query-"));
  db = openMemoryDbAt(":memory:");
});

afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});

test("hydrates vector hits from current canonical markdown sections", async () => {
  await writeWikiPage("setup/index.md", "# Setup\n\nProject setup uses the myelin CLI.\n");
  const rowId = await indexedRetrievalRow("setup/index.md", "setup");

  const result = await queryProjectMemory(db, {
    root,
    project_key: "demo",
    question: "How do I set up the project?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: fixedProvider(),
    limit: 5,
    max_inline_chars: 4000,
    vector_store: vectorStore([rowId]),
    now: () => "2026-06-30T10:00:00.000Z",
  });

  expect(result.degraded).toBe(false);
  expect(result.matches).toHaveLength(1);
  expect(result.matches[0]).toMatchObject({
    retrieval_row_id: rowId,
    wiki_path: "wiki/setup/index.md",
    section_id: "setup",
    return_kind: "inline_content",
    content: "Project setup uses the myelin CLI.",
    citation: "project_memory:wiki/setup/index.md#setup",
  });
});

test("hydrates sectioned Project Memory markdown for storage retrieval questions", async () => {
  await writeWikiPage(
    "storage-retrieval.md",
    "# Storage Retrieval\n\nProject Memory storage notes.\n\n## SQLite State\n\nThe project stores durable retrieval state in state/memory.db and resolves hits back to markdown sections.\n",
  );
  const rowId = await indexedRetrievalRow("storage-retrieval.md", "storage-retrieval/sqlite-state");

  const result = await queryProjectMemory(db, {
    root,
    project_key: "demo",
    question: "Where is the SQLite database stored?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: fixedProvider(),
    limit: 5,
    max_inline_chars: 4000,
    vector_store: vectorStore([rowId]),
    now: () => "2026-06-30T10:00:00.000Z",
  });

  expect(result.degraded).toBe(false);
  expect(result.matches[0]).toMatchObject({
    retrieval_row_id: rowId,
    wiki_path: "wiki/storage-retrieval.md",
    section_id: "storage-retrieval/sqlite-state",
    return_kind: "inline_content",
    citation: "project_memory:wiki/storage-retrieval.md#storage-retrieval/sqlite-state",
  });
  expect(result.matches[0]?.content ?? "").toContain("state/memory.db");
});

test("returns canonical reference instead of inline content when section is too large", async () => {
  await writeWikiPage("setup/index.md", `# Setup\n\n${"large ".repeat(20)}\n`);
  const rowId = await indexedRetrievalRow("setup/index.md", "setup");

  const result = await queryProjectMemory(db, {
    root,
    project_key: "demo",
    question: "How do I set up the project?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: fixedProvider(),
    limit: 5,
    max_inline_chars: 10,
    vector_store: vectorStore([rowId]),
  });

  expect(result.matches[0]).toMatchObject({
    retrieval_row_id: rowId,
    return_kind: "reference",
    reference_reason: "too_large",
    citation: "project_memory:wiki/setup/index.md#setup",
  });
  expect(result.matches[0].content).toBeUndefined();
});

test("does not return stale inline content when current markdown hash differs", async () => {
  await writeWikiPage("setup/index.md", "# Setup\n\nOriginal setup guidance.\n");
  const rowId = await indexedRetrievalRow("setup/index.md", "setup");
  await writeWikiPage("setup/index.md", "# Setup\n\nChanged setup guidance.\n");

  const result = await queryProjectMemory(db, {
    root,
    project_key: "demo",
    question: "How do I set up the project?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: fixedProvider(),
    limit: 5,
    max_inline_chars: 4000,
    vector_store: vectorStore([rowId]),
  });

  expect(result.degraded).toBe(true);
  expect(result.matches[0]).toMatchObject({
    retrieval_row_id: rowId,
    return_kind: "reference",
    reference_reason: "stale_hash",
    citation: "project_memory:wiki/setup/index.md#setup",
  });
  expect(result.matches[0].content).toBeUndefined();
});

test("returns degraded canonical reference when markdown section is missing", async () => {
  await writeWikiPage("setup/index.md", "# Setup\n\nOriginal setup guidance.\n");
  const rowId = await indexedRetrievalRow("setup/index.md", "setup");
  await writeWikiPage("setup/index.md", "# Different\n\nMoved content.\n");

  const result = await queryProjectMemory(db, {
    root,
    project_key: "demo",
    question: "How do I set up the project?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: fixedProvider(),
    limit: 5,
    max_inline_chars: 4000,
    vector_store: vectorStore([rowId]),
  });

  expect(result.degraded).toBe(true);
  expect(result.matches[0]).toMatchObject({
    retrieval_row_id: rowId,
    wiki_path: "wiki/setup/index.md",
    section_id: "setup",
    return_kind: "reference",
    reference_reason: "missing_markdown",
    citation: "project_memory:wiki/setup/index.md#setup",
  });
  expect(result.matches[0].content).toBeUndefined();
});

async function writeWikiPage(path: string, text: string): Promise<void> {
  const absolutePath = join(root, "projects", "demo", "wiki", path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

async function indexedRetrievalRow(pagePath: string, sectionId: string): Promise<string> {
  const manifest = await extractProjectMemorySections(root, "demo");
  const section = manifest.sections.find((item) => item.wiki_path === `wiki/${pagePath}` && item.section_id === sectionId);
  if (!section) throw new Error(`missing section fixture: ${pagePath}#${sectionId}`);
  const row = ensurePendingProjectMemoryRetrievalEmbedding(db, {
    project_key: "demo",
    wiki_path: section.wiki_path,
    section_id: section.section_id,
    section_hash: section.section_hash,
    hint_hash: null,
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-30T10:00:00.000Z",
  });
  markProjectMemoryRetrievalEmbeddingIndexed(db, {
    id: row.id,
    normalized_text_hash: "sha256:text",
    now: "2026-06-30T10:01:00.000Z",
  });
  return row.id;
}

function vectorStore(rowIds: string[]): ProjectMemoryQueryVectorStore {
  return {
    ensure() {
      return { available: true };
    },
    search() {
      return rowIds.map((retrieval_row_id, index) => ({ retrieval_row_id, distance: 0.1 + index / 10 }));
    },
  };
}

function fixedProvider(): EmbeddingProviderClient {
  return {
    async embed(request) {
      return {
        embedding: Array.from({ length: request.contract.dimensions }, () => 0),
        model: request.contract.model,
        dimensions: request.contract.dimensions,
      };
    },
  };
}
