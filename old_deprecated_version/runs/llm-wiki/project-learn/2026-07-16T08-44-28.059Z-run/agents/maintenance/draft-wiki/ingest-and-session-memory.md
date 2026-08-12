# Experience Log ingest and Session Memory

Experience Log ingest turns captured provider events into auditable, provider-derived Session Memory, candidates, and one-hop handoffs; it is distinct from the lightweight manual session log used by operators.

## Capture boundary and raw Experience Log

`myelin capture codex-hook` is the external Codex-hook integration, not a memory-writing API. It reads hook JSON from stdin, normalizes it in `src/capture/providers/codex.ts`, and passes the result through `src/capture/facade.ts`. The hook always fails open: malformed input, capture failures, and a disabled `MYELIN_CAPTURE_DISABLED=1` do not interrupt the provider session. Failures are recorded as hook errors when possible (with a file fallback); an unregistered or missing working directory is dropped rather than assigned to a project.

The current Codex normalization contract is:

| Hook condition | Normalized outcome |
| --- | --- |
| `SessionStart` | valid `session.start` event |
| `UserPromptSubmit` with string `prompt` | valid `user.prompt` event containing the prompt |
| `Stop` with nonblank `last_assistant_message` | valid `assistant.response` event containing that message |
| `Stop` without usable assistant text, or any other hook shape | invalid event with no event kind/text |

For a registered repository, capture records raw payload/text plus provider/session/turn identifiers and git worktree context in `experience_events`. Duplicate original IDs or provider dedupe keys are not reinserted once a matching tombstone exists (`src/memory/experience.ts`). Capture may schedule detached automatic Session Memory maintenance only after storing the event; a `session.start` forces ingest scheduling even below the normal capture threshold. It does not synchronously ingest, index, curate Project Memory, or treat Codex `Stop` as the end of a session.

## Detached ingest: authority and lifecycle

The operator command is `myelin ingest <project-key> [--limit N] [--batch-size N] [--provider codex|claude] [--json]` (`src/commands/ingest.ts`). It verifies the target repository, counts queued Experience Log rows, divides the selected rows into batches (maximum batch size 500), creates one `starting` job per batch, and launches detached workers. A no-work invocation creates no job. The queued event set is the worker's input; the worker runs in the target repository and is the only component that calls the ingest LLM and commits its output.

Job state is observable with `myelin ingest status <project-key>` or `myelin ingest status --job <id>`, and jobs can be listed with `myelin ingest jobs <project-key> [--status ...]`. Supported job statuses are `starting`, `running`, `needs_followup`, `completed`, and `failed`. Status refresh also detects dead detached processes. Completion layers progress from Experience Log drain pending/complete, through Session Memory write complete, to Session Memory retrieval pending (`src/memory/ingest-types.ts`); durable memory can therefore exist before its embedding is indexed.

Each worker leases rows transactionally. A lease creates a `claimed` tombstone associated with the job while retaining the source event until terminal finalization. Its terminal tombstone states are `output`, `no_output`, `failed`, and `unfinished`; `claimed` is the active lease state. A worker first recovers claimed leases from failed jobs, then leases otherwise-unclaimed events in timestamp/id order. This protects the raw event from concurrent workers while preserving retryable evidence. On output application, referenced tombstones become `output` with output references; declared or remaining unrepresented leases become `no_output`; finalization retains raw evidence in the tombstone and removes the live event. A thrown worker error marks the job `failed` and leaves claims recoverable by a later ingest. This means raw event removal is irreversible from the live queue, but preserved tombstones keep the source evidence and decision trail.

The LLM response is constrained by `src/ingest/worker-output.schema.json` and parsed again by `parseIngestWorkerOutput`. It can create low-risk Session Memory directly, or propose candidates/handoffs. Every output that consumes a row must cite one or more currently claimed tombstone IDs; references outside the job's claims are ignored, and reconciliation may only name active memories supplied in the bounded reconciliation context. The worker, not the model, applies all database changes in one transaction.

## Session Memory, candidates, handoffs, and reconciliation

Provider-derived Session Memory has kinds `continuity`, `decision`, `blocker`, `next_action`, and `verification`; its lifecycle status is `active`, `superseded`, or `retracted`. New memory includes source tombstone references and copied repository/worktree context. It may remain durable even if background embedding initialization or index scheduling fails; indexing is separately available through `myelin memory index session <project-key>`.

Reconciliation never physically deletes an existing memory. A replacement memory plus a `memory_supersessions` operation moves the old memory to `superseded` and records a link with relationship `supersedes`, `refines`, `contradicts`, or `duplicates`. A retraction moves an active memory to `retracted` when no replacement is appropriate. `memory_noops` leave supplied active memory unchanged. The worker prompt specifically treats `next_action` as short-lived and prefers retraction/supersession when evidence makes it completed or stale. These transitions are consequential for active-memory retrieval, but retain the prior row, reason, links, and tombstone evidence for audit.

