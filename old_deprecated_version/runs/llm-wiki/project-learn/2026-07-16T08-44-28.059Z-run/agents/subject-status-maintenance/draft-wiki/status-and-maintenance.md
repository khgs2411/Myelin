# Status and maintenance operations

Status exposes a versioned, evidence-backed view of a project's installation, Session Memory, and Project Memory health; maintenance commands and schedulers perform the bounded follow-up work that status identifies.

The inspected checkout is the `llm-wiki` project on `master` at `78cc13dfcc73145db780b80c38c7d247efd9eca9`, with the registered repository path and origin recorded in [repository-identity.json](../repository-identity.json). This is deterministic checkout evidence, not a statement that the remote is currently reachable.

## Operational status

`myelin status [<project-key>] [--json]` is the public inspection boundary (`src/commands/status.ts`). With a key, it reports `resolved_from: "argument"`; without one it resolves the caller's canonical path against registered project repositories and rejects both no match and ambiguous matches. Unknown options and extra positional arguments fail before inspection.

`--json` returns the stable `myelin.status.v1` / `project_operational_status` contract from `src/status/status-v1.ts`. Its top-level fields are the timestamp, overall state, resolved project, three sections (`installation`, `session_memory`, `project_memory`), warnings, suggested actions, and evidence. Serialization sorts project paths, providers, warnings, actions, and evidence deterministically. The default rendering (`src/status/status-renderer.ts`) presents the same section states, counts, warnings, actions, and evidence paths for operators; it is not a distinct authority.

Status is an inspection operation: `src/status/session-memory-inspector.ts` copies the root SQLite database (and WAL/SHM when present) to a temporary, readonly, query-only snapshot. It therefore does not create the database or sidecars and does not change database bytes. If the root database is absent or lacks required tables, status still returns a complete-shaped result but marks both memory sections `blocked` with `ROOT_SQLITE_UNAVAILABLE`; it does not initialize storage. Installation inspection, state files, lock owners, project wiki state, logs, SQLite rows, and embedding-provider configuration are surfaced as typed evidence (`file`, `sqlite`, `process`, or `config`) so warnings can name their basis.

### State and severity precedence

Every section and the overall result use exactly three states: `healthy`, `attention`, and `blocked`. `blocked` outranks `attention`, which outranks `healthy`; overall state is the maximum of the installation, Session Memory, and Project Memory states (`src/status/severity.ts`). Warnings are only `attention` or `blocked`, include a section and evidence IDs, and actions are recommendations rather than automatically executed remediation.

Retrieval has its own usable-index gate before it contributes to the section state:

| Scope condition | Outcome |
| --- | --- |
| Session Memory has no active memory | `healthy` regardless of index counts |
| Session Memory is active and has no indexed row | `blocked` |
| Session Memory has indexed rows plus pending or failed rows | `attention` |
| Project Memory is not curated | `healthy` regardless of retrieval counts |
| Curated Project Memory has no indexed row | `blocked` |
| Curated Project Memory has indexed rows plus pending or failed rows | `attention` |
| Usable active/curated data and no pending or failed row | `healthy` |

An embedding-contract mismatch adds `attention` and suggests `myelin memory embeddings migrate`; an unavailable active embedding provider also adds `attention` and changes that memory section's lifecycle to `provider_unavailable`. These checks do not alter contracts or retry indexing.

For Session Memory, the remaining precedence is: stale maintenance lock, unusable retrieval, then any attention condition, otherwise `ready`. A stale lock is `blocked`; a dead or failed ingest worker is `blocked` when it holds claimed event tombstones and `attention` otherwise. A queue at or above the configured capture threshold without a live ingest job or active maintenance lock is `attention` and suggests `myelin ingest <key>`. Disabled automatic maintenance with queued events, malformed maintenance state, a failed maintenance run, and a missing referenced log also contribute as documented warnings.

For Project Memory, unreadable inbox and invalid curation state are `blocked`; a state that claims `curated` but has no readable canonical markdown is also `blocked`. An uncurated project is `attention`/`not_curated`, while any non-`curated` persisted project state is `blocked`/`curation_failed`. A stale lock takes lifecycle precedence, then curation failure, then unusable retrieval, then generic attention. Pending `needs_review` candidates, threshold pressure without an active worker, disabled maintenance with work, failed maintenance, malformed state, migration required, and missing log are attention conditions. Status suggests `myelin memory maintain project <key>` when pressure reaches the threshold without a live worker.

## Maintenance administration

The central CLI exposes worker entry points, not a separate daemon API:

```text
myelin maintenance worker session <project-key>
myelin maintenance worker project <project-key>
```

Both require exactly one project key and fail closed on invalid usage or a service result of `failed` (`src/commands/maintenance.ts`). They are the command targets used by detached schedulers. Manual operator controls remain explicit: `myelin ingest <key>` starts Experience Log ingest; `myelin ingest status <job-id> [--json]` or `myelin ingest status --project <key> [--json]` reads job/project progress; `myelin ingest jobs <key> [--status starting|running|needs_followup|completed|failed]` lists jobs; and `myelin memory maintain project <key>` performs Project Memory maintenance. The latter can be run with `--dry-run` or `--review`; ordinary maintenance can update curated markdown and state, so those modes are the non-writing/review boundary rather than status.

