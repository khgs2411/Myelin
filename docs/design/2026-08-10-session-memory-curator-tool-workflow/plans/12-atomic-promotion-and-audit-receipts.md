# Chunk 12: Atomic Promotion, Audit Receipts, And Production Enablement

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Deterministic Validation And Atomic Promotion; Rolling Global Audit
**Status:** Approved for Execution
**Depends on:** Chunks 01–11
**Enables:** Chunks 13–15

## Goal

One trusted finalizer promotes exactly the validated projection and all evidence/audit terminal
effects in one admitted idempotent SQLite transaction, and the complete planning → preparation → coordinator
→ finalizer path becomes the first enabled ordinary production ingest/resume workflow.

## Source Artifacts And Constraints

- Reuse lifecycle/reference/candidate/handoff helpers from `src/session-maintenance/commit.ts`, but
  finalizer is the sole new production owner and must use revision/fence authority.
- Finalization accepts only the projection digest fixed by `running -> finalizing` CAS.
- Recheck active set/revisions/digests, evidence hashes/leases, governing identities, embedding
  contract/coverage, overlay revision, references, and exact coverage immediately before mutation.
- Source tombstones/raw deletion, accepted result, audit receipts, terminal receipt, job completion,
  and project-fence release are in the same transaction. Indexing request is post-commit.
- Finalizer authority is the current project owner/epoch plus exact `finalize_anchor` firewall
  admission. A denied old job/provider return cannot acquire it or partially commit outputs.
- Temporary start/resume blockers are removed only in this chunk, when the Chunk 11 coordinator and
  this finalizer can complete the workflow. A new-format job never dispatches to the legacy one-shot.

## Relationships

- Consumes all prior shared contracts and writes finalization receipts into Chunk 07 authority.
- Produces canonical Session Memory revisions, per-revision audit receipts, terminal tombstones,
  accepted result, and idempotent finalization response.
- Chunk 13 schedules post-commit indexing and future work; Chunk 15 retires older apply owners.

## File Responsibility Map

**Create:**
- `src/session-maintenance/finalization-service.ts` — preflight, finalizing CAS, atomic promotion, replay.
- `src/session-maintenance/audit-receipts.ts` — per-memory revision receipt create/current-coverage read.
- `tests/session-maintenance/finalization-service.test.ts`
- `tests/session-maintenance/audit-receipts.test.ts`

**Modify:**
- `src/memory/migrations.ts` — migration `22`: per-revision audit receipt schema/indexes.
- `src/session-maintenance/commit.ts` — split reusable open-transaction projection apply from old
  workflow ownership; use authoritative revision/fence helpers.
- `src/session-maintenance/result.ts` — durable accepted projection/digest and reference resolution.
- `src/session-maintenance/terminal-receipts.ts` — create/read finalization receipt.
- `src/session-maintenance/job-lifecycle.ts` — finalizing/completed CAS and fence release in commit.
- `src/memory/experience.ts` — exact selected tombstone finalization/raw deletion in caller transaction.
- `src/memory/session-memory-index-service.ts` — idempotent post-commit request boundary.
- `src/session-maintenance/coordinator.ts` — invoke finalizer only for the accepted projection digest.
- `src/ingest/ingest-service.ts` and `src/ingest/ingest-service-contracts.ts` — replace the temporary
  blocker with evidence planning, Chunk 06 preparation, and launch after complete commit.
- `src/ingest/runtime.ts` — detached companion anchor starts the coordinator in target repo and
  supports after-preparation/before-spawn failure injection.
- `src/ingest/worker.ts` — dispatch new-format companion anchors only to coordinator/finalizer;
  retain one-shot execution solely for an already-running legacy job until Chunk 15.
- `src/session-maintenance/recovery-service.ts` — inject the coordinator launcher and enable guarded
  compatible `needs_followup -> running` production resume.

**Test:**
- `tests/memory/experience.test.ts`
- `tests/memory/session-memory-index-service.test.ts`
- `tests/ingest/worker.test.ts`

## Behavioral And Contract Changes

- Finalizer input is `{jobId, ownerEpoch, acceptedProjectionDigest}`; it does not accept arbitrary
  output JSON or re-run provider parsing.
- Preflight and all writes use one `BEGIN IMMEDIATE` transaction after CAS to `finalizing`, with the
  exact project/owner/epoch admission. Any drift
  or validation failure rolls back all effects and records recoverable state outside canonical data.
- A finalization receipt uniquely binds job, accepted digest, output counts/IDs, terminal tombstone
  set, accepted-result digest, and commit time. Same digest replay returns it; different digest fails.
- Audit receipt binds `(memory_id, revision, state_digest)` to policy/output/tool/embedding identities
  and accepted job/projection. Changed revision or governing identity makes it historical.
- Deterministic no-agent intents persisted by Chunk 06 resolve to durable no-output references
  without SMC. This finalizer is their sole tombstone/raw-row terminalization owner; Chunk 05 only
  classified intent and Chunk 06 only copied/leased it.
- Post-commit indexing failure records derived retrieval degradation/retryable work and never rolls
  back canonical memory or falsifies job completion.
