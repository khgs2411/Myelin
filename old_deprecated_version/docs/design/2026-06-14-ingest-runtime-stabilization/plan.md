# Ingest Runtime Stabilization Implementation Plan Set

**Spec:** `spec.md`
**Agenda:** `agenda.md`
**Context:** `../../../../CONTEXT.md`
**ADRs:** `../../../adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`
**Status:** Chunk Plans Written

## Goal

Implement the finalized ingest-runtime stabilization design so `myelin ingest <project-key>` uses tombstone-backed lease stubs instead of deleting Experience Log rows before provider output is accepted, exposes precise layered ingest status, moves runtime knobs into a named ingest profile, keeps provider failures compact and recoverable, and verifies the result with tests plus a small real retest before Session Memory query/MCP work resumes.

## Source Artifacts

- `docs/design/2026-06-14-ingest-runtime-stabilization/spec.md`
- `docs/design/2026-06-14-ingest-runtime-stabilization/agenda.md`
- `CONTEXT.md`
- `docs/adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`
- Related prior specs:
  - `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/spec.md`
  - `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/agenda.md`
  - `docs/design/2026-06-13-session-memory-embedding-index/spec.md`
  - `docs/design/2026-06-13-session-memory-embedding-index/agenda.md`
- External design/spec audit:
  - Auditor sub-agent: `019ec746-593b-7701-a78e-ca3023e1567e`
  - Verdict: `Ready for Development`, interpreted as ready to proceed to `$pmp-writing-plans`
- Code paths inspected:
  - `myelin.config`
  - `src/commands/ingest.ts`
  - `src/commands/ingest.test.ts`
  - `src/ingest/jobs.ts`
  - `src/ingest/runtime.ts`
  - `src/ingest/runtime.test.ts`
  - `src/ingest/worker.ts`
  - `src/ingest/worker.test.ts`
  - `src/ingest/worker-output.schema.json`
  - `src/memory/db.ts`
  - `src/memory/db.test.ts`
  - `src/memory/experience.ts`
  - `src/memory/experience.test.ts`
  - `src/memory/ingest-types.ts`
  - `src/memory/migrations.ts`
  - `src/runtime/config.ts`
  - `src/runtime/llm-client.ts`
  - `src/runtime/llm-client.test.ts`
  - `src/runtime/process.ts`
  - `src/runtime/runtime.test.ts`
- Test/validation commands discovered:
  - `bun test`
  - `bun run typecheck`
  - `git diff --check`

## Design Readiness Check

- Source artifact paths verified: Pass.
- Missing or unavailable artifacts: None.
- Open agenda questions or risks: No open agenda questions. Non-blocking risks are assigned below: one-tombstone-per-source retry history, exact numeric completion enum values, and small real retest input availability.
- Spec / agenda / context / ADR consistency: Pass. `CONTEXT.md` and ADR 0056 both reflect tombstone-backed lease stubs and terminal finalization.
- Parent / child spec consistency: Pass with accepted reconciliation. The older Experience Log ingest and Session Memory embedding specs contain stale wording that says rows move to tombstones before provider output; the 2026-06-14 stabilization design supersedes those lifecycle details while preserving their broader product boundaries.
- Accepted planning reconciliations:
  - The 2026-06-13 Session Memory embedding spec sentence that the worker "claims raw `experience_events`, moves them to tombstones" is treated as stale implementation context. This plan assigns docs reconciliation to Chunk 05 and uses the tombstone-backed lease lifecycle for implementation chunks.
  - The current working tree already includes some live hardening changes from the handoff, such as capture suppression, structured output schema support, prompt sizing, DB open retry, staggered worker startup, and process timeout plumbing. This plan treats those as existing uncommitted implementation context that must be preserved and reconciled, not reintroduced blindly.
- Blockers: None.

## Unresolved Decision Ownership

