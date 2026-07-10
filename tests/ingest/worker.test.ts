import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIngestJob, getIngestJob } from "../../src/ingest/jobs.ts";
import { applyIngestWorkerOutput, buildIngestPrompt, parseIngestWorkerOutput, runIngestWorker } from "../../src/ingest/worker.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { listExperienceEvents, recordExperienceEvent } from "../../src/memory/experience.ts";
import { listSessionMemoryContexts } from "../../src/memory/session-memory-contexts.ts";
import { createSessionMemory, supersedeSessionMemory } from "../../src/memory/session-memories.ts";
import { PROMPT_SIZE_LIMIT } from "../../src/runtime/llm-client.ts";
import type { RunProcessResult } from "../../src/runtime/process.ts";

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
  seedClaimedTombstone(db, {
    id: "tomb_1",
    ingest_job_id: "job_1",
    project_key: "class-kit",
    source_metadata: {
      repo_path: "/repo/class-kit",
      git_branch: "feature/sqlite-vec",
      git_commit: "abc123",
      git_worktree_id: "/repo/class-kit",
    },
  });

  const counts = applyIngestWorkerOutput(db, {
    projectKey: "class-kit",
    jobId: "job_1",
    provider: "codex",
    providerSessionId: "sess_1",
    finalizedAt: "2026-06-13T10:00:00.000Z",
    embeddingContract: {
      provider: "ollama",
      model: "qwen3-embedding:4b",
      dimensions: 1536,
      purpose: "retrieval_document",
      formatVersion: 1,
    },
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
  expect(
    db.query("SELECT embedding_provider, embedding_model FROM session_memory_embeddings WHERE session_memory_id = ?").get("mem_1"),
  ).toEqual({ embedding_provider: "ollama", embedding_model: "qwen3-embedding:4b" });
  expect(listSessionMemoryContexts(db, "mem_1")).toMatchObject([
    {
      session_memory_id: "mem_1",
      project_key: "class-kit",
      repo_path: "/repo/class-kit",
      git_branch: "feature/sqlite-vec",
      git_commit: "abc123",
      git_worktree_id: "/repo/class-kit",
      source_event_ref: "tomb_1",
    },
  ]);
  expect(db.query("SELECT state, output_references_json FROM experience_event_tombstones WHERE id = ?").get("tomb_1")).toEqual({
    state: "output",
    output_references_json: JSON.stringify(["session_memories/mem_1"]),
  });
});

test("worker output can supersede supplied active session memory", () => {
  createSessionMemory(db, {
    id: "mem_old",
    project_key: "class-kit",
    source_event_refs: ["tomb_old"],
    memory_kind: "decision",
    title: "Old decision",
    summary: "SQLite retrieval is not branch-aware.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-13T09:00:00.000Z",
  });
  seedClaimedTombstone(db, { id: "tomb_1", ingest_job_id: "job_1", project_key: "class-kit" });

  const counts = applyIngestWorkerOutput(db, {
    projectKey: "class-kit",
    jobId: "job_1",
    provider: "codex",
    providerSessionId: "sess_1",
    finalizedAt: "2026-06-13T10:00:00.000Z",
    allowedExistingMemoryIds: ["mem_old"],
    output: {
      session_memories: [
        {
          id: "mem_new",
          source_event_refs: ["tomb_1"],
          memory_kind: "decision",
          title: "Branch-aware retrieval",
          summary: "SQLite retrieval is branch-aware through session memory contexts.",
          payload: {},
          confidence: "high",
          risk: "low",
        },
      ],
      memory_supersessions: [
        {
          superseded_memory_id: "mem_old",
          superseding_memory_id: "mem_new",
          relationship: "supersedes",
          reason: "New evidence added branch-aware retrieval.",
          source_event_refs: ["tomb_1"],
        },
      ],
    },
  });

  expect(counts.session_memories).toBe(1);
  expect(db.query("SELECT status, superseded_by, lifecycle_reason FROM session_memories WHERE id = ?").get("mem_old")).toEqual({
    status: "superseded",
    superseded_by: "mem_new",
    lifecycle_reason: "New evidence added branch-aware retrieval.",
  });
  expect(db.query("SELECT relationship, reason FROM session_memory_links").get()).toEqual({
    relationship: "supersedes",
    reason: "New evidence added branch-aware retrieval.",
  });
  expect(db.query("SELECT state, output_references_json FROM experience_event_tombstones WHERE id = ?").get("tomb_1")).toEqual({
    state: "output",
    output_references_json: JSON.stringify([
      "session_memories/mem_new",
      "session_memory_links/mem_old/mem_new",
    ]),
  });
});

