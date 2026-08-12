# Ingest Runtime Stabilization Design

Status: Final design. Ready for external design/spec audit before implementation planning.

## Goal

Stabilize the detached `myelin ingest <project-key>` runtime after the first real `class-kit` Experience Log drain, and reconcile the roadmap so the next work does not overstate what the drain proved.

This slice is intentionally narrower than Session Memory query/retrieval. It should make the ingest runtime safer to operate, recover, retry, and verify before Myelin moves on to embedding-backed Session Memory lookup, MCP exposure, or Current Briefing consumption.

The working direction changed during design: instead of moving raw rows into tombstones before the provider call, ingest should prefer a tombstone-backed lease lifecycle. When Myelin pulls a row, it creates a minimal tombstone stub that prevents duplicate processing and records traceability, but it leaves the raw row in `experience_events`. Only accepted terminal ingestion deletes the raw row and populates/finalizes the tombstone.

## Current Context

The approved ingest design in `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/spec.md` established the durable product model:

- top-level `myelin ingest <project-key>` starts detached target-repo provider work
- Experience Log rows receive tombstone-backed lease stubs for provider work and move fully into populated tombstones only after accepted terminal processing
- trusted low-risk outputs become `session_memories`
- proposed outputs become `memory_candidates`
- downstream layer inputs become Project/Practice/Personal handoff instructions
- vector indexing and query/MCP retrieval are deferred

The real `class-kit` drain completed the active Experience Log queue and produced Session Memory/candidate/handoff output, but it also exposed runtime fragility. The current working tree already contains live stabilization fixes for:

- self-ingestion suppression through `MYELIN_CAPTURE_DISABLED=1`
- capture-side skip behavior for Myelin-owned provider sessions
- Codex structured output schema support for ingest worker output
- prompt sizing based on the actual prompt representation instead of full tombstone evidence
- smaller retained-evidence prompt excerpts while preserving full tombstone audit evidence
- SQLite open retry behavior for startup locking
- staggered detached worker startup
- provider process timeout plumbing
- lower default pipeline Codex reasoning effort for live ingest work

The final live state reported by the handoff was:

- active `experience_events` for `class-kit`: `0`
- running `ingest_jobs` for `class-kit`: `0`
- claimed tombstones for `class-kit`: `0`
- `session_memories` for `class-kit`: `236`
- `memory_candidates` for `class-kit`: `103`
- `project_handoff_instructions` for `class-kit`: `43`

These results prove the drain can complete under real load after stabilization. They do not prove that Session Memory is searchable, indexed, exposed to MCP, or consumed by Current Briefing.

## Product Boundary

This stabilization slice should cover:

- operator-visible recovery and retry behavior for failed provider work with tombstone-backed lease stubs
- status/readback that separates unleased active queue rows, tombstone-backed in-progress leases, running jobs, terminal tombstones, and generated outputs
- runtime limits for worker count, startup timing, provider timeout, prompt budget, and model/reasoning profile
- structured output validation and failure compaction
- a safe small real retest strategy after the stabilization changes are accepted
- roadmap language that marks Experience Log drain as complete while keeping query/retrieval as pending

This slice should not cover:

- Session Memory embedding/index implementation
- MCP query exposure
- Current Briefing integration
- Project/Practice/Personal promotion agents
- a full scheduler, retry daemon, cancellation manager, or multi-agent worker pool
- broad cleanup of unrelated ingest, memory, or runtime modules

## User-Facing Behavior

The operator should be able to answer four questions without raw SQLite spelunking:

1. What ingest work is still active?
2. What work failed or timed out?
3. Which tombstone-backed leases can be safely recovered, retried, or released?
4. What evidence proves a retry or recovery finished cleanly?

The existing `myelin ingest <project-key>` behavior remains the main write path. The stabilization design may add or refine operator surfaces around status and recovery, but it should not split the product vocabulary back into source-specific drain commands.

The design should preserve explicit operator-triggered ingest. It should not introduce always-on automatic ingest.

## Technical Design

### Runtime Safety Envelope

Detached ingest should keep a bounded runtime profile:

- workers run with capture disabled so Myelin-owned provider calls do not recursively capture themselves
- Codex-backed stages continue to run with `--sandbox read-only`
- worker output is constrained by a JSON schema when provider support exists
- prompt budgeting uses the same representation sent to the provider
- retained prompt evidence is bounded independently from tombstone audit retention
- process timeouts are explicit and visible in job failure metadata
- worker startup is staggered or concurrency-limited enough to avoid local SQLite lock storms
- ingest model/reasoning config for live drains is separated from broader pipeline defaults through a named ingest runtime profile in `myelin.config`
- local environment overrides remain available for debugging and emergency runs, but stable ingest behavior should not depend on undocumented env-only controls

### Tombstone-Backed Lease Then Commit Model

The approved ingest implementation moved rows into tombstones before the provider call. The live drain showed that this makes provider failure recovery too expensive: a dead provider can leave the active queue empty while tombstones still represent unfinished work.

The preferred stabilization model is:

- select a bounded batch of active Experience Log rows for the provider
- insert a minimal tombstone stub for each pulled row, keyed by `original_event_id` and `dedupe_key`, while leaving the source row in `experience_events`
- use the stub as the in-progress lease and duplicate-prevention record
- send the agent a prompt representation derived from the active row data, with a stable source reference that maps to the tombstone stub
- when the provider returns valid output, apply Session Memory/candidate/handoff writes, populate/finalize the tombstone rows, and delete the corresponding `experience_events` rows in one transaction
- when the provider fails or times out before valid output, keep the raw rows in `experience_events` and mark or recover the tombstone stubs so a later run can retry without reconstructing evidence from tombstones
- preserve finalized tombstones as terminal archive/audit records, while tombstone stubs serve as temporary in-progress leases

This approach reduces the need to requeue tombstone evidence manually. It still requires explicit stale-stub recovery semantics.

Stale-stub recovery should reuse the same tombstone stub for retry. The stub remains the one durable lease/audit identity for the original Experience Log row. Retry attempts append structured attempt/job history to the stub metadata instead of creating another tombstone for the same source row or deleting the stub. This preserves the current one-tombstone-per-source identity model and keeps the unique `original_event_id` / `dedupe_key` guard intact.

### Status Model

Status should separate lifecycle categories that were blurred during the live drain:

- active unleased queue rows still in `experience_events`
- in-progress tombstone stubs for rows that still exist in `experience_events`
- running or recently finished `ingest_jobs`
- failed/timeout tombstones or jobs
- terminal no-output tombstones
- generated Session Memory, Memory Candidate, and handoff output counts
- remaining embedding/index backlog, explicitly labeled as a later layer

The status model should avoid saying "ingest complete" when it only means "Experience Log queue drained." Use layered completion labels such as "Experience Log drain complete", "Session Memory write complete", and "Session Memory retrieval pending".

Implementation should back these labels with a simple numeric enum in code rather than ad hoc string comparisons. The enum represents the completion layer/stage; operator-facing output can map the numeric enum to readable labels.

### Output Failure Compaction

Provider failures can include huge prompt fragments, raw excerpts, or stderr. The stabilization design should decide how much failure detail belongs in durable job/tombstone metadata versus log files.

The likely direction is:

- durable state stores a compact error code, timeout/provider classification, retryability, and log reference
- log files preserve enough debugging context for local operators
- raw Experience Log text is not duplicated into tracked artifacts or broad status output

This policy is selected for the stabilization design. Durable failure state should be typed and compact; detailed stderr/stdout/prompt-adjacent debugging material belongs in local logs referenced from durable state.

### Retest Strategy

Before query/MCP retrieval work proceeds, Myelin should run one smaller real ingest retest that proves the runtime changes are durable without repeating the full class-kit drain.

The retest should be explicit about:

- target project and corpus size
- expected starting queue/job/tombstone counts
- expected terminal counts
- failure injection, if any
- exact verification commands
- what result is sufficient to unblock Session Memory indexing/query work

The selected strategy is two-part when feasible:

- run one small newly captured real batch in a bootstrapped project for end-to-end confidence
- keep a bounded replay/requeue fixture for recovery regression around tombstone-backed lease stubs