| Item | Type | Owning Chunk | Must Resolve Before | Notes |
| --- | --- | --- | --- | --- |
| Tombstone-backed lease query semantics | Data-integrity risk | `01-tombstone-lease-storage-contracts.md` | Implementation steps in owning chunk | Must exclude already-stubbed rows and use skip-on-conflict semantics for unique `original_event_id` / `dedupe_key` conflicts so concurrent workers do not fail the whole batch. Conflicted rows are skipped for the current lease call and remain visible to the next status/worker pass. |
| Retry/job-history storage for reused stubs | Schema/data-model risk | `01-tombstone-lease-storage-contracts.md` | Implementation steps in owning chunk | Current tombstone rows have JSON fields but no explicit retry history contract. Chunk 01 must choose and test the storage field shape. |
| Worker lifecycle migration from claim/delete to lease/commit | Data-integrity risk | `02-worker-commit-lifecycle.md` | Implementation steps in owning chunk | Current `claimExperienceEvents` deletes rows before the provider call. Chunk 02 must ensure provider failure leaves raw rows present and retryable. |
| Named ingest runtime profile shape | Config/API risk | `03-ingest-runtime-profile.md` | Implementation steps in owning chunk | Must define config/env keys for concurrency, startup delay, timeout, prompt budget, model, and reasoning without broad command-flag sprawl. |
| Layered completion numeric enum values | Naming/status risk | `04-ingest-status-readback.md` | Implementation steps in owning chunk | Numeric enum values are fixed by the plan; Chunk 04 must make every layer reachable: drain pending, drain complete, retrieval pending, and write complete. |
| Status/readback aggregation scope | Operator UX risk | `04-ingest-status-readback.md` | Implementation steps in owning chunk | Current status is job-only. New status must count active rows, lease stubs, jobs, terminal tombstones, generated outputs, and embedding backlog. |
| Stale lifecycle wording in prior docs | Documentation reconciliation | `05-docs-validation-and-retest.md` | Implementation steps in owning chunk | Prior specs should be annotated or reconciled so future agents do not revive pre-provider row deletion. |
| Small real retest input may be unavailable | Verification risk | `05-docs-validation-and-retest.md` | Implementation steps in owning chunk | If no safe newly captured batch exists, run the bounded replay/requeue fixture and record the missing real-batch risk explicitly. |

## Approved Chunks