Candidates use scopes `session`, `project`, `practice`, or `personal` and statuses `pending`, `needs_review`, `processed`, or `rejected`. Provider-created candidates are limited to `pending` or `needs_review`; a repeated stable candidate ID for the same project/scope merges new source refs rather than reopening a terminal candidate. `myelin memory candidates` and `myelin memory candidate show <id>` expose them. Handoffs are separate, one-hop instructions targeting `project`, `practice`, or `personal`; they use the same queue statuses and retain objective, prompt, suggested actions, Session Memory references, and tombstone sources. Project handoffs can be marked processed only from `pending`/`needs_review`; terminal `processed` and `rejected` rows are not reopened.

## Manual sessions are separate

`myelin session start <key>`, `session log <key> <message>`, `session close <key>`, `session recent <key>`, and `session show <session-id>` operate the manual session log in `src/session/session-service.ts` and `src/memory/sessions.ts`. A manual session is `open` or `closed`; events are `note`, `decision`, `finding`, or `followup`. `log` and `close` select an explicit open `--session <id>` or the only open session for the project. They fail if none is open, if more than one is open without an explicit ID, if an ID belongs to another project, or if the session is closed. Closing is a durable state transition and prevents further events; the session and its events remain readable through `recent` and `show`.

Manual sessions do not automatically create Experience Log rows, Session Memory, candidates, or handoffs. Conversely, provider ingest does not create these manual-session records. This separation prevents informal operator notes from being represented as trusted provider-derived memory without an explicit workflow.

## Runtime inbox and Project Memory candidates

`myelin memory inbox create <project-key>` writes an immutable, validated JSON source under `sources/<key>/inbox/`; it requires title/body/rationale, evidence refs, confidence and risk ratings (`low`, `medium`, `high`), and currently supports only the `project` layer. It validates project ownership and atomically creates a new file; it does not create a candidate immediately. Existing IDs are rejected, so source replacement is not an operator action.

`myelin memory inbox intake <project-key>` deterministically sorts those files and creates `project.inbox` candidates in `needs_review`. The intake records created, existing active, terminal-duplicate, skipped, unsupported, and invalid outcomes. Project/key/scope mismatches and malformed files are reported as degraded results; a missing project or unreadable inbox is blocking. Existing `pending`/`needs_review` candidates are preserved, while existing `processed`/`rejected` candidates are terminal duplicates rather than reopened. `myelin memory maintain project <key>` is the separate curator workflow that can consume candidates and apply Project Memory maintenance; `--dry-run` and `--review` expose non-writing/review-oriented modes.

## Maintenance, review, and failed-job resolution

Automatic Session Memory maintenance is opt-in. When enabled, it schedules a detached, lock-protected worker after enough captured events (or forced SessionStart); the worker may launch ingest, wait for its drain, index pending Session Memory, record state/logs, and reschedule if work remains. Automatic Project Memory maintenance is likewise opt-in and may be scheduled after runtime-inbox writes or newly created project-scoped ingest candidates. Operators can run the workers directly with `myelin maintenance worker session <key>` and `myelin maintenance worker project <key>`.

`myelin memory review <key>` presents neutral outcomes needing operator attention, including failed ingest jobs, nonterminal tombstones, candidates, handoffs, and Project Memory dispositions/runs. It is inspection only. Job status and review queues are operational control surfaces; neither changes curated markdown by itself.

`myelin ingest jobs resolve <project-key> (--id <job-id> ... | --all) --reason <text> [--code <error-code>] [--dry-run]` is an administrative resolution, not a retry. It selects only failed jobs, and dry-run makes no change. Applying it changes selected rows to `completed`, clears `error_json`, sets a resolution terminal summary, and stores the prior error plus reason/timestamp in `followup_state_json`. This is a user-visible, effectively irreversible classification change: it can remove the job from ordinary failed-job investigation, although its previous error metadata remains retained. It neither runs a worker nor finalizes/reprocesses any associated tombstones; unresolved failed leases remain eligible for recovery by a subsequent ingest.

## Evidence and known gaps

Current behavior is implemented in `src/commands/{capture,ingest,session,memory,maintenance}.ts`, `src/{capture,ingest,inbox,maintenance}/`, and `src/memory/{experience,ingest-types,sessions,handoffs,candidates,memory-review-service}.ts`; focused regression evidence is in `tests/capture/providers/codex.test.ts`, `tests/ingest/`, `tests/session/session-service.test.ts`, `tests/memory/`, `tests/maintenance/`, and matching command tests. The supplied [repository-identity.json](../repository-identity.json) verifies the checkout identity for this run. The inspected tests cover deterministic output application, recovery/status paths, command validation, and scheduler behavior; they do not demonstrate a live provider-backed detached ingest or real multi-process concurrency end to end. In this documentation run, worker-runtime tests that require embedding-contract initialization were blocked before their assertions because neither local Ollama embedding provider was reachable.
