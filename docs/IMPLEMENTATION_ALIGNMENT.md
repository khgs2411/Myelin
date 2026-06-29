# Implementation Alignment

This document is a snapshot of what Myelin currently has, how each layer relates to the V2 product shape, and which parts should or should not be extended before more design work.

Use this when returning to the repo and asking: "What do we already have, and does it match the project-rooted memory vision?"

Related docs:

- `MYELIN.md` is the canonical product design.
- `CONTEXT.md` is the product-language glossary and resolved ambiguity log.
- `docs/README.md` is the documentation map and canonical reading path.
- `docs/archive/V2_SPEC.md` is the raw brainstorming source for the project-rooted memory model.
- `docs/ROADMAP.md` is the canonical implementation checklist, built status, known gap list, and next step.

## Product Shape

Myelin is not primarily a SQLite session tracker, a generic RAG system, or a repo documentation compiler.

The intended product is a maintained memory layer for coding agents, rooted in real project work. It turns repo-local knowledge and session experience into durable project understanding, reusable practices, and personal operating preferences, served through a small semantic interface.

The core hierarchy is:

- Project Memory is the root. Real project work is the source of lived truth.
- Session Memory belongs under a project. It answers what happened last time, what was verified, what remains, and what not to redo.
- Practice Memory is canonical cross-project guidance derived from project evidence. Project references are provenance, not instructions to copy.
- Personal Memory is durable guidance about Liad's working preferences and agent behavior, derived from repeated corrections or explicit guidance.
- Experience Log is noisy raw evidence. It is not truth.

The important flow is:

```text
raw project work
  -> session continuity
  -> curated project memory
  -> practice candidates
  -> personal preference candidates
  -> canonical practice/personal memory
```

The operating rule is:

```text
Capture cheaply. Reason rarely. Promote with judgment.
```

Hooks and low-level capture should append evidence or candidates. They should not call LLMs directly or mutate curated memory. Agentic work belongs at promotion boundaries: summarizing meaningful sessions, updating project memory, turning repeated project evidence into practice candidates, or encoding durable preferences.

## Current Implementation

The current codebase has three kinds of layers:

- Solid runtime foundation worth keeping.
- Thin product surfaces that point in the right direction but are not the full product yet.
- Legacy-compatible surfaces that still carry old wiki/brain/compiler assumptions and should be reframed before extension.

### Runtime And Providers

What exists:

- Bun/TypeScript CLI entrypoint and command registry.
- Runtime helpers for paths, JSON, project discovery, state, run artifacts, ids, and subprocesses.
- Provider abstraction for Codex and Claude Code using the operator's authenticated CLI.
- Stub-response support for deterministic tests.
- Vendored SQLite runtime selection for vector extensions on Apple Silicon macOS, with explicit override and host SQLite fallback.

Code evidence:

- `src/cli.ts`
- `src/commands/registry.ts`
- `src/runtime/*`
- `src/memory/sqlite-runtime.ts`
- `vendor/sqlite/README.md`

Alignment:

This layer matches V2 well. It is the stable foundation created by the Python/Bash to Bun/TypeScript migration. For Session Memory vector indexing, Myelin owns the SQLite runtime boundary where it has a vendored runtime; a platform is host-independent only after `vendor/sqlite/<platform>-<arch>/` exists for it.

Verdict:

Keep and build on it.

### Project Data Layout

What exists:

- Project-owned data under `projects/<key>/`, including `wiki/`, `state/`, `sources/`, `log/`, and `runs/`.
- Migration support for old run-artifact layouts.

Code evidence:

- `src/runtime/layout.ts`
- `src/runtime/projects.ts`
- `src/runtime/state.ts`
- `projects/<key>/...`

Alignment:

Mostly aligned. The target layout is project-rooted and keeps curated memory next to project state and provenance.

Risk:

Some existing state/page metadata still reflects the older wiki/compiler model. Treat it as useful migration material, not final product semantics.

Verdict:

Keep the layout. Reevaluate metadata meaning as product work resumes.

### Schema Layer

What exists:

- Global authored schema in `schema/global.md`.
- Typed JSON rules for source classification, memory scopes, and page taxonomy.
- `myelin schema check <key>` and `myelin schema build <key>`.
- Generated per-project `schema-context.json` with input hashes.

Code evidence:

- `schema/global.md`
- `schema/rules/*.json`
- `src/schema/*`
- `src/commands/schema.ts`

Alignment:

Good Phase-0 match. The layer encodes global rules and keeps query/learn from operating without schema context.

Missing:

- Project-local schema.
- Schema overrides.
- Schema candidates and apply flow.

Verdict:

Keep. Do not add advanced schema features until the desired memory artifacts are clearer.

### Query

What exists:

- `myelin memory query <key> "<question>"`.
- Query fails closed when schema context is missing or invalid.
- Query planner routes over `page-metadata.json` or `pages.json`.
- Response envelope includes confidence, memory scope, citations, degradation, and optional route metadata.

Code evidence:

- `src/commands/memory.ts`
- `src/query/engine.ts`
- `src/query/planner.ts`

Alignment:

Partially aligned. It points toward the V2 `query` facade but currently serves mostly `project_wiki`.

Mismatch:

The V2 interface should route across Project Memory, Session Memory, Practice Memory, Personal Memory, and project state. The current implementation mostly selects wiki pages from metadata.

