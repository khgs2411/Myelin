# Chunk 03: Scope-Global Embedding Lifecycle Fence

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Data And State; Agenda Question 15
**Status:** Approved for Execution
**Depends on:** Chunk 02
**Enables:** Chunks 04–15

## Goal

Bind the Session-scope lifecycle fence and reciprocal project exclusion to Chunk 01's exact global
firewall admission. Initial Session embedding-contract registration and lifecycle mutation are
DB-denied to old runtimes even before Chunk 04 activates SMC authority.

## Source Artifacts And Constraints

- `src/memory/embedding-contract-lifecycle-service.ts` owns current scope-wide lifecycle operations.
- `src/commands/memory.ts` exposes the combined public embedding lifecycle command; preserve that
  vocabulary and do not redesign Project Memory phases.
- Project-fence acquisition from Chunk 02 and global-fence acquisition must check one another inside
  their respective `BEGIN IMMEDIATE` transactions.
- The global operation has its own epoch, heartbeat, recovery, completion receipt, and explicit
  abandonment; elapsed time alone never permits a competing owner.
- Migration version `18` adds global fence/generation/receipt state but neither reopens the
  migration-16 firewall nor flips the authority-mode row created by Chunk 02.

## Relationships

- Extends `ProjectSessionMutationFence` and consumes `SessionMemoryWriteAdmission`.
- Produces dormant `SessionEmbeddingLifecycleFence` primitives and stable busy/recovery results used
  after Chunk 04 activation by snapshots, triggers, status, and finalization.
- Chunk 08 supplies the common operator recovery semantics; this chunk owns lifecycle-specific state
  transitions and receipts.

## File Responsibility Map

**Create:**
- `src/memory/session-embedding-lifecycle-fence.ts` — global acquire, CAS phases, heartbeat, recovery,
  completion/abandon receipt, and inspection.
- `tests/memory/session-embedding-lifecycle-fence.test.ts` — multi-project admission races.

**Modify:**
- `src/memory/migrations.ts` — migration `18`: create one dormant Session-scope global fence and
  terminal receipt storage without changing authority mode.
- `src/memory/project-session-mutation-fence.ts` — reject project acquisition while the global row
  is active in the same transaction.
- `src/memory/embedding-contract-lifecycle-service.ts` — wrap Session migrate/rollback/prune with
  global ownership and same-operation recovery.
- `src/memory/embedding-contract-lifecycle-types.ts` — stable busy, recovery, epoch, and receipt types.
- `src/commands/memory.ts` — preserve combined-command behavior while surfacing typed Session phase
  conflicts.

**Test:**
- `tests/memory/embedding-contract-lifecycle-service.test.ts`
- `tests/commands/memory.test.ts`

## Behavioral And Contract Changes

- The singleton Session-scope fence records operation ID/kind, phase, owner epoch, heartbeat, target
  contract identity, and terminal receipt identity.
- In active mode, global acquire succeeds only when no project fence row is active and project
  acquire succeeds only when the global fence is absent/inactive. In legacy mode, both new acquire
  APIs return `session_memory_authority_not_activated`; existing lifecycle behavior remains in force
  only through current-runtime compatibility authority plus firewall admission until Chunk 04
  activates SMC ownership.
- Stable failures distinguish `session_embedding_lifecycle_busy` from
  `session_memory_project_busy`; neither mutates contracts, indexes, or queued work.
- A crashed global operation recovers only the same operation under a higher epoch when its active
  and target contract identities match. Incompatible state requires explicit idempotent abandon.
- For a combined Session+Project command, the Session phase holds the global fence around every
  Session mutation. If the existing service cannot safely split phases, conservatively hold it for
  the combined operation; this is the approved decision rule and does not change Project semantics.

## Implementation Tasks

- [ ] Add migration `18` and global fence/receipt primitives parallel to the project fence, including
      dormant-mode refusal, same-operation recovery, and stale-epoch rejection.
- [ ] Bind initial Session contract registration and lifecycle apply/rollback/prune to an exact
      scope-global operation/owner/epoch firewall admission. Project-scope behavior remains outside
      this Session reliability change.
