# Myelin V2 — Phase 0: Clean TypeScript Core (Reference-Quarantine Rewrite)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Supersedes** `docs/superpowers/plans/2026-06-01-v2-project-rooted-agent-memory-foundation.md` (kept as history). Same goal — move the core runtime from Python/Bash to Bun/TypeScript — but this revision quarantines V1 as reference and rewrites clean instead of porting for parity, thins the Phase-0 schema to global-only, adds an early `status` walking skeleton, elevates the provider abstraction, resolves the core/MCP query boundary, and adopts the product name **Myelin**.

**Goal:** Stand up a clean Bun/TypeScript core for Myelin by moving the V1 Python/Bash implementation into a `legacy/` reference folder and rewriting `src/` fresh, optimizing for the V2 memory product over V1 compatibility, with `/mcp` left detached.

**Architecture:** The core repo becomes Bun/TypeScript-first. Root TypeScript owns project discovery, config, state, the provider abstraction, query, schema, inbox, pipeline orchestration, and operator commands. V1 Python/Bash is reference material in `legacy/`, not a parity target — breaking V1 behavior is acceptable when it advances the V2 brain. Query logic lives once in core; the detached `/mcp` consumes it through the CLI/JSON contract. Integration with `/mcp` is contracts only (files, commands, env, schemas, JSON) — no cross-boundary source imports.

**Tech stack:** Bun, TypeScript, `src/runtime/*`, `src/cli.ts` (`myelin` binary), Zod, Bun tests, existing markdown/JSON stage-instruction assets.

**Deferred (not this slice):** SQLite memory, vector search / `sqlite-vec`, Gemini embeddings, a Gemini *runner*, Codex hooks, MCP facade changes, automatic practice/preference promotion, and the project-local / override / candidate / `--global` schema machinery.

## Invariants (must hold across the slice)

- [ ] Markdown wiki + state JSON remain human-reviewable curated truth; no curated truth moves into SQLite this slice.
- [ ] **Provider Abstraction / BYO-subscription:** the runner shells out to the operator's authenticated vendor CLI in headless mode. Preserve **Codex** and **Claude Code**, a configurable default (`DEFAULT_PROVIDER` + `MODEL` override + per-call override), and per-workload model profiles (pipeline vs query, incl. Codex reasoning-effort). Provider-pluggable for later backends; Gemini not wired this slice. (ADR 0051)
- [ ] Codex stages run `--sandbox read-only` and return JSON on stdout — preserve this to avoid the historic "wrote artifact to disk and narrated" failure.
- [ ] `/mcp` stays detached: no source imports cross the boundary in either direction; `LLM_WIKI_*` env and the `mcp__llm-wiki__*` namespace stay unchanged this slice (ADR 0050).
- [ ] Durable writes preserve traceable provenance (file paths, commit/state pointers, source snippets, or explicit inference labels).

## File map

- **Move → `legacy/`** (git-tracked reference, deleted in Task 12): `agents/`, `scripts/`, root `tests/` (pytest), the old `Makefile`, `pyproject.toml`. (Task 11 writes a *new* thin root `Makefile` of `myelin` aliases — it is not the one moved here.)
- **Keep in place** (data/interface, not V1 runtime): `projects/`, `raw/`, `concepts/`, `docs/`, `schema/`, and `/mcp` (untouched).
- **Stage instructions** (`agents/update/*/{instructions.md,config.json}`) move to `legacy/` with `agents/` in Task 1, then Task 5 migrates them to `stages/<stage-id>/`; Task 10 reads them from `stages/`.
- **Create:** `package.json`, `tsconfig.json`, `src/cli.ts`, `src/runtime/{fs,json,config,projects,state,artifacts,process,llm-client}.ts`, `src/schema/*`, `src/query/{planner,engine}.ts`, `src/inbox/*`, `src/pipeline/*`, `src/commands/*`, Bun tests under `src/**/*.test.ts`.
- **Rename:** `llm-wiki.config` → `myelin.config`.
- **Modify:** `README.md`, `AGENTS.md` (Bun/TS runtime, Myelin name, detached MCP boundary).
- **Do not touch:** `/mcp`, `LLM_WIKI_*` env vars, the `mcp__llm-wiki__*` tool namespace.

