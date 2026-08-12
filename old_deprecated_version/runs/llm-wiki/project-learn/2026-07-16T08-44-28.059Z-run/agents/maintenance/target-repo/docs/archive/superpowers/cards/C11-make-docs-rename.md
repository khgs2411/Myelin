# C11 — Make aliases + docs + config rename

- **Wave:** 6 · **Depends on:** C10 · **Parallel with:** none
- **Implements:** Task 11 of the Phase-0 plan
- **Contract:** see `README.md` (shared)

## Scope
Make the operator surface coherent and Myelin-named.

## Files
- Rename: `llm-wiki.config` → `myelin.config`; update loaders.
- Create: a *new* thin root `Makefile` whose targets are `myelin` CLI aliases (the V1 Makefile is in `legacy/` and is removed in C12); retire V1-concept targets; keep `/mcp` untouched.
- Modify: `README.md`, `AGENTS.md` — Bun/TS runtime, Myelin name, V2 CLI vocabulary + old-command mapping, detached MCP boundary, how to run tests/typecheck/commands.
- Docs clarify that `LLM_WIKI_*` env vars and the `mcp__llm-wiki__*` tool namespace are intentionally-unchanged **compatibility/env contracts** (rename deferred — ADR 0050), not Myelin product naming.

## Acceptance (gate)
- `make <target>` calls the `myelin` CLI; docs reflect the Bun/TS runtime and Myelin name.

## Trello
- **Title:** C11 — Make aliases + docs + config rename
- **List:** Backlog until C10 Done, then Intake (Wave 6).
