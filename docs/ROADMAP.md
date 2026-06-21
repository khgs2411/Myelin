# Myelin Roadmap

This is the canonical progress tracker for Myelin.

Use this file to answer "what are we doing next?" regardless of what happened in the last session. `MYELIN.md` remains the canonical product design; this file is the implementation checklist against that design.

## How To Use This Roadmap

- Start with **Current Next Step**. Do not skip to a later layer unless this section says to.
- Mark completed work here when code, docs, and verification land.
- Add new work here when a real gap appears. Do not create a second TODO, DONE, task-list, or roadmap file.
- Keep items scoped to product behavior, not one session's conversation.
- Do not treat the dogfood Experience Log queue as something to manually finish. Every user message and assistant response adds rows. Auto-maintenance owns that loop.

Status labels:

- `done`: built and verified.
- `partial`: usable scaffold exists, but the product behavior is incomplete.
- `next`: the next implementation slice.
- `open`: known future work.
- `deferred`: intentionally not part of the current phase.

## Current Next Step

We are in the **first implementation slice of the Project Memory layer**.

The next slice is:

- [ ] `next` Wire the bounded Project Memory packet into `project learn` before any curator writes durable markdown.
- [ ] `next` Define the first Project Memory Curator output schema and validation contract.
- [ ] `next` Require the curator to propose bounded page updates with provenance. The agent must not write arbitrary files directly.

Success for this slice:

- `project learn <key>` builds or receives the Project Memory packet.
- Curator output is JSON with a validated schema.
- Proposed markdown changes are bounded to known pages or explicit new-page requests.
- Every proposed durable memory update carries provenance or an explicit inference label.
- Tests prove invalid curator output is rejected before file writes.

Not next:

- Full Practice Memory.
- Full Personal Memory.
- A universal scoring system.
- Manual draining of the live `llm-wiki` Experience Log queue.
- Current Briefing implementation, until Project Memory curation has a stable write contract.

## Roadmap Step 0: Runtime Foundation

Goal: make Myelin a stable Bun/TypeScript CLI with repo-safe runtime primitives.

- [x] `done` Bun/TypeScript CLI entrypoint and command registry.
- [x] `done` Runtime helpers for repo-safe paths, JSON state, project discovery, IDs, subprocesses, and provider execution.
- [x] `done` Provider abstraction for Codex and Claude through authenticated local CLIs.
- [x] `done` `myelin.config`, `.env`, and process-env precedence.
- [x] `done` SQLite runtime selection for local vector-extension use, including vendored runtime support and macOS fallback.

Evidence: `src/cli.ts`, `src/commands/registry.ts`, `src/runtime/*`, `src/memory/sqlite-runtime.ts`, `myelin.config`

## Roadmap Step 1: Project Shell And Capture

Goal: register software repos, capture agent work, and avoid routing active work into legacy V1 projects.

- [x] `done` `myelin bootstrap <key> --repo <path>` creates a project shell.
- [x] `done` Bootstrap repairs older V2 shells without deleting preserved material.
- [x] `done` `myelin project list` shows active projects by default.
- [x] `done` `myelin project list --include-legacy` exposes archived V1 projects explicitly.
- [x] `done` Project discovery excludes `legacy` and `deprecated` configs by default.
- [x] `done` Capture hooks persist provider-neutral Experience Log rows for bootstrapped projects.
- [x] `done` Capture records repo path, git branch, git commit, and worktree id when available.
- [x] `done` Capture is fail-open and records hook errors instead of breaking agent workflow.

Active V2 projects currently expected in normal routing:

- `class-kit`
- `llm-wiki`
- `senshi`
- `wizepal`

Legacy/deprecated V1 projects should stay out of normal routing:

- `code-style`
- `company`
- `rpg_game`
- `trygga`

Evidence: `src/commands/bootstrap.ts`, `src/commands/project.ts`, `src/runtime/projects.ts`, `src/capture/facade.ts`, `src/capture/git-context.ts`, `src/memory/experience.ts`