| Chunk | Purpose | Depends On | Enables | Status |
| --- | --- | --- | --- | --- |
| [`01-tombstone-lease-storage-contracts.md`](plans/01-tombstone-lease-storage-contracts.md) | Add the storage/types/helper contract for tombstone-backed lease stubs, one-tombstone-per-source retry history, unleased row selection, unique-conflict behavior, and terminal commit primitives. Boundary: data lifecycle helpers and tests only; no provider execution changes. | None | [`02-worker-commit-lifecycle.md`](plans/02-worker-commit-lifecycle.md), [`04-ingest-status-readback.md`](plans/04-ingest-status-readback.md), [`05-docs-validation-and-retest.md`](plans/05-docs-validation-and-retest.md) | Written |
| [`02-worker-commit-lifecycle.md`](plans/02-worker-commit-lifecycle.md) | Migrate the ingest worker from pre-provider claim/delete to lease-stub prompt input and atomic output commit: accepted outputs populate/finalize stubs and delete source rows; provider failures leave raw rows present and retryable. Boundary: worker orchestration and output application only. | [`01-tombstone-lease-storage-contracts.md`](plans/01-tombstone-lease-storage-contracts.md) | [`04-ingest-status-readback.md`](plans/04-ingest-status-readback.md), [`05-docs-validation-and-retest.md`](plans/05-docs-validation-and-retest.md) | Written |
| [`03-ingest-runtime-profile.md`](plans/03-ingest-runtime-profile.md) | Define and wire a named ingest runtime profile in config for batch/concurrency/start delay/timeout/prompt budget/model/reasoning, preserving env overrides for debugging. Boundary: config/runtime invocation; no lifecycle semantics. | None | [`04-ingest-status-readback.md`](plans/04-ingest-status-readback.md), [`05-docs-validation-and-retest.md`](plans/05-docs-validation-and-retest.md) | Written |
| [`04-ingest-status-readback.md`](plans/04-ingest-status-readback.md) | Expand ingest status/readback around layered numeric completion codes and project/job counts for active rows, tombstone-backed leases, running jobs, terminal tombstones, outputs, and embedding backlog. Boundary: operator status surfaces and supporting read helpers. | [`01-tombstone-lease-storage-contracts.md`](plans/01-tombstone-lease-storage-contracts.md), [`02-worker-commit-lifecycle.md`](plans/02-worker-commit-lifecycle.md), [`03-ingest-runtime-profile.md`](plans/03-ingest-runtime-profile.md) | [`05-docs-validation-and-retest.md`](plans/05-docs-validation-and-retest.md) | Written |
| [`05-docs-validation-and-retest.md`](plans/05-docs-validation-and-retest.md) | Reconcile stale lifecycle docs, preserve the query/retrieval boundary, run full repo verification, and execute/record the small real retest plus bounded recovery replay fixture when feasible. Boundary: docs, validation, and retest evidence only. | [`01-tombstone-lease-storage-contracts.md`](plans/01-tombstone-lease-storage-contracts.md), [`02-worker-commit-lifecycle.md`](plans/02-worker-commit-lifecycle.md), [`03-ingest-runtime-profile.md`](plans/03-ingest-runtime-profile.md), [`04-ingest-status-readback.md`](plans/04-ingest-status-readback.md) | Execution closeout; safe return to Session Memory indexing/query work | Written |

## Dependency Order

1. `01-tombstone-lease-storage-contracts.md`
2. `02-worker-commit-lifecycle.md`
3. `03-ingest-runtime-profile.md`
4. `04-ingest-status-readback.md`
5. `05-docs-validation-and-retest.md`

Chunk 01 must land before any chunk that depends on row/stub counts or commit behavior. Prefer sequential execution through Chunk 03 even though Chunk 03 does not own storage semantics, because Chunk 02 and Chunk 03 both touch ingest runtime/worker integration surfaces. Status/readback should consume final config names rather than inventing parallel labels.

## Shared Contracts

- Tombstone-backed lease lifecycle:
  - Pulling a row creates or reuses a non-terminal tombstone stub.
  - The source `experience_events` row remains present while provider work is in progress.
  - Terminal commit writes outputs, populates/finalizes the tombstone, and deletes the source row in one transaction.
- Provider failure before accepted output leaves the raw row present and retryable; failed/unfinished outcomes must not use terminal helpers that delete source rows.
- Existing claim/delete compatibility APIs stay unchanged until the worker is migrated in Chunk 02, so Chunk 01 is safe to verify independently.
- Tombstone identity:
  - Preserve one durable tombstone identity per source row through `original_event_id` and `dedupe_key`.
  - Stale-stub recovery reuses the same stub and appends retry/job history.
  - Concurrent lease insert conflicts are skipped for the current lease call and remain visible to the next status/worker pass rather than being treated as product failures.
- Worker prompt/output contract:
  - Provider outputs continue to reference tombstone ids in `source_event_refs`.
  - Prompt evidence is derived from the source row while the stub provides the stable source reference.
  - Structured output schema support remains in place for Codex.
- Config contract:
  - Ingest has a named runtime profile separate from broad `pipeline` and `query` profiles.
  - Env overrides are allowed for local debugging/emergency runs.
  - Command flags should stay sparse; do not add one flag per internal knob unless a chunk proves a concrete operator need.
- Status contract:
  - Human labels are layered: Experience Log drain, Session Memory write, Session Memory retrieval.
  - Code uses a numeric completion enum for those layers.
  - Status must distinguish unleased active rows from in-progress tombstone stubs.
  - Failed jobs are reported as counts; active rows and lease stubs, not failed-job existence alone, keep drain status pending.