Verdict:

Keep as a project-wiki query seed. Reframe as one backend for the future `query` facade, not the complete query product.

### Status

What exists:

- `myelin status [project-key]`.
- Reports project identity, stale state, latest run, and latest session pointer.
- JSON response follows a facade-like envelope.

Code evidence:

- `src/commands/status.ts`

Alignment:

Good skeleton. It is the closest existing piece to the future `status` facade.

Mismatch:

Status currently reads latest sessions from `wiki/sessions/*.md` mtime, not from a broader current-state or session-continuity model. It is useful as smoke-test/status output, but it is not yet the agent's full current-state briefing.

Verdict:

Keep. Expand only after deciding what "current state" should mean as a product artifact.

### Pipeline

What exists:

- `myelin project learn <key>` runs the Project Memory Curator pre-write flow.
- Top-level `myelin ingest <key>` remains the Session Memory / Experience Log ingest command.
- Project Memory Curator artifacts live under `projects/<key>/runs/project-learn/<run-id>/`.
- Curator output is validated before any markdown write.
- Markdown apply is not implemented in the current Project Memory Curator slice.

Code evidence:

- `src/commands/project.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-curator-validator.ts`
- `src/runtime/project-run-infrastructure.ts`

Alignment:

This is now aligned with the pre-write Project Memory Curator boundary. It still stops before canonical markdown mutation.

Mismatch:

The current apply stage records run artifacts and freshness state, but it does not perform meaningful curated wiki updates. The V2 product needs a pipeline that asks "what durable project knowledge changed?" and writes focused, provenance-backed Project Memory updates.

Verdict:

Do not extend blindly. Revisit the learn/ingest model before adding more stages.

### Inbox And Gap Flow

What exists:

- Typed inbox item writer.
- Manual and MCP-created gap items.
- Auto-update wrapper with lock/log behavior.
- Existing MCP tools can flag stale answers, create inbox items, and enrich gaps.

Code evidence:

- `src/inbox/items.ts`
- `src/inbox/auto-update.ts`
- `docs/inbox-item-schema.md`

Alignment:

Useful, but currently legacy-shaped. It maps well to Project Memory repair or candidate intake.

Mismatch:

It is still framed around gap notes and auto-update behavior. V2 should generalize this as evidence/candidate intake, not just query repair.

Verdict:

Keep and reframe. This is likely valuable if renamed and routed through the V2 candidate model.

### SQLite Memory And Session CLI

What exists:

- Repo-root `state/memory.db`.
- WAL, foreign-key pragmas, migrations.
- `sessions` and `session_events` tables.
- `myelin session start/log/close/recent/show`.

Code evidence:

- `src/memory/db.ts`
- `src/memory/migrations.ts`
- `src/memory/sessions.ts`
- `src/commands/session.ts`

Alignment:

Technically aligned with "SQLite is serving state," but product fit is uncertain.

Risk:

The current session implementation was the first substrate slice. It may not match the actual memory artifact Myelin should expose. It captures manual session rows, but the product may need current-state handoffs, evidence bundles, or agent stop summaries before generic session CRUD.

Verdict:

Keep as non-harmful infrastructure. Do not wire it deeper or treat it as authoritative until the desired session/current-state artifact is clearer.

### MCP Interface

What exists:

- Root config for a detached published MCP package.
- Compatibility contracts for `LLM_WIKI_*` env and the `mcp__llm-wiki__*` namespace.
- Core query behavior is owned by root `src/query/` and exposed through CLI/JSON contracts for detached consumers.

Code evidence:

- `.mcp.json`
- `src/query/*`
- `src/commands/memory.ts`

Alignment:

The boundary is aligned: MCP is not root-owned product logic. The legacy tool vocabulary remains a compatibility concern for the detached package.

Mismatch:

V2 wants semantic facades:

- `query` for what is known or true.
- `how` for operating guidance.
- `status` for current state, inventory, and freshness.

The current MCP tools still expose internal/legacy concepts like wiki pages and brain pages.

Verdict:

Keep the detached server and contract discipline. Plan to add semantic facades and demote old tools to supporting/internal tools.

## Alignment Verdict

Keep as foundation:

- `src/runtime/*`
- provider abstraction
- CLI registry
- project discovery and state helpers
- schema check/build
- detached MCP boundary
- tests and typecheck discipline

Keep but reframe:

- query planner and project-wiki query
- inbox/gap flow
- status command
- project wiki metadata
- retained non-Project-Memory stage/reference assets

Do not extend blindly:

- SQLite session logic
- future markdown apply beyond the current `project learn` pre-write curator flow
- old MCP brain/wiki tool vocabulary
- advanced schema candidates before real candidate examples exist

## Product Implication

The product-shape change is from:

```text
project files -> wiki pages -> metadata -> query_wiki/update
```

to:

```text
real project work
  -> evidence
  -> curated project memory
  -> session/current-state continuity
  -> practice and personal memory candidates
  -> semantic query/how/status interface
```

The current implementation gives Myelin enough runtime to build that product, but it does not yet embody the product. Before adding new technical layers, decide which durable memory artifact would be obviously useful in a new coding session.

Good candidates:

- a current-state project briefing
- a session handoff artifact
- a project-memory update candidate
- a practice candidate
- a semantic `status` facade
- a semantic `how` facade

The next implementation should start from that artifact, then decide which existing layer should support it.