## Roadmap Step 2: Session Memory Layer

Goal: accurate, relevant project-scoped continuity from recent work.

- [x] `done` Top-level `myelin ingest <key>` starts detached provider-backed Experience Log to Session Memory work.
- [x] `done` Ingest uses tombstone-backed leases so raw Experience Log rows are not deleted before terminal output.
- [x] `done` Ingest writes trusted Session Memories, Memory Candidates, layer handoff instructions, supersession links, retractions, noops, and terminal tombstone state.
- [x] `done` Ingest preserves branch context as metadata and does not fail just because a repo is not on `master`.
- [x] `done` Prompt-size packing budgets instructions, leased evidence, and reconciliation context together.
- [x] `done` Session Memory writes create pending embedding metadata.
- [x] `done` `myelin memory index session <key>` indexes pending Session Memories through the active embedding contract.
- [x] `done` Query embeddings are cached.
- [x] `done` `myelin memory query <key> "<question>"` retrieves indexed active Session Memories.
- [x] `done` `memory query --branch current|<name>` filters Session Memory by branch context.
- [x] `done` Query returns explicit degraded states when sqlite-vec, embeddings, or indexed rows are unavailable.
- [x] `done` Capture can schedule auto-maintenance after enough queued Experience Log rows exist.
- [x] `done` Auto-maintenance is detached, lock-guarded, cooldown-guarded, and prevents recursive self-capture.
- [x] `done` Auto-maintenance runs ingest, waits for ingest drain, and indexes pending Session Memory embeddings.

Open Session Memory work:

- [ ] `open` Refresh `tests/query/fixtures/llm-wiki-session-memory-quality.json` to match current live Session Memory instead of stale pre-auto-maintenance state.
- [ ] `open` Make reconciliation lifecycle branch-scoped. Other branch memories should remain preserved and queryable, but current-branch maintenance should not casually retract or supersede inactive-branch memories.
- [ ] `open` Keep `next_action` memories short-lived, but retire them through evidence-backed ingest/reconciliation rather than manual queue chasing.
- [ ] `open` Surface `needs_review` Memory Candidates in query/status contexts when active Session Memory is weak, clearly labeled as non-trusted.
- [ ] `open` Improve auto-maintenance reporting around failed ingest jobs: decide whether maintenance should complete with partial indexing or mark itself failed/degraded when ingest jobs fail.
- [ ] `open` Fix small documentation drift in `myelin.config`: the comment says auto-maintenance is disabled by default, while this checkout enables it.
- [ ] `deferred` Add manual review/admin commands only as escape hatches after the automated lifecycle is coherent.

Evidence: `src/commands/ingest.ts`, `src/ingest/*`, `src/memory/session-memories.ts`, `src/memory/candidates.ts`, `src/memory/handoffs.ts`, `src/memory/session-memory-query.ts`, `src/maintenance/auto-memory-maintenance.ts`, `src/maintenance/worker.ts`

## Roadmap Step 3: Project Memory Layer

Goal: maintain curated, human-readable project truth in `projects/<key>/wiki/` with machine-readable state and provenance.

Completed or partial foundation:

- [x] `done` `project learn <key>` and `project ingest <key>` exist as Phase-0 pipeline commands.
- [x] `done` Stage instructions live as data under `stages/`.
- [x] `done` The scaffold can run provider-backed stages and deterministic apply/validate code.
- [x] `done` `project packet <key>` builds a read-only bounded Project Memory packet from project state, wiki markdown, pending project handoffs/candidates, recent Session Memory, and deterministic markdown lookup results.
- [x] `done` Project Memory lookup reports degraded state because it is currently deterministic markdown text search, not a derived metadata/vector index.
- [ ] `partial` Evolve `project learn` from a Phase-0 pipeline scaffold into behavior-focused Project Memory maintenance.

Current Project Memory work:

- [ ] `next` Wire the bounded Project Memory packet into `project learn`.
- [ ] `next` Define the Project Memory Curator output schema.
- [ ] `next` Validate curator output before any durable markdown write.
- [ ] `next` Preserve provenance for every durable Project Memory update.
- [ ] `next` Reframe inbox/gap flow as evidence/candidate intake instead of legacy query repair only.

Later Project Memory work:

- [ ] `open` Add derived metadata/vector Project Memory index after the markdown write contract is stable.
- [ ] `open` Decide how Current Briefing relates to Session Memory, old `wiki/sessions/*.md`, and project wiki pages.
- [ ] `deferred` Resume Current Briefing implementation only after Project Memory curation has a stable write contract.

Evidence: `src/commands/project.ts`, `src/project/project-memory-packet.ts`, `src/project/project-memory-lookup.ts`, `src/pipeline/runner.ts`, `stages/*`

## Roadmap Step 4: Practice Memory Layer

Goal: canonical cross-project guidance derived from repeated or explicitly selected project evidence.

- [ ] `open` Design the canonical Practice Memory storage shape.
- [ ] `open` Define the Practice Candidate promotion path from Project/Session evidence.
- [ ] `open` Decide how project-specific runbooks override or cite canonical practices.
- [ ] `deferred` Keep automatic Practice promotion out of scope until evidence shape and manual promotion are proven.

## Roadmap Step 5: Personal Memory Layer

Goal: durable guidance about Liad's preferences and agent behavior expectations.

- [ ] `open` Design the canonical Personal Memory storage shape.
- [ ] `open` Define Personal Candidate creation from repeated corrections, explicit guidance, and observed project behavior.
- [ ] `open` Avoid turning one-off session instructions into durable preferences without corroboration or explicit user intent.
- [ ] `deferred` Keep automatic Personal promotion out of scope until manual review boundaries are proven.

## Roadmap Step 6: Query, How, And Status Facades

Goal: small semantic interfaces over the memory layers.

- [ ] `partial` `memory query` currently retrieves Session Memory vectors; it is not yet the full multi-layer query facade.
- [ ] `open` Route `query` across Project, Session, Practice, Personal, and state-backed sources.
- [ ] `open` Implement `how` as a first-class facade for prescriptive operating guidance.
- [ ] `open` Evolve `status` into the structured current-state facade.
- [ ] `open` Make retrieval quality interpretable without letting scoring become the product driver.
- [ ] `open` Surface candidates explicitly and label them as non-trusted.
- [ ] `open` Keep detached MCP consuming core contracts; core logic must stay out of MCP implementation.

## Roadmap Step 7: Schema Layer

Goal: rules and conventions that teach agents how to maintain Myelin.

- [x] `done` Global schema inputs and typed rules exist.
- [x] `done` `schema check` validates authored/global schema context.
- [x] `done` `schema build` writes generated per-project schema context.
- [ ] `deferred` Project-local schema.
- [ ] `deferred` Schema overrides.
- [ ] `deferred` Schema candidate list/apply flows.
- [ ] `deferred` Global schema candidate promotion after cross-project Practice/Personal promotion exists.

Reason for deferral: ADR 0049 keeps Phase 0 thin and global-only until real divergence proves the need.

## Always-On Guardrails

- [ ] Keep hooks fast and fail-open.
- [ ] Keep provider-backed work detached and bounded.
- [ ] Do not let auto-maintenance recursively capture its own provider sessions.
- [ ] Keep SQLite as serving/recall state, not curated truth.
- [ ] Keep markdown Project/Practice/Personal memory human-reviewable.
- [ ] Do not import root `src/` from detached MCP or MCP source from root core.
- [ ] Do not manually drain the live dogfood queue as proof of progress.

## Last Verified

- `rtk bun test` passed with 261 tests.
- `rtk bun run typecheck` passed.
- `rtk git diff --check` passed.
- `rtk bun src/cli.ts project packet llm-wiki` returned a bounded Project Memory packet for `llm-wiki`.