- [ ] Make project/global admission reciprocal and atomic. Prove a new project key cannot acquire
      while the global operation is active without enumerating registered projects.
- [ ] Integrate migrate, rollback, and prune behind the authority-mode branch. Preserve only
      admitted current-runtime compatibility before activation; after activation freeze
      operation/target-contract identity,
      create the receipt before release, and preserve preview/apply/rollback vocabulary.
- [ ] Adapt combined CLI behavior and add injected hard-kill/race tests across project A, project B,
      and a previously unseen project key.

## Verification

- `bun test tests/memory/session-embedding-lifecycle-fence.test.ts tests/memory/embedding-contract-lifecycle-service.test.ts tests/commands/memory.test.ts`
  — admitted current-runtime compatibility, denied old registration, active-mode reciprocal
  exclusion, stale epoch, recovery, rollback, prune, and combined-command cases pass.
- `bun test tests/memory/db.test.ts` — migration row `18` exists on success while authority mode
  remains `legacy_compatibility`; injected failure leaves no version-18 row or partial global schema.
- `bun run typecheck` — exits 0.
- `git diff --check` — exits 0.

## Acceptance Criteria Covered

- Dormant global/project primitives are fully integrated without claiming authority beside legacy
- Old-runtime initial Session contract registration/lifecycle mutation is denied; legitimate current
  operations remain generation-, predecessor-, and receipt-safe.

## Risks, Rollback, And Isolation

- Incorrect combined-command scoping could expose a Session mutation after early release. Tests must
  assert the fence remains held across the actual Session mutation interval.
- A failed acquisition leaves current embedding contracts and staging rows byte-for-byte unchanged.
- Chunk 03 must remain behaviorally compatible until Chunk 04 flips durable authority mode; no
  executor may enable it through config or process-local state.

## Non-Goals

- Changing provider selection, embedding contract semantics, or Project Memory reliability.

## Consistency Check

- Verify every Session migrate/rollback/prune mutation flows through the lifecycle service.
- Verify project-fence acquisition checks the singleton regardless of project registration.
- Verify public command names and preview/apply semantics remain unchanged.

## Execution Notes

### 2026-08-11: Reopened Chunk Accepted

- No production rewrite was required after Chunks 01–02: active Session embedding DML already binds
  to the live global operation/epoch/phase, while fixed compatibility admission is available only
  before authority activation. A regression now rejects direct initial Session contract
  registration after activation.
- Independent review accepted generation, predecessor-receipt, lost-ack, partial-scope, abandon,
  and reciprocal project/global behavior. Focused review passed; the sole broader Project Memory
  provider-dependent failure remains outside this Session slice.

### 2026-08-11: Reopened By Approved Migration Correction

- Preserve the accepted generation, predecessor-receipt, lost-ack, partial-scope, and abandoned-
  generation behavior. Add the exact firewall-admission binding and re-review old registration
  denial before this chunk is accepted again.

### 2026-08-11: Accepted Local Drift

- **Planned shape:** The lifecycle service is the named operation owner, while
  `src/memory/embedding-contract-resolver.ts`, `src/memory/session-memory-repair-service.ts`, and
  `tests/memory/db.test.ts` are not listed in the file map.
- **Current repository evidence:** `resolveEmbeddingContract` may register an initial active
  contract during plan construction, before active-mode global admission; `db.test.ts` owns the
  required migration-count and failure-isolation proof for migration 18; repair exhaustively maps
  the project-fence acquisition union and must surface the new reciprocal global-busy result.
- **Why equivalent:** Active-mode planning must be read-only until the reciprocal global fence is
  acquired, or a busy failure could still mutate embedding state. A pure/read-only planning seam
  preserves existing legacy behavior and the approved lifecycle contract.
- **Implementation used:** Add the minimum read-only resolver/planning seam needed by the lifecycle
  service, defer initial registration until admitted mutation, extend the repair conflict mapping,
  and extend the migration fixture.
- **Verification:** Prove a failed active-mode acquisition leaves contracts/index queues byte-for-byte
  unchanged and migration 18 remains dormant and atomic.