test("worker output rejects reconciliation outside supplied context", () => {
  createSessionMemory(db, {
    id: "mem_old",
    project_key: "class-kit",
    source_event_refs: ["tomb_old"],
    memory_kind: "continuity",
    summary: "Old memory.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-13T09:00:00.000Z",
  });
  seedClaimedTombstone(db, { id: "tomb_1", ingest_job_id: "job_1", project_key: "class-kit" });

  expect(() =>
    applyIngestWorkerOutput(db, {
      projectKey: "class-kit",
      jobId: "job_1",
      provider: "codex",
      providerSessionId: null,
      finalizedAt: "2026-06-13T10:00:00.000Z",
      allowedExistingMemoryIds: [],
      output: {
        memory_retractions: [
          {
            memory_id: "mem_old",
            reason: "Not in supplied context.",
            source_event_refs: ["tomb_1"],
          },
        ],
      },
    }),
  ).toThrow("outside supplied context");

  expect(db.query("SELECT status FROM session_memories WHERE id = ?").get("mem_old")).toEqual({ status: "active" });
});

test("worker output skips reconciliation when supplied context became inactive in a parallel batch", () => {
  createSessionMemory(db, {
    id: "mem_old",
    project_key: "class-kit",
    source_event_refs: ["tomb_old"],
    memory_kind: "decision",
    summary: "Old memory that another worker already superseded.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-13T09:00:00.000Z",
  });
  createSessionMemory(db, {
    id: "mem_parallel",
    project_key: "class-kit",
    source_event_refs: ["tomb_parallel"],
    memory_kind: "decision",
    summary: "Replacement from a parallel worker.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-13T09:30:00.000Z",
  });
  supersedeSessionMemory(db, {
    id: "mem_old",
    projectKey: "class-kit",
    supersededBy: "mem_parallel",
    reason: "Parallel worker already reconciled it.",
    now: "2026-06-13T09:45:00.000Z",
  });
  seedClaimedTombstone(db, { id: "tomb_1", ingest_job_id: "job_1", project_key: "class-kit" });

  const counts = applyIngestWorkerOutput(db, {
    projectKey: "class-kit",
    jobId: "job_1",
    provider: "codex",
    providerSessionId: null,
    finalizedAt: "2026-06-13T10:00:00.000Z",
    allowedExistingMemoryIds: ["mem_old"],
    output: {
      session_memories: [
        {
          id: "mem_new",
          source_event_refs: ["tomb_1"],
          memory_kind: "decision",
          summary: "New memory from this worker still commits.",
          payload: {},
          confidence: "high",
          risk: "low",
        },
      ],
      memory_retractions: [
        {
          memory_id: "mem_old",
          reason: "This operation is stale because the memory is already inactive.",
          source_event_refs: ["tomb_1"],
        },
      ],
      memory_noops: [
        {
          memory_id: "mem_old",
          reason: "The memory was relevant when the prompt was built.",
        },
      ],
    },
  });

  expect(counts.session_memories).toBe(1);
  expect(db.query("SELECT id FROM session_memories WHERE id = ?").get("mem_new")).toEqual({ id: "mem_new" });
  expect(db.query("SELECT status, superseded_by FROM session_memories WHERE id = ?").get("mem_old")).toEqual({
    status: "superseded",
    superseded_by: "mem_parallel",
  });
  expect(db.query("SELECT state, output_references_json FROM experience_event_tombstones WHERE id = ?").get("tomb_1")).toEqual({
    state: "output",
    output_references_json: JSON.stringify(["session_memories/mem_new"]),
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

test("worker schedules project memory auto-maintenance after creating project candidates", async () => {
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
  const scheduled: string[] = [];

  await runIngestWorker({
    root,
    projectKey: "class-kit",
    jobId: "job_1",
    targetRepo: "/target/repo",
    provider: "codex",
    providerSessionId: "sess_1",
    batchSize: 1,
    now: fixedNow(),
    projectMemoryMaintenanceScheduler: {
      async maybeSchedule(projectKey, trigger) {
        scheduled.push(`${projectKey}:${trigger}`);
        return { status: "skipped", reason: "test scheduler" };
      },
    },
    runner: async (): Promise<RunProcessResult> => ({
      exitCode: 0,
      stdout: JSON.stringify({
        memory_candidates: [
          {
            id: "cand_project_1",
            source_event_refs: ["tomb_job_1_evt_1"],
            scope: "project",
            status: "needs_review",
            candidate_type: "project.documentation",
            summary: "Project documentation should mention auto maintenance.",
            evidence: { tombstones: ["tomb_job_1_evt_1"] },
            proposed_payload: { summary: "Project documentation should mention auto maintenance." },
            confidence: "medium",
            risk: "low",
            reason: "Durable project behavior was discussed.",
          },
        ],
      }),
      stderr: "",
    }),
  });

  db = openMemoryDbAt(join(root, "state", "memory.db"));
  expect(scheduled).toEqual(["class-kit:session_memory_candidate_created"]);
  expect(db.query("SELECT scope FROM memory_candidates WHERE id = ?").get("cand_project_1")).toEqual({ scope: "project" });
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

test("output application ignores unclaimable tombstone refs and preserves valid refs", () => {
  seedClaimedTombstone(db, { id: "tomb_1", ingest_job_id: "job_1", project_key: "class-kit" });

  const counts = applyIngestWorkerOutput(db, {
    projectKey: "class-kit",
    jobId: "job_1",
    provider: "codex",
    providerSessionId: null,
    finalizedAt: "2026-06-13T10:00:00.000Z",
    output: {
      memory_candidates: [
        {
          id: "cand_1",
          source_event_refs: ["missing_tombstone", "tomb_1"],
          scope: "session",
          status: "needs_review",
          candidate_type: "session.continuity",
          summary: "Keep the valid source ref.",
          evidence: {},
          proposed_payload: {},
          confidence: "low",
          risk: "medium",
          reason: "Missing tombstone was ignored",
        },
        {
          id: "cand_2",
          source_event_refs: ["missing_tombstone"],
          scope: "session",
          status: "needs_review",
          candidate_type: "session.continuity",
          summary: "No valid source refs.",
          evidence: {},
          proposed_payload: {},
          confidence: "low",
          risk: "medium",
          reason: "Should not be written",
        },
      ],
    },
  });

  expect(counts.memory_candidates).toBe(1);
  expect(db.query("SELECT id, source_event_refs_json FROM memory_candidates").all()).toEqual([
    { id: "cand_1", source_event_refs_json: JSON.stringify(["tomb_1"]) },
  ]);
  expect(db.query("SELECT state, output_references_json FROM experience_event_tombstones WHERE id = ?").get("tomb_1")).toEqual({
    state: "output",
    output_references_json: JSON.stringify(["memory_candidates/cand_1"]),
  });
});

test("output application scopes provider ids when they collide with existing memory rows", () => {
  seedClaimedTombstone(db, { id: "tomb_1", ingest_job_id: "job_1", project_key: "class-kit" });
  seedClaimedTombstone(db, { id: "tomb_2", ingest_job_id: "job_1", project_key: "class-kit" });

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
          summary: "First memory.",
          payload: {},
          confidence: "high",
          risk: "low",
        },
      ],
    },
  });

  const counts = applyIngestWorkerOutput(db, {
    projectKey: "class-kit",
    jobId: "job_1",
    provider: "codex",
    providerSessionId: null,
    finalizedAt: "2026-06-13T10:00:00.000Z",
    output: {
      session_memories: [
        {
          id: "mem_1",
          source_event_refs: ["tomb_2"],
          memory_kind: "continuity",
          summary: "Second memory with reused provider id.",
          payload: {},
          confidence: "high",
          risk: "low",
        },
      ],
    },
  });

  expect(counts.session_memories).toBe(1);
  expect(db.query("SELECT id FROM session_memories ORDER BY id").all()).toEqual([
    { id: "job_1_mem_1" },
    { id: "mem_1" },
  ]);
  expect(db.query("SELECT output_references_json FROM experience_event_tombstones WHERE id = ?").get("tomb_2")).toEqual({
    output_references_json: JSON.stringify(["session_memories/job_1_mem_1"]),
  });
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

test("output application lets output win when tombstones are also marked no_output", () => {
  seedClaimedTombstone(db, { id: "tomb_1", ingest_job_id: "job_1", project_key: "class-kit" });

  const counts = applyIngestWorkerOutput(db, {
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
  });

  expect(counts.session_memories).toBe(1);
  expect(db.query("SELECT state, output_references_json FROM experience_event_tombstones WHERE id = ?").get("tomb_1")).toEqual({
    state: "output",
    output_references_json: JSON.stringify(["session_memories/mem_1"]),
  });
});

test("parser treats empty terminal summary as absent", () => {
  expect(parseIngestWorkerOutput({ terminal_summary: "" })).toEqual({ terminal_summary: undefined });
  expect(parseIngestWorkerOutput({ terminal_summary: null })).toEqual({ terminal_summary: undefined });
  expect(parseIngestWorkerOutput({ terminal_summary: {} })).toEqual({ terminal_summary: undefined });
});

test("parser normalizes non-empty string arrays to singleton arrays", () => {
  const output = parseIngestWorkerOutput({
    no_output_tombstone_ids: "tomb_1",
  });

  expect(output.no_output_tombstone_ids).toEqual(["tomb_1"]);
});

test("prompt caps oversized retained evidence without mutating the tombstone", () => {
  const rawText = "y".repeat(80_000);
  const rawPayload = "x".repeat(80_000);
  const prompt = buildIngestPrompt({
    projectKey: "class-kit",
    jobId: "job_1",
    leased: [
      {
        id: "tomb_1",
        original_event_id: "evt_1",
        project_key: "class-kit",
        ingest_job_id: "job_1",
        provider: "codex",
        provider_session_id: null,
        claimed_at: "2026-06-13T10:00:00.000Z",
        state: "claimed",
        source_metadata_json: "{}",
        retained_evidence_json: "{}",
        prompt_evidence: {
          raw_text: rawText,
          raw_payload_json: rawPayload,
        },
      },
    ],
  });

  expect(prompt.length).toBeLessThan(40_000);
  expect(prompt).toContain("truncated for ingest prompt");
  expect(rawText.length).toBe(80_000);
  expect(rawPayload.length).toBe(80_000);
});

test("prompt instructs ingest to retire completed next actions", () => {
  const prompt = buildIngestPrompt({
    projectKey: "class-kit",
    jobId: "job_1",
    leased: [],
    projectStatus: {
      project_key: "class-kit",
      completion_layer: 10,
      completion_label: "Session Memory write complete",
      counts: {
        active_events: 0,
        unleased_events: 0,
        leased_events: 0,
        running_jobs: 0,
        failed_jobs: 0,
        terminal_tombstones: 1,
        session_memories: 1,
        memory_candidates: 0,
        handoff_instructions: 0,
        pending_session_memory_embeddings: 0,
      },
    },
    reconciliationContext: [
      {
        id: "mem_next_action",
        memory_kind: "next_action",
        title: "Retry failed ingest",
        summary: "Retry failed ingest after a fix lands.",
        created_at: "2026-06-13T09:00:00.000Z",
        updated_at: "2026-06-13T09:00:00.000Z",
        contexts: [],
        selection_reasons: ["active_next_action"],
        score: 45,
      },
    ],
  });

  expect(prompt).toContain("Treat next_action memories as short-lived");
  expect(prompt).toContain("Prefer retracting completed next_action memories");
  expect(prompt).toContain("Project maintenance status context");
  expect(prompt).toContain("\"failed_jobs\": 0");
  expect(prompt).toContain("\"selection_reasons\": [");
  expect(prompt).toContain("\"active_next_action\"");
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

  const calls: Array<{ command: string[]; cwd?: string; stdin?: string }> = [];
  await runIngestWorker({
    root,
    projectKey: "class-kit",
    jobId: "job_1",
    targetRepo: "/target/repo",
    provider: "codex",
    providerSessionId: "sess_1",
    batchSize: 1,
    now: fixedNow(),
    runner: async (command, options): Promise<RunProcessResult> => {
      calls.push({ command, cwd: options?.cwd, stdin: options?.stdin });
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
  expect(calls[0].command).toContain("--output-schema");
  expect(calls[0].command).toContain(join(root, "src", "ingest", "worker-output.schema.json"));
  expect(calls[0].cwd).toBe("/target/repo");
  expect(calls[0].stdin).toContain("Every session memory, memory candidate, and handoff instruction must include source_event_refs");
  expect(calls[0].stdin).toContain("Every memory candidate must include: id, source_event_refs, scope, status, candidate_type");
  expect(calls[0].stdin).toContain("Project maintenance status context");
  expect(calls[0].stdin).toContain("\"running_jobs\": 1");
  expect(calls[0].stdin).toContain("\"candidate_type\":\"session.continuity\"");
  expect(listExperienceEvents(db, "class-kit")).toEqual([]);
  expect(db.query("SELECT id FROM session_memories WHERE id = ?").get("mem_1")).toEqual({ id: "mem_1" });
  expect(getIngestJob(db, "job_1")?.status).toBe("completed");
  expect(getIngestJob(db, "job_1")?.terminal_summary).toBe("Created one memory.");
});

test("worker packs large experience rows into prompt-safe sub-batches", async () => {
  for (let index = 0; index < 45; index += 1) {
    recordExperienceEvent(db, {
      id: `evt_${index}`,
      project_key: "class-kit",
      occurred_at: `2026-06-13T09:${String(index).padStart(2, "0")}:00.000Z`,
      provider: "codex",
      raw_payload_json: JSON.stringify({ text: "x".repeat(8_000), index }),
      source: "codex-hook",
      status: "valid",
    });
  }
  db.close();

  const promptLengths: number[] = [];
  await runIngestWorker({
    root,
    projectKey: "class-kit",
    jobId: "job_1",
    targetRepo: "/target/repo",
    provider: "codex",
    limit: 45,
    batchSize: 100,
    maxPromptChars: 180_000,
    now: fixedNow(),
    runner: async (_command, options): Promise<RunProcessResult> => {
      const prompt = options?.stdin ?? "";
      promptLengths.push(prompt.length);
      const tombstoneIds = [...prompt.matchAll(/"id": "(tomb_job_1_evt_\d+)"/g)].map((match) => match[1]);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ no_output_tombstone_ids: tombstoneIds }),
        stderr: "",
      };
    },
  });

  db = openMemoryDbAt(join(root, "state", "memory.db"));
  expect(promptLengths.length).toBeGreaterThan(1);
  expect(promptLengths.every((length) => length < PROMPT_SIZE_LIMIT)).toBe(true);
  expect(listExperienceEvents(db, "class-kit")).toEqual([]);
  expect(getIngestJob(db, "job_1")?.status).toBe("completed");
});

test("worker trims reconciliation context to the computed context budget", async () => {
  for (let index = 0; index < 12; index += 1) {
    createSessionMemory(db, {
      id: `mem_large_${index}`,
      project_key: "class-kit",
      source_event_refs: [`tomb_old_${index}`],
      memory_kind: "continuity",
      summary: `Large active memory ${index}: ${"x".repeat(16_000)}`,
      payload: {},
      confidence: "high",
      risk: "low",
      now: `2026-06-13T08:${String(index).padStart(2, "0")}:00.000Z`,
    });
  }
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

  const prompts: string[] = [];
  await runIngestWorker({
    root,
    projectKey: "class-kit",
    jobId: "job_1",
    targetRepo: "/target/repo",
    provider: "codex",
    limit: 1,
    batchSize: 1,
    maxPromptChars: 180_000,
    now: fixedNow(),
    runner: async (_command, options): Promise<RunProcessResult> => {
      const prompt = options?.stdin ?? "";
      prompts.push(prompt);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ no_output_tombstone_ids: ["tomb_job_1_evt_1"] }),
        stderr: "",
      };
    },
  });

  const prompt = prompts[0] ?? "";
  const suppliedMemoryIds = [...prompt.matchAll(/"id": "mem_large_\d+"/g)];
  expect(prompt.length).toBeLessThan(PROMPT_SIZE_LIMIT);
  expect(suppliedMemoryIds.length).toBeGreaterThan(0);
  expect(suppliedMemoryIds.length).toBeLessThan(12);
});

