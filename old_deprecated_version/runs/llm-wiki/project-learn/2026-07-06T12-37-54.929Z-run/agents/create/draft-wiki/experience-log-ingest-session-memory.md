# Experience Log, Ingest, And Session Memory

Placeholder for the subject writer.

Document the Session Memory layer and the ingest pipeline. Explain how Experience Log rows are stored, leased, tombstoned, processed by detached provider-backed workers, reconciled into trusted Session Memory, candidates, handoffs, supersession/retraction/no-op records, and indexed for retrieval. Cover batch sizing, job status, branch/worktree context, prompt budgets, auto-maintenance drain behavior, and the difference between manual session commands and trusted Session Memory.

Suggested repo paths to inspect: `src/memory/experience.ts`, `src/memory/session-memories.ts`, `src/memory/session-memory-contexts.ts`, `src/memory/session-memory-links.ts`, `src/memory/candidates.ts`, `src/memory/handoffs.ts`, `src/memory/ingest-types.ts`, `src/ingest/`, `src/maintenance/worker.ts`, `src/commands/ingest.ts`, `src/commands/session.ts`, `tests/ingest/`, `tests/memory/session-memories.test.ts`, `tests/memory/session-memory-query.test.ts`, `docs/adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`.
