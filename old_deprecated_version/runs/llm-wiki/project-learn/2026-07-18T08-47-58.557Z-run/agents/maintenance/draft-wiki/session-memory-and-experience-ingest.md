# Session Memory and Experience Ingest

Session Memory and Experience Ingest turn captured agent activity into short-lived, repo-scoped memory records, review queues, and downstream handoff instructions without treating raw conversation logs as canonical Project Memory.

## Boundary

The active pipeline is `myelin ingest <project-key>`, not `project ingest`. `docs/CLI.md` defines it as the top-level Experience Log to Session Memory pipeline, and `README.md` notes that it batches queued Experience Log rows by `INGEST_BATCH_SIZE`, defaulting to `100` and accepting at most `500`.

This layer owns:

- cheap hook capture into `experience_events`
- detached ingest job creation and worker launch
- leasing Experience Log rows into tombstone audit records
- direct trusted `session_memories`
- lower-trust `memory_candidates`
- project/practice/personal `handoff_instructions`
- Session Memory lifecycle reconciliation, including supersession and retraction
- optional auto-maintenance that runs ingest and indexes pending Session Memory embeddings

It does not directly update curated wiki pages. The ingest prompt in `src/ingest/worker.ts` explicitly tells the worker not to mutate curated wiki pages and to create Project/Practice/Personal handoff instructions only as one-hop downstream inputs.

## Capture Flow

Codex hook payloads enter through `src/capture/capture-service.ts`, which normalizes provider payloads with `src/capture/providers/codex.ts` and delegates to `handleCaptureEvent` in `src/capture/facade.ts`.

Capture is intentionally fail-open and deterministic:

- events without a `cwd`, or with a `cwd` that cannot be routed to a registered project, are dropped as `dropped-unregistered-repo`
- routed events are inserted into `experience_events` through `recordExperienceEvent` in `src/memory/experience.ts`
- duplicate provider turns are deduplicated through a provider/session/turn key when available
- hook failures are recorded in `hook_errors`, or appended to `state/hook-errors.jsonl` if the database cannot be opened
- auto-maintenance scheduling failures are swallowed so hook capture is not blocked

Capture also records branch context. `src/capture/git-context.ts` reads `git branch --show-current` and `git rev-parse HEAD` for the matched repo path, returning nulls when git metadata cannot be read. The stored row keeps `repo_path`, `git_branch`, `git_commit`, and `git_worktree_id`; `tests/capture/facade.test.ts` verifies both branch capture and fail-open behavior.

## Experience Log Tables

`src/memory/migrations.ts` defines `experience_events` as the active queue and `experience_event_tombstones` as the lease/audit table. Raw rows store provider metadata, raw text, raw payload JSON, routing status, repo path, branch, commit, worktree id, and insertion time.

Tombstones preserve processing state:

- `claimed` means an ingest job has leased the row
- `output` means at least one durable output references the tombstone
- `no_output` means the row was reviewed but produced no durable output
- `failed` and `unfinished` mark terminal non-success states for older claimed flows

The current lease path keeps the source `experience_events` row until finalization. `leaseExperienceEvents` creates a claimed tombstone stub with retained prompt evidence, and `finalizeLeasedExperienceEventsInOpenTransaction` stores retained evidence and deletes the source row only after a terminal decision is written. This makes failed or dead worker leases recoverable while the source row still exists.

## Detached Ingest Jobs

`IngestService.start` in `src/ingest/ingest-service.ts` resolves the registered target repo, reads the current branch, counts queued Experience Log rows, creates one `ingest_jobs` row per batch, and launches a detached worker for each batch. Worker input is stored in `ingest_jobs.input_json` with the target repo, target branch, batch size, batch index, batch count, and worker concurrency.

The start result's `queued_count` is a point-in-time count of active `experience_events`, and `selected_count` is that raw count capped by the requested limit. It is not a claimability guarantee: leased rows remain in `experience_events` until their terminal tombstone decision, so a concurrent worker can make part of that snapshot unavailable before a newly started worker claims it. The CLI reports those fields as `queued` and `selected`; operators should use ingest status for the current leased/running breakdown rather than interpret the start line as an exclusive-work reservation. This is an accounting distinction, not a documented product gap. `src/ingest/ingest-service.ts`, `src/memory/experience.ts`, and `tests/ingest/worker.test.ts` establish the retained-row lease lifecycle.

