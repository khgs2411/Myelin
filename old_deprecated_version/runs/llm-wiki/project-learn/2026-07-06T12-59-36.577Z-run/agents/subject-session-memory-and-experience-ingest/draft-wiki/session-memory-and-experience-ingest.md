# Session Memory And Experience Ingest

Session Memory turns noisy per-turn agent activity into project-scoped continuity records, review candidates, and downstream handoffs without treating raw hook payloads as durable truth.

## Capture Boundary

Capture starts in provider adapters and is intentionally fail-open. The Codex adapter in `src/capture/providers/codex.ts` normalizes hook payloads into provider-neutral events: `SessionStart` becomes `session.start`, `UserPromptSubmit` with a prompt becomes `user.prompt`, and `Stop` with a non-empty `last_assistant_message` becomes `assistant.response`; unknown or empty hook payloads are stored as `invalid` evidence rather than blocking the agent.

`src/capture/facade.ts` is the routing boundary. It drops events without a `cwd`, drops events whose `cwd` is not inside a registered project repo, enriches accepted events with repo path, git branch, git commit, and worktree id, then writes an Experience Log row through `src/memory/experience.ts`. Capture errors are recorded in `hook_errors` or the fallback `state/hook-errors.jsonl`, and the hook returns a failed-open status instead of interrupting provider workflow.

After storing an event, capture calls `AutoMemoryMaintenanceService.maybeSchedule`. Scheduling failures are swallowed because hook capture must stay reliable even when maintenance is unhealthy.

## Experience Log Storage

The Experience Log is SQLite state, not curated memory. `src/memory/migrations.ts` defines `experience_events` with provider/session/turn fields, raw text, raw payload JSON, validity status, git context, and a dedupe key. `recordExperienceEvent` in `src/memory/experience.ts` refuses to insert a duplicate if a matching tombstone already exists, then inserts with `INSERT OR IGNORE`.

The active queue is `experience_events`. Terminal audit state is `experience_event_tombstones`, whose states are defined in `src/memory/ingest-types.ts`: `claimed`, `output`, `no_output`, `failed`, and `unfinished`. Tombstones preserve source metadata and retained evidence, plus output references that explain which Session Memory, candidate, handoff, or lifecycle operation consumed the row.

## Ingest Command And Detached Workers

Top-level `myelin ingest <project-key>` is the Experience Log to Session Memory pipeline. `docs/CLI.md` documents the command as launching detached provider-backed workers, and `src/ingest/ingest-service.ts` implements that behavior. The service counts queued Experience Log rows, applies `--limit` and batch size, creates one `ingest_jobs` row per batch, and launches each batch through `src/ingest/runtime.ts`.

Detached workers run from the target repository cwd, not from the Myelin repo. `spawnDetachedIngestWorker` invokes:

```bash
bun <myelin-root>/src/cli.ts ingest worker <job-id>
```

with `MYELIN_ROOT`, `MYELIN_INGEST_JOB_ID`, `MYELIN_INGEST_PROJECT`, and `MYELIN_CAPTURE_DISABLED=1`. Worker stdout/stderr goes to `projects/<project-key>/logs/ingest-<job-id>.log`. The capture-disabled environment flag prevents Myelin-owned workers from recursively capturing their own maintenance activity.

`myelin ingest status` refreshes stale running jobs when the recorded PID is no longer alive. Project-level status is computed in `src/ingest/status.ts` from active events, leased events, running and failed jobs, terminal tombstones, output counts, and pending Session Memory embeddings.

## Tombstone-Backed Leasing

Workers do not delete raw Experience Log rows before provider output is accepted. `leaseExperienceEvents` in `src/memory/experience.ts` first recovers claimed tombstones from failed jobs when the original source row still exists, then inserts `claimed` tombstone lease stubs for unleased rows. The raw source row remains available while the worker asks the provider to classify the leased evidence.

On successful output commit, `finalizeLeasedExperienceEventsInOpenTransaction` copies retained evidence from the source row into the tombstone, marks the tombstone `output` or `no_output`, stores output references, and then deletes the source `experience_events` row. If a worker fails, `runIngestWorker` marks the job `failed` with a compact retryable error, leaving claimed leases recoverable by a later job.

This lease design is the reliability boundary: raw Experience Log rows are not discarded until a terminal tombstone records the outcome.

## Worker Output Contract

`src/ingest/worker.ts` prompts the provider to return JSON only. The accepted output categories are:

- `session_memories`
- `memory_candidates`
- `handoff_instructions`
- `memory_supersessions`
- `memory_retractions`
- `memory_noops`
- `no_output_tombstone_ids`
- `terminal_summary`

