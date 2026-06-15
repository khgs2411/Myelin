# Chunk 02: Worker Commit Lifecycle

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-tombstone-lease-storage-contracts.md`
**Enables:** `04-ingest-status-readback.md`, `05-docs-validation-and-retest.md`

## Goal

Migrate the ingest worker from pre-provider row deletion to tombstone-backed lease stubs. The worker should prompt from active source-row evidence, accept provider output referencing tombstone ids, commit accepted output plus terminal tombstone population atomically, and leave raw Experience Log rows present and retryable on provider failure or invalid output.

## Source Artifacts

- `../spec.md`: Runtime Safety Envelope; Tombstone-Backed Lease Then Commit Model; Output Failure Compaction; Testing Strategy.
- `../agenda.md`: Questions 1, 4, 6, and 7.
- `../../../adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`.
- Chunk 01 completed contracts: `leaseExperienceEvents`, `LeasedExperienceEvent`, `finalizeLeasedExperienceEventsInOpenTransaction`, `finalizeRemainingLeasedExperienceEvents`.
- Code paths: `src/ingest/worker.ts`, `src/ingest/worker.test.ts`, `src/memory/experience.ts`, `src/commands/ingest.test.ts`.

## Relationships

- **Depends on:** Chunk 01 lease-stub helpers and count helpers.
- **Enables:** Status/readback can trust that failed provider runs leave source rows present.
- **Shared contracts:** provider `source_event_refs` continue to reference tombstone ids; `no_output_tombstone_ids` references terminal no-output leases.
- **Integration points:** `invokeLlm`, `worker-output.schema.json`, Session Memory/candidate/handoff repositories, ingest job status.

## File Responsibility Map

**Modify:**
- `src/ingest/worker.ts` - use lease helper, prompt from `LeasedExperienceEvent`, commit via terminal helper, preserve raw rows on failures.
- `src/ingest/worker-output.schema.json` - keep schema aligned if output wording changes; no new fields expected.

**Test:**
- `src/ingest/worker.test.ts` - lifecycle migration, provider failure, invalid output, no-output terminalization.
- `src/commands/ingest.test.ts` - update stale expectations around dead detached worker finalization if status behavior depends on worker lifecycle.

## Implementation Tasks

### Task 1: Update worker tests for lease/commit lifecycle

**Files:**
- Modify: `src/ingest/worker.test.ts`

- [ ] **Step 1: Change success-path expectations**

In `worker claims batches from target repo cwd and completes when queue is empty`, keep the current provider/output assertions, then assert terminal commit:

```ts
expect(listExperienceEvents(db, "class-kit")).toEqual([]);
expect(db.query("SELECT state, retained_evidence_json FROM experience_event_tombstones WHERE id = ?").get("tomb_job_1_evt_1")).toMatchObject({
  state: "output",
});
```

- [ ] **Step 2: Replace provider-failure tombstone finalization expectation**

Change the provider failure test to assert raw rows remain present and the tombstone stub remains retryable:

```ts
expect(listExperienceEvents(db, "class-kit").map((row) => row.id)).toEqual(["evt_1"]);
expect(db.query("SELECT state, finalized_at, terminal_decision FROM experience_event_tombstones WHERE id = ?").get("tomb_job_1_evt_1")).toEqual({
  state: "claimed",
  finalized_at: null,
  terminal_decision: null,
});
expect(getIngestJob(db, "job_1")?.status).toBe("failed");
```

- [ ] **Step 3: Replace invalid-output failure expectation**

In `worker rejects invalid provider output before durable memory writes`, assert no memory writes and retryable row/stub:

```ts
expect(listExperienceEvents(db, "class-kit").map((row) => row.id)).toEqual(["evt_1"]);
expect(db.query("SELECT state, terminal_decision FROM experience_event_tombstones WHERE id = ?").get("tomb_job_1_evt_1")).toEqual({
  state: "claimed",
  terminal_decision: null,
});
```

- [ ] **Step 4: Add no-output commit test**

```ts
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
```

- [ ] **Step 5: Run focused tests**

Run: `bun test src/ingest/worker.test.ts`
Expected: fails until worker imports and commit logic are updated.

### Task 2: Prompt from leased source evidence

**Files:**
- Modify: `src/ingest/worker.ts`

- [ ] **Step 1: Replace imports**

```ts
import type { LeasedExperienceEvent } from "../memory/experience.ts";
import {
  leaseExperienceEvents,
  finalizeLeasedExperienceEventsInOpenTransaction,
  finalizeRemainingLeasedExperienceEvents,
} from "../memory/experience.ts";
```

Remove direct use of `claimExperienceEvents` and `finalizeRemainingClaimedExperienceEvents` in worker failure paths.

- [ ] **Step 2: Update prompt types and text**

Change `buildIngestPrompt` input from `claimed: ClaimedExperienceTombstone[]` to:

```ts
export function buildIngestPrompt(input: {
  projectKey: string;
  jobId: string;
  leased: LeasedExperienceEvent[];
  batchIndex?: number;
  batchCount?: number;
}): string {
```

Change the prompt label and mapping:

```ts
"Leased Experience Log rows:",
JSON.stringify(input.leased.map(leaseForPrompt), null, 2),
```

Add:

```ts
function leaseForPrompt(lease: LeasedExperienceEvent): JsonObject {
  const evidence = JSON.stringify(lease.prompt_evidence);
  const promptEvidence =
    evidence.length <= MAX_PROMPT_RETAINED_EVIDENCE_CHARS
      ? lease.prompt_evidence
      : {
          raw_text: lease.prompt_evidence.raw_text,
          raw_payload_json: `${lease.prompt_evidence.raw_payload_json.slice(0, MAX_PROMPT_RETAINED_EVIDENCE_CHARS)}${TRUNCATED_EVIDENCE_SUFFIX}`,
        };
  return {
    id: lease.id,
    original_event_id: lease.original_event_id,
    project_key: lease.project_key,
    ingest_job_id: lease.ingest_job_id,
    provider: lease.provider,
    provider_session_id: lease.provider_session_id,
    claimed_at: lease.claimed_at,
    state: lease.state,
    source_metadata_json: lease.source_metadata_json,
    prompt_evidence: promptEvidence,
  };
}
```

Keep output instructions saying `source_event_refs` must reference tombstone ids.

### Task 3: Lease rows instead of claim/delete

**Files:**
- Modify: `src/ingest/worker.ts`

- [ ] **Step 1: Replace lease call**

Inside `runIngestWorker`, replace `claimExperienceEvents` with:

```ts
const leased = leaseExperienceEvents(db, {
  ingest_job_id: input.jobId,
  project_key: input.projectKey,
  provider_session_id: input.providerSessionId ?? null,
  limit: remaining,
  max_prompt_chars: input.maxPromptChars ?? DEFAULT_INGEST_PROMPT_CHAR_LIMIT,
  prompt_chars_for_lease: (lease) => JSON.stringify(leaseForPrompt(lease), null, 2).length,
  claimed_at: claimedAt,
  tombstone_id_for: (event) => `tomb_${input.jobId}_${event.id}`,
});
if (leased.length === 0) break;
claimedCount += leased.length;
```

Use `leased` in `buildIngestPrompt`.

### Task 4: Commit outputs through terminal lease finalization

**Files:**
- Modify: `src/ingest/worker.ts`

- [ ] **Step 1: Replace finalizer calls in `applyIngestWorkerOutput`**

Replace every call to `finalizeClaimedExperienceEventsInOpenTransaction` with `finalizeLeasedExperienceEventsInOpenTransaction`.

The existing transaction boundary in `applyIngestWorkerOutput` must remain: memory/candidate/handoff writes and tombstone finalization happen in one transaction.

- [ ] **Step 2: Preserve no-output terminalization**

No-output refs should call:

```ts
finalizeLeasedExperienceEventsInOpenTransaction(db, {
  ingest_job_id: input.jobId,
  tombstone_ids: [tombstoneId],
  finalized_at: input.finalizedAt,
  state: "no_output",
  terminal_decision: "no_output",
  output_references: [],
});
```

### Task 5: Keep provider failures retryable

**Files:**
- Modify: `src/ingest/worker.ts`

- [ ] **Step 1: Remove failure-time finalization**

In the `catch` block, delete the call that finalizes remaining claimed rows as failed. Keep job status failure and compact error metadata:

```ts
updateIngestJobStatus(db, {
  id: input.jobId,
  status: "failed",
  finished_at: now().toISOString(),
  updated_at: now().toISOString(),
  error: { message: compactIngestWorkerError(error), retryable: true },
});
throw error;
```

- [ ] **Step 2: Adjust completed-job auto no-output**

Keep finalizing remaining leases as `no_output` only after the provider loop exits normally:

```ts
const finalized = finalizeRemainingLeasedExperienceEvents(db, {
  ingest_job_id: input.jobId,
  finalized_at: now().toISOString(),
  state: "no_output",
  terminal_decision: "no_output",
});
```

Use the `finalizeRemainingLeasedExperienceEvents` helper created in Chunk 01.

### Task 6: Update command status stale-worker expectation

**Files:**
- Modify: `src/commands/ingest.test.ts`
- Modify: `src/ingest/runtime.ts`

- [ ] **Step 1: Change detached dead-worker status behavior**

`refreshDetachedIngestJobStatus` should mark the job failed but should not finalize tombstone stubs as failed. Remove the call to `finalizeRemainingClaimedExperienceEvents`.

Tests for this path should seed retryable tombstone leases through `leaseExperienceEvents`, not `claimExperienceEvents`, so the assertion that `experience_events` still contains the source row is testing the intended new lifecycle.

Expected test assertion:

```ts
expect(
  readDb
    .query("SELECT COUNT(*) AS count FROM experience_event_tombstones WHERE ingest_job_id = ? AND state = 'claimed'")
    .get(jobId),
).toEqual({ count: 1 });
expect(readDb.query("SELECT id FROM experience_events WHERE id = ?").get("evt_1")).toEqual({ id: "evt_1" });
```

### Verification

Run: `bun test src/ingest/worker.test.ts`
Expected: passes.

Run: `bun test src/commands/ingest.test.ts src/ingest/runtime.test.ts`
Expected: passes with dead-worker status preserving retryable stubs.

Run: `bun run typecheck`
Expected: exits 0.

Run: `git diff --check`
Expected: no output.

## Acceptance Criteria Covered

- Worker creates tombstone stubs but does not delete raw rows before provider output.
- Accepted output finalizes tombstones and deletes raw rows atomically.
- Provider failure and invalid output leave source rows present and retryable.
- Structured output schema, prompt sizing, compact failure metadata, and capture suppression remain intact.

## Risks And Rollback

- Risk: prompt contract changes from "claimed tombstones" to "leased rows" may reduce provider output quality. Keep tombstone ids stable in examples and instructions.
- Risk: keeping stubs claimed after provider failure requires later recovery/status behavior. Chunk 04 owns operator readback; Chunk 01 owns retry-history helper.
- Rollback: revert this chunk while preserving Chunk 01 helpers if worker migration fails.

## Non-Goals

- No runtime profile config changes.
- No expanded status output beyond tests required to preserve retryable stubs.
- No Session Memory indexing/query work.

## Type And Name Consistency

Use `leased` / `LeasedExperienceEvent` in worker internals, but keep provider-facing `source_event_refs` as tombstone ids.
