# Chunk 07: Overlay, Journal, And Receipt Persistence

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Trusted Coordinator And Overlay; Data And State
**Status:** Approved for Execution
**Depends on:** Chunks 04, 05, 06
**Enables:** Chunks 08–15

## Goal

Accepted noncanonical work is restart-safe through a revisioned overlay and append-only action
journal, with one shared terminal-receipt authority that gates forensic cleanup.

## Source Artifacts And Constraints

- Provider-native conversation state and filesystem artifacts are not authoritative.
- Every action/result carries job, batch, attempt, sequence, owner epoch, protocol version, request
  digest, expected overlay revision, and result digest.
- Same idempotency key/same request digest replays the recorded result; the same key/different digest
  fails closed.
- Overlay state is proposal-only and must not write canonical memory, tombstones, candidates, or
  handoffs.
- This chunk defines both finalization and abandonment receipt schema/predicate; Chunk 08 writes
  abandonment receipts and Chunk 12 writes finalization receipts.
- Tests create valid prepared anchors by calling Chunk 06's trusted preparation service directly;
  production ingest remains `smc_preparation_not_available` and launches nothing through Chunk 11.

## Relationships

- Uses ready manifests/snapshots and current owner epochs.
- Produces `SMCOverlayRevision`, `SMCJournalEntry`, coverage receipt persistence, budget grants, and
  `SMCTerminalReceipt` for Chunks 08–15.
- Chunk 09 supplies query-receipt contents; this chunk supplies their durable storage boundary.

## File Responsibility Map

**Create:**
- `src/session-maintenance/overlay-store.ts` — revisioned staged records/dispositions, stable IDs, and
  CAS mutation.
- `src/session-maintenance/action-journal.ts` — append/replay semantics and digest validation.
- `src/session-maintenance/coverage-receipts.ts` — work-set/query receipt storage primitives.
- `src/session-maintenance/terminal-receipts.ts` — shared receipt schema, digest validation, and
  cleanup-eligibility predicate.
- `tests/session-maintenance/overlay-store.test.ts`
- `tests/session-maintenance/action-journal.test.ts`
- `tests/session-maintenance/terminal-receipts.test.ts`

**Modify:**
- `src/memory/migrations.ts` — migration `21`: overlay revision/records, journal, coverage receipts,
  budget grants, and terminal receipt tables/indexes.
- `src/session-maintenance/manifest.ts` — expose frozen budgets and current overlay identity.
- `src/memory/ingest-types.ts` — shared staged/receipt row types where they cross service boundaries.

**Test:**
- `tests/memory/db.test.ts`

## Behavioral And Contract Changes

- Overlay revision begins at `0`; an accepted mutation supplies `expected_revision` and atomically
  writes a full delta plus revision `n+1` and response digest.
- Staged IDs are deterministic/job-scoped and remain stable through final ID mapping. Retraction and
  supersession mask base records in later views without changing canonical rows.
- Journal uniqueness is `(job_id, work_batch_id, attempt_id, sequence)`. Results are recorded before
  being returned to any provider adapter.
- Budget grants are additive, operator-attributed, epoch/digest guarded journal records; they do not
  alter manifest evidence or snapshot identities.
- `SMCTerminalReceipt` belongs to `session_memory_anchor_jobs` and permits at most one terminal
  receipt per `job_id` (primary/unique job key). It has discriminated terminal kind
  `finalization|abandonment` and basis kind `smc_manifest|legacy_quarantine`, a non-null basis digest,
  target-owner epoch, authoritative result/receipt digests, created time, and schema version.
  Finalization requires an SMC-manifest basis; abandonment may use either exact basis. Job-phase and
  target-epoch CAS plus the unique job key jointly prevent dual terminal kinds. Cleanup requires a
  valid receipt and elapsed configured retention; job phase alone is insufficient.

## Implementation Tasks

- [ ] Add migration `21` with normalized overlay/journal/receipt schema and constraints preventing
      two accepted revisions or more than one terminal receipt of any kind for one job.
