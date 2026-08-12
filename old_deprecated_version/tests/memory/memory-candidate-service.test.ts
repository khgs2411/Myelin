import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryCandidate } from "../../src/memory/candidates.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { MemoryCandidateService } from "../../src/memory/memory-candidate-service.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-memory-candidate-service-"));
  const db = openMemoryDb(root);
  try {
    createMemoryCandidate(db, {
      id: "cand_1",
      project_key: "demo",
      scope: "session",
      status: "needs_review",
      candidate_type: "session_memory",
      title: null,
      summary: "Candidate summary",
      source_event_refs: [],
      evidence: {},
      proposed_payload: {},
      confidence: "medium",
      risk: "low",
      reason: "test fixture",
      now: "2026-06-15T00:00:00.000Z",
    });
  } finally {
    db.close();
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("memory candidate service lists and shows candidates through a storage boundary", () => {
  const service = new MemoryCandidateService(root);

  const listed = service.list({ projectKey: "demo", status: service.normalizeStatus("needs-review") });
  const shown = service.show(listed.candidates[0].id);

  expect(listed.candidates).toHaveLength(1);
  expect(shown.candidate.summary).toBe("Candidate summary");
});
