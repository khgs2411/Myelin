# Chunk 04: Anchor Job Phases, Permanent Deny, And Authority Activation

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Trusted Coordinator And Overlay; Migration And Compatibility
**Status:** Approved for Execution
**Depends on:** Chunks 02, 03
**Enables:** Chunks 05–15

## Goal

A companion Session Memory Anchor Job phase record becomes authoritative. Every migrated old job
receives an immutable permanent deny identity before quarantine/activation; old runtime writes are
already blocked by migration 16, so PID/process observation is diagnostic rather than an integrity gate.

## Source Artifacts And Constraints

- Preserve existing job IDs, tombstone IDs, attempt history, completed/failed history, and raw rows.
- Authoritative phases are `preparing`, `running`, `needs_followup`, `finalizing`, `completed`, and
  `abandoned`; legacy `starting` is migration input, not a new steady-state phase.
- `src/ingest/runtime.ts` and `src/ingest/status.ts` currently infer detached-process lifecycle.
- Migration 16 has already denied protected old-runtime DML. Migration 19 remains additive to job
  state but must not promise old binaries write compatibility.
- A `starting` row without PID may still have a launcher paused before spawn. It is safe because a
  late child/parent cannot pass the firewall, not because Myelin proved the process dead.
- Migration version `19` adds anchor phase/attempt schema but leaves durable authority mode
  `legacy_compatibility`. A dedicated activation service owns the only transition to `smc_v1`;
  Chunks 02–03 and automatic read-only database opens cannot activate themselves.

## Relationships

- Uses project/global authority plus firewall admission from Chunks 01–03.
- Produces `SessionMemoryAnchorJobPhase`, CAS transitions, owner-attempt metadata, quarantined fence
  assignments, and the atomic authority activation gate used by every later chunk.
- Chunk 06 creates complete manifests only after this migration gate is accepted; Chunk 05 is
  side-effect-free evidence planning.

## File Responsibility Map

**Create:**
- `src/session-maintenance/job-lifecycle.ts` — phase types, CAS transitions, companion anchor-state/
  attempt reads, and compatibility projection to the unchanged `ingest_jobs` handle.
- `src/session-maintenance/legacy-job-migration.ts` — permanent deny assignment and quarantine mapping.
- `src/session-maintenance/authority-activation-service.ts` — one deny/quarantine/fence/mode-flip
  transaction; liveness is recorded only as diagnostic metadata.
- `tests/session-maintenance/job-lifecycle.test.ts`
- `tests/session-maintenance/legacy-job-migration.test.ts`
- `tests/session-maintenance/authority-activation-service.test.ts`

**Modify:**
- `src/memory/migrations.ts` — migration `19`: add `session_memory_anchor_jobs` and attempt tables
  plus immutable `legacy_session_job_deny_identities`, keyed to `ingest_jobs.id`; preserve mode.
- `src/memory/ingest-types.ts` — retain the legacy job-status union and add separate authoritative
  anchor phase/reason row types.
- `src/ingest/jobs.ts` — preserve legacy create/update APIs; add companion phase-aware reads/CAS
  without making `ingest_jobs.status` authoritative for new anchors.
- `src/ingest/ingest-service.ts` — run authority activation when needed, then return stable
  `smc_preparation_not_available` until Chunk 12 supplies preparation, coordinator, and finalizer
  integration; never persist an ordinary new-format `preparing` anchor in this chunk.
- `src/ingest/ingest-service-contracts.ts` — represent the temporary stable preparation-unavailable
  blocker without treating it as no-work or a failed job.
- `src/memory/embedding-contract-lifecycle-service.ts` and
  `src/memory/session-memory-repair-service.ts` — call the same activation service before the first
  authority-bearing mutation; read-only database opens never activate.
- `src/ingest/runtime.ts` — process liveness is diagnostic evidence only, never write/cutover authority.
- `src/ingest/job-admin-service.ts` and `src/ingest/status.ts` — surface quarantined legacy jobs and
  prevent generic failed-job cleanup from releasing them.

