# Session Memory And Ingest

Session Memory and ingest turn captured agent activity into project-scoped continuity records without treating raw conversation history as canonical truth.

## Boundary

The Session Memory layer starts with provider hook capture and ends with SQLite records that can be reconciled, queried, indexed, or routed for later curation. It does not update curated Project Memory wiki pages directly. That boundary is explicit in `src/ingest/worker.ts`: ingest agents are prompted to create low-risk Session Memory directly, create candidates for ambiguous or risky outputs, create one-hop handoff instructions, and avoid mutating curated wiki pages.

The active product vocabulary is top-level `myelin ingest <project-key>`, not `project ingest`. `docs/CLI.md` defines `ingest` as the Experience Log to Session Memory pipeline, while `project learn` owns Project Memory source and runtime-inbox intake.

## Capture

Capture is deterministic and fail-open. `src/capture/capture-service.ts` accepts provider payloads, currently Codex hook payloads, normalizes them, and delegates to `src/capture/facade.ts`.

`src/capture/providers/codex.ts` maps Codex hooks into provider-neutral events:

- `SessionStart` becomes `session.start` with no raw text.
- `UserPromptSubmit` with a string prompt becomes `user.prompt` and stores the prompt as raw text.
- `Stop` with a non-empty `last_assistant_message` becomes `assistant.response`.
- Unknown or malformed hooks are still representable as invalid events instead of crashing capture.

`handleCaptureEvent` in `src/capture/facade.ts` drops events without a registered project match. For registered repositories, it stores the event in the root memory database through `recordExperienceEvent`, adds git context from `src/capture/git-context.ts`, and then asks `AutoMemoryMaintenanceService` whether maintenance should be scheduled. Scheduling errors are swallowed so hooks do not block the provider. If database storage itself fails, capture records a hook error in SQLite when possible, or appends `state/hook-errors.jsonl` as a fallback.

Git context is intentionally small: `readGitWorktreeContext` records resolved `repo_path`, current `git_branch`, current `git_commit`, and uses the resolved repo path as `git_worktree_id`. Git command failures produce null fields rather than failing capture.

## Experience Log Storage

`src/memory/experience.ts` owns Experience Log rows and tombstones. Active raw events live in `experience_events` and include provider identifiers, hook metadata, raw text, raw payload JSON, status, cwd, repo path, branch, commit, worktree id, and a provider dedupe key when provider/session/turn/hook are available.

Experience Log rows are evidence, not truth. `CONTEXT.md` defines the Experience Log as raw captured agent activity used as evidence, and defines Experience Log Tombstones as audit records that begin as in-progress lease stubs and end as terminal archives after ingest decides whether the source row produced output.

The dedupe boundary spans both active events and tombstones. `recordExperienceEvent` returns no new row when the same original event id or dedupe key already exists in `experience_event_tombstones`, which prevents already-processed provider events from returning to the active queue.

## Starting Ingest

`src/ingest/ingest-service.ts` is the service boundary behind top-level ingest. `start` loads config, resolves the project target repo from the first configured `repo_paths` entry, reads the target branch for reporting, counts queued Experience Log rows, splits selected rows into batches, creates `ingest_jobs` rows, and launches detached workers.

Batching is controlled by `INGEST_BATCH_SIZE`, defaulting to 100 and capped at 500 in `src/runtime/config.ts`. Each job records input JSON with the target repo, target branch, batch size, batch index/count, and configured worker concurrency. The first job is returned for compatibility, but the start result includes all created jobs and launch records.

`src/ingest/runtime.ts` launches detached workers with:

- command `bun <root>/src/cli.ts ingest worker <job-id>`
- cwd set to the target repository
- logs under `projects/<project-key>/logs/ingest-<job-id>.log`
- `MYELIN_CAPTURE_DISABLED=1` so Myelin-owned workers do not recursively capture themselves
- job follow-up state containing pid, log path, target repo, and branch

Status reads are allowed to repair stale process state. `refreshDetachedIngestJobStatus` marks a running job failed with `detached_worker_exited` when its recorded pid is no longer alive before the job reaches a terminal status.

Operators can list and resolve failed jobs through the ingest jobs CLI. `docs/CLI.md` documents `myelin ingest jobs resolve`, which marks selected failed jobs completed, clears `error_json`, and keeps the previous error and resolution metadata under `followup_state_json.resolved_failed_job`.

## Tombstone Leases

The lease boundary is the core ingest safety mechanism. `leaseExperienceEvents` first recovers claimed tombstones from failed ingest jobs that still have source rows, then leases unclaimed active events. New leases insert `experience_event_tombstones` rows in `claimed` state but do not immediately delete the active `experience_events` row. This tombstone stub prevents duplicate active workers from claiming the same event while keeping the source row available until output is accepted.

When a worker output is accepted, `applyIngestWorkerOutput` finalizes referenced tombstones as `output` with concrete output references. If the model explicitly returns `no_output_tombstone_ids`, those claimed tombstones are finalized as `no_output`. At worker completion, any remaining claimed tombstones for the job are automatically finalized as `no_output`.

The older `claimExperienceEvents` and `finalizeClaimedExperienceEvents` helpers delete active rows during claim/finalization, but the current worker path uses tombstone lease stubs and `finalizeLeasedExperienceEventsInOpenTransaction`.

Terminal tombstone states are `output`, `no_output`, `failed`, and `unfinished`; active leases remain `claimed`. `src/ingest/status.ts` counts terminal tombstones separately from active and leased events so operators can distinguish queue drain from useful output production.

## Worker Prompt And Reconciliation

