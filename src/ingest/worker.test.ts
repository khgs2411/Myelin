import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIngestJob, getIngestJob } from "./jobs.ts";
import { applyIngestWorkerOutput, runIngestWorker } from "./worker.ts";
import { openMemoryDbAt, type MemoryDb } from "../memory/db.ts";
import { listExperienceEvents, recordExperienceEvent } from "../memory/experience.ts";
import type { RunProcessResult } from "../runtime/process.ts";

let root: string;
let db: MemoryDb;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-ingest-worker-"));
  db = openMemoryDbAt(join(root, "state", "memory.db"));
  createIngestJob(db, {
    id: "job_1",
    project_key: "class-kit",
    provider: "codex",
    input: {},
    now: "2026-06-13T09:58:00.000Z",
  });
});

afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});

test("worker output writes session memory and finalizes tombstones", () => {
  seedClaimedTombstone(db, { id: "tomb_1", ingest_job_id: "job_1", project_key: "class-kit" });

  const counts = applyIngestWorkerOutput(db, {
    projectKey: "class-kit",
    jobId: "job_1",
    provider: "codex",
    providerSessionId: "sess_1",
    finalizedAt: "2026-06-13T10:00:00.000Z",
    output: {
      session_memories: [
        {
          id: "mem_1",
          source_event_refs: ["tomb_1"],
          memory_kind: "decision",
          summary: "Decided to run detached ingest.",
          payload: {},
          confidence: "high",
          risk: "low",
        },
      ],
    },
  });

  expect(counts.session_memories).toBe(1);
  expect(db.query("SELECT id FROM session_memories WHERE id = ?").get("mem_1")).toEqual({ id: "mem_1" });
  expect(db.query("SELECT state, output_references_json FROM experience_event_tombstones WHERE id = ?").get("tomb_1")).toEqual({
    state: "output",
    output_references_json: JSON.stringify(["session_memories/mem_1"]),
  });
});

test("candidate output stores source refs and finalizes the referenced tombstone", () => {
  seedClaimedTombstone(db, { id: "tomb_1", ingest_job_id: "job_1", project_key: "class-kit" });

  const counts = applyIngestWorkerOutput(db, {
    projectKey: "class-kit",
    jobId: "job_1",
    provider: "codex",
    providerSessionId: "sess_1",
    finalizedAt: "2026-06-13T10:00:00.000Z",
    output: {
      memory_candidates: [
        {
          id: "cand_1",
          source_event_refs: ["tomb_1"],
          scope: "session",
          status: "needs_review",
          candidate_type: "session.continuity",
          summary: "Possible risky session summary.",
          evidence: { tombstones: ["tomb_1"] },
          proposed_payload: { summary: "Possible risky session summary." },
          confidence: "medium",
          risk: "medium",
          reason: "Ambiguous evidence",
        },
      ],
    },
  });

  expect(counts.memory_candidates).toBe(1);
  const candidate = db.query("SELECT source_event_refs_json FROM memory_candidates WHERE id = ?").get("cand_1") as {
    source_event_refs_json: string;
  };
  expect(JSON.parse(candidate.source_event_refs_json)).toEqual(["tomb_1"]);
  const tombstone = db.query("SELECT state, output_references_json FROM experience_event_tombstones WHERE id = ?").get("tomb_1") as {
    state: string;
    output_references_json: string;
  };
  expect(tombstone.state).toBe("output");
  expect(JSON.parse(tombstone.output_references_json)).toEqual(["memory_candidates/cand_1"]);
});

test("handoff output stores source refs and finalizes the referenced tombstone", () => {
  seedClaimedTombstone(db, { id: "tomb_1", ingest_job_id: "job_1", project_key: "class-kit" });

  const counts = applyIngestWorkerOutput(db, {
    projectKey: "class-kit",
    jobId: "job_1",
    provider: "codex",
    providerSessionId: "sess_1",
    finalizedAt: "2026-06-13T10:00:00.000Z",
    output: {
      handoff_instructions: [
        {
          id: "handoff_1",
          target_scope: "project",
          status: "pending",
          objective: "Verify project auth choice.",
          prompt_text: "Check the repo and update project memory later.",
          source_session_memory_ids: ["mem_1"],
          source_event_refs: ["tomb_1"],
          suggested_actions: ["read auth config"],
          reason: "Session evidence suggests durable project fact.",
          confidence: "medium",
          risk: "medium",
        },
      ],
    },
  });

  expect(counts.handoff_instructions).toBe(1);
  const handoff = db.query("SELECT source_event_refs_json FROM project_handoff_instructions WHERE id = ?").get("handoff_1") as {
    source_event_refs_json: string;
  };
  expect(JSON.parse(handoff.source_event_refs_json)).toEqual(["tomb_1"]);
  expect(db.query("SELECT output_references_json FROM experience_event_tombstones WHERE id = ?").get("tomb_1")).toEqual({
    output_references_json: JSON.stringify(["project_handoff_instructions/handoff_1"]),
  });
});

test("output application rolls back candidate writes when finalization fails", () => {
  expect(() =>
    applyIngestWorkerOutput(db, {
      projectKey: "class-kit",
      jobId: "job_1",
      provider: "codex",
      providerSessionId: null,
      finalizedAt: "2026-06-13T10:00:00.000Z",
      output: {
        memory_candidates: [
          {
            id: "cand_1",
            source_event_refs: ["missing_tombstone"],
            scope: "session",
            status: "needs_review",
            candidate_type: "session.continuity",
            summary: "Should roll back.",
            evidence: {},
            proposed_payload: {},
            confidence: "low",
            risk: "medium",
            reason: "Missing tombstone",
          },
        ],
      },
    }),
  ).toThrow("Unable to finalize claimed tombstone: missing_tombstone");

  expect(db.query("SELECT COUNT(*) AS count FROM memory_candidates").get()).toEqual({ count: 0 });
});