test("worker keeps leased rows retryable when provider invocation fails", async () => {
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
  expect(listExperienceEvents(db, "class-kit").map((row) => row.id)).toEqual(["evt_1"]);
  expect(db.query("SELECT state, finalized_at, terminal_decision FROM experience_event_tombstones WHERE id = ?").get("tomb_job_1_evt_1")).toEqual({
    state: "claimed",
    finalized_at: null,
    terminal_decision: null,
  });
  expect(getIngestJob(db, "job_1")?.status).toBe("failed");
});

test("ordinary retry worker recovers a failed lease and commits the same raw row", async () => {
  recordExperienceEvent(db, {
    id: "evt_1",
    project_key: "class-kit",
    occurred_at: "2026-06-13T09:59:00.000Z",
    provider: "codex",
    raw_text: "retry this row",
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
  createIngestJob(db, {
    id: "job_2",
    project_key: "class-kit",
    provider: "codex",
    input: {},
    now: "2026-06-13T10:01:00.000Z",
  });
  db.close();

  const prompts: string[] = [];
  await runIngestWorker({
    root,
    projectKey: "class-kit",
    jobId: "job_2",
    targetRepo: "/target/repo",
    provider: "codex",
    batchSize: 1,
    now: fixedNow(),
    runner: async (_command, options): Promise<RunProcessResult> => {
      prompts.push(options?.stdin ?? "");
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          session_memories: [
            {
              id: "mem_retry",
              source_event_refs: ["tomb_job_1_evt_1"],
              memory_kind: "continuity",
              summary: "Recovered retry row.",
              payload: {},
              confidence: "high",
              risk: "low",
            },
          ],
        }),
        stderr: "",
      };
    },
  });

  db = openMemoryDbAt(join(root, "state", "memory.db"));
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("tomb_job_1_evt_1");
  expect(listExperienceEvents(db, "class-kit")).toEqual([]);
  expect(db.query("SELECT id FROM session_memories WHERE id = ?").get("mem_retry")).toEqual({ id: "mem_retry" });
  const tombstone = db
    .query("SELECT ingest_job_id, state, source_metadata_json, output_references_json FROM experience_event_tombstones WHERE id = ?")
    .get("tomb_job_1_evt_1") as {
    ingest_job_id: string;
    state: string;
    source_metadata_json: string;
    output_references_json: string;
  };
  expect(tombstone.ingest_job_id).toBe("job_2");
  expect(tombstone.state).toBe("output");
  expect(JSON.parse(tombstone.source_metadata_json).attempts).toEqual([
    { ingest_job_id: "job_1", ended_at: "2026-06-13T10:00:00.000Z", reason: "provider_failed" },
  ]);
  expect(JSON.parse(tombstone.output_references_json)).toEqual(["session_memories/mem_retry"]);
});