**Test:**
- `tests/ingest/jobs.test.ts`
- `tests/ingest/ingest-service.test.ts`
- `tests/ingest/runtime.test.ts`
- `tests/ingest/status.test.ts`

## Behavioral And Contract Changes

- Authoritative SMC transitions live only in `session_memory_anchor_jobs` and CAS on job ID, project,
  prior phase, and owner epoch with the project fence in the same transaction after activation.
- Chunk 04 creates companion rows only for quarantined legacy jobs. Ordinary new jobs are not born
  `preparing` until Chunk 06 can atomically create the job, companion phase, fence, leases, snapshot,
  and complete manifest.
- `ingest_jobs.status` remains a compatibility projection using its existing literals: preparing is
  `starting`; running/finalizing is `running`; needs-followup is `needs_followup`; completed is
  `completed`; abandoned projects as `failed` with stable `error_json.code = "abandoned"`. All new
  authority/status reads use the companion phase, never infer authority from that projection.
- Every pre-SMC job identity receives an immutable deny row. The deny prevents that job from ever
  becoming admitted authority, including after abandonment, fence release, or a later owner.
- A trusted activation/abandon/reassignment operation may mutate a denied job as its target using
  its own distinct admitted owner; it never mints admission owned by the denied job.
- A nonterminal legacy job lacking manifest/overlay becomes `needs_followup` with
  `legacy_state_missing_smc_manifest`, receives/retains the project fence, and cannot resume.
- Legacy failed/completed jobs remain historical. Claimed tombstones and raw evidence remain
  recoverable through later explicit abandonment/release policy.
- Activation is all-or-nothing: one `BEGIN IMMEDIATE` rechecks the old job set, inserts permanent
  denies, appends initial attempt records, quarantines every unresumable nonterminal job, assigns
  fences, and sets mode `smc_v1`. Multiple incompatible nonterminal jobs return one stable blocked
  result without partial writes. PID state may be surfaced but cannot change this transaction's
  safety decision.
- Protected legacy job/tombstone target updates use `migrate_legacy_anchor` admission owned by the
  activation service. The denied job ID is a target only and never the admission owner.
- Every `needs_followup -> running` resume increments epoch and appends a new attempt row; it never
  rewrites the historical attempt in place.

## Implementation Tasks

- [ ] Add companion phase/attempt schema and CAS helpers without rebuilding or changing
      `ingest_jobs`; make the companion epoch the only active-mode authority for heartbeat, journal,
      overlay, and later finalization operations.
- [ ] Add immutable permanent-deny schema/read/assertion. Integrate it into current-runtime
      compatibility authority minting so denied owner IDs fail even while mode says
      `legacy_compatibility`. Deny rows have no normal delete/update path.
- [ ] Implement `AuthorityActivationService`: in one immediate transaction classify the exact old
      job set, insert denies, append attempts, quarantine, assign fences, and flip mode. Return a
      stable blocked union for multiple incompatible jobs; never throw an untyped migration error.
      Mint exact `migrate_legacy_anchor` admission under activation-service identity for protected
      target updates, then delete it before commit.
- [ ] Quarantine unresumable legacy jobs with their original identities/history and acquire the
      matching project fence. In the same activation transaction, flip authority mode to `smc_v1`.
      Reject new starts until explicit abandonment exists in Chunk 08.
- [ ] Adapt ingest service, runtime refresh, admin, and status to authoritative phases. Remove any
      path that rewrites a durable phase from process observation without CAS. Before Chunk 06,
      active-mode normal ingest returns `smc_preparation_not_available` and persists no job/fence.
- [ ] Add deterministic launcher/worker barriers: pre-spawn, post-spawn/pre-PID, child-running with
      PID-null, leased/provider-return after activation, and post-abandon/new-owner. Use exact old
      runtime through both installed-locator and direct-source entrypoints plus a held-open old SQLite
      connection. All old protected writes fail; legitimate new owners succeed.
