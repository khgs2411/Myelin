import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryCandidate, getMemoryCandidate } from "../../src/memory/candidates.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { createHandoffInstruction, listHandoffInstructions } from "../../src/memory/handoffs.ts";
import { ProjectMemorySourceConsumptionReconciler } from "../../src/project/project-memory-source-consumption-reconciler.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-source-reconcile-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("marks consumed project candidates and handoffs processed", async () => {
  await seedSourceConsumptionState([
    sourceRecord("project_candidate", "cand_1"),
    sourceRecord("project_handoff", "handoff_1"),
    sourceRecord("project_candidate", "missing"),
    sourceRecord("project_candidate", "cand_1"),
  ]);
  seedMemoryDb();

  const result = await new ProjectMemorySourceConsumptionReconciler(root).reconcileProject("demo", {
    now: new Date("2026-06-25T09:00:00.000Z"),
  });

  expect(result.degraded).toBe(false);
  expect(result.processed_candidates).toEqual(["cand_1"]);
  expect(result.processed_project_handoffs).toEqual(["handoff_1"]);
  expect(result.missing_refs).toEqual(["project_candidate:missing"]);

  const db = openMemoryDb(root);
  try {
    expect(getMemoryCandidate(db, "cand_1")?.status).toBe("processed");
    expect(getMemoryCandidate(db, "cand_1")?.processed_at).toBe("2026-06-25T09:00:00.000Z");
    expect(listHandoffInstructions(db, { target_scope: "project", project_key: "demo", status: "processed" })[0]?.id).toBe(
      "handoff_1",
    );
  } finally {
    db.close();
  }
});

test("marks supported terminal no-op dispositions processed", async () => {
  await seedSourceConsumptionState([
    sourceRecord("project_candidate", "cand_1", "already_trusted"),
    sourceRecord("project_handoff", "handoff_1", "not_durable"),
    sourceRecord("project_candidate", "cand_2", "already_covered"),
  ]);
  seedMemoryDb();

  const result = await new ProjectMemorySourceConsumptionReconciler(root).reconcileProject("demo", {
    now: new Date("2026-06-25T09:00:00.000Z"),
  });

  expect(result.processed_candidates).toEqual(["cand_1", "cand_2"]);
  expect(result.processed_project_handoffs).toEqual(["handoff_1"]);
});

test("does not retire missing coverage or blocked-by-quality dispositions", async () => {
  await seedSourceConsumptionState([
    sourceRecord("project_candidate", "cand_1", "missing_coverage_no_grounded_write"),
    sourceRecord("project_handoff", "handoff_1", "blocked_by_quality"),
    sourceRecord("project_candidate", "cand_2", "duplicate_or_superseded"),
  ]);
  seedMemoryDb();

  const result = await new ProjectMemorySourceConsumptionReconciler(root).reconcileProject("demo", {
    now: new Date("2026-06-25T09:00:00.000Z"),
  });

  expect(result.processed_candidates).toEqual([]);
  expect(result.processed_project_handoffs).toEqual([]);
  const db = openMemoryDb(root);
  try {
    expect(getMemoryCandidate(db, "cand_1")?.status).toBe("pending");
    expect(listHandoffInstructions(db, { target_scope: "project", project_key: "demo", status: "needs_review" })[0]?.id).toBe(
      "handoff_1",
    );
  } finally {
    db.close();
  }
});

test("does nothing when source-consumption state is absent", async () => {
  const result = await new ProjectMemorySourceConsumptionReconciler(root).reconcileProject("demo");

  expect(result.degraded).toBe(false);
  expect(result.processed_candidates).toEqual([]);
});

test("fails closed on malformed source-consumption state", async () => {
  await writeJson(join(root, "state", "demo", "project-memory-source-consumptions.json"), {
    schema_version: 2,
    project_key: "demo",
    records: [],
  });
  seedMemoryDb();

  const result = await new ProjectMemorySourceConsumptionReconciler(root).reconcileProject("demo");

  expect(result.degraded).toBe(true);
  expect(result.blocking).toBe(true);
  expect(result.degraded_reasons[0]).toContain("schema_version");
  const db = openMemoryDb(root);
  try {
    expect(getMemoryCandidate(db, "cand_1")?.status).toBe("pending");
  } finally {
    db.close();
  }
});

function seedMemoryDb(): void {
  const db = openMemoryDb(root);
  try {
    createMemoryCandidate(db, {
      id: "cand_1",
      project_key: "demo",
      scope: "project",
      status: "pending",
      candidate_type: "project.fact",
      summary: "Possible project fact.",
      source_event_refs: ["tomb_1"],
      evidence: {},
      proposed_payload: {},
      confidence: "medium",
      risk: "low",
      reason: "Durable fact",
      now: "2026-06-25T08:00:00.000Z",
    });
    createMemoryCandidate(db, {
      id: "cand_2",
      project_key: "demo",
      scope: "project",
      status: "pending",
      candidate_type: "project.fact",
      summary: "Duplicate project fact.",
      source_event_refs: ["tomb_2"],
      evidence: {},
      proposed_payload: {},
      confidence: "medium",
      risk: "low",
      reason: "Duplicate fact",
      now: "2026-06-25T08:00:00.000Z",
    });
    createHandoffInstruction(db, {
      id: "handoff_1",
      target_scope: "project",
      project_key: "demo",
      status: "needs_review",
      objective: "Document durable fact",
      prompt_text: "Review Project Memory.",
      source_session_memory_ids: ["mem_1"],
      source_event_refs: ["tomb_1"],
      suggested_actions: ["query project memory"],
      reason: "Durable handoff",
      confidence: "medium",
      risk: "low",
      now: "2026-06-25T08:01:00.000Z",
    });
  } finally {
    db.close();
  }
}

async function seedSourceConsumptionState(records: ReturnType<typeof sourceRecord>[]): Promise<void> {
  await writeJson(join(root, "state", "demo", "project-memory-source-consumptions.json"), {
    schema_version: 1,
    project_key: "demo",
    records,
  });
}

function sourceRecord(
  source_kind: "project_candidate" | "project_handoff",
  source_ref: string,
  terminal_decision = "applied_to_project_memory",
) {
  return {
    source_kind,
    source_ref,
    project_key: "demo",
    consumed_by_run: "runs/demo/project-learn/run-1",
    consumed_at: "2026-06-25T08:30:00.000Z",
    terminal_decision,
    output_refs: ["project-memory-changeset.json"],
  };
}
