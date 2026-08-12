# Chunk 02: Project Mutation Fence Adoption

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Trusted Coordinator And Overlay, Failure And Recovery Behavior
**Status:** Approved for Execution
**Depends on:** Chunk 01
**Enables:** Chunks 03–15

## Goal

Bind every project-scoped Session mutation to both the accepted project owner/epoch and Chunk 01's
narrow SQLite write admission. `legacy_compatibility` permits only current-runtime compatibility
code under admission; it never restores old-binary write access.

## Source Artifacts And Constraints

- Use the firewall, admission, and revision-aware writers accepted in Chunk 01.
- The fence covers ingest preparation/resume/finalize/abandon, repair, payload/lifecycle/context/link
  writes, and future canonical Session writers.
- `src/ingest/ingest-service.ts` currently checks `starting|running` application-side; that check is
  not authoritative.
- The Session-scope global fence is introduced in Chunk 03; this chunk exposes atomic admission hooks
  for reciprocal integration without fabricating the global row early.
- Timed expiry detects stale ownership but never transfers work to a different job.
- Migration version `17` creates the project fence/authority-mode schema. It does not reopen the
  migration-16 firewall. Current compatibility owners still mint exact admissions internally.

## Relationships

- Consumes `SessionMemoryRevisionIdentity` from Chunk 01.
- Produces `ProjectSessionMutationFence` and an opaque DB/project/owner/epoch authority whose
  transaction adapter mints one exact `SessionMemoryWriteAdmission`.
- `LegacySessionMutationAuthority` means current-runtime compatibility authority only and is never
  serializable, cloneable, or public. Chunk 04 adds the permanent-deny assertion before activation.
- Chunk 03 extends fence acquisition with reciprocal global-fence admission in the same transaction.

## File Responsibility Map

**Create:**
- `src/memory/project-session-mutation-fence.ts` — project fence acquisition, CAS transition,
  heartbeat, authority assertion, release, and inspection.
- `tests/helpers/session-mutation-authority.ts` — test-only helper that opens an explicit bounded
  owner; it cannot bypass active-mode fence checks.
- `tests/memory/project-session-mutation-fence.test.ts` — concurrency and stale-epoch coverage.

**Modify:**
- `src/memory/migrations.ts` — migration `17`: create the dormant project-fence table,
  uniqueness/phase constraints, and authority-mode row defaulting to `legacy_compatibility`.
- `src/memory/ingest-types.ts` — shared fence phase/row types.
- `src/ingest/ingest-service.ts` — pass explicit legacy or fenced authority according to the durable
  mode; do not activate fence admission yet.
- `src/memory/session-memories.ts`, `session-memory-contexts.ts`, `session-memory-links.ts` — require
  current project mutation authority for non-migration writes.
- `src/memory/session-memory-repair-service.ts` — acquire a bounded repair owner and release it only
  after its transaction finishes.
- `src/session-maintenance/commit.ts` — the trusted projection apply path proves current authority;
  the compatibility output owner is retired by Chunk 15.
- `src/ingest/worker.ts` — the coordinator/finalizer worker carries explicit authority and cannot
  call canonical helpers without it; the legacy `applyIngestWorkerOutput` path is retired by Chunk 15.

**Test:**
- `tests/ingest/ingest-service.test.ts`
- `tests/memory/session-memory-repair-service.test.ts`
- `tests/memory/session-memories.test.ts`
- `tests/ingest/worker.test.ts`
- `tests/commands/memory.test.ts`
- `tests/maintenance/auto-memory-maintenance.test.ts`
- `tests/memory/embedding-contract-lifecycle-service.test.ts`
- `tests/memory/session-current-continuity.test.ts`
- `tests/memory/session-memory-index-service.test.ts`
- `tests/memory/session-memory-indexer.test.ts`
- `tests/memory/session-memory-query.test.ts`
- `tests/memory/sqlite-vec.test.ts`
- `tests/project/project-memory-packet.test.ts`
- `tests/query/memory-quality-eval.test.ts`
- `tests/status/embedding-retrieval-status.test.ts`

## Behavioral And Contract Changes

- One row per project stores `project_key`, `owner_id`, `owner_kind`, `phase`, `owner_epoch`,
  `heartbeat_at`, `acquired_at`, and nullable terminal-receipt identity.
- In active mode, acquire uses `BEGIN IMMEDIATE`; an occupied fence returns a stable
  `session_memory_project_busy` result carrying safe owner metadata, never raw evidence. In dormant
  mode, acquisition returns `session_memory_authority_not_activated` and cannot create a fence row.
- Fenced mutation authority is opaque and DB-bound to `{projectKey, ownerId, ownerEpoch}`. Every
  write verifies the fence/mode and creates its exact uncommitted firewall admission in the same
  transaction. Legacy authority is issued only to the current runtime after checking mode and
  DB identity; old binaries and replayed capabilities fail. Chunk 04 adds deny-row verification.
- Heartbeat and phase changes are CAS operations over project, owner, prior phase, and epoch. Release
  requires a qualifying terminal transition; deletion by timeout is forbidden.
- Direct helper calls without authority fail closed. Migration-only backfill is the sole explicit
  bypass and is not exported as a runtime mutation option. Chunk 02's accepted repository remains in
  legacy mode and therefore makes no premature fence-authority claim.

## Implementation Tasks

- [ ] Add migration `17`, the durable authority-mode read, and dormant fence primitives. Use affected-
      row counts plus a reread to distinguish inactive mode, stale epoch, wrong phase, and owner.
