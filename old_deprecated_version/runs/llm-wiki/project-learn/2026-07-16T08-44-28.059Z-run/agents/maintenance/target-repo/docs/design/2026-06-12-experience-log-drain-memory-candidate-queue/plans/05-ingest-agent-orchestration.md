# Chunk 05: Ingest Agent Orchestration

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `02-experience-log-claim-finalize.md`, `03-ingest-job-runtime.md`, `04-memory-output-repositories.md`
**Enables:** `06-operator-cli-surfaces.md`, `07-docs-validation-and-source-set.md`

## Goal

Implement the bounded ingest worker/orchestration loop used by the detached provider job. The worker claims Experience Log rows in batches, builds a constrained prompt/tool bridge, lets the provider decide Session Memory/candidates/handoffs, writes outputs through Myelin repositories, finalizes tombstones, and stops when the active queue is empty. V1 runs one worker per job and does not implement a scheduler or multi-agent pool.

## Source Artifacts

- `../spec.md`: Agentic Ingest Boundary, Agent Runtime Context, Pull-To-Tombstone Lifecycle, Parallelism Boundary, Session Memory Trust Boundary, Error Handling
- `../agenda.md`: Questions 7, 8, 9, 18, 19, 20, 21
- `../../../adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`
- `src/runtime/llm-client.ts`
- `src/memory/experience.ts` from Chunk 02
- `src/ingest/jobs.ts` and `src/ingest/runtime.ts` from Chunk 03
- `src/memory/session-memories.ts`, `src/memory/candidates.ts`, `src/memory/handoffs.ts` from Chunk 04

## Relationships

- **Depends on:** claim/finalize helpers, job lifecycle, and output repositories.
- **Enables:** top-level CLI can start jobs and workers; candidate commands can inspect created candidates.
- **Shared contracts:** `runIngestWorker`, provider output JSON shape, batch loop semantics.
- **Integration points:** `invokeLlm` uses target repo cwd; tests use stubbed runner/provider output.

## File Responsibility Map

**Create:**
- `src/ingest/worker.ts` - worker loop, prompt builder, provider result application.
- `src/ingest/worker.test.ts` - stubbed worker tests for output, no-output, and failure finalization.

**Modify:**
- `src/runtime/llm-client.ts` only if a lightweight `runner` injection or workload selector is missing for worker tests. Prefer existing `runner` option.

**Test:**
- `src/ingest/worker.test.ts`

## Implementation Tasks

### Task 1: Define Worker Output Contract

**Files:**
- Create: `src/ingest/worker.ts`

- [ ] **Step 1: Add provider output types**

```ts
import type { JsonObject } from "../runtime/llm-client.ts";
import type { MemoryScope, SessionMemoryKind, HandoffScope } from "../memory/ingest-types.ts";

export type IngestWorkerOutput = {
  session_memories?: Array<{
    id: string;
    source_event_refs: string[];
    memory_kind: SessionMemoryKind;
    title?: string | null;
    summary: string;
    payload: JsonObject;
    confidence: string;
    risk: string;
  }>;
  memory_candidates?: Array<{
    id: string;
    source_event_refs: string[];
    scope: MemoryScope;
    status: "pending" | "needs_review";
    candidate_type: string;
    title?: string | null;
    summary: string;
    evidence: JsonObject;
    proposed_payload: JsonObject;
    confidence: string;
    risk: string;
    reason: string;
  }>;
  handoff_instructions?: Array<{
    id: string;
    target_scope: HandoffScope;
    status: "pending" | "needs_review";
    objective: string;
    prompt_text: string;
    source_session_memory_ids: string[];
    source_event_refs: string[];
    suggested_actions: string[];
    reason: string;
    confidence: string;
    risk: string;
  }>;
  no_output_tombstone_ids?: string[];
  terminal_summary?: string;
};

export function parseIngestWorkerOutput(value: JsonObject): IngestWorkerOutput {
  return value as IngestWorkerOutput;
}
```

