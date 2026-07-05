import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  ensurePendingProjectMemoryRetrievalEmbedding,
  getProjectMemoryRetrievalEmbedding,
  hydrateProjectMemoryRetrievalRows,
  listPendingProjectMemoryRetrievalEmbeddings,
  markProjectMemoryRetrievalEmbeddingFailed,
  markProjectMemoryRetrievalEmbeddingIndexed,
  projectMemoryRetrievalEmbeddingId,
} from "../../src/memory/project-memory-retrieval-storage.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
});

afterEach(() => {
  db.close();
});

test("creates deterministic pending Project Memory retrieval rows", () => {
  const row = ensurePendingProjectMemoryRetrievalEmbedding(db, {
    project_key: "demo",
    wiki_path: "wiki/architecture/ranking.md",
    section_id: "ranking/proposal-ranking",
    section_hash: "sha256:section",
    hint_hash: "sha256:hint",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-28T10:00:00.000Z",
  });

  expect(row.id).toBe(
    projectMemoryRetrievalEmbeddingId({
      project_key: "demo",
      wiki_path: "wiki/architecture/ranking.md",
      section_id: "ranking/proposal-ranking",
      section_hash: "sha256:section",
      hint_hash: "sha256:hint",
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    }),
  );
  expect(row.status).toBe("pending");
});

test("keeps indexed row when section, hint, and embedding contract are unchanged", () => {
  const row = ensurePendingProjectMemoryRetrievalEmbedding(db, {
    project_key: "demo",
    wiki_path: "wiki/index.md",
    section_id: "demo",
    section_hash: "sha256:section",
    hint_hash: null,
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-28T10:00:00.000Z",
  });
  markProjectMemoryRetrievalEmbeddingIndexed(db, {
    id: row.id,
    normalized_text_hash: "sha256:text",
    now: "2026-06-28T10:01:00.000Z",
  });

  const again = ensurePendingProjectMemoryRetrievalEmbedding(db, {
    project_key: "demo",
    wiki_path: "wiki/index.md",
    section_id: "demo",
    section_hash: "sha256:section",
    hint_hash: null,
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-28T10:02:00.000Z",
  });

  expect(again.status).toBe("indexed");
  expect(again.normalized_text_hash).toBe("sha256:text");
});

test("hydrates Project Memory retrieval rows in requested order and skips missing ids", () => {
  const first = ensurePendingProjectMemoryRetrievalEmbedding(db, {
    project_key: "demo",
    wiki_path: "wiki/index.md",
    section_id: "demo",
    section_hash: "sha256:first",
    hint_hash: null,
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-28T10:00:00.000Z",
  });
  const second = ensurePendingProjectMemoryRetrievalEmbedding(db, {
    project_key: "demo",
    wiki_path: "wiki/setup/index.md",
    section_id: "setup",
    section_hash: "sha256:second",
    hint_hash: null,
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-28T10:00:00.000Z",
  });

  expect(hydrateProjectMemoryRetrievalRows(db, [second.id, "missing", first.id, second.id]).map((row) => row.id)).toEqual([
    second.id,
    first.id,
  ]);
});

test("lists failed rows only when retry is requested", () => {
  const row = ensurePendingProjectMemoryRetrievalEmbedding(db, {
    project_key: "demo",
    wiki_path: "wiki/index.md",
    section_id: "demo",
    section_hash: "sha256:section",
    hint_hash: null,
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-28T10:00:00.000Z",
  });
  markProjectMemoryRetrievalEmbeddingFailed(db, {
    id: row.id,
    failure_reason: "sqlite-vec unavailable",
    now: "2026-06-28T10:01:00.000Z",
  });

  expect(
    listPendingProjectMemoryRetrievalEmbeddings(db, {
      project_key: "demo",
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      limit: 10,
    }),
  ).toEqual([]);
  expect(
    listPendingProjectMemoryRetrievalEmbeddings(db, {
      project_key: "demo",
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      limit: 10,
      include_failed: true,
    }).map((item) => item.id),
  ).toEqual([row.id]);
  expect(getProjectMemoryRetrievalEmbedding(db, row.id).retry_count).toBe(1);
});
