import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  createHandoffInstruction,
  listHandoffInstructions,
  markProjectHandoffInstructionProcessed,
} from "../../src/memory/handoffs.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
});

afterEach(() => {
  db.close();
});

test("writes and lists layer handoff instructions to separate layer tables", () => {
  const row = createHandoffInstruction(db, {
    id: "handoff_1",
    target_scope: "project",
    project_key: "class-kit",
    status: "pending",
    objective: "Verify auth decision",
    prompt_text: "Read session memory mem_1 and verify whether project memory needs an auth note.",
    source_session_memory_ids: ["mem_1"],
    source_event_refs: ["tomb_1"],
    suggested_actions: ["query project memory", "read auth files"],
    reason: "Session memory found durable project signal",
    confidence: "medium",
    risk: "low",
    now: "2026-06-13T10:00:00.000Z",
  });

  expect(row.id).toBe("handoff_1");
  expect(listHandoffInstructions(db, { target_scope: "project", project_key: "class-kit" }).map((item) => item.id)).toEqual([
    "handoff_1",
  ]);
  expect(listHandoffInstructions(db, { target_scope: "practice", project_key: "class-kit" })).toEqual([]);
});

test("normalizes handoff status filters", () => {
  createHandoffInstruction(db, {
    id: "handoff_1",
    target_scope: "personal",
    project_key: "class-kit",
    status: "needs_review",
    objective: "Evaluate repeated preference",
    prompt_text: "Compare source refs before recording a personal preference.",
    source_session_memory_ids: ["mem_1"],
    source_event_refs: ["tomb_1"],
    suggested_actions: ["query session memory"],
    reason: "Repeated correction may indicate durable preference",
    confidence: "medium",
    risk: "medium",
    now: "2026-06-13T10:00:00.000Z",
  });

  expect(
    listHandoffInstructions(db, { target_scope: "personal", project_key: "class-kit", status: "needs-review" }).map(
      (item) => item.status,
    ),
  ).toEqual(["needs_review"]);
});

test("marks project handoff instructions processed idempotently", () => {
  createHandoffInstruction(db, {
    id: "handoff_1",
    target_scope: "project",
    project_key: "class-kit",
    status: "pending",
    objective: "Verify auth decision",
    prompt_text: "Read session memory mem_1.",
    source_session_memory_ids: ["mem_1"],
    source_event_refs: ["tomb_1"],
    suggested_actions: ["query project memory"],
    reason: "Project signal",
    confidence: "medium",
    risk: "low",
    now: "2026-06-13T10:00:00.000Z",
  });
  createHandoffInstruction(db, {
    id: "practice_1",
    target_scope: "practice",
    project_key: "class-kit",
    status: "pending",
    objective: "Compare auth practice",
    prompt_text: "Compare project evidence.",
    source_session_memory_ids: ["mem_1"],
    source_event_refs: ["tomb_2"],
    suggested_actions: ["query practice memory"],
    reason: "Practice signal",
    confidence: "medium",
    risk: "low",
    now: "2026-06-13T10:00:00.000Z",
  });

  expect(
    markProjectHandoffInstructionProcessed(db, {
      project_key: "class-kit",
      id: "handoff_1",
      now: "2026-06-13T11:00:00.000Z",
    }),
  ).toEqual({ status: "processed", id: "handoff_1" });
  expect(listHandoffInstructions(db, { target_scope: "project", project_key: "class-kit", status: "processed" })[0]?.processed_at).toBe(
    "2026-06-13T11:00:00.000Z",
  );
  expect(
    markProjectHandoffInstructionProcessed(db, {
      project_key: "class-kit",
      id: "handoff_1",
      now: "2026-06-13T12:00:00.000Z",
    }),
  ).toEqual({ status: "already_terminal", id: "handoff_1", current_status: "processed" });
  expect(
    markProjectHandoffInstructionProcessed(db, {
      project_key: "class-kit",
      id: "practice_1",
      now: "2026-06-13T11:00:00.000Z",
    }),
  ).toEqual({ status: "missing", id: "practice_1" });
});
