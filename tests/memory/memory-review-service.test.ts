import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryCandidate } from "../../src/memory/candidates.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { MemoryReviewService } from "../../src/memory/memory-review-service.ts";
import { writeJson } from "../../src/runtime/json.ts";
import { createIngestJob, updateIngestJobStatus } from "../../src/ingest/jobs.ts";
import {
  finalizeLeasedExperienceEventsInOpenTransaction,
  leaseExperienceEvents,
  recordExperienceEvent,
} from "../../src/memory/experience.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-memory-review-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("reports reviewable Project Memory maintenance dispositions with run artifact paths", async () => {
  const runDir = join(root, "runs", "demo", "project-learn", "2026-07-07T10-00-00.000Z-run");
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
    json_path: "runs/demo/project-learn/2026-07-07T10-00-00.000Z-run/reports/documentation-maintenance-report.json",
  });

  const filtered = await new MemoryReviewService(root).reviewProject({ projectKey: "demo", status: "belongs_to_other_layer" });
  expect(filtered.reviewable_count).toBe(1);
  expect(filtered.items[0]).toMatchObject({ kind: "project_memory_disposition", source_ref: "handoff_other" });
});

test("reports SQLite reviewable ingest and candidate outcomes", async () => {
  const db = openMemoryDb(root);
  try {
    createIngestJob(db, {
      id: "job_followup", project_key: "demo", provider: "codex", input: {},
      now: "2026-07-07T10:00:00.000Z",
    });
    updateIngestJobStatus(db, {
      id: "job_followup", status: "needs_followup", terminal_summary: "Needs operator follow-up.",
      updated_at: "2026-07-07T10:01:00.000Z",
    });
    recordExperienceEvent(db, {
      id: "event_1", project_key: "demo", occurred_at: "2026-07-07T10:02:00.000Z",
      event_kind: "user.prompt", provider: "codex", raw_text: "review me", raw_payload_json: "{}",
      source: "test", status: "valid",
    });
    leaseExperienceEvents(db, {
      ingest_job_id: "job_followup", project_key: "demo", limit: 1,
      claimed_at: "2026-07-07T10:02:00.000Z", tombstone_id_for: () => "tomb_no_output",
    });
    db.transaction(() => finalizeLeasedExperienceEventsInOpenTransaction(db, {
      ingest_job_id: "job_followup", tombstone_ids: ["tomb_no_output"],
      finalized_at: "2026-07-07T10:03:00.000Z", state: "no_output",
      terminal_decision: "reviewed_no_output", output_references: [],
    }))();
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