- [ ] Replace global Experience tombstone source/dedupe uniqueness with partial uniqueness for
      `state='claimed'`, preserving terminal history while permitting one fresh lease after explicit
      abandonment. Raw replay reconciliation treats only `output|no_output` as consumed.
- [ ] Implement overlay CAS and stable staged-ID mapping for memory, lifecycle dispositions,
      candidates, handoffs, source dispositions, and accepted batch digests. Ensure read views can
      reconstruct any accepted revision needed by journal replay.
- [ ] Implement journal append/replay: validate owner epoch and manifest identities, return stored
      result for exact replay, and return `journal_idempotency_conflict` for changed content.
- [ ] Define the shared terminal receipt parser/digest and `isForensicCleanupEligible` predicate.
      Prove phase-only, malformed, mismatched-digest, and premature rows never authorize cleanup.

## Verification

- `bun test tests/session-maintenance/overlay-store.test.ts tests/session-maintenance/action-journal.test.ts tests/session-maintenance/terminal-receipts.test.ts tests/memory/db.test.ts`
  — CAS, replay, conflict, restart reconstruction, receipt uniqueness, and cleanup denial pass.
- `bun test tests/ingest/ingest-service.test.ts tests/ingest/runtime.test.ts` — production start returns
  `smc_preparation_not_available`, persists no new anchor, and launches no PID.
- In `tests/memory/db.test.ts`, success records migration row `21`; injected failure leaves no
  version-21 row/new tables, foreign-key check is empty, and integrity is `ok`.
- `bun run typecheck` — exits 0.
- `git diff --check` — exits 0.

## Acceptance Criteria Covered

- Later batches can observe earlier accepted staged proposals without canonical publication.
- Resume correctness does not depend on provider conversation memory.
- Cleanup cannot precede a durable finalization or abandonment receipt.

## Risks, Rollback, And Isolation

- A journal result must never be returned before durable append; inject failure between execution and
  response in tests.
- These tables are noncanonical. Rollback removes no canonical/evidence rows and leaves the anchor
  blocked rather than pretending completion.

## Non-Goals

- Query algorithms, proposal semantics, canonical finalization, or cleanup execution.

## Consistency Check

- Verify journal and overlay foreign keys preserve job/attempt/batch identities from Chunks 04–05.
- Verify terminal-receipt names/digests match Chunks 08 and 12 exactly.
- Verify a finalization-versus-abandonment race can commit at most one receipt/terminal phase and the
  loser receives the persisted terminal result or a stable conflicting-terminal error.
- Verify no overlay helper imports canonical writer modules.

## Execution Notes

### 2026-08-11: Chunk Accepted

- Independent review accepted the migration-21 overlay, journal, coverage/grant, and shared terminal
  receipt boundaries after all batch-bearing rows gained composite job/batch foreign keys.
- Durable replay now validates canonical request/result envelopes and digests; overlay revisions are
  reconstructable without canonical mutation, and cleanup remains receipt- and retention-gated.
- Verification passed: 30 focused tests, 22 production-blocker tests, `bun run typecheck`, and
  `git diff --check`.

### 2026-08-11: Shared Receipt Contract Reopened By Chunk 08

- Pressure testing found that manifest-less quarantined legacy anchors could not use the shared
  receipt table. Migration 21 is corrected before release because the only durable database remains
  at schema 15.
- Terminal receipts now bind a typed manifest or legacy-quarantine basis to the anchor lifecycle;
  claimed-only tombstone uniqueness preserves abandoned history while allowing a later fresh lease.

### 2026-08-11: Shared Contract Re-Accepted

- Chunk 08's independent review accepted the corrected anchor-owned receipt schema, partial active
  lease uniqueness, and genesis-rooted overlay revision digest chain.
- The overlay chain binds batch, attempt, epoch, response/delta digests, parent identity, and
  materialized records; valid-digest substitution now fails reconstruction and resume.