## Tasks

### Task 0 — Pre-flight (decisions + seed artifacts)

Settled before Task 1 so the build does not stall on upstream unknowns.

- [x] **Query/inbox seed:** core ADAPTS the self-contained MCP TypeScript (`mcp/src/query-planner.ts`, `query-engine.ts`, `wiki-state.ts`, `fs.ts`, `inbox.ts`) into `src/` rather than re-porting `agents/query/*.py` (ADR 0052). This reshapes Tasks 4, 8, 9: Task 4 adapts `wiki-state.ts` (`projectMap`/`listWikiProjects`); Task 8 adapts the deterministic `query-planner`/`query-engine` and layers the LLM router/synthesizer as *optional* stages via the provider abstraction; Task 9 adapts the `inbox.ts` schema and `auto-update.ts` lock/spawn (which now spawns `project ingest`).
- [x] **Pipeline scope:** Phase-0 `learn` = sense → impact → propose → apply → validate; `ingest` = ingest → apply → validate; validate failure surfaces and stops (no auto-reconcile). Acceptance, reconcile, self-correct, and `measure` are deferred (ADR 0053).
- [x] **Schema seed authored:** global `schema/` exists (`global.md` + `rules/{source-classification,memory-scopes,page-taxonomy}.json`); the compiled `schema-context.json` shape is specified in `schema/schema-context.md`. Task 3/7 implements the Zod validator + compiler against that shape. `schema build` always yields a valid context for a project with no project-local schema (bootstrap resolved).
- [x] **Target project:** `trygga` (leanest — 272K, 12 wiki pages, full `state/` set) is the Task-4 walking-skeleton + Task-5 migration guinea pig; dogfood `llm-wiki` once it works. All 7 registered projects share an identical `state/` shape, so the pick is purely iteration speed.
- [x] **`.gitignore` policy:** `legacy/` tracked (deleted Task 12); authored `schema/` tracked; generated `projects/<key>/state/schema-context.json` **tracked** (deterministic agent-facing contract — keeps `memory query` working without a build step; the `inputs` sha256 + freshness check guards drift); `node_modules/`, `projects/*/state/.update.lock`, `projects/*/logs/`, and `projects/*/runs/` ignored.
- [x] **`--json` envelope:** `status` and `memory query --json` emit the design's Facade Response Contract (`answer, confidence, memory_scope, citations, candidate_ids, degraded, degraded_reason, source_tools`) — the contract the detached MCP consumes later.
- [x] **Test fixtures:** a minimal synthetic project at `tests-ts/fixtures/sample/` (`project.json` + a few wiki pages + minimal `state/`) backs Bun tests; never the real `projects/` or the absent `projects/sample/`.

### Task 1 — Quarantine V1

- [ ] Move `agents/`, `scripts/`, root `tests/`, the old `Makefile`, `pyproject.toml` into `legacy/` (git-tracked).
- [ ] Confirm project data (`projects/`, `raw/`, `concepts/`), `docs/`, and `/mcp` remain in place.
- [ ] Exclude `legacy/` from the TS build/test so it never compiles or runs.
- [ ] Gate: repo root is clean for a fresh `src/`; `legacy/` runs nothing automatically.

### Task 2 — Root Bun/TS package + `myelin` CLI skeleton

- [ ] Create `package.json` (`"private": true`, bin `myelin` → `src/cli.ts`) and `tsconfig.json`.
- [ ] `src/cli.ts` dispatches V2 verbs (stubs OK): `status`, `memory query`, `project learn`, `project ingest`, `session close`, `schema check`, `schema build`. (`ask` is the V1 name, mapped to `memory query` — not a separate V2 verb.)
- [ ] Do not add `/mcp` as a workspace member.
- [ ] Gate: `bun install && bun run typecheck` PASS; `myelin status` prints a real (even if minimal) response.

