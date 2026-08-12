# Chunk 13: Trigger Scheduling, Indexing Order, And Audit Fairness

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Rolling Global Audit; Inputs And Scheduling
**Status:** Approved for Execution
**Depends on:** Chunks 03–12
**Enables:** Chunks 14–15

## Goal

Manual, content-count, observed-age, and `session.start` wakes use one indexing-first anchor service
and make bounded audit progress without starving continuously eligible evidence.

## Source Artifacts And Constraints

- Capture persists valid content before scheduling; `session.start` is non-persisted control and
  never curator evidence.
- Fallback defaults are 60 valid content entries or 24-hour oldest-pending eligibility. The current
  root `myelin.config` threshold 25 is an explicit project override and remains unchanged.
- Audit partition size is a separate required positive-integer plan control. The current root
  `SMC_AUDIT_PARTITION_LIMIT=10` bounds each anchor independently of the larger
  `SMC_MAX_AFFECTED_WORK_SET_SIZE` retrieval-work ceiling.
- Because every selected audit member requires one provider fetch turn, the root also sets
  `SMC_MAX_TURNS=20`. With seven evidence formulations and two work-batch proposals, the ten-member
  audit partition yields an exact 19-turn preparation floor.
- No daemon/timer is added. Age is evaluated only on capture, `session.start`, explicit maintenance,
  and manual ingest wakes.
- Pending Session indexing is an indexing-only wake and never creates an SMC anchor by itself.
- When indexing and SMC work coexist, indexing completes first; incomplete indexing blocks before
  anchor manifest creation.

## Relationships

- Uses global/project fence admission, finalizer/index request, audit coverage, and recovery.
- Produces one `SessionMaintenanceScheduler` eligibility/result contract used by capture, manual CLI,
  auto maintenance, and status.
- Chunk 14 exposes operator/config/status vocabulary; Chunk 15 proves end-to-end triggers.

## File Responsibility Map

**Create:**
- `src/maintenance/session-maintenance-eligibility.ts` — evidence/audit/index workload evaluation and
  trigger reason selection.
- `src/maintenance/session-maintenance-scheduler.ts` — indexing-first orchestration and anchor start.
- `tests/maintenance/session-maintenance-eligibility.test.ts`
- `tests/maintenance/session-maintenance-scheduler.test.ts`

**Modify:**
- `src/maintenance/auto-memory-maintenance.ts` — delegate Session work to the new scheduler and remove
  one-shot/job-status assumptions.
- `src/maintenance/maintenance-contracts.ts` — stable trigger/workload/no-work/blocked result types.
- `src/capture/facade.ts` — ordinary post-storage and `session.start` wake semantics.
- `src/ingest/ingest-service.ts` and `ingest-service-contracts.ts` — manual evidence+audit,
  audit-only, and no-work behavior.
- `src/runtime/config.ts` — typed fallback threshold/max-age policy and the separate required
  `SMC_AUDIT_PARTITION_LIMIT` plan control while preserving explicit project overrides.
- `myelin.config` — retain threshold 25 and explicitly set the audit partition limit to 10.

**Test:**
- `tests/maintenance/auto-memory-maintenance.test.ts`
- `tests/capture/facade.test.ts`
- `tests/commands/ingest.test.ts`

## Behavioral And Contract Changes

- Eligibility returns independent `index`, `evidence`, and `audit` workloads plus durable trigger
  reason. Content count uses only valid user/assistant content; age uses oldest `inserted_at`.
- Manual always evaluates all workloads: evidence+due audit, audit-only with `manual_audit`, or
  `no_work` only when neither curation workload exists.
- Automatic start is logical OR of configured count, observed max age, and `session.start` flush.
  Cooldown may suppress duplicate wakes but cannot claim processed work or strand an already active
  anchor; the next wake reevaluates.
- If evidence and audit are due, one anchor selects evidence first plus one bounded due audit
  partition. Audit selection is oldest/never-audited/identity-invalidated and cannot be displaced by
  additional evidence after manifest freeze. Scheduler selection uses `auditPartitionLimit`, not
  `max_affected_work_set_size`; status uses the same bounded selector configuration.