The parser validates shape, enum values, non-empty source tombstone refs, candidate statuses, handoff scopes, Session Memory kinds, and Session Memory link relationships. The JSON schema used for provider invocation lives at `src/ingest/worker-output.schema.json`.

Prompt construction includes project maintenance status, leased Experience Log rows, and bounded reconciliation context from existing active Session Memory. The prompt tells workers to create only low-risk trusted Session Memory directly, route ambiguous or risky outputs to candidates, and use handoffs as one-hop downstream instructions. Prompt budgeting keeps fixed instructions, leased evidence, and reconciliation context under the provider prompt size limit.

## Session Memory Outputs

Trusted Session Memory records are stored in `session_memories` through `src/memory/session-memories.ts`. Allowed kinds are `continuity`, `decision`, `blocker`, `next_action`, and `verification`. Records include provider metadata, ingest job id, source tombstone refs, summary, payload JSON, confidence, risk, and lifecycle status.

New Session Memory starts as `active`. Reconciliation can mark prior active memory as `superseded` or `retracted`; physical deletion is not the lifecycle mechanism. Supersessions also create rows in `session_memory_links` with relationships such as `supersedes`, `refines`, `contradicts`, or `duplicates`.

`applyIngestWorkerOutput` creates branch-aware context rows through `src/memory/session-memory-contexts.ts` by copying repo path, git branch, git commit, and worktree id from source tombstone metadata. This is the source for later branch-filtered Session Memory retrieval.

Creating a Session Memory also creates pending embedding metadata by default through `ensurePendingSessionMemoryEmbedding`. Retrieval indexing is explicit operator work via `myelin memory index session <project-key>`, or automatic maintenance work when enabled.

## Candidates And Handoffs

Memory candidates are the review queue for evidence that should not become trusted memory immediately. `src/memory/candidates.ts` stores candidates with scope `session`, `project`, `practice`, or `personal`; status `pending`, `needs_review`, `processed`, or `rejected`; a dotted `candidate_type`; evidence JSON; proposed payload JSON; confidence; risk; and reason. Project Memory candidate lifecycle helpers can mark project-scope candidates processed after downstream consumption.

Handoffs are downstream prompts, not direct memory promotion. `src/memory/handoffs.ts` stores separate tables for project, practice, and personal handoff instructions. Each handoff records objective, prompt text, source Session Memory ids, source tombstone refs, suggested actions, reason, confidence, risk, and lifecycle status. Project handoffs can be marked processed when a downstream project-memory workflow consumes them.

## Auto-Maintenance

Auto-maintenance is optional and detached. `src/maintenance/auto-memory-maintenance.ts` reads `AUTO_MEMORY_MAINTENANCE` and related config; if disabled, scheduling returns disabled. If enabled, scheduling checks queued Experience Log count, running ingest jobs, minimum captured-event threshold, cooldown, and a project lock at `projects/<key>/state/.auto-memory-maintenance.lock`.

When scheduling succeeds, Myelin spawns:

```bash
bun <myelin-root>/src/maintenance/worker.ts <project-key>
```

with `MYELIN_CAPTURE_DISABLED=1`, `MYELIN_AUTO_MEMORY_MAINTENANCE_WORKER=1`, and `MYELIN_AUTO_MEMORY_RUN_ID`. State is written to `projects/<key>/state/auto-memory-maintenance.json`, and logs go to `projects/<key>/logs/<run-id>.log`.

The maintenance worker starts ingest through `IngestService`, waits until project-level ingest status has no running jobs, then indexes pending Session Memory embeddings through `SessionMemoryIndexService`. It records indexed, failed, and pending counts in the state file. If a scheduled/running lock belongs to a dead PID, the scheduler can mark that prior run failed, clear the lock, and schedule a new worker.

## Current Completion State

`docs/ROADMAP.md` marks the Session Memory layer complete for the current slice: capture persists provider-neutral Experience Log rows; ingest runs detached provider-backed workers; tombstone leases prevent source loss before terminal output; workers write Session Memory, candidates, handoffs, supersessions, retractions, noops, and terminal tombstone state; branch context is preserved; prompt packing is bounded; Session Memory creates pending embedding metadata; manual and auto indexing exist; and auto-maintenance is detached, lock-guarded, cooldown-guarded, and recursion-safe.

The main remaining boundary to remember is product semantics, not mechanics: Experience Log rows are noisy evidence, Session Memory is trusted but project-scoped continuity, candidates are review queues, and handoffs are one-hop inputs to other memory layers.