`parseIngestWorkerOutput` starts as a narrow cast because provider JSON is already parsed by `invokeLlm`. If runtime validation becomes necessary during implementation, use Zod in this file and keep the external output shape unchanged.

### Task 2: Build The Worker Prompt

**Files:**
- Create: `src/ingest/worker.ts`

- [ ] **Step 1: Add prompt builder**

```ts
import type { ClaimedExperienceTombstone } from "../memory/experience.ts";

export function buildIngestPrompt(input: {
  projectKey: string;
  jobId: string;
  claimed: ClaimedExperienceTombstone[];
}): string {
  return [
    "You are the Myelin Session Memory ingest agent.",
    `Project key: ${input.projectKey}`,
    `Ingest job id: ${input.jobId}`,
    "",
    "You are running from the target repository cwd. Use repo context when deciding what memory matters.",
    "Create only low-risk trusted Session Memory directly.",
    "Create Session Memory candidates for ambiguous, risky, conflicting, or privacy-sensitive outputs.",
    "Create Project/Practice/Personal handoff instructions only as one-hop downstream inputs.",
    "Do not mutate curated wiki pages.",
    "Return JSON only with keys: session_memories, memory_candidates, handoff_instructions, no_output_tombstone_ids, terminal_summary.",
    "Every session memory, memory candidate, and handoff instruction must include source_event_refs containing claimed tombstone ids.",
    "",
    "Claimed Experience Log tombstones:",
    JSON.stringify(input.claimed, null, 2),
  ].join("\n");
}
```

### Task 3: Implement Output Application

**Files:**
- Create: `src/ingest/worker.ts`
- Test: `src/ingest/worker.test.ts`

- [ ] **Step 1: Add output application helper**