### Task 3 — Runtime primitives (lean reimplementation)

- [ ] `src/runtime/{fs,json,config,projects,state,artifacts,process}.ts`: safe path resolution, deterministic JSON IO, config load (incl. `myelin.config` model profiles), project discovery/registry, state read/write, artifact paths, subprocess helpers.
- [ ] Reimplement from behavior; read `legacy/` only to recall specifics. Tests written fresh against V2 intent (Rule 9), not ported pytest assertions.
- [ ] Gate: `bun test && bun run typecheck` PASS.

### Task 4 — ★ Walking skeleton: `myelin status` end-to-end (de-risk gate)

- [ ] `status` answers "what project am I in / latest session / what's stale" deterministically from existing project state. No schema, no LLM.
- [ ] Run against a real registered project's current data.
- [ ] **Go/no-go checkpoint:** prove the runtime + data access work end-to-end on real data before any breadth is built. Revisit primitives/layout here if anything is wrong.

### Task 5 — Adopt + migrate the V2 data layout

- [ ] Adopt `projects/<key>/{sources,wiki,schema,state,log,runs}/` (ADR 0046).
- [ ] Write a migration adapter; migrate one real project (`trygga`); migrate stage-instruction data from `legacy/agents/update/*/{instructions.md,config.json}` → `stages/<stage-id>/` (global pipeline data, read by Task 10).
- [ ] Update Task-4 readers for the new layout. Preserve existing knowledge, raw sources, and provenance.
- [ ] Gate: `status` still passes on the migrated project.

### Task 6 — Provider abstraction (`src/runtime/llm-client.ts`) (ADR 0051)

- [ ] Reimplement the BYO-subscription runner: Codex (`codex exec --skip-git-repo-check --sandbox read-only -`, prompt on stdin, JSON parse + referenced-file recovery) and Claude Code (`claude -p --output-format json [--model]`, parse `result`/`final_message`).
- [ ] Preserve `DEFAULT_PROVIDER` + `MODEL`/per-call override, per-workload profiles (pipeline vs query) and Codex reasoning-effort tiers from `myelin.config`.
- [ ] Preserve stub mode (`LLM_STUB_RESPONSES_DIR`) and prompt-hash checks for deterministic tests.
- [ ] Keep a clean provider seam so a third backend can be added later (no Gemini this slice).
- [ ] Gate: stubbed tests cover codex + claude dispatch, default/override/profile resolution, read-only sandbox flags, and JSON recovery.

### Task 7 — Thin global-only schema (ADR 0049)

- [ ] Global `schema/` only: markdown guidance + a small set of hand-authored JSON rules (page taxonomy, required provenance fields, allowed memory scopes, CLI vocabulary), validated by Zod.
- [ ] Implement `schema check` (read-only) and `schema build` (compile `schema-context.json`; `--dry-run` previews; build writes by default per 0033).
- [ ] Explicitly do NOT implement project-local schema, override records, candidates/lifecycle, `--include-global`, or `--global` apply (deferred).
- [ ] Gate: tests prove valid schema compiles, invalid schema fails build, and `schema check` mutates nothing.

### Task 8 — Query on schema context (+ MCP contract) (ADR 0048)

- [ ] `src/query/{planner,engine}.ts` consumes `schema-context.json` for taxonomy/scopes/freshness/provenance. Treat `legacy/agents/query/*` as reference only.
- [ ] `memory query` fails closed (deterministic degraded response) when schema context is missing/invalid; suggests `schema build|check`; does not auto-build; stays side-effect-light (0037/0038).
- [ ] Document the contract: core owns query; the detached MCP consumes `myelin memory query --json` rather than duplicating logic. (MCP-side change is separate work in the `/mcp` repo.)
- [ ] Gate: tests cover schema-aware routing and fail-closed behavior.