- Scope boundary:
  - Session Memory embedding/index/query/MCP work remains out of scope.
  - Project/Practice/Personal promotion agents remain out of scope.
  - No full scheduler, retry daemon, cancellation manager, or multi-agent worker pool in this plan set.

## Spec Coverage Map

| Spec Requirement | Covered By | Notes |
| --- | --- | --- |
| Tombstone-backed lease stubs that keep raw rows present until accepted terminal processing | `01-tombstone-lease-storage-contracts.md`, `02-worker-commit-lifecycle.md` | Data helpers first, worker integration second. |
| Duplicate-prevention through tombstone stubs and one-tombstone-per-source identity | `01-tombstone-lease-storage-contracts.md` | Owns unique conflict and retry-history behavior. |
| Accepted output atomically writes memory outputs, finalizes tombstones, and deletes raw rows | `02-worker-commit-lifecycle.md` | Must update output application transaction and tests. |
| Provider failure leaves raw Experience Log rows present and retryable | `02-worker-commit-lifecycle.md` | Must replace current failure finalization behavior. |
| Runtime controls live in named ingest runtime profile | `03-ingest-runtime-profile.md` | Owns config keys, defaults, parsing, and tests. |
| Capture suppression, structured output schema, prompt sizing, timeout, and DB retry hardening are preserved | `02-worker-commit-lifecycle.md`, `03-ingest-runtime-profile.md`, `05-docs-validation-and-retest.md` | Existing dirty-worktree hardening must not regress. |
| Status/readback separates active rows, tombstone leases, running jobs, terminal tombstones, outputs, and embedding backlog | `04-ingest-status-readback.md` | Treat as a separate deliverable, per audit recommendation. |
| Layered completion labels backed by numeric enum | `04-ingest-status-readback.md` | Uses fixed numeric values and reachable state rules for drain pending, drain complete, retrieval pending, and write complete. |
| Compact durable provider failures with log references | `02-worker-commit-lifecycle.md`, `04-ingest-status-readback.md` | Worker writes compact metadata; status presents it. |
| Small real retest plus bounded recovery replay fixture | `05-docs-validation-and-retest.md` | Must record skipped real-batch risk if fresh safe input is unavailable. |
| Roadmap language marks drain/write progress without implying query/MCP readiness | `04-ingest-status-readback.md`, `05-docs-validation-and-retest.md` | Includes stale prior-spec wording reconciliation. |

## Verification Strategy

- Run targeted Bun tests after each code-changing chunk:
  - `bun test src/memory/experience.test.ts src/memory/db.test.ts`
  - `bun test src/ingest/worker.test.ts` after Chunk 01 to verify compatibility APIs still support the current worker.
  - `bun test src/ingest/worker.test.ts` after Chunk 02 to verify the migrated worker lifecycle.
  - `bun test src/commands/ingest.test.ts`
  - `bun test src/runtime/runtime.test.ts src/runtime/llm-client.test.ts`
- Run broad verification before closeout:
  - `bun test` should pass.
  - `bun run typecheck` should pass.
  - `git diff --check` should produce no output.
- Retest strategy after code verification:
  - Run a small newly captured real ingest batch in a bootstrapped project when safe input exists.
  - Run a bounded replay/requeue fixture for tombstone-stub recovery regression.
  - Record starting counts, terminal counts, command output, and whether Session Memory retrieval remains pending.

## Risks And Sequencing Notes