test("worker commits provider no-output refs and deletes source rows", async () => {
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

  await runIngestWorker({
    root,
    projectKey: "class-kit",
    jobId: "job_1",
    targetRepo: "/target/repo",
    provider: "codex",
    batchSize: 1,
    now: fixedNow(),
    runner: async (): Promise<RunProcessResult> => ({
      exitCode: 0,
      stdout: JSON.stringify({ no_output_tombstone_ids: ["tomb_job_1_evt_1"], terminal_summary: "No useful memory." }),
      stderr: "",
    }),
  });

  db = openMemoryDbAt(join(root, "state", "memory.db"));
  expect(listExperienceEvents(db, "class-kit")).toEqual([]);
  expect(db.query("SELECT state, terminal_decision FROM experience_event_tombstones WHERE id = ?").get("tomb_job_1_evt_1")).toEqual({
    state: "no_output",
    terminal_decision: "no_output",
  });
});

test("worker compacts large provider failure messages before storing job errors", async () => {
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

  const stderr = [
    "codex transcript header",
    "user",
    "x".repeat(8_000),
    "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark.",
  ].join("\n");

  await expect(
    runIngestWorker({
      root,
      projectKey: "class-kit",
      jobId: "job_1",
      targetRepo: "/target/repo",
      provider: "codex",
      batchSize: 1,
      now: fixedNow(),
      runner: async (): Promise<RunProcessResult> => ({ exitCode: 1, stdout: "", stderr }),
    }),
  ).rejects.toThrow("codex exited 1");

  db = openMemoryDbAt(join(root, "state", "memory.db"));
  const job = getIngestJob(db, "job_1");
  const error = JSON.parse(job?.error_json ?? "{}") as { message: string; retryable: boolean };
  expect(error.retryable).toBe(true);
  expect(error.message.length).toBeLessThan(4_100);
  expect(error.message).toContain("usage limit");
  expect(error.message).not.toContain("x".repeat(500));
});

