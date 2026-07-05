import { expect, test } from "bun:test";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import {
  createSqliteVecAdapter,
  ensureProjectMemoryRetrievalVectorTable,
  ensureSessionMemoryVectorTable,
  getSqliteVecAvailability,
  searchProjectMemoryRetrievalVectors,
  searchSessionMemoryVectors,
  upsertProjectMemoryRetrievalVector,
  upsertSessionMemoryVector,
} from "../../src/memory/sqlite-vec.ts";

test("sqlite-vec availability reports unavailable when load throws", () => {
  const db = openMemoryDbAt(":memory:");
  try {
    const adapter = createSqliteVecAdapter({
      load: () => {
        throw new Error("extension disabled");
      },
    });
    expect(getSqliteVecAvailability(db, adapter)).toEqual({
      available: false,
      reason: "extension disabled",
    });
  } finally {
    db.close();
  }
});

test("vector table creation is skipped when sqlite-vec is unavailable", () => {
  const db = openMemoryDbAt(":memory:");
  try {
    const adapter = createSqliteVecAdapter({
      load: () => {
        throw new Error("extension disabled");
      },
    });
    const result = ensureSessionMemoryVectorTable(db, { dimensions: 1536, adapter });
    expect(result).toEqual({ created: false, available: false, reason: "extension disabled" });
  } finally {
    db.close();
  }
});

test("vector operations are project scoped when sqlite-vec is available", () => {
  const db = openMemoryDbAt(":memory:");
  try {
    const created = ensureSessionMemoryVectorTable(db, { dimensions: 3 });
    if (!created.available) {
      console.warn(`sqlite-vec unavailable, skipping live vector operation assertion: ${created.reason}`);
      return;
    }

    upsertSessionMemoryVector(db, {
      memory_id: "mem_class_close",
      project_key: "class-kit",
      embedding_model: "test-model",
      embedding_dimensions: 3,
      embedding_purpose: "retrieval_document",
      format_version: 1,
      embedding: [0.1, 0.2, 0.3],
    });
    upsertSessionMemoryVector(db, {
      memory_id: "mem_class_far",
      project_key: "class-kit",
      embedding_model: "test-model",
      embedding_dimensions: 3,
      embedding_purpose: "retrieval_document",
      format_version: 1,
      embedding: [0.9, 0.9, 0.9],
    });
    upsertSessionMemoryVector(db, {
      memory_id: "mem_other_close",
      project_key: "other",
      embedding_model: "test-model",
      embedding_dimensions: 3,
      embedding_purpose: "retrieval_document",
      format_version: 1,
      embedding: [0.1, 0.2, 0.3],
    });

    const matches = searchSessionMemoryVectors(db, {
      project_key: "class-kit",
      embedding_model: "test-model",
      embedding_dimensions: 3,
      embedding_purpose: "retrieval_document",
      format_version: 1,
      embedding: [0.1, 0.2, 0.3],
      limit: 10,
    });

    expect(matches.map((match) => match.memory_id)).toEqual(["mem_class_close", "mem_class_far"]);
    expect(matches[0].distance).toBeLessThanOrEqual(matches[1].distance);
  } finally {
    db.close();
  }
});

test("Project Memory vector operations are project and section scoped when sqlite-vec is available", () => {
  const db = openMemoryDbAt(":memory:");
  try {
    const created = ensureProjectMemoryRetrievalVectorTable(db, { dimensions: 3 });
    if (!created.available) {
      console.warn(`sqlite-vec unavailable, skipping Project Memory vector assertion: ${created.reason}`);
      return;
    }

    upsertProjectMemoryRetrievalVector(db, {
      retrieval_row_id: "pmr_1",
      project_key: "demo",
      wiki_path: "wiki/index.md",
      section_id: "demo",
      embedding_model: "stub",
      embedding_dimensions: 3,
      embedding_purpose: "retrieval_document",
      format_version: 1,
      embedding: [0.1, 0.2, 0.3],
    });
    insertProjectRetrievalRow(db, "pmr_1", "demo", "wiki/index.md", "demo", "indexed");
    upsertProjectMemoryRetrievalVector(db, {
      retrieval_row_id: "pmr_stale",
      project_key: "demo",
      wiki_path: "wiki/old.md",
      section_id: "old",
      embedding_model: "stub",
      embedding_dimensions: 3,
      embedding_purpose: "retrieval_document",
      format_version: 1,
      embedding: [0.1, 0.2, 0.3],
    });
    insertProjectRetrievalRow(db, "pmr_stale", "demo", "wiki/old.md", "old", "stale");
    upsertProjectMemoryRetrievalVector(db, {
      retrieval_row_id: "pmr_2",
      project_key: "other",
      wiki_path: "wiki/index.md",
      section_id: "other",
      embedding_model: "stub",
      embedding_dimensions: 3,
      embedding_purpose: "retrieval_document",
      format_version: 1,
      embedding: [0.1, 0.2, 0.3],
    });

    expect(
      searchProjectMemoryRetrievalVectors(db, {
        project_key: "demo",
        embedding_model: "stub",
        embedding_dimensions: 3,
        embedding_purpose: "retrieval_document",
        format_version: 1,
        embedding: [0.1, 0.2, 0.3],
        limit: 1,
      })[0]?.retrieval_row_id,
    ).toBe("pmr_1");
  } finally {
    db.close();
  }
});

function insertProjectRetrievalRow(
  db: ReturnType<typeof openMemoryDbAt>,
  id: string,
  projectKey: string,
  wikiPath: string,
  sectionId: string,
  status: "indexed" | "stale",
): void {
  db.query(
    `INSERT INTO project_memory_retrieval_embeddings
      (id, project_key, wiki_path, section_id, section_hash, hint_hash, hint_hash_key,
       embedding_provider, embedding_model, embedding_dimensions, embedding_purpose, format_version,
       normalized_text_hash, status, failure_reason, retry_count, created_at, updated_at, indexed_at)
     VALUES (?, ?, ?, ?, 'sha256:section', NULL, '', 'stub', 'stub', 3, 'retrieval_document', 1,
       'sha256:text', ?, NULL, 0, '2026-06-30T10:00:00.000Z', '2026-06-30T10:00:00.000Z',
       '2026-06-30T10:00:00.000Z')`,
  ).run(id, projectKey, wikiPath, sectionId, status);
}