- Ordinary start plans evidence, creates one complete anchor transaction, and launches the
  coordinator. Failure after preparation commit/before spawn leaves that same `preparing` job
  recoverable. Compatible resume launches once under a new epoch; neither path falls back to the
  legacy workflow or creates a second job.

## Implementation Tasks

- [ ] Add migration `22` for audit receipts/current-coverage queries and include audit work-set dispositions in the
      projection preflight. Enforce one current receipt per exact identity without deleting history.
- [ ] Implement exhaustive final drift checks and exact-ID preflight, then apply memories,
      lifecycle/context/link changes, candidates/handoffs, revision updates, source tombstones/raw
      deletion, accepted result, audit receipts, finalization receipt, completed phase, and fence
      release atomically.
- [ ] Bind the entire mutation set—including canonical DML, tombstone finalization, raw evidence
      deletion, job completion, and fence release—to one exact admission. Execute the old
      leased/provider-return barrier after firewall activation and prove the terminal-tombstone
      denial rolls its indirect output transaction back.
- [ ] Implement commit-before-ack recovery: receipt lookup precedes any tombstone/canonical replay;
      same digest returns the stored receipt, different digest rejects.
- [ ] Race finalization against explicit abandonment under separate connections; job phase/epoch CAS
      and Chunk 07's unique terminal receipt must permit exactly one terminal commit and no mixed
      lease/fence effects.
- [ ] Move indexing request after commit and add injected failure tests at every canonical effect,
      immediately before commit, and after commit before response.
- [ ] Replace both start/resume availability blockers in this same accepted change: wire
      `IngestService` through Chunk 05 planning and Chunk 06 preparation, dispatch companion jobs
      through the Chunk 11 coordinator and this finalizer, and supply that launcher to recovery.
- [ ] Inject failure after preparation commit/before spawn and after spawn/before acknowledgement.
      Prove same-job recovery, one resume launch, stale-epoch rejection, no second job, and no call to
      the legacy one-shot function for companion work.

## Verification

- `bun test tests/session-maintenance/finalization-service.test.ts tests/session-maintenance/audit-receipts.test.ts tests/session-maintenance/recovery-service.test.ts tests/memory/experience.test.ts tests/memory/session-memory-index-service.test.ts tests/ingest/ingest-service.test.ts tests/ingest/runtime.test.ts tests/ingest/worker.test.ts`
  — admission-bound atomic rollback, denied old-provider-return rollback, receipt replay, drift
  rejection, audit invalidation, no-agent rows, and indexing
  independence pass; one ordinary start reaches the coordinator and receipt-backed completion, and
  one compatible resume launches exactly once and reaches the same terminal contract.
- `bun test tests/memory/db.test.ts` — success records migration row `22`; injected failure leaves no
  version-22 row/audit table, foreign-key check is empty, and integrity is `ok`.
- `bun run typecheck` — exits 0.
- `git diff --check` — exits 0.

## Acceptance Criteria Covered

- Canonical promotion and terminal evidence handling are all-or-nothing.
- Old or permanently denied owners cannot partially apply after returning from provider execution.
- Finalization replay is safe after lost acknowledgement.
- Audit progress is proven per exact current memory revision.
- Derived indexing cannot roll trusted memory back.
- Ordinary production start/resume is enabled only with a complete coordinator-plus-finalizer target.

## Risks, Rollback, And Isolation

- This is the canonical trust boundary. Do not split writes into nested transactions/connections or
  emit a success artifact before commit.
- On failure, leave the job/fence recoverable; never compensate by deleting accepted canonical rows.

## Non-Goals

- Redesigned trigger eligibility, CLI formatting, or retirement of the already-running legacy
  compatibility entrypoint.

## Consistency Check

- Verify every projection reference has a durable final result resolver, including keep dispositions.
- Verify every canonical writer uses the current project owner epoch and revision helper.
- Verify every protected finalizer statement is covered by the Chunk 01 matrix and exact admission.
- Verify terminal receipt digest/schema exactly matches Chunk 07/08 cleanup expectations.
- Verify no companion anchor can reach `runSessionMemoryMaintenanceWorkflow`, and no production
  start/resume bypasses planning, complete preparation, coordinator, or finalizer.

## Execution Notes

### 2026-08-11: Accepted Implementation

- Independent review accepted the finalizer's single admitted transaction over canonical revisions,
  lifecycle/context/link writes, candidates/handoffs, exact evidence terminalization, raw deletion,
  accepted result, audit and terminal receipts, job completion, and fence release.
- Finalization reuses recovery's exhaustive frozen-state validator inside `BEGIN IMMEDIATE` before
  CAS or effects, including full evidence, memory, normalized text, vector, retrieval, coverage, and
  snapshot identities.
- Migration 22 audit receipts reference the retained anchor job, allowing forensic cleanup to remove
  manifests/details while preserving compact audit and terminal proof with clean FKs.
- Runtime SMC budgets are all-or-nothing with no inferred defaults. This repository supplies explicit
  3 evidence and 8 workflow budget overrides; registered manual, automatic, and resume composition
  launches the same companion coordinator/finalizer job and never falls back to the legacy one-shot.
- Final independent gates passed 116 plan/production/cleanup tests, 47 migration/firewall/fence/
  abandonment/terminal tests, TypeScript typecheck, and `git diff --check`.