- Data integrity is the highest risk. Do not change worker behavior before Chunk 01 defines and tests lease-stub selection, conflict handling, terminal population, and retry history.
- Current tests assert that provider failure finalizes claimed tombstones as failed. Those tests must be intentionally replaced with raw-row-present retry behavior; do not preserve the old behavior for compatibility.
- Current `recordExperienceEvent` ignores new rows when any tombstone exists for the same event/dedupe key. Chunk 01 must verify this still behaves correctly when tombstones can be non-terminal stubs.
- Current command start launches one job per batch. Chunk 01 must implement skip-on-conflict lease behavior under concurrent jobs so a unique conflict does not fail the whole batch.
- The Session Memory embedding spec is already approved for a later slice but contains stale lifecycle wording. Chunk 05 must annotate or reconcile that wording before agents return to query/retrieval planning.
- The dirty working tree includes runtime fixes from the live drain. Executors must work with those changes and must not revert them while implementing the finalized lifecycle.

## Execution Handoff

Recommended next skill: `$pmp-executing-plans`.

Execution should load:

- `docs/design/2026-06-14-ingest-runtime-stabilization/plan.md`
- selected chunk plan files under `docs/design/2026-06-14-ingest-runtime-stabilization/plans/` after they are written
- source artifacts listed above

Recommended execution modes:

- execute one chunk
- execute selected chunks
- execute all chunks in dependency order

Execution must stop on unclear plan steps, failed verification, code/spec conflict, missing dependencies, or user-requested changes.

## User Approval

Roadmap was approved by the user before chunk plan generation. Chunk plan files are written and ready for review or execution selection.

## Implementation Validation

Implementation date: 2026-06-15.

Implemented chunks:

- `01-tombstone-lease-storage-contracts.md`: added tombstone-backed lease stubs, skip-on-conflict selection, stale lease recovery, terminal leased finalization, and active/unleased count helpers while preserving legacy claim/delete compatibility APIs.
- `02-worker-commit-lifecycle.md`: migrated the ingest worker to prompt from leased source evidence, commit accepted output/no-output through leased finalization, and keep provider failures retryable with raw rows plus claimed lease stubs intact.
- `03-ingest-runtime-profile.md`: added the named ingest runtime profile for batch size, worker concurrency, start delay, LLM timeout, prompt budget, and ingest model/reasoning profile.
- `04-ingest-status-readback.md`: added numeric completion layers, project-level count aggregation, and `myelin ingest status --project <key> [--json]`.
- `05-docs-validation-and-retest.md`: reconciled stale lifecycle wording in prior specs and AGENTS guidance, and added a bounded replay/requeue recovery fixture.

Verification results:

- `rtk bun test`: pass, 183 tests across 35 files.
- `rtk bun run typecheck`: pass, `tsc --noEmit`.
- `git diff --check`: pass, no output.
- `rtk bun src/cli.ts ingest status --project class-kit --json`: pass. Readback reported `completion_layer: 40`, `completion_label: "Session Memory retrieval pending"`, `active_events: 0`, `unleased_events: 0`, `leased_events: 0`, `running_jobs: 0`, `failed_jobs: 29`, `terminal_tombstones: 1081`, `session_memories: 236`, `memory_candidates: 103`, `handoff_instructions: 43`, and `pending_session_memory_embeddings: 234`.

Retest evidence:

- Bounded replay/requeue fixture passed in `src/memory/experience.test.ts`: it seeds a source row, creates a tombstone-backed lease stub, recovers the same stub for a retry job, records attempt history, commits accepted output, deletes the raw row, and preserves retained evidence/output references.
- Ordinary retry regression passed in `src/ingest/worker.test.ts`: a failed provider run leaves a raw row and claimed stub, then a normal subsequent worker recovers the same tombstone id and commits accepted output.
- Project status stale-PID regression passed in `src/commands/ingest.test.ts`: `myelin ingest status --project <key> --json` refreshes dead running jobs before aggregating `running_jobs` and `failed_jobs`.
- Real small ingest retest was skipped because local `class-kit` status showed no safe newly captured active batch at execution time (`active_events: 0`, `unleased_events: 0`, `leased_events: 0`). Session Memory retrieval remains explicitly pending because embeddings/query retrieval are a later layer.