Detached launch lives in `src/ingest/runtime.ts`. Workers run:

```bash
bun <myelin-root>/src/cli.ts ingest worker <job-id>
```

from the target repo cwd, with `MYELIN_ROOT`, `MYELIN_INGEST_JOB_ID`, `MYELIN_INGEST_PROJECT`, and `MYELIN_CAPTURE_DISABLED=1` in the environment. Logs go to `runs/<project-key>/logs/ingest-<job-id>.log`. If launch fails, the job is marked `failed` with `error_json.code = "detached_worker_launch_failed"`.

Branch context is warning and routing metadata, not a gate. Tests in `tests/ingest/ingest-service.test.ts` and `tests/ingest/runtime.test.ts` verify that non-`master` branches are allowed and recorded in job metadata.

## Worker Prompt And Outputs

`runIngestWorker` in `src/ingest/worker.ts` loops over leased batches until the job limit is exhausted or no rows remain. Each loop:

1. reads project ingest status from `src/ingest/status.ts`
2. leases rows with a prompt-size budget
3. selects existing active Session Memory context for reconciliation
4. builds a JSON-only prompt
5. invokes the configured provider
6. validates the provider JSON with `parseIngestWorkerOutput`
7. applies outputs transactionally

The prompt tells the agent to create only low-risk trusted Session Memory directly. Ambiguous, risky, conflicting, or privacy-sensitive findings should become memory candidates instead. Existing Session Memory reconciliation is limited to memories supplied in the reconciliation context.

Accepted output categories are:

- `session_memories`
- `memory_candidates`
- `handoff_instructions`
- `memory_supersessions`
- `memory_retractions`
- `memory_noops`
- `no_output_tombstone_ids`
- `terminal_summary`

Every session memory, candidate, handoff, supersession, and retraction must reference leased tombstone IDs in `source_event_refs`. Outputs that reference no currently claimable tombstones are skipped. Tombstones with durable outputs are finalized as `output`; explicitly reviewed tombstones with no output are finalized as `no_output`; any remaining claimed leases are finalized as `no_output` at worker shutdown.

## Session Memory Records

`src/memory/session-memories.ts` stores trusted records in `session_memories`. Allowed kinds are defined in `src/memory/ingest-types.ts`:

- `continuity`
- `decision`
- `blocker`
- `next_action`
- `verification`

Each record has source tombstone refs, provider/job metadata, summary, payload JSON, confidence, risk, and lifecycle status. New active records also enqueue pending embedding work through `ensurePendingSessionMemoryEmbedding` unless embedding is explicitly disabled.

`applyIngestWorkerOutput` also writes `session_memory_contexts` for each source tombstone, copying `repo_path`, `git_branch`, `git_commit`, and `git_worktree_id` from tombstone metadata. `src/ingest/reconciliation-context.ts` later uses those contexts to select relevant existing memory by semantic query, active next actions, recency, branch, and repo path.

Session Memory is not physically deleted during reconciliation. A replacement memory plus `memory_supersessions` marks the old record `superseded` and writes a relationship link such as `supersedes`, `refines`, `contradicts`, or `duplicates`. A `memory_retractions` item marks an active record `retracted` when it should no longer be trusted and no replacement is appropriate. Tests in `tests/ingest/worker.test.ts` cover direct writes, supersession, retraction, stale parallel-worker cases, candidates, handoffs, and tombstone finalization.

## Candidates And Handoffs

`src/memory/candidates.ts` stores reviewable `memory_candidates` for scopes `session`, `project`, `practice`, and `personal`. Provider-created candidate statuses are `pending` or `needs_review`; terminal operator states are `processed` and `rejected`. Candidate rows preserve source tombstones, evidence JSON, proposed payload JSON, confidence, risk, and the reason review is needed.

Provider worker output makes candidates evidence-bearing leads. Its `evidence` object requires a non-empty `observed_facts` array plus `relevant_paths` and `uncertainties` arrays; its `proposed_payload` requires a non-empty `durable_facts` array plus a non-empty `change_kind` string, `suggested_subjects`, and `verification_needed`. The four non-fact fields that are arrays may be empty, but neither required fact array may be omitted or empty. `src/ingest/worker-output.schema.json` enforces the shape, and `tests/ingest/worker.test.ts` covers rejection of missing observed facts. This provider-output contract is distinct from runtime-inbox intake, which normalizes its separately authored source metadata into a candidate.

