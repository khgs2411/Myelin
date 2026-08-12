# Capture Session Ingest And Maintenance

Capture Session Ingest And Maintenance is the Myelin path that turns provider hook events into queued Experience Log rows, detached ingest jobs, trusted Session Memory, review candidates, handoff instructions, and optional embedding maintenance.

## System Flow

The runtime is deliberately split into deterministic capture, provider-backed ingest, and automated maintenance:

1. `src/commands/capture.ts` receives provider hook payloads, currently through `myelin capture codex-hook`, and fails open so agent sessions are not interrupted.
2. `src/capture/providers/codex.ts` normalizes Codex hook payloads into capture events such as `session.start`, `user.prompt`, and `assistant.response`.
3. `src/capture/facade.ts` routes events to the registered project by `cwd`, adds git context from `src/capture/git-context.ts`, and stores them through `src/memory/experience.ts`.
4. `src/ingest/ingest-service.ts` starts one or more detached ingest jobs for queued Experience Log rows.
5. `src/ingest/worker.ts` leases rows into tombstones, builds a JSON-only LLM prompt, validates worker output, writes Session Memory/candidates/handoffs, and finalizes tombstones.
6. `src/maintenance/auto-memory-maintenance.ts` can schedule a detached maintenance worker after capture. That worker runs ingest, waits for jobs to drain, then indexes pending Session Memory embeddings.

The main durability boundary is SQLite state under `state/memory.db`. Capture rows live in `experience_events`; processing audit rows live in `experience_event_tombstones`; durable outputs live in `session_memories`, `memory_candidates`, `*_handoff_instructions`, `session_memory_contexts`, and `session_memory_links`.

## Capture Hooks And Experience Log

`src/commands/capture.ts` registers `capture codex-hook`. The command reads JSON from stdin, calls `CaptureService.captureCodexPayload`, and swallows all errors. `MYELIN_CAPTURE_DISABLED=1` disables capture, which Myelin-owned workers use to avoid recursive capture.

`src/capture/providers/codex.ts` is the Codex-specific normalization layer:

- `SessionStart` becomes a valid `session.start` event with no `raw_text`.
- `UserPromptSubmit` with a string `prompt` becomes a valid `user.prompt` event.
- `Stop` with a non-empty `last_assistant_message` becomes a valid `assistant.response` event.
- Unknown or incomplete payloads are stored as `invalid` events rather than throwing.

`src/capture/facade.ts` resolves the project from `cwd` using `projectForRepoPath`, picks the matching configured repo path, reads git branch/commit/worktree metadata, and records the row. If the `cwd` is absent or does not belong to a registered project, capture returns `dropped-unregistered-repo`.

Capture is fail-open by design. On storage or routing errors, it records a hook error in the `hook_errors` table when SQLite is available, or appends JSONL to `state/hook-errors.jsonl` as a fallback. Auto-maintenance scheduling errors are also swallowed after the event has been stored.

`src/memory/experience.ts` owns Experience Log persistence. `recordExperienceEvent` writes `experience_events` with provider/session/turn metadata, raw payload, optional raw text, source, status, repo path, git branch, git commit, git worktree id, and a provider dedupe key. It refuses to requeue events already represented by a tombstone and relies on the `experience_events_dedupe_key` unique index for duplicate suppression.

## Detached Ingest Jobs

Manual ingest is the top-level command documented in `docs/CLI.md` and implemented by `src/commands/ingest.ts`:

```bash
myelin ingest <project-key> [--limit N] [--batch-size N] [--provider codex|claude] [--json]
myelin ingest status <ingest-job-id> [--json]
myelin ingest status --project <project-key> [--json]
myelin ingest jobs <project-key> [--status starting|running|needs_followup|completed|failed] [--limit N] [--json]
myelin ingest jobs resolve <project-key> (--id <job-id> | --all) --reason <text> [--code <error-code>] [--dry-run] [--json]
```

`IngestService.start` counts queued Experience Log rows, applies `INGEST_BATCH_SIZE` from config unless overridden, creates `ingest_jobs` rows, and launches detached workers. Each job stores batch input, target repo, target branch, batch index/count, and worker concurrency in `input_json`.

`src/ingest/runtime.ts` resolves the target repo from project metadata and spawns:

```text
bun <root>/src/cli.ts ingest worker <job-id>
```

