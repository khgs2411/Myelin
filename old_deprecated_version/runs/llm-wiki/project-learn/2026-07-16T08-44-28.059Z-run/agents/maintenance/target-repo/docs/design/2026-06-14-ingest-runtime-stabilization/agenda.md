# Ingest Runtime Stabilization Design Agenda

## Status

- Spec: `spec.md`
- State: Complete
- Completion gate:
  - Live agenda questions resolved: Yes
  - Pressure test complete: Yes
  - Spec finalized: Yes

## Documented Decisions

- `myelin ingest <project-key>` remains the top-level detached agentic Experience Log to Session Memory workflow.
- `myelin project ingest <key>` remains the queued source/inbox processing command and should not be conflated with top-level ingest.
- Experience Log rows are raw evidence, not truth.
- Experience Log tombstones can begin as in-progress lease stubs, then become terminal archive/audit records after accepted processing.
- The full `class-kit` Experience Log queue was drained after live stabilization, but Session Memory embedding/index/query/MCP retrieval remains incomplete.
- The next design scope is ingest-runtime stabilization and roadmap reconciliation, not Session Memory query implementation.
- No Symphony/Trello task should be created automatically for this cleanup.

## Questions

### Question 1: Recovery Surface For Stale Claimed Tombstones

- Status: Answered
- Branch type: Initial
- Why it matters: The live drain required manual recovery of interrupted claimed tombstones. If recovery stays ad hoc, future real drains can either strand evidence or require risky SQLite/manual repair steps.
- Scenario probe: A provider worker claims 80 rows, moves them into tombstones, then times out before writing outputs. The active queue is empty, the job is failed, and tombstones are still claimed. The operator wants to retry safely without duplicating Session Memory or losing the original audit trail.
- Options:
  - A. Add a dedicated guarded recovery command - clear operator path and testable behavior, but adds product surface for a rare operation.
  - B. Keep recovery inside `ingest status` as suggested next actions plus a confirmation command - easier status-driven workflow, but may blur read-only status with repair behavior.
  - C. Keep recovery as an internal/manual admin helper for now - lowest product surface, but repeats the exact operational weakness exposed by the live drain.
- Recommendation: A. Add a narrow guarded recovery command for stale claimed tombstones, with dry count/readback first and explicit project/job scope. This makes the failure mode testable without turning tombstones into a broad workflow.
- Answer: The user proposed changing the queue lifecycle instead of adding a recovery surface: do not move rows into tombstones before provider work. Give active Experience Log rows to the agent first, then after the agent finishes and produces accepted output, automate the move from `experience_events` to tombstones.
- Answer impact: Changes model
- Spec impact: Updated the spec from pre-provider tombstone claims plus recovery command toward a read/lease-then-commit lifecycle. Tombstones become terminal archive/audit records. Provider failure before accepted output leaves rows active or releasable for retry.
- Context impact: Updated - `Experience Log Tombstone` now allows an in-progress lease stub before terminal archive/finalization.
- ADR impact: Updated - ADR 0056 now records tombstone-backed lease/finalization state.
- Follow-ups: Added Question 6 to decide the active-row in-progress guard now that tombstones no longer serve as the claim mechanism.

### Question 2: Status Completion Vocabulary

- Status: Answered
- Branch type: Initial
- Why it matters: The handoff explicitly warns that the Experience Log drain completed but Session Memory retrieval did not. Status and roadmap language need to prevent future agents from treating "ingest complete" as "query layer complete."
- Scenario probe: After a drain, `experience_events=0`, `running_jobs=0`, and `claimed_tombstones=0`, but embeddings have not been indexed. What should the operator-facing status and roadmap say?
- Options:
  - A. Use layered completion labels - "Experience Log drain complete", "Session Memory write complete", and "Session Memory retrieval pending". Precise, but slightly wordier.
  - B. Keep "ingest complete" for drained queue and rely on docs to explain indexing is later. Shorter, but easy to misread.
  - C. Make status include every downstream layer before it can say complete. Accurate in theory, but makes one status term too broad and blocks useful progress labels.
- Recommendation: A. Use layered completion labels so the runtime and roadmap can mark the proven drain done without overstating retrieval readiness.
- Answer: A confirmed, with an implementation preference: represent completion layers as a simple numeric enum in code, then map that enum to the operator-facing layered labels.
- Answer impact: Confirms branch
- Spec impact: Updated the status model to require layered completion labels backed by a numeric code enum rather than fuzzy status strings.
- Context impact: Not needed; this is implementation representation for status, not a new domain term.
- ADR impact: Not needed.
- Follow-ups:

### Question 3: Runtime Knob Ownership

- Status: Answered
- Branch type: Initial
- Why it matters: The working diff added timeout, startup delay, prompt sizing, structured output, and lowered reasoning effort. The design needs decide whether these stay as local environment knobs or become documented Myelin config/runtime profile.
- Scenario probe: A future large repo has 2,000 queued rows. The operator wants slower, cheaper ingest with fewer concurrent workers and a longer timeout. Should they edit `.env`, `myelin.config`, command flags, or code defaults?
- Options:
  - A. Document config/env knobs only - minimal surface and fast to stabilize, but discoverability is weaker.
  - B. Add a named ingest runtime profile in `myelin.config` - good repeatability and separates ingest from broad pipeline defaults, but adds config schema surface.
  - C. Add command flags for every runtime knob - discoverable for one-off runs, but likely overexposes internals before the model settles.
- Recommendation: B for stable defaults, with env overrides for local debugging. Ingest has proven different enough from broad pipeline work to deserve a named profile, while command flags should stay sparse.
- Answer: B confirmed. Add a named ingest runtime profile in `myelin.config`, with env overrides reserved for local debugging or emergency runs.
- Answer impact: Confirms branch
- Spec impact: Updated the runtime safety envelope and planning boundaries so ingest concurrency, startup delay, timeout, prompt budget, and model/reasoning profile belong to a named ingest runtime profile rather than broad pipeline defaults or command flags.
- Context impact: Not needed; this is config ownership, not a domain glossary term.
- ADR impact: Not needed for this slice unless the config profile expands into a broader runtime-profile architecture.
- Follow-ups:

### Question 4: Durable Failure Detail Policy

- Status: Answered
- Branch type: Risk
- Why it matters: Provider failures and prompt excerpts can be large and sensitive. Recovery needs enough detail to classify failures, but durable state should not become a second raw transcript store.
- Scenario probe: Codex times out after receiving a prompt with bounded evidence excerpts. The stderr/log contains command details and maybe prompt fragments. What should `ingest_jobs.error_json` or tombstone failure metadata persist?
- Options:
  - A. Compact durable error plus log reference - stores failure class, retryability, timeout/provider code, and log path; best retention boundary, but debugging needs log access.
  - B. Persist full stderr/output in DB - easiest debugging, but risks large/sensitive durable state and noisy status.
  - C. Persist only generic failed status - safest retention, but recovery and diagnosis become too opaque.
- Recommendation: A. Keep durable state compact and typed, with log references for detailed local debugging.
- Answer: A confirmed. Durable state stores compact typed failure metadata plus a log reference; detailed debugging output remains in local logs.
- Answer impact: Confirms branch
- Spec impact: Updated Output Failure Compaction to make compact typed durable errors with log references the selected policy.
- Context impact: Not needed.
- ADR impact: Not needed unless this becomes a global provider-runtime policy.
- Follow-ups:

### Question 5: Small Real Retest Boundary

- Status: Answered
- Branch type: Initial
- Why it matters: The full class-kit drain already completed. Repeating a large drain is expensive and may create noise, but moving directly to query/MCP work without another real retest would skip the failure mode that triggered this design.
- Scenario probe: After stabilization implementation and tests pass, what real run proves enough: a tiny synthetic project, a small newly captured class-kit batch, or a replay/requeue fixture from tombstone evidence?
- Options:
  - A. Small newly captured real batch in a bootstrapped project - best dogfood signal, but requires fresh safe input.
  - B. Replay/requeue a bounded preserved evidence fixture - deterministic and focused on recovery, but less like live provider behavior.
  - C. Synthetic local project only - cheap and repeatable, but may miss target-repo/provider interactions.
- Recommendation: A plus B if feasible: run one small real batch for end-to-end confidence, and keep a bounded replay fixture for recovery regression. If only one is practical, choose A.
- Answer: Recommendation confirmed. Use one small newly captured real batch for end-to-end confidence plus a bounded replay/requeue fixture for recovery regression when feasible. If only one is practical, prefer the small real batch.
- Answer impact: Confirms branch
- Spec impact: Updated Retest Strategy and planning boundaries with the two-part retest approach.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups:

### Question 6: Active-Row Lease And Concurrency Guard

