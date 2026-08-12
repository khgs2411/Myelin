# Chunk 08: Same-Job Recovery, Abandonment, And Retention

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Trusted Coordinator And Overlay; Failure And Recovery Behavior
**Status:** Approved for Execution
**Depends on:** Chunks 02, 03, 04, 07
**Enables:** Chunks 09–15

## Goal

Hard-killed or bounded-failure anchors safely resume the same job under a higher epoch, remain
blocked on identity conflict, or are explicitly abandoned without evidence loss; forensic cleanup
is receipt- and retention-gated.

## Source Artifacts And Constraints

- Timeout only establishes stale-heartbeat eligibility; it never hands ownership to a new job.
- Resume requires exact manifest, lease, snapshot, policy/output/tool, provider/model, embedding,
  journal, overlay, and accepted-batch identities.
- A policy-version/digest change is incompatible, not resumable. Policy v3's `audit_fetch` playbook
  therefore requires explicit abandonment of earlier-policy anchors and a new anchor over the
  preserved raw evidence.
- Budget exhaustion requires an additive operator grant or abandonment; provider/process transients
  may auto-resume within bounded policy.
- Existing configuration hierarchy is authoritative for retention. If no key exists, introduce one
  named `sessionMaintenance.forensicRetentionMs`; cleanup remains disabled when it is absent rather
  than inventing a default.
- This chunk can detect, epoch-takeover, validate, block, abandon, and clean recovery state, but it
  has no production coordinator launcher. Public automatic/manual resume returns stable
  `smc_coordinator_not_available` without changing `needs_followup -> running`. Production
  start/resume remains blocked through Chunk 11; Chunk 12 alone replaces the blockers and owns first
  production launch/resume integration.

## Relationships

- Uses permanent deny, firewall admission, anchor phase/attempt/epoch, both fence types,
  overlay/journal state, and shared terminal receipts.
- Produces recovery validation/abandon/cleanup services required before curator retrieval and
  operator CLI. Production start/resume remains blocked through Chunk 11; Chunk 12 alone replaces
  the blockers and owns first production launch/resume integration.
- Chunk 12 writes finalization receipts into the same cleanup predicate; Chunk 15 proves real cleanup.

## File Responsibility Map

**Create:**
- `src/session-maintenance/recovery-service.ts` — stale detection, same-job validation, epoch takeover,
  and automatic resume decision.
- `src/session-maintenance/abandonment-service.ts` — idempotent abandonment transaction/receipt.
- `src/session-maintenance/forensic-cleanup-service.ts` — receipt/retention-gated job-state cleanup.
- `tests/session-maintenance/recovery-service.test.ts`
- `tests/session-maintenance/abandonment-service.test.ts`
- `tests/session-maintenance/forensic-cleanup-service.test.ts`

**Modify:**
- `src/session-maintenance/job-lifecycle.ts` — stale-phase to `needs_followup` epoch CAS and terminal
  receipt reconciliation.
- `src/session-maintenance/terminal-receipts.ts` — write/resolve abandonment receipts using the shared
  schema.
- `src/ingest/job-admin-service.ts` — route explicit recovery/abandonment rather than generic failure
  resolution.
- `src/runtime/config.ts` — resolved forensic retention boundary if no existing authoritative key is
  found.

**Test:**
- `tests/ingest/runtime.test.ts`
- `tests/ingest/status.test.ts`

## Behavioral And Contract Changes

- An expired `preparing|running|finalizing` owner is CAS-moved to `needs_followup` under an incremented
  epoch and appended attempt history. The old epoch immediately loses all authority.
- `preparing` is recoverable only when Chunk 06's complete manifest and leases exist (the
  after-commit/before-launch crash). Because pre-commit preparation is atomic, any persisted
  `preparing` job without that complete manifest is corrupt and remains blocked for explicit
  abandonment; recovery never fills missing snapshot state from live tables.
- If a matching finalization receipt exists, recovery returns it and reconciles `completed` rather
  than resuming. Receipt-less finalizing validates the fixed accepted digest before resuming.
- Exact identity validation resumes at the first incomplete work batch. Incompatibility records a
  stable reason and retains the project fence. Production start/resume remains blocked through
  Chunk 11; Chunk 12 alone replaces the blockers and owns first production launch/resume
  integration. Until then, a compatible job remains `needs_followup` with
  `smc_coordinator_not_available` and is not advanced to `running`.
- Abandonment is one admitted immediate transaction owned by the trusted operator/service, not the
  abandoned job: verify current epoch, write the unique abandonment
  receipt, release nonterminal leases and project fence, preserve raw Experience Log rows, and mark
  `abandoned`. Replay returns the same receipt.
- The shared terminal receipt binds either an exact `smc_manifest` basis or, for permanently denied
  pre-SMC anchors only, an exact `legacy_quarantine` basis derived from the immutable deny identity.
  It records the target epoch separately from the trusted abandonment operator/request identity.
- Permanent deny rows are never removed. A later project owner receives a fresh identity/epoch and
  admission; the denied old job remains unable to mutate after lease/fence release.