- [ ] Prove resume appends attempts, permanent deny survives abandonment/reassignment, and liveness
      diagnostics cannot flip authority or authorize mutation.

## Verification

- `bun test tests/session-maintenance/job-lifecycle.test.ts tests/session-maintenance/legacy-job-migration.test.ts tests/session-maintenance/authority-activation-service.test.ts tests/ingest/jobs.test.ts tests/ingest/ingest-service.test.ts tests/ingest/runtime.test.ts tests/ingest/status.test.ts`
  — permanent deny, quarantine, phase/attempt CAS, stable blockers, late-old-worker denial, and
  history preservation pass.
- `bun test tests/memory/db.test.ts` — schema success records migration row `19` while mode remains
  `legacy_compatibility`, creates companion/deny tables, and returns no foreign-key rows/integrity
  `ok`; injected failure leaves no version-19 row/partial tables. Activation atomically inserts
  denies/quarantine/fences and flips `smc_v1`.
- `bun run typecheck` — exits 0.
- `git diff --check` — exits 0.

## Acceptance Criteria Covered

- One durable anchor lifecycle with recoverable phases and owner epochs.
- Old legacy workers are permanently DB-denied independent of process timing.
- Unresumable jobs are denied/quarantined without evidence loss or false resume.
- Project/global fence enforcement becomes authoritative only in the same commit as successful
  legacy classification.
- The accepted Chunk 04 state cannot persist an ordinary incomplete `preparing` anchor; active-mode
  starts fail with `smc_preparation_not_available` through Chunk 11 and Chunk 12 enables them.

## Risks, Rollback, And Isolation

- Do not rely on PID reuse, age, argv, or a second liveness check. The migration-16 firewall and
  immutable deny identity are the safety boundary.
- Until Chunk 15 cutover, the compatibility worker may run only for jobs explicitly classified as
  legacy; it cannot create new-format state.

## Non-Goals

- Manifest contents, overlay, automatic resume, abandonment, or CLI recovery commands.

## Consistency Check

- Verify every job status literal and query across `src/` and tests is classified as migrated,
  compatibility-only, or updated.
- Verify normal `none -> preparing` creation has no owner in Chunk 04 and exists only in Chunk 06's
  complete-manifest transaction.
- Verify fence phase and job phase cannot disagree after any transaction.
- Verify no chunk-plan file assumes `failed` is the terminal state for new anchors.
- Verify no process-local flag can replace or bypass the durable `smc_v1` authority-mode row.
- Verify a denied job can be a trusted operation target but never its admitted authority.

## Execution Notes

### 2026-08-11: Partial Implementation Reopened

- Existing Chunk 04 edits are unverified and must be reconciled, not reverted. Known gaps include
  PID-based activation, missing permanent deny, in-place resume attempts, and untyped multi-job
  failure. Rework them under this corrected contract before review.

### 2026-08-11: Permanent-Deny Reassignment Proof Boundary

- Chunk 04 proves the identity invariant with a narrowly test-owned fence release/reassignment:
  the denied legacy job cannot reacquire or use authority, while a fresh owner acquires and writes.
  This is not a production abandonment path. Chunk 08 owns the real admitted abandonment receipt,
  lease/fence release, replay, and the same permanent-deny-after-reassignment proof through that path.

### 2026-08-11: Chunk Accepted

- Independent review accepted the corrected activation boundary after executable direct-source and
  installed-locator barrier coverage, an activated provider-return rollback proof, immutable deny
  reassignment coverage, and after-apply migration-19 rollback verification.
- Verification passed: 59 focused Chunk 04 tests, `bun run typecheck`, and `git diff --check`.
- Real receipt-backed abandonment and release remain explicitly owned by Chunk 08.