`runIngestWorker` repeatedly leases bounded batches, builds a reconciliation prompt, invokes the configured provider from the target repo cwd, validates JSON output, applies the output transactionally, and updates job status. Provider failures mark the job `failed` with a compact retryable error.

The prompt includes:

- project key, ingest job id, and batch position when parallel batches are running
- project ingest completion status from `readIngestProjectStatus`
- existing active Session Memory context selected for reconciliation
- leased tombstone ids, source metadata, and retained prompt evidence

Prompt budgeting is defensive. The worker reserves a safety margin under the provider prompt limit, caps reconciliation context to 25,000 characters, truncates retained evidence in the prompt after 6,000 characters, and preserves full evidence in tombstone audit rows.

`src/ingest/reconciliation-context.ts` selects existing active Session Memory to present to the worker. It combines semantic search when embeddings are available, active `next_action` memories, recent active memories, branch-matched memories, and repo-path-matched memories. Reconciliation operations are constrained to the supplied context: the worker may supersede, retract, or noop only active memory ids it was shown. Tests in `tests/ingest/worker.test.ts` cover rejection of reconciliation outside the supplied context and tolerance for parallel batches that made a supplied memory inactive before commit.

## Outputs

The provider JSON contract is parsed by `parseIngestWorkerOutput` in `src/ingest/worker.ts`. Allowed direct Session Memory kinds are `continuity`, `decision`, `blocker`, `next_action`, and `verification`.

Direct Session Memory is written by `createSessionMemory` in `src/memory/session-memories.ts`. Rows are active by default, retain source tombstone refs, provider/session/job metadata, summary, payload, confidence, risk, and lifecycle fields for supersession or retraction. Creating Session Memory also creates pending embedding metadata by default, using the active retrieval document embedding contract.

For every created Session Memory row, `contextsForSessionMemory` copies tombstone source metadata into `session_memory_contexts`: repo path, git branch, git commit, worktree id, and source event ref. This is the branch and repository context bridge between capture and later retrieval or reconciliation filtering.

Ambiguous or risky outputs become memory candidates via `src/memory/candidates.ts`. Candidates have scope `session`, `project`, `practice`, or `personal`; status `pending` or `needs_review` at provider creation time; a stable `candidate_type`; evidence; proposed payload; confidence; risk; and reason. Project-scoped candidates can later be marked processed.

One-hop downstream work becomes handoff instructions via `src/memory/handoffs.ts`. Handoffs target `project`, `practice`, or `personal` tables, store an objective, prompt text, source Session Memory ids, source tombstones, suggested actions, confidence, risk, and reason. Project handoffs can later be marked processed. Ingest status counts all three handoff scopes together.

Session Memory lifecycle changes never delete rows. Supersession marks the old active row `superseded`, records `superseded_by` and lifecycle reason, and writes a relationship link with one of `supersedes`, `refines`, `contradicts`, or `duplicates`. Retraction marks an active row `retracted` with a lifecycle reason. Completed or stale `next_action` memories are expected to be superseded or retracted rather than kept active.

## Status

`src/ingest/status.ts` reports project-level completion as layered state:

- `Experience Log drain pending` when active events, leased events, or running jobs remain.
- `Experience Log drain complete` when the queue is drained but no Session Memory, candidates, or handoffs exist.
- `Session Memory retrieval pending` when outputs exist but active Session Memory embeddings are pending or failed.
- `Session Memory write complete` when outputs exist and active Session Memory retrieval rows are indexed or otherwise not pending.

The status result includes counts for active events, unleased events, leased events, running jobs, failed jobs, terminal tombstones, Session Memory rows, memory candidates, handoff instructions, and pending Session Memory embeddings.

## Auto-Maintenance

Auto-maintenance is optional and hook-triggered only after an event is stored. `AutoMemoryMaintenanceService.maybeSchedule` in `src/maintenance/auto-memory-maintenance.ts` is disabled unless `AUTO_MEMORY_MAINTENANCE=1`. It also skips when running inside Myelin-owned workers, when an ingest job is already running, when queued events are below `AUTO_MEMORY_MIN_CAPTURED_EVENTS`, when cooldown is active, or when a project maintenance lock is held.

Defaults in `src/runtime/config.ts` are conservative: minimum captured events 10, cooldown 5 minutes, drain poll interval 5 seconds, drain timeout 10 minutes, and indexing limit 500. A scheduled run creates `projects/<project-key>/state/.auto-memory-maintenance.lock`, writes state to `projects/<project-key>/state/auto-memory-maintenance.json`, logs to `projects/<project-key>/logs/<run-id>.log`, and spawns `bun src/maintenance/worker.ts <project-key>` with capture disabled.

The maintenance worker adopts or acquires the project lock, starts ingest with the configured default provider, waits until running ingest jobs drain, then indexes pending Session Memory embeddings through `SessionMemoryIndexService`. It records completed or failed state with counts for queued rows, indexed rows, failed indexing rows, and pending rows. If a previous scheduled or running maintenance worker pid is dead, scheduling can clear the dead lock, mark the old run failed, and schedule a replacement.

## Known Gaps

- Session Memory query integration is narrower than the long-term product model. The repository docs say Session Memory vector retrieval is still an internal facade, with MCP exposure, Current Briefing integration, and non-Session Memory vectorization deferred.
- Practice and Personal outputs are represented as candidates or handoff instructions, not automatically promoted durable memories.
- Auto-maintenance can drain and index, but it is threshold-, cooldown-, and lock-gated; capture itself remains cheap and does not make durable truth decisions.