```ts
import type { Database } from "bun:sqlite";
import { finalizeClaimedExperienceEventsInOpenTransaction } from "../memory/experience.ts";
import { createMemoryCandidate } from "../memory/candidates.ts";
import { createHandoffInstruction } from "../memory/handoffs.ts";
import { createSessionMemory } from "../memory/session-memories.ts";

export function applyIngestWorkerOutput(
  db: Database,
  input: {
    projectKey: string;
    jobId: string;
    provider: string;
    providerSessionId: string | null;
    output: IngestWorkerOutput;
    finalizedAt: string;
  },
): { session_memories: number; memory_candidates: number; handoff_instructions: number } {
  const apply = db.transaction(() => {
    let sessionMemories = 0;
    let memoryCandidates = 0;
    let handoffs = 0;
    const outputRefsByTombstone = new Map<string, string[]>();

    const addOutputRefs = (tombstoneIds: string[], outputRef: string) => {
      if (tombstoneIds.length === 0) throw new Error(`Output ${outputRef} must reference at least one tombstone`);
      for (const tombstoneId of tombstoneIds) {
        const refs = outputRefsByTombstone.get(tombstoneId) ?? [];
        refs.push(outputRef);
        outputRefsByTombstone.set(tombstoneId, refs);
      }
    };

    for (const memory of input.output.session_memories ?? []) {
      createSessionMemory(db, {
        id: memory.id,
        project_key: input.projectKey,
        provider: input.provider,
        provider_session_id: input.providerSessionId,
        ingest_job_id: input.jobId,
        source_event_refs: memory.source_event_refs,
        memory_kind: memory.memory_kind,
        title: memory.title ?? null,
        summary: memory.summary,
        payload: memory.payload,
        confidence: memory.confidence,
        risk: memory.risk,
        now: input.finalizedAt,
      });
      addOutputRefs(memory.source_event_refs, `session_memories/${memory.id}`);
      sessionMemories += 1;
    }

    for (const candidate of input.output.memory_candidates ?? []) {
      createMemoryCandidate(db, {
        id: candidate.id,
        project_key: input.projectKey,
        scope: candidate.scope,
        status: candidate.status,
        candidate_type: candidate.candidate_type,
        title: candidate.title ?? null,
        summary: candidate.summary,
        source_event_refs: candidate.source_event_refs,
        evidence: candidate.evidence,
        proposed_payload: candidate.proposed_payload,
        confidence: candidate.confidence,
        risk: candidate.risk,
        reason: candidate.reason,
        now: input.finalizedAt,
      });
      addOutputRefs(candidate.source_event_refs, `memory_candidates/${candidate.id}`);
      memoryCandidates += 1;
    }

    for (const handoff of input.output.handoff_instructions ?? []) {
      createHandoffInstruction(db, {
        id: handoff.id,
        target_scope: handoff.target_scope,
        project_key: input.projectKey,
        status: handoff.status,
        objective: handoff.objective,
        prompt_text: handoff.prompt_text,
        source_session_memory_ids: handoff.source_session_memory_ids,
        source_event_refs: handoff.source_event_refs,
        suggested_actions: handoff.suggested_actions,
        reason: handoff.reason,
        confidence: handoff.confidence,
        risk: handoff.risk,
        now: input.finalizedAt,
      });
      addOutputRefs(handoff.source_event_refs, `${handoff.target_scope}_handoff_instructions/${handoff.id}`);
      handoffs += 1;
    }

    for (const [tombstoneId, outputRefs] of outputRefsByTombstone.entries()) {
      finalizeClaimedExperienceEventsInOpenTransaction(db, {
        ingest_job_id: input.jobId,
        tombstone_ids: [tombstoneId],
        finalized_at: input.finalizedAt,
        state: "output",
        terminal_decision: "output",
        output_references: [...new Set(outputRefs)],
      });
    }

    for (const tombstoneId of input.output.no_output_tombstone_ids ?? []) {
      if (outputRefsByTombstone.has(tombstoneId)) {
        throw new Error(`Tombstone ${tombstoneId} cannot be both output and no_output`);
      }
      finalizeClaimedExperienceEventsInOpenTransaction(db, {
        ingest_job_id: input.jobId,
        tombstone_ids: [tombstoneId],
        finalized_at: input.finalizedAt,
        state: "no_output",
        terminal_decision: "no_output",
        output_references: [],
      });
    }

    return { session_memories: sessionMemories, memory_candidates: memoryCandidates, handoff_instructions: handoffs };
  });

  return apply();
}
```

### Task 4: Implement Worker Loop

**Files:**
- Create: `src/ingest/worker.ts`
- Test: `src/ingest/worker.test.ts`

- [ ] **Step 1: Add `runIngestWorker`**