- [ ] Integrate project authority with Chunk 01 admission minting: bind DB identity, operation,
      project, owner, epoch, and allowed phase. Reject clone/spread/cross-DB/stale/paused authorities;
      `needs_followup` cannot mutate until resume appends a fresh attempt/epoch in Chunk 04/08.
- [ ] Introduce the required authority union on canonical mutation helpers and adapt every production
      caller, including `applyIngestWorkerOutput`, current compatibility commit, repair, and ingest.
      Current-runtime compatibility capability construction must be internal, transaction-bound,
      and mode-checked; expose only the internal assertion seam Chunk 04 will extend with deny rows.
- [ ] Update every compiled direct-caller test identified in the File Responsibility Map to use the
      explicit test owner helper. Add a source/call-site inventory assertion so newly added direct
      callers cannot bypass authority silently.
- [ ] Add deterministic two-connection race tests for competing starts, repair versus ingest,
      heartbeat/phase CAS, delayed stale-epoch writes, dormant-mode refusal, post-activation legacy
      rejection fixtures, and transaction rollback. Actual activation is exercised in Chunk 04.

## Verification

- `bun test tests/memory/project-session-mutation-fence.test.ts tests/ingest/ingest-service.test.ts tests/ingest/worker.test.ts tests/memory/session-memory-repair-service.test.ts tests/memory/session-memories.test.ts tests/commands/memory.test.ts tests/maintenance/auto-memory-maintenance.test.ts tests/memory/embedding-contract-lifecycle-service.test.ts tests/memory/session-current-continuity.test.ts tests/memory/session-memory-index-service.test.ts tests/memory/session-memory-indexer.test.ts tests/memory/session-memory-query.test.ts tests/memory/sqlite-vec.test.ts tests/project/project-memory-packet.test.ts tests/query/memory-quality-eval.test.ts tests/status/embedding-retrieval-status.test.ts`
  — all callers carry authority plus exact admission; current-runtime compatibility works; old,
  stale, cloned, paused, and cross-DB owners fail. Chunk 04 owns permanently denied owners.
- `bun test tests/memory/db.test.ts` — migration row `17` exists on success with authority mode
  `legacy_compatibility`; injected failure leaves no version-17 row or partially active fence schema.
- `bun run typecheck` — exits 0; all canonical writer call sites carry authority.
- `git diff --check` — exits 0.

## Acceptance Criteria Covered

- Complete authority-plus-admission call-site adoption before activation.
- Project CAS primitives are ready for Chunk 04; the migration-16 firewall already excludes old
  runtime writes regardless of process timing.
- Active-mode fixtures prove delayed old workers cannot write after recovery.

## Risks, Rollback, And Isolation

- Partial adoption would leave an unfenced writer. The chunk is accepted only after a direct-SQL and
  call-site search shows all runtime writers are covered.
- On migration rollback, the new ingestion path must remain inactive; existing canonical rows and
  revision identities remain intact.

## Non-Goals

- Authority-mode activation, scope-global embedding lifecycle ownership, permanent-deny assignment,
  stale-job resume policy, or
  overlay state.

## Consistency Check

- Search runtime code for `INSERT|UPDATE|DELETE` against the three canonical Session tables and
  account for every result.
- Search production and tests for all canonical helper calls and account for every authority source,
  including the compiled legacy apply export.
- Confirm project-fence phases used here are compatible with Chunk 04's authoritative anchor phases.
- Confirm no public caller can forge migration bypass authority.
- Confirm `legacy_compatibility` never disables firewall triggers or admits an old job identity.

## Execution Notes

### 2026-08-11: Reopened Chunk Accepted

- The accepted firewall bridge now binds canonical writes to durable project owner/epoch/phase.
  Repair is writable only in `running`; anchor canonical writes are writable only in `finalizing`.
  Migration 17 independently validates the same admission identity.
- Independent review accepted the reconciliation. Focused root verification: 55 tests, 375
  assertions, zero failures; `git diff --check` passed. Remaining typecheck and broader workflow
  failures are confined to partial Chunk 04 and later planned slices.

### 2026-08-11: Reopened By Approved Migration Correction

- Preserve the previously accepted opaque WeakMap/DB-bound authority and epoch behavior, but bind
  every protected mutation to Chunk 01's exact SQLite admission. Re-review the combined boundary.

### 2026-08-11: Accepted Local Drift

- **Planned shape:** The file map names canonical leaf writers, compatibility commit/apply, repair,
  and ingest service, but omits `src/memory/session-memory-revisions.ts`,
  `src/session-maintenance/workflow.ts`, and the corresponding revision/raw-SQL fixture tests.
- **Current repository evidence:** `advanceSessionMemoryRevisionInOpenTransaction` directly updates
  `session_memories`; the live transaction that invokes the compatibility commit is owned by
  the then-current `runSessionMemoryMaintenanceWorkflow` (retired by Chunk 15); and current-schema fixtures in
  `tests/memory/session-memory-revisions.test.ts`, `tests/memory/session-memory-embeddings.test.ts`,
  and `tests/ingest/status.test.ts` exercise those authoritative columns or mutation paths.
- **Why equivalent:** Authority must be checked inside the same mutation transaction and every
  canonical DML path/current-schema fixture must adopt the approved required columns. These edits
  preserve the approved dormant-mode behavior, public contracts, and chunk boundary.
- **Implementation used:** Require transaction-bound authority in the revision accumulator flush,
  mint legacy authority inside the live workflow transaction, and update only the affected fixtures.
- **Verification:** Include the added revision/embedding/status fixtures in focused verification and
  confirm no capability can be transported across the detached-process boundary or forged publicly.
