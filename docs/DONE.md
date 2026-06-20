# Done

This is the current built-and-verified inventory for Myelin. It complements `MYELIN.md`, which describes the product design whether or not a slice is implemented.

If this file and the code disagree, the code wins. Keep this file current when a slice becomes real product behavior.

## Runtime Foundation

- Bun/TypeScript CLI entrypoint and command registry exist.
- Runtime helpers cover repo-safe paths, JSON state, project discovery, ids, subprocesses, and provider execution.
- Provider abstraction can run Codex and Claude through the operator's authenticated CLI.
- `myelin.config` is the root product config, with `.env` and process-env precedence.
- SQLite runtime selection is handled for local vector-extension use, including vendored runtime support and macOS fallbacks.

Evidence: `src/cli.ts`, `src/commands/registry.ts`, `src/runtime/*`, `src/memory/sqlite-runtime.ts`, `myelin.config`

## Project Shell And Capture

- `myelin bootstrap <key> --repo <path>` registers a software repo as a Myelin project shell.
- `myelin project list` shows active projects by default; `--include-legacy` exposes archived V1 projects explicitly.
- Project discovery ignores `legacy` and `deprecated` project configs by default so archived V1 projects are not routed into capture, ingest, status, or learn accidentally.
- Capture hooks can persist provider-neutral Experience Log rows for bootstrapped projects.
- Capture records repo path, git branch, git commit, and worktree id when available.
- Capture is fail-open and records hook errors rather than breaking the agent workflow.

Evidence: `src/commands/bootstrap.ts`, `src/commands/project.ts`, `src/runtime/projects.ts`, `src/capture/facade.ts`, `src/capture/git-context.ts`, `src/memory/experience.ts`

## Session Memory Layer

- Top-level `myelin ingest <key>` starts detached provider-backed Experience Log to Session Memory work.
- Ingest uses tombstone-backed leases so raw Experience Log rows are not deleted before terminal output.
- Ingest writes trusted Session Memories, Memory Candidates, layer handoff instructions, supersession links, retractions, noops, and terminal tombstone state.
- Ingest no longer treats non-`master` branches as a hard failure; branch context is preserved as metadata.
- Session Memory contexts store repo/branch/worktree provenance per memory.
- Prompt-size packing now budgets fixed instructions, leased evidence, and reconciliation context together.
- Stale `next_action` handling exists in the worker prompt and reconciliation context.

Evidence: `src/commands/ingest.ts`, `src/ingest/*`, `src/memory/session-memories.ts`, `src/memory/candidates.ts`, `src/memory/handoffs.ts`, `src/memory/session-memory-contexts.ts`

## Auto Session Memory Maintenance

- Capture can schedule auto-maintenance after enough queued Experience Log rows exist.
- Maintenance is detached, lock-guarded, cooldown-guarded, and sets capture-disabled env vars to prevent recursive self-capture.
- The maintenance worker runs ingest, waits for ingest drain, and indexes pending Session Memory embeddings.
- Hooks do not run provider-backed ingest or embedding work synchronously.

Evidence: `src/maintenance/auto-memory-maintenance.ts`, `src/maintenance/worker.ts`, `src/capture/facade.ts`, `tests/maintenance/auto-memory-maintenance.test.ts`

## Session Memory Embedding And Query

- Session Memory writes create pending embedding metadata.
- `myelin memory index session <key>` indexes pending Session Memories through the active embedding contract.
- Query embeddings are cached.
- `myelin memory query <key> "<question>"` retrieves indexed active Session Memories.
- `memory query --branch current|<name>` filters Session Memory by branch context.
- Query returns explicit degraded states when sqlite-vec, embeddings, or indexed rows are unavailable.

Evidence: `src/memory/session-memory-embeddings.ts`, `src/memory/session-memory-index-service.ts`, `src/memory/query-embedding-cache.ts`, `src/memory/session-memory-query.ts`, `src/query/*`, `src/commands/memory.ts`

## Schema Layer

- Global schema inputs and typed rules exist.
- `schema check` validates authored/global schema context.
- `schema build` writes generated per-project schema context.
- Phase-0 intentionally excludes project-local schema, schema overrides, and schema candidate apply flows.

Evidence: `schema/global.md`, `schema/rules/*`, `src/schema/*`, `src/commands/schema.ts`, `docs/adr/0049-phase-0-ships-thin-global-only-schema.md`

## Project Memory Pipeline Scaffold

- `project learn <key>` and `project ingest <key>` exist as Phase-0 pipeline commands.
- Stage instructions live as data under `stages/`.
- The scaffold can run provider-backed stages and deterministic apply/validate code.
- This is not yet the evolved Project Memory Curator described in `MYELIN.md`.

Evidence: `src/commands/project.ts`, `src/pipeline/runner.ts`, `stages/*`, `docs/IMPLEMENTATION_ALIGNMENT.md`

## Status, Inbox, And MCP Boundary

- `status` reports project identity and operational state, but it is not yet Current Briefing.
- Inbox/gap item storage exists and can support future Project Memory repair or candidate intake.
- The MCP server remains detached from the root package graph.
- Existing MCP tools are still legacy/wiki-shaped; semantic `query` / `how` / `status` facades are not complete.

Evidence: `src/commands/status.ts`, `src/inbox/*`, `mcp/src/*`, `docs/IMPLEMENTATION_ALIGNMENT.md`

## Recent Verification

- `rtk bun test tests/query/memory-quality-eval.test.ts` passed with 12 tests.
- `rtk bun test tests/maintenance/auto-memory-maintenance.test.ts tests/capture/facade.test.ts tests/runtime/runtime.test.ts` passed with 29 tests.
- The previous handoff recorded a full `rtk bun test`, `rtk bun run typecheck`, and `rtk git diff --check` pass after the auto-maintenance and prompt-packing work.
