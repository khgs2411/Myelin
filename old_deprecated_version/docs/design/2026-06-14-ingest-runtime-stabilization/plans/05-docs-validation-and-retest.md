# Chunk 05: Docs Validation And Retest

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-tombstone-lease-storage-contracts.md`, `02-worker-commit-lifecycle.md`, `03-ingest-runtime-profile.md`, `04-ingest-status-readback.md`
**Enables:** Execution closeout and safe return to Session Memory embedding/query work

## Goal

Close the stabilization implementation by reconciling stale lifecycle wording in related docs, running full repo verification, and recording retest evidence. This chunk must prove the stabilized ingest runtime is ready before Myelin resumes Session Memory indexing/query/MCP work.

## Source Artifacts

- `../spec.md`: Retest Strategy; Product Boundary; Acceptance Criteria.
- `../agenda.md`: Question 5 and Pressure-Test Result.
- `../plan.md`: accepted planning reconciliations and verification strategy.
- Related docs:
  - `../../2026-06-12-experience-log-drain-memory-candidate-queue/spec.md`
  - `../../2026-06-13-session-memory-embedding-index/spec.md`
  - `../../../adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`
  - `../../../../AGENTS.md`
  - `../../../../CONTEXT.md`

## Relationships

- **Depends on:** all code-changing chunks.
- **Enables:** the team can proceed to Session Memory embedding/index/query work with a clean stabilization record.
- **Shared contracts:** tombstone-backed lease lifecycle supersedes old pre-provider row deletion wording; retrieval remains pending until explicit indexing/query work.
- **Integration points:** docs/design specs, ADRs, repo verification commands, real/replay ingest retest.

## File Responsibility Map

**Modify:**
- `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/spec.md` - add a supersession note for tombstone lifecycle only.
- `docs/design/2026-06-13-session-memory-embedding-index/spec.md` - replace or annotate stale claim/delete wording.
- `docs/design/2026-06-14-ingest-runtime-stabilization/plan.md` - update final validation/retest evidence after implementation.
- `AGENTS.md` - update pipeline gotchas if lifecycle wording is stale.

**Test / Verify:**
- Repo test suite and typecheck.
- Small real ingest retest or explicit skipped-real-batch note.
- Bounded replay/requeue recovery fixture.

## Implementation Tasks

### Task 1: Reconcile stale lifecycle wording in prior specs

**Files:**
- Modify: `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/spec.md`
- Modify: `docs/design/2026-06-13-session-memory-embedding-index/spec.md`

- [ ] **Step 1: Add supersession note to 2026-06-12 ingest spec**

Near the `Pull-To-Tombstone Lifecycle` section, add:

```md
Update note: the 2026-06-14 ingest-runtime stabilization design supersedes the original pre-provider claim/delete lifecycle. Current ingest creates tombstone-backed lease stubs while raw Experience Log rows remain in `experience_events`, then populates/finalizes tombstones and deletes raw rows only after accepted terminal processing.
```

- [ ] **Step 2: Reconcile 2026-06-13 embedding spec wording**

Replace the stale sentence:

```md
The worker claims raw `experience_events`, moves them to tombstones, lets a headless provider decide trusted outputs, and writes accepted low-risk outputs through `createSessionMemory` in `src/memory/session-memories.ts`.
```

with:

```md
The worker creates tombstone-backed lease stubs for raw `experience_events`, keeps raw rows present until accepted terminal processing, lets a headless provider decide trusted outputs, and writes accepted low-risk outputs through `createSessionMemory` in `src/memory/session-memories.ts`.
```

- [ ] **Step 3: Search for remaining stale wording**

Run: `rtk grep -n "claims raw\\|moves them to tombstones\\|move.*into tombstones\\|claim/delete" docs AGENTS.md MYELIN.md`
Expected: either no stale matches, or matches explicitly marked as historical/superseded.

### Task 2: Update operator gotchas if needed

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Check current gotcha wording**

Inspect `AGENTS.md` around ingest pipeline gotchas. If it still accurately says workers claim rows atomically, revise it to the new lifecycle:

```md
- Top-level `myelin ingest <key>` counts queued Experience Log rows and launches detached target-repo agents according to the ingest runtime profile. Workers create tombstone-backed lease stubs without deleting raw rows before provider output is accepted; terminal commit finalizes tombstones and archives source rows.
```

Keep the Session Memory vector indexing line unchanged unless implementation changed it.

### Task 3: Run full repo verification

**Files:**
- No planned source edits in this task.

- [ ] **Step 1: Run tests**

Run: `bun test`
Expected: exits 0. The output should report all Bun tests passing.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: exits 0.

- [ ] **Step 3: Run whitespace check**

Run: `git diff --check`
Expected: no output.

If any command fails, stop this chunk and record the failing command, error output, and suspected owning chunk before making further changes.

### Task 4: Run bounded replay/requeue recovery fixture

**Files:**
- Test helpers may be created only if the executor finds no existing way to seed/replay the fixture.

- [ ] **Step 1: Create a local replay scenario through tests or CLI fixture**

Use the implemented helpers to seed:

- one `experience_events` row for a test project
- one tombstone-backed lease stub for that row
- one failed ingest job pointing at the lease

Then recover/retry the same stub and confirm:

- the source row still exists before retry
- the tombstone id remains the same
- retry/job history records the failed attempt
- accepted terminal commit deletes the source row
- terminal tombstone contains retained evidence and output references

Prefer a Bun test if the helper surface is not already covered:

```ts
test("replay fixture recovers stale tombstone stub and commits accepted retry output", () => {
  // seed source row, lease stub, recover same stub to a new job, then finalize output
});
```

Run: `bun test src/memory/experience.test.ts src/ingest/worker.test.ts`
Expected: passes with replay/recovery coverage.

### Task 5: Run small real ingest retest when safe input exists

**Files:**
- Modify: `docs/design/2026-06-14-ingest-runtime-stabilization/plan.md`

- [ ] **Step 1: Check for safe real input**

Use project status:

```bash
bun src/cli.ts ingest status --project class-kit --json
```

Expected: JSON includes counts for active events, leased events, running jobs, terminal tombstones, outputs, and pending embeddings.

If there is a safe small active batch, run:

```bash
bun src/cli.ts ingest class-kit --limit 3 --json
```

Expected: returns one or more job handles and does not block on provider completion.

After jobs finish or status marks them terminal, run:

```bash
bun src/cli.ts ingest status --project class-kit --json
```

Expected:
- active events decrease by the selected count after terminal commit
- leased events return to 0
- terminal tombstones increase by the selected count
- Session Memory retrieval may still be pending

- [ ] **Step 2: If no safe real input exists, record explicit skip**

Add a note to `plan.md` under `Verification Strategy` or `Risks And Sequencing Notes`:

```md
Real small ingest retest was skipped because no safe newly captured active batch was available at execution time. The bounded replay/requeue fixture passed and Session Memory retrieval remains explicitly pending.
```

Do not fabricate a live test result.

### Task 6: Update plan closeout evidence

**Files:**
- Modify: `docs/design/2026-06-14-ingest-runtime-stabilization/plan.md`

- [ ] **Step 1: Add a validation result section**

Append an `## Implementation Validation` section. Use concrete execution dates from the implementation day, record each command's actual pass/fail state, include the bounded replay/requeue fixture result, include the small real ingest retest result or explicit skip reason, and state that Session Memory retrieval remains pending unless a later approved query/index slice completed it.

