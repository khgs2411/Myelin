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

- Bun/TypeScript CLI entrypoint and command registry driven by an explicit
  launch context that separates the authoritative Myelin checkout from the
  caller's working directory.
- A copied machine launcher (normally `~/.local/bin/myelin`) backed by the
  versioned ownership locator at `~/.myelin/install.json`; installed hooks and
  detached workers resolve through the same absolute command boundary.
- Runtime helpers for paths, JSON, project discovery, state, run artifacts, ids, and subprocesses.
- Provider abstraction for Codex and Claude Code using the operator's authenticated CLI.
- Stub-response support for deterministic tests.
- Vendored SQLite runtime selection for vector extensions on Apple Silicon macOS, with explicit override and host SQLite fallback.

Code evidence:

- `src/cli.ts`
- `src/commands/registry.ts`
- `src/commands/register.ts`
- `src/runtime/launch-context.ts`
- `src/runtime/command-invocation.ts`
- `src/runtime/*`
- `src/memory/sqlite-runtime.ts`
- `vendor/sqlite/README.md`

Alignment:

This layer matches V2 well. It is the stable foundation created by the Python/Bash to Bun/TypeScript migration. For Session Memory vector indexing, Myelin owns the SQLite runtime boundary where it has a vendored runtime; a platform is host-independent only after `vendor/sqlite/<platform>-<arch>/` exists for it.

Verdict:

Keep and build on it.

### Installed Command And Provider Lifecycle

What exists:

- Repo-root `./install` delegates to the same `myelin install` service used by
  the CLI.
- Installation is preview-first; `--apply` writes a copied launcher and the
  single machine ownership locator under `~/.myelin/`.
- Bare install detects the available supported provider, while explicit
  `--provider codex` and `--command-only` keep provider selection deliberate.
- `--rebind` handles a moved checkout explicitly, and `--bin-dir` supports an
  absolute custom launcher directory without silently moving an existing
  recorded launcher.
- Provider-only uninstall preserves the command; full uninstall removes only
  verified artifacts recorded by Myelin. Both are preview-first and require
  `--apply` to mutate machine state.
- A recoverable journal makes launcher, provider, and locator promotion
  resumable. Ownership or hash mismatches fail closed.

Code evidence:

- `install`
- `src/commands/install.ts`
- `src/install/install-service.ts`
- `src/install/machine-locator.ts`
- `src/install/install-journal.ts`
- `src/install/launcher.ts`
- `src/install/provider-registry.ts`
- `src/install/codex.ts`

Alignment:

This is the stable local operator boundary needed for external-repository use.
The checkout remains the update source, the copied launcher is machine access,
and the locator owns the binding without relying on a symlink or release
package.

Verdict:

Keep this boundary conservative. Add providers through the same registry and
ownership lifecycle; do not create provider-specific global commands or infer
ownership from files that are absent from the locator.

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
- Query routes explicitly to indexed Session Memory or Project Memory retrieval.
- Query embedding cache, vector recall, Project Memory FTS fusion, and deterministic response shaping are separate boundaries.
- Response envelope includes confidence, memory scope, citations, degradation, and optional route metadata.

Code evidence:

- `src/commands/memory.ts`
- `src/query/engine.ts`
- `src/query/memory-query-service.ts`
- `src/query/project-memory-query-service.ts`
- `src/memory/session-memory-query.ts`

Alignment:

Partially aligned. It provides the V2 query facade for Project Memory and Session Memory.

Mismatch:

The V2 interface should eventually route across Practice Memory, Personal Memory, and project state in addition to the implemented Project and Session Memory layers.

Verdict:

Keep the current explicit layer routing and retrieval services as backends for the future multi-layer query facade.

### Status

What exists:

- `myelin status [project-key]`.
- Resolves an omitted project key only from the caller's registered repository;
  unrelated directories must supply a key.
- Reports installation, Session Memory capture/ingest/retrieval/maintenance,
  Project Memory inbox/candidates/curation/retrieval/maintenance, warnings,
  suggested actions, and evidence paths.
- `--json` emits the exact versioned `myelin.status.v1` operational contract.
- Status inspection is read-only. Successfully observed `healthy`, `attention`,
  and `blocked` states exit zero; failures that prevent contract construction
  exit nonzero.

Code evidence:

- `src/commands/status.ts`
- `src/status/contracts.ts`
- `src/status/installation-inspector.ts`
- `src/status/session-memory-inspector.ts`
- `src/status/project-memory-inspector.ts`
- `src/status/lock-inspector.ts`
- `src/status/status-service.ts`
- `src/status/status-v1.ts`
- `src/status/status-renderer.ts`

Alignment:

Good operational foundation. It exposes machine and memory-pipeline health
without mutating jobs, locks, SQLite, or project files, and gives automation an
exact contract.

Mismatch:

This is operational status, not the later agent-facing Current Briefing. It does
not compose recent continuity and durable context into a bounded session-start
brief, and it does not yet route across future Practice or Personal Memory.

Verdict:

Keep the `myelin.status.v1` operational contract stable. Build the broader
agent-facing status and Current Briefing on top of this truth in Roadmap Step 12
instead of overloading the operational inspector.

### Pipeline

What exists:

- `myelin project learn <key>` runs agent-authored Project Memory creation or maintenance.
- Top-level `myelin ingest <key>` remains the Session Memory / Experience Log ingest command.
- Project Memory Curator artifacts live under `projects/<key>/runs/project-learn/<run-id>/`.
- File-authoring agents write a draft wiki, and a journaled promotion step publishes it to canonical markdown.
- Recovery fails closed when staged or already-promoted files drift.

Code evidence:

- `src/commands/project.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-draft-promotion.ts`
- `src/project/project-memory-markdown-applier.ts`
- `src/runtime/project-run-infrastructure.ts`

Alignment:

This is aligned with the agent-authored Project Memory boundary. Structured curator output schemas, deterministic quality gates, and entry-level markdown mutation were retired after the planner/writer flow became authoritative.

Mismatch:

The apply boundary promotes complete markdown documents rather than interpreting a second structured mutation language. Retrieval indexing remains derived state and runs after canonical publication.

Verdict:

Keep new Project Memory behavior on the agent-authored document path; do not reintroduce the retired structured-curator gates as a parallel pipeline.

### Runtime Inbox And Candidate Intake

What exists:

- Typed runtime inbox source-item writer.
- CLI-created project-memory inbox items.
- Deterministic intake into Project Memory candidates.
- Optional detached Project Memory maintenance scheduling after source preservation.

Code evidence:

- `src/inbox/runtime-inbox-items.ts`
- `src/project/project-memory-candidate-intake-service.ts`
- `src/maintenance/auto-project-memory-maintenance.ts`

Alignment:

Aligned with the V2 evidence-to-candidate boundary. Runtime inbox JSON remains preserved source material until deterministic intake records its terminal disposition.

Mismatch:

The runtime inbox is currently project-scoped; broader layer routing remains outside this slice.

Verdict:

Extend the runtime inbox contract when another producer needs preserved source intake; do not restore the retired low-confidence gap schema or detached `ingest` wrapper.

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

- Project Memory and Session Memory query backends
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