test("output application rolls back session memory when provider omits source refs", () => {
  expect(() =>
    applyIngestWorkerOutput(db, {
      projectKey: "class-kit",
      jobId: "job_1",
      provider: "codex",
      providerSessionId: null,
      finalizedAt: "2026-06-13T10:00:00.000Z",
      output: {
        session_memories: [
          {
            id: "mem_1",
            source_event_refs: [],
            memory_kind: "continuity",
            summary: "Missing source refs.",
            payload: {},
            confidence: "low",
            risk: "medium",
          },
        ],
      },
    }),
  ).toThrow("Output session_memories/mem_1 must reference at least one tombstone");

  expect(db.query("SELECT COUNT(*) AS count FROM session_memories").get()).toEqual({ count: 0 });
});

test("output application rejects tombstones marked both output and no_output", () => {
  seedClaimedTombstone(db, { id: "tomb_1", ingest_job_id: "job_1", project_key: "class-kit" });

  expect(() =>
    applyIngestWorkerOutput(db, {
      projectKey: "class-kit",
      jobId: "job_1",
      provider: "codex",
      providerSessionId: null,
      finalizedAt: "2026-06-13T10:00:00.000Z",
      output: {
        session_memories: [
          {
            id: "mem_1",
            source_event_refs: ["tomb_1"],
            memory_kind: "continuity",
            summary: "Output exists.",
            payload: {},
            confidence: "high",
            risk: "low",
          },
        ],
        no_output_tombstone_ids: ["tomb_1"],
      },
    }),
  ).toThrow("Tombstone tomb_1 cannot be both output and no_output");
});

test("worker claims batches from target repo cwd and completes when queue is empty", async () => {
  recordExperienceEvent(db, {
    id: "evt_1",
    project_key: "class-kit",
    occurred_at: "2026-06-13T09:59:00.000Z",
    provider: "codex",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid",
  });
  db.close();

  const calls: Array<{ cwd?: string; stdin?: string }> = [];
  await runIngestWorker({
    root,
    projectKey: "class-kit",
    jobId: "job_1",
    targetRepo: "/target/repo",
    provider: "codex",
    providerSessionId: "sess_1",
    batchSize: 1,
    now: fixedNow(),
    runner: async (_command, options): Promise<RunProcessResult> => {
      calls.push({ cwd: options?.cwd, stdin: options?.stdin });
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          session_memories: [
            {
              id: "mem_1",
              source_event_refs: ["tomb_job_1_evt_1"],
              memory_kind: "continuity",
              summary: "Captured useful continuity.",
              payload: {},
              confidence: "high",
              risk: "low",
            },
          ],
          terminal_summary: "Created one memory.",
        }),
        stderr: "",
      };
    },
  });

  db = openMemoryDbAt(join(root, "state", "memory.db"));
  expect(calls).toHaveLength(1);
  expect(calls[0].cwd).toBe("/target/repo");
  expect(calls[0].stdin).toContain("Every session memory, memory candidate, and handoff instruction must include source_event_refs");
  expect(listExperienceEvents(db, "class-kit")).toEqual([]);
  expect(db.query("SELECT id FROM session_memories WHERE id = ?").get("mem_1")).toEqual({ id: "mem_1" });
  expect(getIngestJob(db, "job_1")?.status).toBe("completed");
  expect(getIngestJob(db, "job_1")?.terminal_summary).toBe("Created one memory.");
});

test("worker marks claimed tombstones failed when provider invocation fails", async () => {
  recordExperienceEvent(db, {
    id: "evt_1",
    project_key: "class-kit",
    occurred_at: "2026-06-13T09:59:00.000Z",
    provider: "codex",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid",
  });
  db.close();

  await expect(
    runIngestWorker({
      root,
      projectKey: "class-kit",
      jobId: "job_1",
      targetRepo: "/target/repo",
      provider: "codex",
      batchSize: 1,
      now: fixedNow(),
      runner: async (): Promise<RunProcessResult> => ({ exitCode: 1, stdout: "", stderr: "provider down" }),
    }),
  ).rejects.toThrow("codex exited 1: provider down");

  db = openMemoryDbAt(join(root, "state", "memory.db"));
  expect(db.query("SELECT state, terminal_decision FROM experience_event_tombstones WHERE id = ?").get("tomb_job_1_evt_1")).toEqual({
    state: "failed",
    terminal_decision: "provider_failed",
  });
  expect(getIngestJob(db, "job_1")?.status).toBe("failed");
});

function seedClaimedTombstone(
  db: MemoryDb,
  input: { id: string; ingest_job_id: string; project_key: string },
): void {
  db.query(
    `INSERT INTO experience_event_tombstones
      (id, original_event_id, dedupe_key, project_key, ingest_job_id, provider, provider_session_id,
       claimed_at, finalized_at, state, terminal_decision, source_metadata_json, retained_evidence_json,
       output_references_json)
     VALUES (?, ?, NULL, ?, ?, 'codex', 'sess_1', ?, NULL, 'claimed', NULL, ?, ?, ?)`,
  ).run(
    input.id,
    `evt_${input.id}`,
    input.project_key,
    input.ingest_job_id,
    "2026-06-13T09:59:00.000Z",
    JSON.stringify({}),
    JSON.stringify({}),
    JSON.stringify([]),
  );
}

function fixedNow(): () => Date {
  return () => new Date("2026-06-13T10:00:00.000Z");
}