The worker runs from the target repo cwd. Its environment includes `MYELIN_ROOT`, `MYELIN_INGEST_JOB_ID`, `MYELIN_INGEST_PROJECT`, and `MYELIN_CAPTURE_DISABLED=1`. Logs go to `projects/<key>/logs/ingest-<job-id>.log`. Launch records `pid`, `log_path`, `target_repo`, and `branch` in `followup_state_json`.

Status reads can update stale state: `refreshDetachedIngestJobStatus` marks a running job as `failed` with `detached_worker_exited` if the recorded PID is no longer alive before the job reaches a terminal status. `ingest jobs resolve` is the operator path for converting known non-actionable failed jobs to completed while preserving resolution metadata.

## Leasing, Tombstones, And Worker Output

Ingest does not trust raw events directly as memory. `leaseExperienceEvents` in `src/memory/experience.ts` creates `claimed` tombstone stubs while leaving source rows in place until finalization. This protects evidence if a worker crashes after leasing. Failed-job tombstones can be recovered by a later job as long as the original `experience_events` row still exists.

`src/ingest/worker.ts` builds a prompt containing:

- project key and job id
- optional parallel batch metadata
- project ingest status from `src/ingest/status.ts`
- selected existing active Session Memory for reconciliation
- leased Experience Log rows with bounded retained evidence

The prompt requires JSON-only output with these categories:

- `session_memories`
- `memory_candidates`
- `handoff_instructions`
- `memory_supersessions`
- `memory_retractions`
- `memory_noops`
- `no_output_tombstone_ids`
- `terminal_summary`

`parseIngestWorkerOutput` validates that output against local enums from `src/memory/ingest-types.ts`. Allowed Session Memory kinds are `continuity`, `decision`, `blocker`, `next_action`, and `verification`. Candidate scopes are `session`, `project`, `practice`, and `personal`. Handoff target scopes are `project`, `practice`, and `personal`.

`applyIngestWorkerOutput` is the commit boundary. In one SQLite transaction it writes accepted outputs, creates source/context links, updates lifecycle state, and finalizes tombstones:

- A tombstone with at least one committed output reference becomes `output`.
- A tombstone explicitly marked with no output becomes `no_output`.
- Remaining claimed tombstones are finalized as `no_output` after the worker completes.
- Output tombstones require output references, so evidence remains traceable to durable rows.

## Session Memory, Contexts, And Lifecycle Links

`src/memory/session-memories.ts` writes trusted Session Memory rows to `session_memories` with `active` status and enqueues a pending embedding through `ensurePendingSessionMemoryEmbedding` unless embedding creation is explicitly disabled. Active rows are listed by project and newest first.

Session Memory lifecycle is non-destructive:

- `supersedeSessionMemory` changes an active row to `superseded`, records `superseded_by`, lifecycle reason, and timestamp.
- `retractSessionMemory` changes an active row to `retracted`, records lifecycle reason, and timestamp.
- `src/memory/session-memory-links.ts` stores explicit relationships from replacement/source memory to target memory with relationship `supersedes`, `refines`, `contradicts`, or `duplicates`.

`src/memory/session-memory-contexts.ts` stores repo path, git branch, git commit, git worktree id, and source tombstone ref for each committed Session Memory. These context rows make later reconciliation branch-aware and repo-aware without overloading the memory payload.

`src/ingest/reconciliation-context.ts` selects existing active Session Memory for the next worker prompt. It combines semantic query matches when embeddings and a provider are available, active `next_action` memories, recent memories, branch matches, and repo path matches. Reconciliation operations are constrained to the memories supplied in that prompt; attempts to supersede or retract memory outside `allowedExistingMemoryIds` throw, while operations on memory made inactive by a parallel worker are skipped.

## Candidates And Handoff Instructions

`src/memory/candidates.ts` stores outputs that are not safe enough to trust as Session Memory. Candidates have a scope, `candidate_type`, summary, source refs, evidence JSON, proposed payload JSON, confidence, risk, reason, and queue status. Provider-created candidates use `pending` or `needs_review`; later processing can mark project candidates `processed` or `rejected`.

`src/memory/handoffs.ts` stores downstream prompt instructions in separate tables for `project`, `practice`, and `personal` scope: `project_handoff_instructions`, `practice_handoff_instructions`, and `personal_handoff_instructions`. A handoff carries objective, prompt text, source Session Memory ids, source event refs, suggested actions, reason, confidence, risk, and the same queue statuses as candidates.