### Task 9 — Inbox + auto-update primitives

- [ ] `src/inbox/*`: preserve the inbox item schema + filename convention, low-confidence gap-note emission, auto-update lockfile semantics, and detached update-log paths (MCP depends on these contracts).
- [ ] Reimplement faithfully; tests encode *why* the lockfile/gap loop matters, not ported pytest assertions.
- [ ] Gate: tests cover schema/filename validation, gap emission, and lockfile acquire/skip/release.

### Task 10 — Pipeline orchestration (lean)

- [ ] `src/pipeline/*`: stage runner that executes the stage-instruction files in `stages/<stage-id>/` (migrated by Task 5) as data, plus deterministic apply / structural-validate / commit. **No auto-reconcile** — validate failure surfaces and stops; reconcile, self-correct, acceptance, and `measure` are deferred (ADR 0053).
- [ ] `project learn` (was compile) and `project ingest` (was update) run end-to-end via the provider abstraction.
- [ ] Carry forward only structural validators that still make sense; mark internal pipeline semantics **provisional — redesigned in a later phase**. V1 artifact shapes are NOT acceptance criteria.
- [ ] `project learn` auto-applies routine updates with provenance; forces review/dry-run for destructive deletes, decision supersession, low-confidence synthesis, conflicting sources, broad rewrites, or explicit `--review`/`--dry-run` (0019/0020); verifies schema freshness first and stops on schema-validation failure.
- [ ] Gate: a dry/fixture run of learn + ingest completes on a real project.

### Task 11 — Make = thin aliases; docs; config rename

- [ ] Rename `llm-wiki.config` → `myelin.config`; update loaders.
- [ ] Create a *new* thin root `Makefile` whose targets are `myelin` CLI aliases (the V1 Makefile stays in `legacy/` and is removed with it in Task 12); retire V1-concept targets; keep `/mcp` untouched.
- [ ] Update `README.md` and `AGENTS.md`: Bun/TS runtime, Myelin product name, V2 CLI vocabulary + old-command mapping, detached MCP boundary, and how to run tests/typecheck/commands.

### Task 12 — Delete the quarantine + final verification

- [ ] Once V2 commands cover what matters, delete `legacy/`.
- [ ] Run `bun test` and `bun run typecheck` (PASS).
- [ ] Smoke on a real project: `myelin status`, `myelin memory query "..."`, `myelin project learn --dry-run`.
- [ ] Confirm normal operation needs no Python or `.venv`; `/mcp` remains ignored/detached; `LLM_WIKI_*` contracts intact.
- [ ] Report the next slice (SQLite memory foundation).

## Acceptance (V2 intent, not V1 parity)

- [ ] `myelin status / memory query / project learn / project ingest` run end-to-end on a real project with no Python or `.venv`.
- [ ] Provider abstraction drives Codex + Claude Code with configurable default + per-workload profiles; Codex read-only/JSON contract preserved.
- [ ] Thin global schema validates and compiles; query fails closed without it.
- [ ] Inbox/gap/auto-update contracts preserved (MCP unaffected).
- [ ] `/mcp` untouched and detached; query logic exists once, in core.
- [ ] `legacy/` deleted; Bun tests + typecheck pass; tests encode V2 intent.

## ADRs

- **New:** 0047 (quarantine + clean rewrite), 0048 (core owns query; MCP via contract), 0049 (thin global-only Phase-0 schema), 0050 (Myelin name + rename scope), 0051 (multi-provider BYO runner; Gemini deferred).
- **Reinforced:** 0011, 0012, 0013, 0014, 0015, 0016, 0017, 0021, 0022, 0046.
- **Deferred past Phase 0 (target design, not rejected):** 0030, 0031, 0040–0045, and the project-local portion of 0023/0024 (per ADR 0049).