test("worker rejects invalid provider output before durable memory writes", async () => {
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
      runner: async (): Promise<RunProcessResult> => ({
        exitCode: 0,
        stdout: JSON.stringify({
          session_memories: [
            {
              id: "mem_1",
              source_event_refs: ["tomb_job_1_evt_1"],
              summary: "Captured useful continuity.",
              payload: {},
              confidence: "high",
              risk: "low",
            },
          ],
        }),
        stderr: "",
      }),
    }),
  ).rejects.toThrow("IngestWorkerOutput contract violation: session_memories[0].memory_kind must be one of");

  db = openMemoryDbAt(join(root, "state", "memory.db"));
  expect(db.query("SELECT COUNT(*) AS count FROM session_memories").get()).toEqual({ count: 0 });
  expect(db.query("SELECT COUNT(*) AS count FROM memory_candidates").get()).toEqual({ count: 0 });
  expect(db.query("SELECT COUNT(*) AS count FROM project_handoff_instructions").get()).toEqual({ count: 0 });
  expect(db.query("SELECT COUNT(*) AS count FROM practice_handoff_instructions").get()).toEqual({ count: 0 });
  expect(db.query("SELECT COUNT(*) AS count FROM personal_handoff_instructions").get()).toEqual({ count: 0 });
  expect(listExperienceEvents(db, "class-kit").map((row) => row.id)).toEqual(["evt_1"]);
  expect(db.query("SELECT state, terminal_decision FROM experience_event_tombstones WHERE id = ?").get("tomb_job_1_evt_1")).toEqual({
    state: "claimed",
    terminal_decision: null,
  });

  const job = getIngestJob(db, "job_1");
  expect(job?.status).toBe("failed");
  expect(job?.error_json).toContain("IngestWorkerOutput contract violation");
  expect(job?.error_json).toContain("memory_kind");
  expect(job?.error_json).not.toContain("NOT NULL constraint failed");
});

function seedClaimedTombstone(
  db: MemoryDb,
  input: { id: string; ingest_job_id: string; project_key: string; source_metadata?: Record<string, unknown> },
): void {
  recordExperienceEvent(db, {
    id: `evt_${input.id}`,
    project_key: input.project_key,
    occurred_at: "2026-06-13T09:59:00.000Z",
    provider: "codex",
    provider_session_id: "sess_1",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid",
  });
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
    JSON.stringify(input.source_metadata ?? {}),
    JSON.stringify({}),
    JSON.stringify([]),
  );
}

function fixedNow(): () => Date {
  return () => new Date("2026-06-13T10:00:00.000Z");
}