`src/memory/handoffs.ts` stores one-hop downstream instructions in separate `project_handoff_instructions`, `practice_handoff_instructions`, and `personal_handoff_instructions` tables. Handoffs carry an objective, prompt text, suggested actions, source Session Memory ids, source tombstones, confidence, risk, and status. Project candidate and project handoff records can be marked processed by deterministic lifecycle helpers when later Project Memory work consumes them.

The boundary is deliberate: candidates are possible durable memory; handoffs are instructions for a later layer. Neither one is equivalent to a committed wiki fact.

## Status And Recovery

Project-level ingest status in `src/ingest/status.ts` reports active events, unleased events, claimed leases, running and failed jobs, terminal tombstones, Session Memory count, candidate count, handoff count, and pending Session Memory embeddings.

Completion labels are layered:

- `Experience Log drain pending` when active rows, leased rows, or running jobs remain
- `Experience Log retry pending` when failed jobs leave recoverable leases
- `Experience Log drain complete` when there is no output and no active drain work
- `Session Memory retrieval pending` when outputs exist but active Session Memory embeddings are pending or failed
- `Session Memory write complete` when outputs exist and retrieval indexing is not pending

`refreshDetachedIngestJobStatus` marks a running job failed if its recorded PID is no longer alive. Recoverable claimed tombstones are selected before new rows on the next lease attempt, and their metadata records the prior attempt.

## Auto-Maintenance

Auto-maintenance is optional and configured through `AUTO_MEMORY_MAINTENANCE` and related runtime variables. `src/maintenance/auto-memory-maintenance.ts` schedules from capture only after a row is stored and only when:

- auto-maintenance is enabled
- the process is not a Myelin-owned worker with capture disabled
- no ingest job is already running for the project
- queued event count meets `AUTO_MEMORY_MIN_CAPTURED_EVENTS`
- cooldown has expired
- the project lock can be acquired or a dead worker lock can be cleared

Ordinary prompt and stop events follow the threshold and cooldown. A captured `SessionStart` explicitly bypasses both gates and launches one bounded ingest window when rows are queued. This flushes a short previous session before the new session depends on it; running-job and lock guards still prevent duplicate workers. Codex `Stop` is only an assistant-turn boundary and does not force a drain.

Scheduled workers run `bun src/maintenance/worker.ts <project-key>` detached, write logs under `runs/<project-key>/logs/<run-id>.log`, and store state in `state/<project-key>/auto-memory-maintenance.json`. The worker runs `IngestService.start`, waits for ingest drain with configured polling and timeout, then indexes pending Session Memory embeddings through `SessionMemoryIndexService`. Tests in `tests/maintenance/auto-memory-maintenance.test.ts` cover disabled mode, threshold gating, forced SessionStart drain, lock behavior, dead-lock recovery, and completed state recording.

Auto-maintenance is bounded background maintenance, not recursive self-capture: it runs with `MYELIN_CAPTURE_DISABLED=1` and `MYELIN_AUTO_MEMORY_MAINTENANCE_WORKER=1`.

## Verification Evidence

Primary implementation evidence:

- `src/capture/facade.ts`
- `src/capture/git-context.ts`
- `src/capture/capture-service.ts`
- `src/ingest/ingest-service.ts`
- `src/ingest/runtime.ts`
- `src/ingest/worker.ts`
- `src/ingest/status.ts`
- `src/ingest/reconciliation-context.ts`
- `src/maintenance/auto-memory-maintenance.ts`
- `src/memory/experience.ts`
- `src/memory/session-memories.ts`
- `src/memory/candidates.ts`
- `src/memory/handoffs.ts`
- `src/memory/ingest-types.ts`
- `src/memory/migrations.ts`

Primary test evidence:

- `tests/capture/facade.test.ts`
- `tests/capture/capture-service.test.ts`
- `tests/capture/providers/codex.test.ts`
- `tests/ingest/ingest-service.test.ts`
- `tests/ingest/runtime.test.ts`
- `tests/ingest/worker.test.ts`
- `tests/ingest/reconciliation-context.test.ts`
- `tests/ingest/status.test.ts`
- `tests/maintenance/auto-memory-maintenance.test.ts`
