# Branch-Aware Session Memory Context Design

Status: Final design. Ready for user review before implementation planning.

## Goal

Make Session Memory repo-scoped by default, branch-aware when useful.

The ingestion layer should continue to accept Experience Log work from whatever branch the target repository is currently on. Instead of using `master` as a launch gate, Myelin should capture branch and worktree metadata at capture time, preserve that metadata through Experience Log and tombstone processing, and let retrieval filter by branch when the operator or agent asks for branch-specific context.

This design keeps the memory model unified:

- one project-scoped Session Memory corpus
- optional branch/worktree filters for retrieval
- no branch partitioning into separate memory worlds

## Current Context

The repo already contains the core behavior this design describes:

- `src/ingest/runtime.ts` reads the target repo branch when launching detached ingest jobs.
- `src/commands/ingest.ts` warns on non-`master` instead of failing.
- `src/capture/facade.ts` records repo path and git metadata from hook events.
- `src/memory/experience.ts` persists `repo_path`, `git_branch`, `git_commit`, and `git_worktree_id` on Experience Log rows and carries that metadata into tombstones.
- `src/memory/session-memory-contexts.ts` stores branch-aware context rows for Session Memory.
- `src/memory/session-memory-query.ts` and `src/query/memory-query-service.ts` support branch filtering during retrieval.
- `src/commands/memory.ts` exposes `memory query --branch current|<name>`.

The earlier ingest design in `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/spec.md` assumed a `master` launch gate. That assumption is now stale for Session Memory ingest and should be treated as superseded by this branch-aware model.

## User-Facing Behavior

### Ingest

- `myelin ingest <project-key>` launches against the target repo branch that exists at runtime.
- If the target repo is not on `master`, Myelin warns but does not fail.
- The ingest job records the branch used for launch so the operator can inspect it later.
- Capture events continue to be the source of truth for repo path and git metadata.
- Branch metadata is preserved through tombstone-backed lease stubs and terminal outputs.

### Retrieval

- Default Session Memory query remains project-scoped.
- `myelin memory query <project-key> <question>` returns the best matches across the project, regardless of branch.
- `myelin memory query <project-key> <question> --branch current` resolves the target repo's current branch and filters to that branch.
- `myelin memory query <project-key> <question> --branch <name>` filters to the named branch exactly.
- Historical rows without branch metadata remain queryable in the unfiltered project scope, but they do not match branch-specific filters.

### Operator Intent

The mental model is:

- "What does Myelin know about this project?"
- "What did we last do on this branch?"

The first uses project scope. The second uses project scope plus branch context.

## Technical Design

### Capture-Time Metadata

Branch awareness should begin at capture time, not at ingest-time reconstruction.

When a capture event arrives, Myelin should persist:

- `repo_path`
- `git_branch`
- `git_commit`
- `git_worktree_id`

Those fields belong on the Experience Log row itself so later ingest batches do not have to guess where the evidence came from.

### Ingest Job Metadata

Detached ingest jobs should record the branch resolved at launch time.

That launch-time branch is useful for status and operator inspection, but it is not the only source of truth. A single ingest batch may span older evidence from multiple branches, so the persisted per-row capture metadata remains authoritative for retrieval filtering.

### Session Memory Context Rows

Branch-aware retrieval should not live as ad hoc JSON on `session_memories`.

The durable representation is a separate `session_memory_contexts` table that links each Session Memory row to one or more captured contexts:

- `session_memory_id`
- `project_key`
- `repo_path`
- `git_branch`
- `git_commit`
- `git_worktree_id`
- `source_event_ref`

This shape allows:

- one memory to cite multiple source events
- one memory to carry multiple branch observations if the evidence spans branches
- exact branch filtering without overloading the canonical Session Memory row

### Query Behavior

Session Memory query should use two modes:

- project-wide retrieval by default
- exact branch filtering when `--branch` is present

`--branch current` resolves the current branch from the target repo, not from the caller's shell cwd.

If the current branch cannot be resolved, the safest behavior is to fall back to the unfiltered project query rather than fail the entire query path. That keeps retrieval usable even when git metadata is missing or detached.

### Legacy Rows

Older Session Memory rows and Experience Log rows that predate branch capture are left with null branch metadata.

This is intentional. Backfilling them to `master` would fabricate provenance and make branch-specific retrieval untrustworthy.

## Data / State

This design depends on the existing memory schema rather than introducing a new memory scope.

Relevant state:

- `experience_events` stores source capture metadata.
- `experience_event_tombstones` preserves the same metadata through ingest lifecycle transitions.
- `session_memory_contexts` stores branch-aware retrieval context rows.
- `session_memories` remains the canonical trusted memory record.
- `ingest_jobs.followup_state_json` carries launch-time branch metadata for operator status.

The branch-aware context table is derived metadata, not a separate memory corpus.

## Integrations

- `src/capture/facade.ts`
- `src/ingest/runtime.ts`
- `src/commands/ingest.ts`
- `src/memory/experience.ts`
- `src/memory/session-memory-contexts.ts`
- `src/memory/session-memory-query.ts`
- `src/query/memory-query-service.ts`
- `src/commands/memory.ts`

The current code paths already reflect this integration shape; the design records the contract so later planning does not regress to a master-only ingest gate.

## Error Handling

- Git branch resolution failures during ingest launch should degrade to a warning or null branch metadata, not a hard failure.
- Query-time `--branch current` resolution failure should not hide project-wide retrieval.
- Missing branch metadata should not block Session Memory writes.
- Legacy rows without branch metadata should remain queryable in the default project scope.

## Testing Strategy

Tests should prove:

- non-`master` ingest starts successfully and records launch branch metadata
- capture events persist repo/branch/worktree metadata
- tombstones and Session Memory contexts preserve captured metadata
- `memory query --branch <name>` returns only matching branch contexts
- `memory query --branch current` resolves the target repo branch
- historical rows without branch metadata remain visible in default project queries
- branch resolution failure degrades without breaking query or ingest

## Planning Boundaries

This design does not change:

- canonical Session Memory trust rules
- embedding/index contracts
- ingest worker output schema
- curated wiki pages
- project/practice/personal promotion policy

The only boundary shift is how branch context is captured and used for retrieval.

## Assumptions

- Branch metadata is primarily a retrieval filter and provenance aid, not a memory partition key.
- Project scope remains the default query scope.
- Users may work on multiple branches in a single day, so branch context must be preserved per event, not inferred from a single ingest batch.

## Non-Blocking Risk

Existing branchless Session Memory rows will not answer branch-specific questions. That is acceptable for v0 because the data is honest, and the default query path still returns them.