```ts
import { openMemoryDb } from "../memory/db.ts";
import { claimExperienceEvents, finalizeRemainingClaimedExperienceEvents } from "../memory/experience.ts";
import { invokeLlm, type ProcessRunner } from "../runtime/llm-client.ts";
import { updateIngestJobStatus } from "./jobs.ts";

export async function runIngestWorker(input: {
  root: string;
  projectKey: string;
  jobId: string;
  targetRepo: string;
  provider: "codex" | "claude";
  providerSessionId?: string | null;
  limit?: number;
  batchSize?: number;
  now?: () => Date;
  runner?: ProcessRunner;
}): Promise<void> {
  const db = openMemoryDb(input.root);
  const now = input.now ?? (() => new Date());
  let claimedCount = 0;
  try {
    updateIngestJobStatus(db, {
      id: input.jobId,
      status: "running",
      started_at: now().toISOString(),
      updated_at: now().toISOString(),
      provider_session_id: input.providerSessionId ?? null,
    });

    while (input.limit === undefined || claimedCount < input.limit) {
      const remaining = input.limit === undefined ? (input.batchSize ?? 50) : Math.min(input.batchSize ?? 50, input.limit - claimedCount);
      if (remaining <= 0) break;
      const claimed = claimExperienceEvents(db, {
        ingest_job_id: input.jobId,
        project_key: input.projectKey,
        provider_session_id: input.providerSessionId ?? null,
        limit: remaining,
        claimed_at: now().toISOString(),
        tombstone_id_for: (event) => `tomb_${input.jobId}_${event.id}`,
      });
      if (claimed.length === 0) break;
      claimedCount += claimed.length;

      const response = await invokeLlm({
        root: input.root,
        workload: "pipeline",
        provider: input.provider,
        prompt: buildIngestPrompt({ projectKey: input.projectKey, jobId: input.jobId, claimed }),
        cwd: input.targetRepo,
        runner: input.runner,
      });
      applyIngestWorkerOutput(db, {
        projectKey: input.projectKey,
        jobId: input.jobId,
        provider: input.provider,
        providerSessionId: input.providerSessionId ?? null,
        output: parseIngestWorkerOutput(response.response),
        finalizedAt: now().toISOString(),
      });
    }

    const finalized = finalizeRemainingClaimedExperienceEvents(db, {
      ingest_job_id: input.jobId,
      finalized_at: now().toISOString(),
      state: "no_output",
      terminal_decision: "no_output",
    });
    updateIngestJobStatus(db, {
      id: input.jobId,
      status: "completed",
      finished_at: now().toISOString(),
      updated_at: now().toISOString(),
      output_counts: { claimed: claimedCount, auto_no_output: finalized },
    });
  } catch (error) {
    finalizeRemainingClaimedExperienceEvents(db, {
      ingest_job_id: input.jobId,
      finalized_at: now().toISOString(),
      state: "failed",
      terminal_decision: "provider_failed",
    });
    updateIngestJobStatus(db, {
      id: input.jobId,
      status: "failed",
      finished_at: now().toISOString(),
      updated_at: now().toISOString(),
      error: { message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  } finally {
    db.close();
  }
}
```

### Task 5: Add Worker Tests

**Files:**
- Create: `src/ingest/worker.test.ts`

- [ ] **Step 1: Add output application test**

```ts
import type { MemoryDb } from "../memory/db.ts";

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
  const memory = db.query("SELECT id FROM session_memories WHERE id = ?").get("mem_1");
  expect(memory).toEqual({ id: "mem_1" });
});
```

Before using these tests, create required `ingest_jobs` rows in `beforeEach` and add this fixture helper to the test file:

```ts
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
```

- [ ] **Step 2: Add candidate finalization test**

```ts
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
```

- [ ] **Step 3: Add transaction rollback tests**

```ts
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
```

## Verification

- Run: `bun test src/ingest/worker.test.ts`
  - Expected: worker output and failure-finalization tests pass.
- Run: `bun test src/memory/experience.test.ts src/ingest/jobs.test.ts src/memory/session-memories.test.ts src/memory/candidates.test.ts src/memory/handoffs.test.ts src/ingest/worker.test.ts`
  - Expected: integration-adjacent storage/runtime tests pass together.
- Run: `bun run typecheck`
  - Expected: passes.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- The ingest worker runs from target repo cwd through provider invocation.
- The worker claims Experience Log rows in bounded batches.
- The provider decides output shape.
- Myelin writes outputs through repositories and finalizes tombstones.
- Failed provider runs mark claimed tombstones failed.
- V1 uses one worker and no scheduler.

## Risks And Rollback

- Risk: applying outputs and finalizing tombstones can double-finalize a tombstone if provider output references overlap. Add a test for duplicate refs and fail loudly.
- Risk: provider output validation may be too weak. If tests expose bad casts, add Zod validation in `parseIngestWorkerOutput`.
- Rollback: remove `src/ingest/worker.ts` and tests; earlier storage/runtime chunks remain usable.

## Non-Goals

- No top-level CLI start/status commands.
- No multi-agent partition runner.
- No recursive Project/Practice/Personal agents.
- No embeddings or vector retrieval.
- No status/current-briefing integration.

## Type And Name Consistency

Verify `runIngestWorker`, output keys, repository helper names, and tombstone state strings match previous chunks before finalizing.
