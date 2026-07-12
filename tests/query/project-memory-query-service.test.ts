import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import type { EmbeddingProviderClient } from "../../src/memory/embedding-types.ts";
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
  const log = db.query("SELECT * FROM project_memory_query_logs").get() as {
    project_key: string;
    question: string;
    normalized_question: string;
    query_embedding_cache_id: string;
    query_embedding_json: string;
    match_count: number;
    degraded: number;
    degraded_reason: string | null;
    result_json: string;
  };
  expect(log).toMatchObject({
    project_key: "demo",
    question: "How do I set up the project?",
    normalized_question: "how do i set up the project?",
    query_embedding_cache_id: result.query_embedding_cache_id,
    match_count: 1,
    degraded: 0,
    degraded_reason: null,
  });
  expect(JSON.parse(log.query_embedding_json)).toHaveLength(DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.dimensions);
  expect(JSON.parse(log.result_json)).toMatchObject({
    query_embedding_cache_id: result.query_embedding_cache_id,
    matches: [{ retrieval_row_id: rowId, rerank_score: result.matches[0].rerank_score }],
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

test("fetches a broader vector recall set before returning the requested limit", async () => {
  await writeWikiPage("setup.md", "# Setup\n\nProject setup uses the myelin CLI.\n");
  const rowId = await indexedRetrievalRow("setup.md", "setup");
  let requestedLimit = 0;

  const result = await queryProjectMemory(db, {
    root,
    project_key: "demo",
    question: "How do I set up the project?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: fixedProvider(),
    limit: 5,
    max_inline_chars: 4000,
    vector_store: {
      ensure() {
        return { available: true };
      },
      search(_db, input) {
        requestedLimit = input.limit;
        return [{ retrieval_row_id: rowId, distance: 0.1 }];
      },
    },
    now: () => "2026-06-30T10:00:00.000Z",
  });

  expect(requestedLimit).toBe(20);
  expect(result.matches).toHaveLength(1);
});

test("reranks specific subject sections above navigation sections", async () => {
  await writeWikiPage(
    "index.md",
    "# demo Project Memory Draft Index\n\n## Documentation Subjects\n\n1. [Project Memory Creation](project-memory-creation-and-curation.md) - create-mode documentation subjects.\n2. [Storage](storage.md) - database and retrieval notes.\n",
  );
  await writeWikiPage(
    "project-memory-creation-and-curation.md",
    "# Project Memory Creation and Curation\n\n## Current creation model\n\nProject Memory create mode uses a planner agent and subject writer agents to create the initial wiki documentation.\n",
  );
  const navigationRowId = await indexedRetrievalRow("index.md", "demo-project-memory-draft-index/documentation-subjects");
  const specificRowId = await indexedRetrievalRow(
    "project-memory-creation-and-curation.md",
    "project-memory-creation-and-curation/current-creation-model",
  );

  const result = await queryProjectMemory(db, {
    root,
    project_key: "demo",
    question: "How does Project Memory create the initial wiki documentation?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: fixedProvider(),
    limit: 2,
    max_inline_chars: 4000,
    vector_store: vectorStoreWithDistances([
      { retrieval_row_id: navigationRowId, distance: 0.1 },
      { retrieval_row_id: specificRowId, distance: 0.12 },
    ]),
    now: () => "2026-06-30T10:00:00.000Z",
  });

  expect(result.matches.map((match) => match.retrieval_row_id)).toEqual([specificRowId, navigationRowId]);
  expect(result.matches[0].rerank_reasons).toContain("section_title_match");
  expect(result.matches[0].rerank_reasons).toContain("page_title_match");
  expect(result.matches[1].rerank_reasons).toContain("navigation_penalty");
});

test("uses FTS recall to rescue exact subject sections missing from vector recall", async () => {
  await writeWikiPage(
    "product-purpose.md",
    "# Product Purpose\n\n## Living brain\n\nMyelin is a living project brain for repository documentation.\n",
  );
  await writeWikiPage(
    "quality-bar.md",
    "# Quality Bar\n\n## Acceptance checks\n\nThe Project Memory quality bar rejects coarse placeholder citations and shallow documentation.\n",
  );
  const broadRowId = await indexedRetrievalRow("product-purpose.md", "product-purpose/living-brain");
  const preciseRowId = await indexedRetrievalRow("quality-bar.md", "quality-bar/acceptance-checks");

  const result = await queryProjectMemory(db, {
    root,
    project_key: "demo",
    question: "What should the Project Memory quality bar reject?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: fixedProvider(),
    limit: 2,
    max_inline_chars: 4000,
    vector_store: vectorStoreWithDistances([{ retrieval_row_id: broadRowId, distance: 0.1 }]),
    now: () => "2026-06-30T10:00:00.000Z",
  });

  expect(result.matches.map((match) => match.retrieval_row_id)).toEqual([preciseRowId, broadRowId]);
  expect(result.retrieval_debug).toMatchObject({
    vector_recall_count: 1,
    fts_recall_count: 1,
    fused_candidate_count: 2,
  });
  expect(result.matches[0]).toMatchObject({
    retrieval_row_id: preciseRowId,
    vector_rank: undefined,
    fts_rank: 1,
  });
  expect(result.matches[0].bm25_score).toBeNumber();
  expect(result.matches[0].rerank_reasons).toContain("rrf_base");
  expect(result.matches[0].rerank_reasons).toContain("page_title_match");
});

test("logs vector, FTS, and RRF rank diagnostics for hybrid Project Memory query", async () => {
  await writeWikiPage(
    "storage-retrieval.md",
    "# Storage Retrieval\n\n## SQLite retrieval index\n\nProject Memory retrieval uses SQLite vector and lexical indexes.\n",
  );
  const rowId = await indexedRetrievalRow("storage-retrieval.md", "storage-retrieval/sqlite-retrieval-index");

  const result = await queryProjectMemory(db, {
    root,
    project_key: "demo",
    question: "How does SQLite retrieval indexing work?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: fixedProvider(),
    limit: 1,
    max_inline_chars: 4000,
    vector_store: vectorStoreWithDistances([{ retrieval_row_id: rowId, distance: 0.1 }]),
    now: () => "2026-06-30T10:00:00.000Z",
  });

  expect(result.matches[0]).toMatchObject({
    retrieval_row_id: rowId,
    vector_rank: 1,
    fts_rank: 1,
  });
  expect(result.matches[0].rrf_score).toBeGreaterThan(0.03);
  const log = db
    .query("SELECT result_json FROM project_memory_query_logs WHERE question = ?")
    .get("How does SQLite retrieval indexing work?") as { result_json: string };
  expect(JSON.parse(log.result_json)).toMatchObject({
    retrieval_debug: {
      vector_recall_count: 1,
      fts_recall_count: 1,
      fused_candidate_count: 1,
    },
    matches: [
      {
        retrieval_row_id: rowId,
        vector_rank: 1,
        fts_rank: 1,
      },
    ],
  });
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

test("reranks oversized exact command sections using canonical text without leaking it", async () => {
  await writeWikiPage(
    "product-purpose.md",
    `# Product Purpose\n\n${"Myelin project memory provides repository context. ".repeat(8)}\n`,
  );
  await writeWikiPage(
    "command-surface.md",
    `# Command Surface\n\n## Command vocabulary\n\n${"Operator workflow context. ".repeat(8)}myelin memory maintain project refreshes curated Project Memory.\n`,
  );
  const broadRowId = await indexedRetrievalRow("product-purpose.md", "product-purpose");
  const commandRowId = await indexedRetrievalRow("command-surface.md", "command-surface/command-vocabulary");

  const result = await queryProjectMemory(db, {
    root,
    project_key: "demo",
    question: "What does myelin memory maintain project do?",
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: fixedProvider(),
    limit: 2,
    max_inline_chars: 10,
    vector_store: vectorStoreWithDistances([
      { retrieval_row_id: broadRowId, distance: 0.05 },
      { retrieval_row_id: commandRowId, distance: 0.2 },
    ]),
  });

  expect(result.matches[0]).toMatchObject({
    retrieval_row_id: commandRowId,
    heading_path: ["Command Surface", "Command vocabulary"],
    page_title: "Command Surface",
    return_kind: "reference",
    reference_reason: "too_large",
    query_token_coverage: 1,
    query_phrase_coverage: 1,
  });
  expect(result.matches[0].rerank_reasons).toContain("complete_query_token_coverage");
  expect(result.matches[0].rerank_reasons).toContain("query_phrase_coverage");
  expect(result.matches[0].content).toBeUndefined();
  expect("rerank_text" in result.matches[0]).toBe(false);
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

function vectorStoreWithDistances(matches: Array<{ retrieval_row_id: string; distance: number }>): ProjectMemoryQueryVectorStore {
  return {
    ensure() {
      return { available: true };
    },
    search() {
      return matches;
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
    async embedBatch(requests) {
      return Promise.all(requests.map((request) => this.embed(request)));
    },
  };
}