If only one is practical in the moment, prefer the small newly captured real batch.

## Data / State

This slice should prefer using existing tables and metadata fields where possible:

- `ingest_jobs`
- `experience_events`
- `experience_event_tombstones`
- `session_memories`
- `memory_candidates`
- Project/Practice/Personal handoff instruction tables
- detached worker log files under project logs

Schema changes are allowed only if existing state cannot represent recovery/status decisions without ambiguity. A broad job scheduler schema is out of scope.

If rows stay in `experience_events` until provider output is accepted, the tombstone row becomes the active lease record. A stub tombstone should contain only enough data to provide traceability and prevent duplicate claims:

- tombstone id
- original event id
- dedupe key
- project key
- ingest job id
- provider/session metadata when known
- claimed timestamp
- non-terminal state such as `claimed`
- source metadata needed for status/recovery
- retry/job history for stale-stub recovery

The full retained evidence payload should be populated at terminal commit time unless implementation proves a small bounded excerpt is needed in the stub for debugging. The raw source row remains the evidence source while the lease is in progress.

## Error Handling

The runtime should fail loud and recoverably:

- provider timeout produces a failed job or failed batch state with retryable metadata
- invalid structured output fails the batch/job without silently dropping claimed rows
- provider failure before accepted output leaves raw Experience Log rows present and retryable
- stale tombstone stubs are recoverable because the raw row still exists
- SQLite lock/open failures retry for a bounded period, then fail visibly
- capture suppression is explicit and narrowly scoped to Myelin-owned provider sessions
- branch/preflight failures happen before row lease or provider dispatch
- terminal tombstone population and raw-row deletion happen only after accepted output or explicit no-output terminalization

## Testing Strategy

Implementation planning should include:

- unit tests for capture suppression behavior
- LLM runner tests for structured output schema and timeout plumbing
- DB open retry tests or bounded integration coverage for lock handling
- worker prompt-budget tests that use prompt-sized tombstone representation
- status tests that report active, running, claimed, failed, terminal, and output counts separately
- retry tests proving provider failure leaves active rows present and retryable
- tombstone-stub tests proving pulled rows cannot be duplicated while raw rows remain present
- commit-to-tombstone tests proving accepted outputs, terminal tombstone population, and raw-row deletion are applied atomically
- a real small ingest retest after code verification

Repo-native verification remains:

```bash
bun test
bun run typecheck
git diff --check
```

## Planning Boundary Guidance

Later implementation planning should split this design into smaller chunks:

- status/readback classification and operator output
- tombstone-backed lease then commit queue lifecycle
- retry behavior for provider failure before terminal output
- named ingest runtime profile config for concurrency, startup delay, timeout, prompt budget, and model/reasoning profile
- structured output and failure compaction hardening
- docs/roadmap reconciliation and retest checklist
- small real ingest retest execution plus bounded recovery replay fixture

Do not bundle Session Memory embedding/index work into these chunks. The embedding/index design in `docs/design/2026-06-13-session-memory-embedding-index/spec.md` should wait until ingest runtime stabilization is accepted and retested.

## Acceptance Criteria

The design is ready for implementation planning when:

- it defines what "Experience Log drain complete" means versus what remains incomplete
- recovery/retry behavior after provider failure is unambiguous
- status output distinguishes unleased active queue rows, tombstone-backed in-progress leases, running jobs, terminal tombstones, and generated outputs
- tombstone stub contents, terminal population, and stale-stub recovery behavior are specified
- runtime limit knobs are named and scoped without adding a full scheduler
- provider failure details have a compact durable-state policy
- a smaller real retest strategy is defined before query/MCP work resumes
- the agenda records whether `CONTEXT.md` or ADR changes were needed

## Assumptions

- The existing live stabilization diff remains uncommitted while this design is drafted.
- The `class-kit` full drain result is useful evidence but should not be repeated as the next retest by default.
- The current glossary terms in `CONTEXT.md` are sufficient unless this design introduces a new canonical term for recovery.
- The user still wants inline work for this cleanup rather than a Symphony/Trello task.

## Design Agenda

The live decision trail is in `agenda.md`.
