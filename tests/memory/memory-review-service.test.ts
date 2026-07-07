import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryCandidate } from "../../src/memory/candidates.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { MemoryReviewService } from "../../src/memory/memory-review-service.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-memory-review-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("reports reviewable Project Memory maintenance dispositions with run artifact paths", async () => {
  const runDir = join(root, "projects", "demo", "runs", "project-learn", "2026-07-07T10-00-00.000Z-run");
  await mkdir(join(runDir, "reports"), { recursive: true });
  await writeJson(join(runDir, "reports", "documentation-maintenance-report.json"), {
    schema_version: 1,
    project_key: "demo",
    status: "completed",
    dispositions: [
      {
        source_kind: "project_candidate",
        source_ref: "cand_ok",
        disposition: "applied_to_project_memory",
        reason: "Applied.",
        output_refs: ["draft-wiki/runtime.md"],
      },
      {
        source_kind: "project_candidate",
        source_ref: "cand_research",
        disposition: "insufficient_evidence",
        reason: "Requires external research before becoming durable memory.",
        output_refs: [],
      },
      {
        source_kind: "project_handoff",
        source_ref: "handoff_other",
        disposition: "belongs_to_other_layer",
        reason: "Should be practice memory.",
        output_refs: [],
      },
      {
        source_kind: "project_handoff",
        source_ref: "handoff_failure",
        disposition: "blocked_by_runner_failure",
        reason: "Provider failed.",
        output_refs: [],
      },
    ],
    touched_paths: [],
    evidence_paths: [],
    known_gaps: [],
  });

  const result = await new MemoryReviewService(root).reviewProject({ projectKey: "demo" });

  expect(result.items).toHaveLength(2);
  expect(result.items.map((item) => item.kind)).toEqual(["project_memory_disposition", "project_memory_disposition"]);
  expect(result.items.map((item) => item.kind === "project_memory_disposition" ? item.source_ref : "")).toEqual([
    "cand_research",
    "handoff_other",
  ]);
  expect(result.items[0]).toMatchObject({
    kind: "project_memory_disposition",
    status: "insufficient_evidence",
    json_path: "projects/demo/runs/project-learn/2026-07-07T10-00-00.000Z-run/reports/documentation-maintenance-report.json",
  });

  const filtered = await new MemoryReviewService(root).reviewProject({ projectKey: "demo", status: "belongs_to_other_layer" });
  expect(filtered.reviewable_count).toBe(1);
  expect(filtered.items[0]).toMatchObject({ kind: "project_memory_disposition", source_ref: "handoff_other" });
});

test("reports SQLite reviewable ingest and candidate outcomes", async () => {
  const db = openMemoryDb(root);
  try {
    db.query(
      `INSERT INTO ingest_jobs
        (id, project_key, status, provider, provider_session_id, requested_by, input_json, output_counts_json,
         terminal_summary, error_json, followup_state_json, started_at, finished_at, created_at, updated_at)
       VALUES (?, ?, 'needs_followup', 'codex', NULL, NULL, '{}', '{}', ?, NULL, NULL, NULL, NULL, ?, ?)`,
    ).run("job_followup", "demo", "Needs operator follow-up.", "2026-07-07T10:00:00.000Z", "2026-07-07T10:01:00.000Z");
    db.query(
      `INSERT INTO experience_event_tombstones
        (id, original_event_id, dedupe_key, project_key, ingest_job_id, provider, provider_session_id, claimed_at,
         finalized_at, state, terminal_decision, source_metadata_json, retained_evidence_json, output_references_json)
       VALUES (?, ?, NULL, ?, ?, 'codex', NULL, ?, ?, 'no_output', 'reviewed_no_output', '{}', '{}', '[]')`,
    ).run(
      "tomb_no_output",
      "event_1",
      "demo",
      "job_followup",
      "2026-07-07T10:02:00.000Z",
      "2026-07-07T10:03:00.000Z",
    );
    createMemoryCandidate(db, {
      id: "cand_rejected",
      project_key: "demo",
      scope: "project",
      status: "rejected",
      candidate_type: "project.test",
      title: "Rejected",
      summary: "Rejected candidate.",
      source_event_refs: ["tomb_no_output"],
      evidence: {},
      proposed_payload: {},
      confidence: "medium",
      risk: "low",
      reason: "Operator rejected.",
      now: "2026-07-07T10:04:00.000Z",
    });
  } finally {
    db.close();
  }

  const result = await new MemoryReviewService(root).reviewProject({ projectKey: "demo" });

  expect(result.items.map((item) => item.kind)).toEqual([
    "memory_candidate",
    "experience_tombstone",
    "ingest_job",
  ]);
  expect(result.items[0]).toMatchObject({ kind: "memory_candidate", id: "cand_rejected", status: "rejected" });
  expect(result.items[1]).toMatchObject({ kind: "experience_tombstone", id: "tomb_no_output", status: "no_output" });
  expect(result.items[2]).toMatchObject({ kind: "ingest_job", id: "job_followup", status: "needs_followup" });
});
