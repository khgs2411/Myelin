import { afterEach, beforeEach, expect, test } from "bun:test";
import { listMemoryCandidates } from "../../src/memory/candidates.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  createRetrievalMaintenanceFeedbackItem,
  createRetrievalMaintenanceStructuralRepairItem,
  listPendingRetrievalMaintenanceItems,
  markRetrievalMaintenanceFailed,
  markRetrievalMaintenanceProcessed,
} from "../../src/memory/retrieval-maintenance-queue.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
});

afterEach(() => {
  db.close();
});

test("creates deduped poor retrieval feedback without memory candidates", () => {
  const first = createRetrievalMaintenanceFeedbackItem(db, {
    project_key: "demo",
    kind: "poor_retrieval_feedback",
    query_context: { question: "How does ranking work?", selected_hits: [] },
    feedback: { rating: "missed", expected_ref: "wiki/architecture/ranking.md#ranking" },
    wiki_refs: ["wiki/architecture/ranking.md#ranking"],
    reason: "Expected ranking memory was missing from retrieval hits.",
    created_by: "cli_query",
    now: "2026-06-28T10:00:00.000Z",
  });
  const second = createRetrievalMaintenanceFeedbackItem(db, {
    project_key: "demo",
    kind: "poor_retrieval_feedback",
    query_context: { question: "How does ranking work?", selected_hits: [] },
    feedback: { rating: "missed", expected_ref: "wiki/architecture/ranking.md#ranking" },
    wiki_refs: ["wiki/architecture/ranking.md#ranking"],
    reason: "Expected ranking memory was missing from retrieval hits.",
    created_by: "cli_query",
    now: "2026-06-28T10:01:00.000Z",
  });

  expect(second.id).toBe(first.id);
  expect(listPendingRetrievalMaintenanceItems(db, { project_key: "demo", limit: 10 })).toHaveLength(1);
  expect(listMemoryCandidates(db, { project_key: "demo", scope: "project", status: "pending" })).toEqual([]);
});

test("creates structural repair rows and marks terminal states", () => {
  const row = createRetrievalMaintenanceStructuralRepairItem(db, {
    project_key: "demo",
    kind: "index_repair",
    wiki_refs: ["wiki/index.md#demo"],
    reason: "section hash changed",
    created_by: "project_learn",
    now: "2026-06-28T10:00:00.000Z",
  });

  expect(row.status).toBe("pending");
  expect(
    markRetrievalMaintenanceFailed(db, {
      id: row.id,
      failure_reason: "provider unavailable",
      now: "2026-06-28T10:01:00.000Z",
    }).status,
  ).toBe("failed");
  expect(
    markRetrievalMaintenanceProcessed(db, {
      id: row.id,
      now: "2026-06-28T10:02:00.000Z",
    }).status,
  ).toBe("processed");
});