- Index failure returns a typed blocker, leaves evidence/audit due, and creates no anchor. Index-only
  success returns indexing outcome without anchor/job creation.

## Implementation Tasks

- [ ] Implement pure eligibility over content count, oldest insertion time, current audit receipts,
      pending active-contract indexing, configured overrides, and wake kind. Freeze trigger reason
      in the later manifest.
- [ ] Implement indexing-first scheduler with reciprocal fence handling and no zero-work anchor.
      Preserve fail-open hook behavior while recording compact scheduler diagnostics.
- [ ] Add deterministic audit partition selection with its own typed positive limit and evidence-first
      manifest inclusion so one successful eligible job advances due audit coverage even under
      continuous evidence arrival without coupling audit cost to affected-work retrieval.
- [ ] Route capture/session-start/manual/auto entrypoints to the common scheduler and add clock-
      injected tests for 60/24 fallback versus root 25 override, cooldown, no idle wake, audit-only,
      fairness, and index blockers.

## Verification

- `bun test tests/maintenance/session-maintenance-eligibility.test.ts tests/maintenance/session-maintenance-scheduler.test.ts tests/maintenance/auto-memory-maintenance.test.ts tests/capture/facade.test.ts tests/commands/ingest.test.ts`
  — trigger OR logic, explicit 25 override, indexing order, audit fairness, and no-work semantics pass.
- `bun run typecheck` — exits 0 and proves the scheduler/status plan-config contract carries the
  separate audit partition field.
- `git diff --check` — exits 0.

## Acceptance Criteria Covered

- Manual and automatic entrypoints share one workflow.
- Threshold controls cost, not context size; age has honest event-driven semantics.
- Audit work progresses during successful maintenance and cannot starve behind evidence.
- Each anchor admits no more than the configured audit partition independently of affected-work-set
  growth or grants.
- Indexing-only wakes create no SMC anchor.

## Risks, Rollback, And Isolation

- Hook paths must remain fail-open after durable capture. Scheduler errors are diagnostic and cannot
  undo stored evidence.
- Do not change `AUTO_PROJECT_MEMORY_MAINTENANCE` or Project Memory scheduling.

## Non-Goals

- Periodic scheduler/service installation, Session inbox, or Project Memory maintenance changes.

## Consistency Check

- Confirm every count/status path uses the same valid-content predicate.
- Confirm `session.start` does not write an Experience Log row or run maintenance synchronously.
- Confirm `myelin.config` still resolves 25 as the project-specific threshold and 10 as the separate
  audit-partition limit.

## Execution Notes

### 2026-08-11: Accepted Implementation

- The original evidence-only manifest could not represent audit-only work. A focused pressure test
  therefore expanded this chunk to amend unreleased migrations 20–22 with generic kind-bound work
  batches and exact frozen audit members; the only durable database remained schema 15.
- Independent review accepted deterministic evidence-first/audit-last selection, full-record audit
  proof, inherited-only audit provenance, reviewed/resulting audit receipt identities, active-only
  current coverage, and recovery/finalizer/cleanup integrity. Composite kind-bound FKs and runtime
  digests reject cross-kind corruption.
- Manual, capture, `session.start`, and automatic wakes share the indexing-first scheduler. The code
  fallback is 60 valid entries or an observed 24-hour age, while this repository retains its
  explicit threshold override of 25; no idle daemon was added.
- The scheduler and status selector now receive the typed `auditPartitionLimit`; the repository root
  sets it to 10 independently of `max_affected_work_set_size=1000`.
- Root `max_turns` is 20 so the 10-member audit partition remains feasible for the accepted
  7-formulation, 2-proposal workload whose exact minimum is 19 turns.
- Final independent gates passed 40 Chunk 13 tests, 229 expanded Session Maintenance tests, the
  6-test frozen-runtime firewall fixture, TypeScript typecheck, and `git diff --check`.
