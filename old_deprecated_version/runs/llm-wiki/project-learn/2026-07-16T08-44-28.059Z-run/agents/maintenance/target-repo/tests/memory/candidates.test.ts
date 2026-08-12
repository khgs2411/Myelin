import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createMemoryCandidate,
  getMemoryCandidate,
  listMemoryCandidates,
  markProjectMemoryCandidateProcessed,
  mergeMemoryCandidateSourceRefs,
  normalizeCandidateStatus,
} from "../../src/memory/candidates.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
});

afterEach(() => {
  db.close();
});

test("normalizes hyphenated candidate status aliases", () => {
  expect(normalizeCandidateStatus("needs-review")).toBe("needs_review");
  expect(normalizeCandidateStatus("needs_review")).toBe("needs_review");
  expect(() => normalizeCandidateStatus("unknown")).toThrow("Unknown candidate status");
});

test("creates and lists memory candidates by stored status and scope", () => {
  createMemoryCandidate(db, {
    id: "cand_1",
    project_key: "class-kit",
    scope: "session",
    status: "needs_review",
    candidate_type: "session.continuity",
    summary: "Possible risky session summary.",
    source_event_refs: ["tomb_1"],
    evidence: { tombstones: ["tomb_1"] },
    proposed_payload: { summary: "Possible risky session summary." },
    confidence: "medium",
    risk: "medium",
    reason: "Conflicting evidence",
    now: "2026-06-13T10:00:00.000Z",
  });

  expect(listMemoryCandidates(db, { project_key: "class-kit", status: "needs-review" }).map((row) => row.status)).toEqual([
    "needs_review",
  ]);
  expect(listMemoryCandidates(db, { project_key: "class-kit", scope: "session" }).map((row) => row.id)).toEqual([
    "cand_1",
  ]);
  expect(JSON.parse(getMemoryCandidate(db, "cand_1")?.source_event_refs_json ?? "[]")).toEqual(["tomb_1"]);
});

test("marks project memory candidates processed idempotently", () => {
  createMemoryCandidate(db, {
    id: "cand_1",
    project_key: "class-kit",
    scope: "project",
    status: "needs_review",
    candidate_type: "project.fact",
    summary: "Possible project fact.",
    source_event_refs: ["tomb_1"],
    evidence: {},
    proposed_payload: {},
    confidence: "medium",
    risk: "low",
    reason: "Durable project fact",
    now: "2026-06-13T10:00:00.000Z",
  });
  createMemoryCandidate(db, {
    id: "cand_session",
    project_key: "class-kit",
    scope: "session",
    status: "pending",
    candidate_type: "session.continuity",
    summary: "Session candidate.",
    source_event_refs: ["tomb_2"],
    evidence: {},
    proposed_payload: {},
    confidence: "medium",
    risk: "low",
    reason: "Session only",
    now: "2026-06-13T10:00:00.000Z",
  });

  expect(
    markProjectMemoryCandidateProcessed(db, {
      project_key: "class-kit",
      id: "cand_1",
      now: "2026-06-13T11:00:00.000Z",
    }),
  ).toEqual({ status: "processed", id: "cand_1" });
  const processed = getMemoryCandidate(db, "cand_1");
  expect(processed?.status).toBe("processed");
  expect(processed?.processed_at).toBe("2026-06-13T11:00:00.000Z");

  expect(
    markProjectMemoryCandidateProcessed(db, {
      project_key: "class-kit",
      id: "cand_1",
      now: "2026-06-13T12:00:00.000Z",
    }),
  ).toEqual({ status: "already_terminal", id: "cand_1", current_status: "processed" });
  expect(getMemoryCandidate(db, "cand_1")?.processed_at).toBe("2026-06-13T11:00:00.000Z");
  expect(
    markProjectMemoryCandidateProcessed(db, {
      project_key: "class-kit",
      id: "cand_session",
      now: "2026-06-13T11:00:00.000Z",
    }),
  ).toEqual({ status: "missing", id: "cand_session" });
});

test("merges source refs only for the same candidate project and scope", () => {
  createMemoryCandidate(db, {
    id: "cand_1",
    project_key: "class-kit",
    scope: "project",
    status: "processed",
    candidate_type: "project.fact",
    summary: "Durable project fact.",
    source_event_refs: ["tomb_1"],
    evidence: {},
    proposed_payload: {},
    confidence: "high",
    risk: "low",
    reason: "Already covered",
    now: "2026-06-13T10:00:00.000Z",
  });

  expect(
    mergeMemoryCandidateSourceRefs(db, {
      id: "cand_1",
      project_key: "class-kit",
      scope: "project",
      source_event_refs: ["tomb_1", "tomb_2"],
      now: "2026-06-13T11:00:00.000Z",
    }),
  ).toMatchObject({ id: "cand_1", status: "processed", updated_at: "2026-06-13T11:00:00.000Z" });
  expect(JSON.parse(getMemoryCandidate(db, "cand_1")?.source_event_refs_json ?? "[]")).toEqual(["tomb_1", "tomb_2"]);
  expect(
    mergeMemoryCandidateSourceRefs(db, {
      id: "cand_1",
      project_key: "other-project",
      scope: "project",
      source_event_refs: ["tomb_3"],
      now: "2026-06-13T12:00:00.000Z",
    }),
  ).toBeNull();
});