- Abandoned claimed tombstones become `unfinished` historical rows. Partial unique indexes enforce
  at most one current `claimed` lease per source/dedupe identity, so a later anchor creates a fresh
  job-owned tombstone without rewriting the abandoned history. Replay cleanup never treats
  `unfinished` as consumed raw evidence.
- Cleanup deletes only job-owned snapshot/overlay/journal/receipt-detail rows after a qualifying
  terminal receipt and elapsed resolved retention. It never deletes raw evidence, canonical memory,
  terminal tombstones, or the compact receipt/job audit identity.

## Implementation Tasks

- [ ] Resolve the retention configuration boundary by inspecting `src/runtime/config.ts` and
      `myelin.config`. Decision rule: reuse an existing Session forensic retention key if semantically
      exact; otherwise add optional `sessionMaintenance.forensicRetentionMs` and keep cleanup disabled
      until configured. Record the selected key in public config docs during Chunk 14.
- [ ] Implement epoch takeover and exhaustive resume validation with stable reason codes for every
      governing identity. Add injected failures at preparing, running, overlay acceptance, and
      receipt-less finalizing.
- [ ] Require each resume to append a fresh attempt and mint admission only for that new epoch.
      Abandon/reassign uses a distinct trusted authority and may target a denied job without making
      it authority. Prove deny survival after release and later owner acquisition.
- [ ] Separate `validateResume` from `beginCoordinatorResume`. The latter requires an injected
      coordinator-launch capability. Production start/resume remains blocked through Chunk 11;
      Chunk 12 alone replaces the blockers and owns first production launch/resume integration. Add a test that
      public resume before then persists no running transition/PID.
- [ ] Implement budget-grant validation and explicit abandonment. Preserve raw evidence and attempt
      history; release leases/fence exactly once. Race abandonment against finalization and prove
      phase/epoch CAS plus the one-receipt-per-job constraint permits only one terminal outcome.
- [ ] Correct the pre-release migration-21 receipt/tombstone boundary: anchor-owned discriminated
      terminal basis, exact legacy-quarantine validation, trusted exact-target abandonment admission,
      and claimed-only source/dedupe uniqueness. Do not fabricate manifests or reassign historical
      tombstones.
- [ ] Implement generic cleanup using `SMCTerminalReceipt` fixtures for both abandonment and
      finalization. Verify missing, premature, mismatched, or malformed receipts cannot clean state.

## Verification

- `bun test tests/session-maintenance/recovery-service.test.ts tests/session-maintenance/abandonment-service.test.ts tests/session-maintenance/forensic-cleanup-service.test.ts tests/ingest/ingest-service.test.ts tests/ingest/runtime.test.ts tests/ingest/status.test.ts`
  — stale/denied worker rejection, fresh attempt resume, blocked identity drift, replayed abandon,
  permanent deny after later owner, and cleanup gates pass.
- `bun run typecheck` — exits 0.
- `git diff --check` — exits 0.

## Acceptance Criteria Covered

- Hard kills recover the same job without stale-epoch mutation.
- Incompatible work stays blocked until explicit abandonment.
- Abandonment releases ownership once and preserves evidence.
- Denied legacy identity never regains authority after abandonment/reassignment.
- Forensic cleanup requires durable terminal proof and retention.

## Execution Note

- Replace Chunk 04's test-owned release/reassignment simulation with the real admitted abandonment
  transaction. Prove the permanent deny survives its receipt, lease/fence release, replay, and a
  fresh later owner successfully acquiring and using authority.

## Risks, Rollback, And Isolation

- False stale detection must not create two owners. Every takeover is a single CAS on prior epoch,
  phase, and heartbeat cutoff.
- Cleanup is permanently destructive to diagnostic staging; keep it disabled without a resolved
  retention key and validate exact job scope before deletion.

## Non-Goals

- Automatic new-job replacement, wall-clock scheduler, or finalization receipt creation.

## Consistency Check

- Verify recovery validation names every manifest identity listed in the approved spec.
- Verify `needs_followup` remains in the project single-flight set.
- Verify Chunk 12 can write finalization receipts without changing the cleanup predicate.

## Execution Notes

### 2026-08-11: Chunk Accepted

- Independent review accepted same-job epoch recovery, exhaustive frozen-identity validation,
  manifest/legacy terminal bases, exact-target trusted abandonment, evidence-preserving re-entry,
  and receipt/retention-gated cleanup.
- Migration 21 was corrected before release because the only durable database remains at schema 15;
  no fake manifest, parallel receipt authority, or reassigned historical tombstone was introduced.
- Verification passed: 52 Chunk 08 tests, 22 migration/terminal-receipt tests, 23 focused
  overlay/action/recovery tests, `bun run typecheck`, and `git diff --check`.

### 2026-08-12: Policy v3 compatibility application

- The accepted recovery rule applies directly to the new `audit_fetch` policy identity: anchors
  frozen under the earlier policy are abandoned and restarted, never resumed or rewritten in place.