- Status: Answered
- Branch type: Follow-up
- Why it matters: If rows stay in `experience_events` while the provider works, Myelin needs a way to prevent duplicate processing or else accept a strict one-worker v1. Tombstones no longer protect the active queue from concurrent workers.
- Scenario probe: `INGEST_BATCH_SIZE` creates three detached workers. Worker A reads rows 1-50 and is still waiting on Codex. Worker B starts 750ms later. Should Worker B see rows 1-50 as unavailable, or is v1 required to run exactly one worker until commit-to-tombstone is implemented safely?
- Options:
  - A. Add lease fields on `experience_events` - straightforward queries and status counts, but mutates the raw event table with runtime state.
  - B. Add a separate `experience_event_leases` table - keeps raw rows immutable until terminal tombstone, but adds join/cleanup logic.
  - C. Enforce one worker for v1 and skip leases - simplest migration from the live incident, but gives up the current multi-worker batching behavior until a later concurrency slice.
- Recommendation: B if we want to preserve multi-worker ingest soon; C if the immediate goal is the smallest safe stabilization. I lean C for this stabilization slice unless large-queue throughput is still a near-term requirement, because it removes the tombstone recovery failure mode without introducing a half-scheduler.
- Answer: Use the tombstone table itself as the lease/traceability guard, but do not delete the source `experience_events` row when the worker pulls it. Pull creates a minimal tombstone stub. The stub means the row has been pulled and prevents duplicate processing. If the worker dies, Myelin can recover from the stub while the original Experience Log row still exists. Only completed ingestion deletes the Experience Log row and populates/finalizes the tombstone.
- Answer impact: Changes model
- Spec impact: Updated the spec to define a tombstone-backed lease lifecycle: pulled rows create minimal tombstone stubs keyed by source row/dedupe identity, raw rows remain active evidence during provider work, and accepted terminal processing atomically writes outputs, populates/finalizes tombstones, and deletes source rows.
- Context impact: Updated - `Experience Log Tombstone` now allows an in-progress lease stub before terminal archive/finalization.
- ADR impact: Updated - ADR 0056 now records tombstone-backed lease/finalization state.
- Follow-ups: Added Question 7 to decide stale stub recovery semantics.

### Question 7: Stale Tombstone Stub Recovery Semantics

- Status: Answered
- Branch type: Follow-up
- Why it matters: Tombstone stubs prevent duplicate processing while raw rows remain in `experience_events`. If a worker dies, Myelin needs a deterministic way to make those rows retryable without erasing traceability or violating the unique `original_event_id` / `dedupe_key` guard.
- Scenario probe: Worker A creates tombstone stubs for rows 1-50 and times out before valid output. The raw rows still exist. A later operator runs recovery. Should Myelin reuse those same stubs for the retry, mark them failed and replace them, or delete/release them?
- Options:
  - A. Reuse the same stub for retry - preserves one tombstone per original event and fits existing unique indexes, but the stub must track retry/job history.
  - B. Mark the stale stub failed and create a new retry stub - clearer per-attempt audit trail, but requires relaxing or changing unique tombstone indexes.
  - C. Delete/release the stale stub before retry - simplest with current uniqueness, but weakens audit history unless the release is recorded elsewhere.
- Recommendation: A. Reuse the same tombstone stub and append retry/job history in structured metadata. This fits the current one-tombstone-per-source identity model and avoids schema churn, while still preserving recovery evidence.
- Answer: A confirmed. Reuse the same tombstone stub for retry and append retry/job history in structured metadata.
- Answer impact: Confirms branch
- Spec impact: Updated the spec to preserve one tombstone identity per original Experience Log row. Stale-stub recovery appends retry/job history instead of creating replacement tombstones or deleting/releasing the stub.
- Context impact: Updated - refined `Experience Log Tombstone` so it can be an in-progress lease stub before terminal archive/finalization.
- ADR impact: Updated - ADR 0056 now records one durable tombstone lease/finalization identity per pulled Experience Log row.
- Follow-ups: No immediate follow-up from this branch.

## Pressure-Test Result

- Status: Complete
- Checked categories: lifecycle and interruption; state persistence; handoff boundaries; verification evidence; scope control; recovery paths; parallelism and sequencing; user review gates.
- Result: No new live questions were needed. The pressure test found one durable-artifact issue: ADR 0056 still described the old pull/tombstone consequence. ADR 0056 was updated to match tombstone-backed lease stubs, terminal tombstone finalization, and raw-row deletion only after accepted processing.
- Remaining non-blocking risks:
  - Implementation must preserve the one-tombstone-per-source identity while allowing retry/job history on stale stubs.
  - The exact numeric completion enum values should be chosen during implementation, not encoded as prose-only status strings.
  - The small real retest requires fresh safe captured input, or it falls back to the bounded replay fixture.