`myelin memory review <key> [--status <status>] [--limit N] [--json]` is the neutral review queue (`src/memory/memory-review-service.ts`). It merges degraded Project Memory run reports and reviewable project dispositions with SQLite outcomes: `needs_followup` ingest jobs, `no_output` tombstones, rejected candidates, and rejected handoff instructions. It omits successful project dispositions (`applied_to_project_memory`, `already_covered`) and runner-failure dispositions, sorts newest-first, and applies an optional exact status filter after collection. It reports; it neither resolves nor deletes the listed outcomes.

### Worker lifecycle and single-owner recovery

`MaintenanceRunRuntime` (`src/maintenance/maintenance-run-runtime.ts`) owns the per-project state JSON and directory lock. States may be `scheduled`, `running`, `completed`, `failed`, or `skipped`; maintenance records IDs, timestamps, reason, PID, log path, and work counts. A scheduler atomically creates the lock and writes `owner.json` with its run ID. A worker may adopt only the lock with its own run ID; releasing a lock checks ownership again, so one worker cannot remove another's lock.

Cooldown applies from the terminal `completed`/`failed` time or, for an active/nonterminal state, the scheduled time. A duplicate schedule is skipped while locked. Before retrying, the scheduler may recover only a coherent dead-worker case: state must be `scheduled` or `running`, its recorded PID must be dead, and the lock owner must match the recorded run. Recovery removes the lock and records the run as `failed`; malformed or mismatched ownership is not treated as safe to delete and status reports it as stale/blocked. A detached process receives a project log path and run ID, then records scheduled → running → completed or failed and releases the lock in `finally`.

This recovery is destructive only to an abandoned lock directory. It deliberately does not delete captured Experience Log rows, tombstones, Session Memory, candidates, or curated Project Memory. Actual worker execution can create derived retrieval rows and, for Project Memory curation, update canonical markdown/state; failed runs retain their state and reason for status and review.

## Automatic scheduling

Automatic maintenance is opt-in. Defaults are disabled; when enabled, Session Memory uses a default threshold of 10 captured events and five-minute cooldown, while Project Memory uses five pending items and five-minute cooldown (`src/runtime/config.ts`). Settings are loaded from `AUTO_MEMORY_MAINTENANCE`, `AUTO_MEMORY_MIN_CAPTURED_EVENTS`, `AUTO_MEMORY_COOLDOWN_MS`, drain/index settings, and their `AUTO_PROJECT_MEMORY_*` counterparts.

Session scheduling (`src/maintenance/auto-memory-maintenance.ts`) returns one of `disabled`, `skipped`, or `scheduled` with a reason/count where applicable. It refuses to schedule from a Myelin-owned worker, skips while an ingest job is running, skips below threshold when no active embedding rows are pending, and honors cooldown unless forced. Pending active Session Memory embeddings independently justify scheduling below the event threshold. A forced ingest (used for a SessionStart drain) bypasses the threshold and cooldown; force-index skips when no active embedding work exists. The detached worker disables capture in its own environment to avoid recursive capture/scheduling.

The Session Memory worker takes one bounded ingest drain window, indexes pending rows, and reports indexed/failed/pending counts. If queued rows remain at or above threshold or active embeddings remain pending, it schedules continuation rather than treating a bounded pass as a complete drain. Index failure or residual pending work is visible in the final state/result; it is not silently declared healthy.

Project scheduling (`src/maintenance/auto-project-memory-maintenance.ts`) is triggered by `runtime_inbox_created`, `session_memory_candidate_created`, or `retrieval_index_pending`. It counts only inbox files not already represented by an intake candidate, plus pending project candidates. It skips below the configured threshold unless active Project Memory retrieval rows are pending; cooldown then applies. Workers do not schedule themselves. A retrieval-only trigger below curation pressure indexes retrieval rows without curating markdown; otherwise the worker runs ordinary Project Memory maintenance and then indexes pending retrieval rows. Any maintenance failure, indexing degradation, failed index row, or residual pending index row makes the worker result `failed` and preserves the reason.

## Evidence and known gaps

Current implementation and regression evidence cover JSON contract ordering, readonly status snapshots, project-resolution failures, status severity matrices and stale-lock detection, worker CLI failure handling, opt-in/threshold/cooldown scheduling, dead-lock recovery, bounded continuation, and Project Memory retrieval-only maintenance (`tests/status/`, `tests/maintenance/`, `tests/commands/maintenance.test.ts`, `tests/commands/ingest.test.ts`, and `tests/commands/memory.test.ts`).

Known gaps: the inspected tests use stubbed detached spawners and embedding providers, so they do not demonstrate an end-to-end operating-system worker crash/restart or a live provider's availability behavior. They also do not establish a human operator's eventual disposition of `memory review` items. Those outcomes must remain operationally observed rather than assumed from this subject.
