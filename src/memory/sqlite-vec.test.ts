import { expect, test } from "bun:test";
import { openMemoryDbAt } from "./db.ts";
import {
  createSqliteVecAdapter,
  ensureSessionMemoryVectorTable,
  getSqliteVecAvailability,
  searchSessionMemoryVectors,
  upsertSessionMemoryVector,
} from "./sqlite-vec.ts";

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
