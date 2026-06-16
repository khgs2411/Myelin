import { afterEach, beforeEach, expect, test } from "bun:test";
import { createMemoryCandidate, getMemoryCandidate, listMemoryCandidates, normalizeCandidateStatus } from "../../src/memory/candidates.ts";
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