## Verification

Run: `bun test`
Expected: exits 0.

Run: `bun run typecheck`
Expected: exits 0.

Run: `git diff --check`
Expected: no output.

Run: `bun src/cli.ts ingest status --project class-kit --json`
Expected: valid JSON status if `class-kit` is bootstrapped in the current environment; if not bootstrapped, record the exact error and use the bounded replay fixture as the retest evidence.

## Acceptance Criteria Covered

- Stale lifecycle docs are reconciled.
- Full repo verification passes or failures are surfaced.
- Retest evidence is recorded.
- Session Memory retrieval remains explicitly separate from ingest stabilization.

## Risks And Rollback

- Risk: live retest can mutate local Myelin state. Keep the batch small and record counts before/after.
- Risk: provider credentials or model quota can block live retest. Record this as environment-blocked and do not treat it as product failure if replay fixture passes.
- Rollback: documentation changes can be reverted independently from code; retest evidence should remain if it records a real run.

## Non-Goals

- No new product behavior beyond documentation and validation evidence.
- No Session Memory indexing/query implementation.
- No MCP exposure.
- No automatic creation of Symphony/Trello tasks.

## Type And Name Consistency

Use "tombstone-backed lease stub" consistently for in-progress records and "terminal tombstone" for finalized archive records. Use "Session Memory retrieval pending" when embeddings/query remain incomplete.