This split matters: candidates are proposed memory records requiring review; handoffs are one-hop instructions for another memory-maintenance workflow. The ingest prompt explicitly tells workers not to mutate curated wiki pages.

## Ingest Status And Completion Layers

`src/ingest/status.ts` exposes project-level progress as counts plus a completion layer:

- `Experience Log drain pending`: active events, leased events, or running jobs remain.
- `Experience Log drain complete`: no active/leased/running work remains and no outputs exist.
- `Session Memory retrieval pending`: outputs exist but active Session Memory embeddings are pending or failed.
- `Session Memory write complete`: outputs exist and pending active Session Memory embeddings are clear.

The status also counts unleased events, failed jobs, terminal tombstones, Session Memory rows, memory candidates, handoff instructions, and pending Session Memory embeddings. This is the best operator view for distinguishing "ingest has not run", "ingest is running", "ingest wrote memory but retrieval is not ready", and "ingest is complete for retrieval".

## Auto-Maintenance

Auto-maintenance is implemented in `src/maintenance/auto-memory-maintenance.ts` and is off unless `AUTO_MEMORY_MAINTENANCE` enables it in config. Capture calls `maybeSchedule` after storing an event, but scheduling is skipped when:

- auto-maintenance is disabled
- capture is disabled for a Myelin-owned worker
- another ingest job is already running
- queued events are below `AUTO_MEMORY_MIN_CAPTURED_EVENTS`
- cooldown is active
- the project maintenance lock is held by a live worker

When threshold and cooldown permit, Myelin creates a run id, acquires `projects/<key>/state/.auto-memory-maintenance.lock`, writes `projects/<key>/state/auto-memory-maintenance.json`, and spawns:

```text
bun <root>/src/maintenance/worker.ts <project-key>
```

The worker sets `MYELIN_CAPTURE_DISABLED=1` and `MYELIN_AUTO_MEMORY_MAINTENANCE_WORKER=1`. `AutoMemoryMaintenanceService.run` starts normal ingest using the configured default provider, waits for all running ingest jobs to drain using `AUTO_MEMORY_DRAIN_POLL_INTERVAL_MS` and `AUTO_MEMORY_DRAIN_TIMEOUT_MS`, then indexes pending Session Memory embeddings through `SessionMemoryIndexService.indexPending` with `AUTO_MEMORY_INDEX_LIMIT` and embedding batch size. It records completed or failed state and releases the lock.

Dead scheduled/running locks are recoverable: if the stored PID is no longer alive, the next scheduler attempt marks the previous run failed, removes the lock, and can schedule a new worker.

## Tests And Verified Behaviors

The relevant tests are concentrated in `tests/capture/`, `tests/ingest/`, and `tests/maintenance/`:

- `tests/capture/capture-service.test.ts` verifies Codex prompt capture is normalized and routed into `experience_events`.
- `tests/capture/providers/codex.test.ts` covers provider payload normalization.
- `tests/ingest/runtime.test.ts` verifies target repo resolution, branch metadata, detached worker environment, launch failure handling, and dead PID refresh.
- `tests/ingest/worker.test.ts` verifies Session Memory writes, tombstone finalization, context rows, supersession links, reconciliation constraints, prompt budgeting, and parallel-batch stale reconciliation behavior.
- `tests/ingest/status.test.ts` covers project-level ingest status counts and labels.
- `tests/maintenance/auto-memory-maintenance.test.ts` covers disabled-by-default behavior, threshold scheduling, lock behavior, dead lock recovery, completed maintenance runs, and worker environment flags.

## Known Gaps

- Auto-maintenance is implemented but opt-in; capture alone does not guarantee Session Memory creation unless manual ingest or auto-maintenance is configured.
- Session Memory retrieval depends on embedding indexing. A project can have Session Memory rows while still reporting retrieval pending.
- The current capture provider implementation is Codex-specific. The ingest service accepts `codex` and `claude` providers, but capture normalization in the inspected files only covers Codex hooks.
- The ingest worker prompt is bounded and may trim reconciliation context before dropping leased evidence. Full raw evidence is preserved in source rows/tombstones, but not every prior memory can fit in a single prompt.
- Workers are allowed to create Project Memory candidates and handoffs, but they do not edit curated wiki pages directly.
