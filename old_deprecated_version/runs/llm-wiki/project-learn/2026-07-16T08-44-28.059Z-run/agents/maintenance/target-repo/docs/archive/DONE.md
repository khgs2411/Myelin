# Done — Built & Verified

What Myelin actually has today. This is the status counterpart to `MYELIN.md` (which describes the design regardless of progress). Every entry below is grounded in real code; the path in `code:` is the evidence.

Reflects the codebase at commit `fa278a0`. When in doubt, the code wins over this file.

---

## Runtime & Providers

- **Bun/TypeScript core + CLI dispatcher** — single `myelin` entrypoint routing all operator verbs. `code: src/cli.ts, src/commands/registry.ts`
- **Provider Abstraction (BYO-subscription)** — drives Codex (`codex exec --sandbox read-only`) and Claude Code (`claude -p --output-format json`); default provider + per-call model override; stub mode for deterministic tests. `code: src/runtime/llm-client.ts`

## Schema Layer

- **Global schema authored inputs** — `global.md` + typed JSON rules (page taxonomy, provenance, memory scopes, source classification, CLI vocabulary). `code: schema/global.md, schema/rules/*.json`
- **`schema check`** — read-only validation of schema inputs. `code: src/schema/validators.ts, src/commands/schema.ts`
- **`schema build`** — compiles the per-project `schema-context.json` with sha256 freshness (regenerate on change, skip if unchanged). `code: src/schema/compiler.ts`

## Pipeline

- **`project learn`** — broad Project Memory refresh; Phase-0 stages `sense → impact → propose → apply → validate`. `code: src/pipeline/runner.ts (LEARN_STAGES), stages/`
- **`project ingest`** — process queued source/inbox items; stages `ingest → apply → validate`. `code: src/pipeline/runner.ts (INGEST_STAGES)`
- **Stage instructions as data** — each stage is `stages/<id>/{instructions.md,config.json}`, run by the stage runner; apply/validate are code, not model calls. `code: stages/, src/pipeline/runner.ts`

## Memory Substrate (SQLite)

- **Repo-root SQLite serving DB** — WAL + foreign-key pragmas, migration runner, git-ignored generated state. `code: src/memory/db.ts, src/memory/migrations.ts, state/memory.db`

## Session Memory

- **Capture + recall via CLI** — `session start | log | close | recent | show`, stored in SQLite (`sessions`, `session_events`). `code: src/memory/sessions.ts, src/commands/session.ts`

## Query

- **`memory query` on schema context, fail-closed** — answers from project memory; degrades explicitly (suggesting `schema build`/`check`) when context is missing or invalid. `code: src/query/engine.ts, src/query/planner.ts, src/commands/memory.ts`

## Inbox

- **Inbox item schema + writer + auto-update wrapper** — typed items, filesystem-safe ids, source enum. Contract documented in `docs/inbox-item-schema.md`. `code: src/inbox/items.ts, src/inbox/auto-update.ts`

## Status & Ops

- **`status` command** — project identity, freshness/validation pressure, latest run pointer, latest-session pointer. `code: src/commands/status.ts`
- **`project migrate-layout`** — moves legacy `artifacts/<key>/runs/` into canonical `projects/<key>/runs/` and rewrites state pointers. `code: src/commands/project.ts, src/runtime/layout.ts`

## MCP Interface (detached)

- **Detached Bun/TS MCP server** — kept out of the core package graph; exposes today's tool set: `query_wiki`, `plan_query`, `enrich_gap`, `flag_stale_answer`, `create_inbox_item`, `list_brain_pages`, `find_brain_pages`, `get_page_neighbors`, `list_wiki_projects`, `get_wiki_page`, `get_version`. `code: mcp/src/`

## Verification

- Typecheck: `bun run typecheck` (clean).
- Tests: `bun test` — 46 pass / 0 fail across 12 files.
