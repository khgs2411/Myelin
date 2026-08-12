# Myelin — V2 Project-Rooted Agent Memory Design

> **V2 Amendments (2026-06-02).** This design is amended by ADRs 0047–0051 and the Phase-0 plan `docs/superpowers/plans/2026-06-02-v2-phase-0-clean-typescript-core.md`. Read these reconciliations first:
>
> - **Name.** The product is **Myelin**, built on the **LLM Wiki Pattern** (the Karpathy technique keeps its name). Below, "LLM Wiki"/"llm-wiki" as a *product* reference means Myelin; "LLM Wiki pattern" is the technique. Rename scope this slice: product name, CLI binary (`myelin`), `myelin.config`, and docs; `LLM_WIKI_*` env vars and the `mcp__llm-wiki__*` namespace stay unchanged for now (ADR 0050).
> - **Phase 0 is a clean reference-quarantine rewrite,** not a parity port: V1 Python/Bash moves to `legacy/` and `src/` is written fresh; no V1 behavior is an acceptance target (ADR 0047).
> - **Phase-0 schema is thin and global-only.** The full schema layer described below (project-local schemas, override records, candidate lifecycle, `--include-global`, `--global` apply) is the **target design**, deferred past Phase 0 (ADR 0049). The First Slice Command Contract reflects this: only `schema check`/`schema build` are required; `schema candidates`/`schema apply` are deferred.
> - **Query lives once, in core.** The detached MCP consumes it via the CLI/JSON contract (`myelin memory query --json`), not by duplicating logic (ADR 0048).
> - **Provider Abstraction / BYO-subscription is a core invariant** (ADR 0051): preserve the Codex + Claude Code runners; Gemini is *not* wired today and is deferred (it appears below only as a future *embedding* provider, a separate concern).
> - **Authoritative Phase-0 scope** is the 2026-06-02 plan + ADRs 0047–0051. Where the body describes schema, query, or migration as first-slice work, treat it as target design unless the plan includes it.

## Design Status

`V2_SPEC.md` remains raw source material for this design. This document is the normalized V2 contract: it preserves the project-rooted memory direction, removes transcript repetition, and defines the migration boundaries needed before implementation planning.

## Goal

Turn Myelin from a repository documentation compiler into a project-rooted memory system for coding agents, without losing the curated project wiki that already works.

The V2 product should answer:

- what is known about this project
- what happened last session
- how Liad normally works with this kind of task
- how we do recurring workflows such as local Supabase or serverless functions
- what evidence exists, and what still needs curation

## Core Thesis

Projects are the source of lived truth. Other memory types are derived from real project work, not invented as detached notes.

This product originates from Karpathy's LLM Wiki pattern: preserve raw sources, let the LLM maintain an evolving markdown wiki, and use a schema/instructions layer to keep the agent disciplined. V2 should deepen that pattern for coding agents rather than drifting into generic RAG or ordinary repo documentation.

Project docs should capture what code does not cheaply reveal:

- product behavior
- feature intent
- operating workflows
- decisions
- setup gotchas
- manual QA flows
- current work state
- useful provenance

The system should not spend tokens summarizing code that an agent can inspect directly. V1 compatibility is not a primary goal: the current product has limited operator value and may be broken or replaced when that is the cleanest path toward the V2 brain.

## V2 North Star And First Slice

The V2 north star is a project-rooted memory system with curated project docs, project-scoped session continuity, canonical practices, personal workflow memory, raw experience capture, SQLite structured memory, and vector recall.

The product runtime north star is also changing: Myelin should move from a Python/Bash core plus a TypeScript MCP package to a Bun/TypeScript-first codebase. The current TypeScript MCP rewrite is not a sidecar direction; it is the target runtime shape for the repo.

The first implementation slice is therefore a complete core runtime migration, not only a read-only foundation and not the memory substrate itself. It must rewrite the thin Python/Bash core in Bun/TypeScript — V1 quarantined as reference, not ported for parity (ADR 0047) — so later SQLite memory work lands on the final runtime:

- a root Bun/TypeScript package boundary for the core repo, separate from the detached MCP interface
- root `src/runtime/*` TypeScript modules for shared project discovery, path resolution, config loading, state reads, and JSON/file helpers
- TypeScript implementations for current root scripts and pipeline orchestration
- TypeScript implementations for current shared agent helpers and query helpers
- a deliberate TypeScript-native directory and data layout for the core runtime and pipeline
- migration adapters for existing projects, artifacts, and stage assets where needed
- a V2 CLI vocabulary that names product concepts directly
- Make convenience aliases only where useful
- targeted V2-intent checks for behavior worth preserving (no V1 parity target — ADR 0047)
- tests and typecheck gates for the new TypeScript infrastructure
- explicit documentation that SQLite memory, vector search, and hooks build on this runtime foundation

The first implementation slice must not build:

- the SQLite memory database
- vector search
- Gemini embedding calls
- Codex hook installation
- automatic practice promotion
- automatic personal preference promotion

### First Slice Command Contract

The first slice must make the V2 command vocabulary real enough that later memory work does not inherit V1 command names, but it does not need to implement every north-star memory behavior. The schema surface is thin and global-only this slice (ADR 0049).

Required first-slice commands:

| Command | First-slice status | Minimum behavior |
| --- | --- | --- |
| `myelin schema check <key>` | required | Read authored global schema, validate typed JSON rules, validate generated schema context when present, and mutate nothing. |
| `myelin schema build <key>` | required | Build or rebuild `projects/<key>/state/schema-context.json` from root (global) schema inputs; write by default; support `--dry-run`. |
| `myelin memory query <key> "<question>"` | required | Use schema context before query planning; fail closed when schema context is missing or invalid; may delegate to the current query implementation only through the V2 response contract. Query lives once in core; the detached MCP consumes it via the CLI/JSON contract (ADR 0048). |
| `myelin project learn <key>` | required | Replace broad compile as the operator-facing concept; verify schema freshness first; may read the live repo; auto-apply routine Project Memory updates by default; force review for risky changes. |
| `myelin project ingest <key>` | required | Replace narrow update as the queued-source/inbox processing concept; preserve source terminal-state behavior. |
| `myelin project onboard <key>` | required if existing project init remains available | Replace or alias project initialization while preserving project config and source provenance rules. |
| `myelin status <key>` or `myelin project status <key>` | required | Deterministic project/runtime status for operator smoke tests and detached interface checks. Built first as the walking-skeleton gate (no schema, no LLM). |

Alias-only first-slice commands:

- old Make targets may remain as convenience aliases only when they call V2 commands or an explicitly named temporary legacy escape hatch
- old root command names such as `compile`, `update`, and `ask` must not remain the primary product vocabulary

Deferred first-slice commands:

- `myelin schema candidates <key>` and `myelin schema apply <candidate-id>` are deferred: the project-local / override / candidate / `--global` schema machinery is target design but out of Phase 0 (ADR 0049)
- `myelin session close <key>` may be a no-op/degraded placeholder unless session memory is implemented in the slice
- `myelin practice promote` and `myelin personal promote` are deferred until Practice/Personal promotion designs exist

Retired or legacy-only commands:

- commands that only reinforce V1 mechanics should be retired unless the inventory proves they protect useful knowledge, provenance, operator intent, or detached interface contracts

Each required first-slice command must have a deterministic acceptance test or smoke test. Deferred commands must return an explicit degraded or not-implemented response instead of silently falling back to weak behavior.

### Migration Preservation Contract

The TypeScript migration may break weak V1 behavior, but it must not strand useful knowledge or provenance. Existing surfaces are handled by an explicit keep/migrate/adapt/retire decision before implementation:

| Existing surface | V2 treatment |
| --- | --- |
| `projects/<key>/wiki/` | Preserve as curated Project Memory markdown. May be reorganized only with provenance and backlinks retained. |
| `projects/<key>/index.md` | Preserve as project navigation. May be redesigned around content value instead of repo-module shape. |
| `projects/<key>/state/*.json` | Preserve or migrate when it carries project config, page metadata, freshness, source pointers, latest run pointers, relationships, or update state. |
| `projects/<key>/state/latest/` | Adapt into the V2 generated-state model or explicitly retire after equivalent latest-run/status data exists. |
| `projects/<key>/inbox/` | Preserve pending and terminal source state. Migration must not silently discard processed, needs-review, rejected, or pending items. |
| `projects/<key>/wiki/sessions/` | Preserve as curated durable session artifacts. SQLite session rows later become source evidence, not automatic replacements. |
| `projects/<key>/changelog.md` | Preserve or migrate into `projects/<key>/log/` with chronological history intact. |
| `raw/` | Preserve as global unclassified intake unless the runtime-layout decision replaces it with an equivalent source-preservation path. |
| `artifacts/<key>/runs/` | Treat as migration reference material. Move or adapt only the artifacts needed for useful provenance, debugging, acceptance history, or latest-state continuity. |
| `agents/update/**/instructions.md` and `config.json` | Keep as data/reference assets until each stage is classified as moved, converted, retained, or retired. |
| `agents/update/**/run.sh`, `agents/**/*.py`, and `scripts/*` | Reference only during migration. Final normal operation must use TypeScript entrypoints. |
| `.venv`, `pyproject.toml`, pytest-only runtime support | Retire or mark legacy-only once TypeScript parity exists for behavior worth keeping. |

The migration must leave a durable record of:

- what was preserved, migrated, adapted, or retired
- why each retired behavior was not valuable to V2
- where preserved provenance now lives
- how to inspect the last useful V1 run state when needed

Must-not-lose data:

- curated project wiki pages
- raw source evidence and original inbox items
- source provenance and file/path citations
- freshness and stale-state signals
- pending and terminal inbox status
- session summaries and chronological changelog history
- operator-owned project config
- detached MCP interface contracts that agents already rely on

### Implementation Surface

The first V2 implementation slice should establish a repo-level TypeScript foundation for core product logic, not add new Python infrastructure and not fold the detached MCP interface into the main repo package graph.

The core TypeScript runtime starts as root `src/runtime/*`, not `packages/runtime`. A package split is premature while `/mcp` is detached and no second core TypeScript consumer exists.

The MCP layer is the agent interface for communicating with this repo. It is intentionally ignored and detached from the main repo. It may be worked on in parallel because it exposes the agent API, but its files, package metadata, build, release flow, and implementation logic stay separate from the core repo. Main repo logic must not import MCP code, and MCP code must not become the owner of product logic.

The integration boundary is contracts, not shared source files:

- stable repo files under `projects/`, `state/`, `artifacts/`, `raw/`, and documented schemas
- stable CLI/Make commands while they exist
- stable JSON contracts for query, state, inbox, and future memory outputs
- explicit environment such as `LLM_WIKI_ROOT` and `LLM_WIKI_PROJECT`

Current detached MCP source of truth:

- `mcp/src/index.ts` creates the server.
- `mcp/src/tools.ts` registers tools.
- `mcp/src/contracts.ts` defines advertised tool names and resources.
- `mcp/src/fs.ts` resolves `LLM_WIKI_ROOT` and explicit `project_key` / `LLM_WIKI_PROJECT`.
- `mcp/src/query-engine.ts` provides the existing local `planQuery` and `queryWiki` paths.
- `mcp/src/resources.ts` exposes MCP resources and capabilities.
- `mcp/tests/*.test.ts` verify MCP behavior with Bun.

The existing Python/Bash compiler and update pipeline remain reference implementations during migration only. They are not the desired long-term architecture, and their directory structure should not be treated as sacred. This migration is allowed to introduce a better TypeScript-native code and data layout when the new layout has a clear purpose and a migration path for existing project data. The first slice is complete only when normal core repo operation uses Bun/TypeScript entrypoints instead of Python/Bash entrypoints.

The invariants that must hold across every slice are:

- markdown wiki plus state JSON remain human-reviewable curated truth
- the provider abstraction is bring-your-own-subscription: drive the operator's authenticated vendor CLI (Codex, Claude Code today) in headless mode, with a configurable default and per-workload model profiles, and stay provider-pluggable (ADR 0051)
- SQLite/vector memory is serving, recall, and queue state unless a curator promotes content back to a durable artifact
- project references in practices are provenance, not live instructions
- hooks append events and candidates only
- agentic workers require explicit mode, lock, budget, and debounce controls
- useful project knowledge, raw sources, and provenance should not be discarded casually

V1 behavior may be broken during the migration if preserving it blocks the V2 product shape. The migration should distinguish low-value runtime compatibility from valuable knowledge preservation.

The V2 CLI should not preserve old command names as the primary product language. Terms such as `compile` and `update` carry V1 mental models. The new CLI should name the product concepts directly, and Make should become a convenience layer instead of the product API.

The V2 CLI is operator-facing. Its default output should be human-readable, with `--json` for machine-readable output. The detached MCP server remains the primary agent API.

## Memory Model

The memory model should keep the originating LLM Wiki layers visible:

- **Raw sources**: preserved inputs and evidence. The system reads them but does not silently rewrite them.
- **Wiki**: the curated markdown synthesis that compounds over time.
- **Schema**: the instructions, contracts, conventions, and command vocabulary that teach agents how to maintain the wiki.

SQLite/vector layers are serving infrastructure around this pattern, not replacements for it.

The schema layer has two levels:

- a global schema/instructions layer for product-wide rules, command vocabulary, source handling, provenance, review gates, and memory-scope semantics
- project-local schemas for domain-specific conventions, workflow preferences, project vocabulary, and project-specific maintenance rules

Project-local schemas specialize the global schema. By default they may extend or narrow global rules. They must not silently weaken or replace global rules. Any weakening/replacement requires a typed override record with an explicit reason.

`project learn` may detect project-local schema conventions from repeated project evidence. Schema changes affect future agent behavior, so they are more conservative than routine Project Memory updates: queue schema candidates by default, and auto-apply only narrow additive conventions with high confidence.

Schema candidates are stored as generated project state JSON in the TypeScript migration slice, for example `projects/<key>/state/schema-candidates.json`. Do not require SQLite for schema candidates before the memory layer exists.

Schema candidate IDs are globally unique. Each candidate stores `project_key` for ownership, which keeps `schema apply <candidate-id>` unambiguous while preserving project scope.

`schema candidates <key>` lists project-local candidates by default. Use `--include-global` to include global schema candidates relevant to that project. Global schema candidates are higher-impact and should be surfaced intentionally.

Applying a global schema candidate requires an explicit global flag: `schema apply <candidate-id> --global`. Candidate IDs are globally unique, but global schema changes affect every project and should not apply accidentally.

`project learn` does not generate global schema candidates. Global schema candidates require an explicit cross-project workflow, operator intent, or later Practice/Personal promotion logic with cross-project evidence.

Global schema candidate generation is deferred until cross-project Practice/Personal promotion exists. The TypeScript migration slice supports global schema candidate storage, listing, and explicit application mechanics, but not automatic global candidate discovery.

Schema candidate lifecycle states are:

- `pending`
- `applied`
- `rejected`
- `superseded`
- `failed`

Project-local schema candidates live in `projects/<key>/state/schema-candidates.json`. Global schema candidates live in root `state/schema-candidates.json`. Project-local `schema apply` rebuilds that project's schema context. Global `schema apply --global` rebuilds schema context for all registered projects or fails/rolls back.

Schema layout:

- global authored schema lives under root `schema/`
- project-local authored schema lives under `projects/<key>/schema/`
- compiled agent-facing schema context is generated state, for example `projects/<key>/state/schema-context.json`

The compiled schema context is not hand-edited. It gives agents a deterministic contract derived from readable authored schema files.

`schema-context.json` should regenerate when global or project-local schema inputs change. `project learn` should verify schema-context freshness before learning, but unchanged schema inputs should not cause unnecessary rewrites.

Schema files should include both:

- markdown guidance for human and agent-readable intent
- typed JSON rule files for enforceable contracts

Typed rules should cover things such as page taxonomy, review gates, allowed memory scopes, required provenance fields, CLI vocabulary, and validation requirements. YAML is not the default typed-rule format because JSON is easier to validate deterministically in TypeScript and aligns with generated `schema-context.json`.

Typed schema JSON should be hand-authored at first. Do not add a higher-level schema-rule generator until direct JSON authoring proves painful enough to justify another compiler layer.

Typed schema JSON should be validated by Zod validators in TypeScript. JSON Schema export can be added later if external tooling needs it, but JSON Schema is not the primary validator in this slice.

### Existing Schema Transition

The current root `schemas/` directory is a V1 schema-like surface, not the V2 target name. During the TypeScript migration:

- root `schemas/source-classification.md` becomes source material for the new root `schema/` authored guidance
- the source-classification contract currently repeated in `AGENTS.md` becomes global schema content, not a separate competing source of truth
- any typed source-classification rules created from that markdown live as hand-authored JSON under root `schema/`
- `schemas/` is retired, renamed, or left as a legacy reference only after the new `schema/` content and validators cover the same durable contract
- project-local source-classification exceptions must live under `projects/<key>/schema/` and follow the extend/narrow/typed-override rules

The migration must not leave both `schemas/` and `schema/` as active authored schema roots.

### Generated State And Versioning

Generated state is allowed, but its ownership must be explicit:

- root `state/schema-candidates.json` is generated global state for explicitly created global schema candidates
- `projects/<key>/state/schema-candidates.json` is generated project state for project-local schema candidates
- `projects/<key>/state/schema-context.json` is generated compiled schema context
- generated state should be deterministic and avoid rewrites when inputs are unchanged
- authored schema files, migration records, and typed rule definitions are versionable source artifacts
- generated run artifacts and project-local transient outputs may remain ignored when the migration record explains how they are reproduced or inspected

The `.gitignore` policy must be updated or documented so new authored source files and tests are not accidentally hidden, while generated state remains intentionally classified as tracked or ignored.

### Project Memory

Project Memory remains the root memory scope. It owns the maintained project wiki, state files, source provenance, gap-note inbox, current task state, and project-scoped sessions.

It should answer project-specific questions such as:

- how a feature behaves
- what workflows exist
- what changed recently
- what is stale or blocked
- what the next session should know

### Session Memory

Session Memory is a project-scoped continuity layer, not an independent global scope.

It stores:

- last session summary
- task, branch, and external work-tracker context when relevant
- what changed
- what was verified
- blockers
- next actions
- "do not redo this" notes

The default query "what did we work on last session?" resolves against the current project first.

### Practice Memory

Practice Memory stores canonical, project-agnostic workflows.

Practices are not live instructions to "do it like project X." Project references are provenance, not authority. A practice should say:

> This is how we run local Supabase stacks. It was derived from Wodnix and Suitepath. This practice is the current canonical guidance.

If a later project improves the practice, the practice can be updated and older projects remain evidence.

Practice promotion is queue/manual by default in V2. Automatic promotion is deferred until the candidate quality is proven.

### Personal Memory

Personal Memory stores durable working preferences and agent-behavior guidance.

Examples:

- prefer simulation/manual flow validation for role-based product behavior
- keep implementation tickets concise
- use `rtk` commands when possible
- do not over-document code that can be read directly
- separate diagnosis from redesign unless asked

Personal Memory should be derived from repeated project evidence and explicit user corrections. Promotion is queue/manual by default in V2.

### Experience Log

Experience Log is the noisy substrate. It stores hook events, MCP calls, selected pages, failed searches, user corrections, opened files, tool outputs, and agent stop summaries.

It is evidence, not truth. It feeds session memory, gap notes, project updates, practice candidates, and preference candidates.

## Runtime And Serving Model

V2 first completes the core Bun/TypeScript runtime migration for the repo. SQLite memory and vector search are built on that migrated runtime instead of adding more Python infrastructure.

After the core runtime migration is in place, V2 adds SQLite as the structured local memory substrate and, in a later slice, vector search as a derived retrieval layer.

The memory slice uses one repo-root SQLite database at `state/memory.db`, partitioned by `project_key`. It stores:

- project references
- sessions
- event log rows
- memory candidates
- practice candidates
- preference candidates
- queue items

Later vector slices add index chunks and embedding metadata to the same serving layer.

Vector search stores embeddings for curated and semi-curated text:

- wiki pages
- session summaries
- practices
- personal preferences
- selected source snippets
- raw event compactions

Markdown and JSON remain the human-reviewable durable truth. SQLite/vector indexes are serving and recall layers unless a specific promoted artifact is written back into the project wiki, practice memory, or personal memory.

Curated Project Memory remains markdown plus metadata JSON during V2. SQLite should not become the source of curated truth in the TypeScript migration or the first memory slice. SQLite belongs to serving, recall, session continuity, event capture, queues, and vector metadata until a future design explicitly changes that boundary.

The curated Project Memory taxonomy should be redesigned around the originating LLM Wiki pattern, not around the old repo-documentation taxonomy:

- source registries preserve raw inputs and evidence
- `wiki/` contains the maintained markdown synthesis
- schema/instruction contracts define how agents maintain the wiki
- a chronological log/session layer records what changed and why
- an index remains content-oriented and helps agents navigate the wiki

Within `wiki/`, pages should be organized by compounding knowledge value rather than source-code shape: product behavior, operating workflows, decisions, current state/sessions, practices/provenance, open questions, and useful concepts.

The target V2 project layout is:

- `projects/<key>/sources/` for preserved project-owned raw sources and evidence
- `projects/<key>/wiki/` for maintained markdown synthesis
- `projects/<key>/schema/` for project-local schema guidance and JSON rules
- `projects/<key>/state/` for generated project state
- `projects/<key>/log/` for chronological human-readable history
- `projects/<key>/runs/` for V2 run artifacts

Old global artifacts remain migration reference material, not the target project-owned layout.

Memory-slice session summaries are stored only in SQLite. Existing `projects/<key>/wiki/sessions/` pages remain curated durable wiki artifacts written by the existing update/compile flows or by later project-memory curation. A SQLite session can become source evidence for a future wiki session page, but it is not automatically a wiki page.

### Memory-Slice Data Contract

The memory slice must define stable storage fields before any agentic curation depends on them.

Events require:

- `id`
- `project_key`
- `session_id`
- `source`
- `event_type`
- `mode`
- `occurred_at`
- `cwd`
- `tool_name`
- `input_summary`
- `output_summary`
- `payload_json`

Memory-slice manual event recording is intentionally high-signal only. The initial allowed event types are:

- `session.note`
- `session.stop`
- `memory.candidate`
- `answer.correction`

Manual memory-slice recording must not mirror future hook behavior by logging every file read, command, MCP query, or chat turn. High-volume tool and transcript capture belongs to the deferred hook/event collector slice.

`answer.correction` is continuity evidence in SQLite only. It does not replace the existing project inbox repair path. When a correction should update curated Project Memory, agents must still use `flag_stale_answer` or enrich an emitted gap through `enrich_gap`; later curators may link SQLite correction evidence to inbox items, but the memory slice does not merge those flows.

Candidates require:

- `id`
- `project_key`
- `session_id`
- `source`
- `candidate_type`
- `mode`
- `status`
- `created_at`
- `source_event_id`
- `title`
- `summary`
- `payload_json`

Allowed memory-slice candidate types are:

- `project-memory`
- `session-memory`
- `practice-memory`
- `personal-memory`

The event type `memory.candidate` means an event proposes something for memory. The candidate's `candidate_type` determines which memory scope future curation should consider. Agents must not invent candidate type labels outside the allowed set.

Memory-slice candidates use strict routing fields with flexible payloads. `candidate_type`, `title`, `summary`, `project_key`, `source`, `mode`, and `status` are required and structured; `payload_json` remains free-form. The deterministic system routes candidates by `candidate_type`, not by payload shape. Scope-specific payload schemas are deferred until real candidate examples show which fields are useful.

Sessions require:

- `id`
- `project_key`
- `title`
- `started_at`
- `ended_at`
- `status`
- `summary`
- `next_actions_json`
- `source_event_ids_json`
- `updated_at`

Allowed modes are `off`, `queue`, and `auto`. Candidate statuses are `pending`, `processed`, and `needs-review`.

Session ids can come from hooks, an explicit CLI/MCP argument, an external work-tracker identifier, or a generated id. Tracker-specific concepts such as Trello cards, Jira issues, Linear issues, and ClickUp tasks are source evidence, not Myelin product primitives. The store must accept explicit ids so an agent can continue a known session. MCP callers must pass `project_key` explicitly unless the server environment provides `LLM_WIKI_PROJECT`; the globally installed MCP server must not infer the caller's current working directory. The TypeScript MCP implementation already has this fallback contract in `mcp/src/fs.ts::resolveProjectKey`, and V2 facades must reuse it. If no latest session exists for a project, `status` must return a deterministic low-confidence response with `memory_scope: "project_session"` and `degraded: true`, not fall through silently to a weak model.

## MCP Surface

The primary agent-facing surface should be small and semantic.

### `query`

Ask what is true or known.

Examples:

- "What did we work on last session?"
- "How does class visibility work?"
- "What does Liad prefer for tests?"
- "What is known about Supabase in this repo?"

`query` should route across project wiki, session memory, personal memory, practices, and vector recall. It should return answer text, confidence, source memory scopes, citations/provenance, and any emitted candidate ids.

Memory-slice behavior: `query` may delegate to the existing `query_wiki` path for factual project answers, but it must wrap the result in the facade response contract below and set `degraded` when personal, practice, or vector routing was requested but is not available yet.

Tool-choice rule: `query` owns explanatory knowledge questions, even when the natural-language question starts with "how." "How does class visibility work?" is a `query` because the expected output is an explanation.

### `how`

Ask for operating guidance.

Examples:

- "How do we run local Supabase?"
- "How should I test this feature?"
- "How do we create a DigitalOcean function?"
- "How should I approach this repo?"

`how` should prefer practices, personal workflow guidance, project-specific runbooks, and current project overrides.

Memory-slice behavior: `how` may delegate to the existing `query_wiki` path while practice and personal routing are not implemented, but it must say so through response metadata. It must not pretend canonical practice or personal memory was consulted before those stores exist.

Tool-choice rule: `how` owns prescriptive operating guidance. "How should I test class visibility?" is `how` because the expected output is a recommended procedure.

### `status`

Ask for state or inventory.

Examples:

- "What project am I in?"
- "What changed since last session?"
- "What sessions exist?"
- "What memory scopes are available?"
- "What is stale?"

`status` should be mostly deterministic and cheap.

Memory-slice behavior: `status` must deterministically answer latest-session questions from SQLite. Other `status` inventory queries may fall back to existing project metadata or return a deterministic degraded response that names the missing capability.

`status` returns structured state first. A short prose `answer` is allowed for convenience, but agents should rely on the structured payload. Latest-session responses must include a `session` object with `id`, `project_key`, `title`, `status`, `summary`, `next_actions`, and `updated_at`.

### Facade Response Contract

All high-level MCP facades return these stable fields:

- `answer`
- `confidence`
- `memory_scope`
- `citations`
- `candidate_ids`
- `degraded`
- `degraded_reason`
- `source_tools`

`memory_scope` is one of:

- `project_wiki`
- `project_session`
- `project_state`
- `practice`
- `personal`
- `mixed`
- `none`

`degraded` is `true` when the facade could not consult a planned V2 memory source and used a fallback or returned no data.

### Existing Supporting Tools

Current lower-level MCP tools still exist for agents that need control:

- `plan_query`
- `list_brain_pages`
- `find_brain_pages`
- `get_page_neighbors`
- `get_wiki_page`
- `list_wiki_projects`
- `enrich_gap`
- `flag_stale_answer`
- `create_inbox_item`

### Future Or Internal Supporting Tools

These are planned or internal capabilities, not existing MCP contracts:

- `record_observation`
- `refresh_index`

The default instruction to agents should be: start with `query`, `how`, or `status`; use lower-level tools only when the high-level result asks for enrichment, correction, or raw-page inspection.

## Automation Boundary

V2 must preserve operator control and avoid token burn.

The core rule:

> Capture everything cheaply. Reason over almost nothing immediately. Promote with agents only when there is a clear value trigger.

### Deterministic Code

These must be scripts or normal application code:

- capture hook events
- normalize events into SQLite
- detect project/session from cwd and repo path
- hash chunks and skip unchanged content
- chunk markdown/code/session text
- maintain SQLite tables
- maintain vector index metadata
- run lexical search and metadata filtering
- route obvious `status` queries to structured state
- enforce budgets, locks, debounce windows, and queues
- move inbox items between pending, processed, and needs-review
- track stale timestamps and source commit pointers

### Automated But Not Agentic

These can run frequently in the background:

- event ingestion
- event compaction
- embedding changed chunks
- latest-session pointer updates
- project inventory refresh
- cheap candidate creation

Cheap candidates include:

- possible gap
- possible practice evidence
- possible preference evidence
- session has unsummarized events

### Agentic

These require model judgment:

- summarize a meaningful session
- decide whether raw events contain durable project knowledge
- update project memory pages
- turn repeated project evidence into a practice candidate
- promote practice candidates to canonical practice memory
- promote repeated user behavior to personal workflow memory
- reconcile contradictions
- synthesize an answer when deterministic retrieval is insufficient
- validate whether a stale or missing answer should become an inbox item

### Manual Or Confirm-First

These require an explicit command, flag, or operator review:

- full project compile
- cross-project practice promotion
- personal workflow promotion
- superseding a canonical practice
- changing decision records
- processing large pending queues
- expensive embedding/index rebuilds
- background learning during unstable feature work

## Trigger Modes

Every write-ish memory action has a mode:

```text
off   -> capture raw events only
queue -> create candidates/inbox items, do not run agents
auto  -> create candidates/inbox items and make them eligible for bounded background processing
```

`auto` does not mean hooks can run agents inline. The current `enrich_gap(auto_update=True)` path is the exception that already exists: it spawns detached `make update AUTO=1` behind the project lockfile. New auto workers must be lockfile-gated, budgeted, and debounced before they run model-backed work.

Minimum controls:

- project-scoped lock for project-memory and session curation jobs
- global lock for cross-project practice and preference promotion
- no hook-side LLM calls
- debounce repeated candidate processing for the same project/session
- per-job token or model-call budget recorded in job metadata
- deterministic queue status transitions: `pending`, `processed`, or `needs-review`

Default V2 policy:

| Source | Default |
| --- | --- |
| Hook event | queue/compact only |
| MCP low-confidence query | queue, auto only if enabled |
| User correction | auto |
| Explicit `enrich_gap` | auto while the gap/inbox loop remains part of the design |
| Session stop | queue session-summary candidate |
| Manual "remember this" | auto |
| Commit or PR complete | auto project-memory candidate |
| Cross-project practice candidate | queue |
| Preference candidate | queue |
| Practice promotion | manual |
| Preference promotion | manual |

Hooks must never call LLMs directly, mutate curated memory, or start expensive curation jobs. Hooks append events and enqueue candidates only.

## Background Workers

### Event Collector

Deterministic. Always available through hooks and MCP callbacks.

Writes structured events with:

- event type
- project key
- session id
- tool name
- input summary
- output summary
- file paths
- confidence signals
- timestamp

### Indexer

Deterministic. Runs after memory/wiki/session/practice changes.

Responsibilities:

- chunk changed content
- hash chunks
- skip unchanged chunks
- request embeddings for changed chunks only
- write vector rows and index metadata

Embedding providers should be isolated behind a provider interface. Gemini Embedding 2 is the preferred first provider, but the implementation must cache by content hash and tolerate quota failure by leaving chunks pending.

### Session Curator

Agentic but bounded. Runs on explicit command or auto mode after a stop marker.

Writes project-scoped session summaries and current-state pointers. It does not update project feature docs unless separately triggered.

### Project Memory Curator

Agentic. Evolves current `make update` behavior.

It asks whether a source changes product behavior, setup/runbook knowledge, current state, or only code that can be inspected directly. It prefers focused wiki updates over new pages.

### Gap Curator

Agentic. Preserves the existing `query_wiki -> gap-note -> enrich_gap -> auto-update` loop.

It turns low-confidence answers, stale-answer flags, and user corrections into focused project updates.

### Practice Promoter

Agentic and manual/queue by default.

It promotes repeated project evidence into canonical workflows only after review.

### Preference Promoter

Agentic and manual/queue by default.

It promotes repeated user corrections and project behavior into durable personal workflow memory only after review.

## Commands

V2 should add commands that name product concepts directly instead of mirroring the current `make compile` and `make update` control model. Candidate memory-era commands may look like:

```bash
myelin project onboard <key>
myelin project learn <key>
myelin project ingest <key>
myelin memory query <key> "<question>"
myelin session close <key>
myelin schema check <key>
myelin schema build <key>
myelin schema candidates <key>
myelin schema apply <candidate-id>
myelin practice promote
myelin personal promote
```

The first implementation slice does not need all memory commands. It should define the V2 CLI vocabulary and use Make only as convenience aliases where useful.

Initial verb mapping:

- `compile` becomes `project learn <key>` for broad Project Memory refresh from project evidence.
- `update` becomes `project ingest <key>` for queued source/inbox processing.
- `ask` becomes `memory query <key> "<question>"`.
- session continuity uses `session close <key>` and later hook-driven session events.
- schema maintenance uses `schema check <key>`, `schema build <key>`, `schema candidates <key>`, and `schema apply <candidate-id>`.

`schema build <key>` writes generated schema context by default because the compiled context is deterministic generated state needed by agents. Use `--dry-run` to preview the compiled context without writing.

`schema check <key>` is read-only. It validates authored schema and generated schema context without mutating files. If automatic repair is needed later, add a separate `schema fix <key>` command rather than overloading check.

`schema apply <candidate-id>` should rebuild generated schema context immediately after applying authored schema changes. If rebuilding or validation fails, the apply operation must fail or roll back so authored schema and compiled schema context do not drift.

`project learn <key>` should verify schema freshness before learning. If schema context is stale, `project learn` runs the equivalent of `schema build <key>` automatically. If schema validation fails, `project learn` stops instead of learning against invalid instructions.

The TypeScript migration should implement schema functionality before `project learn`. Learning depends on schema-context freshness, review gates, taxonomy rules, and provenance requirements; building learn first would bake in behavior before the maintenance contract exists.

The TypeScript migration should also implement schema functionality before `memory query`. Query behavior should know the active taxonomy, memory scopes, freshness rules, and provenance expectations from the start. The old query planner can be reference material, but the V2 query layer should consume schema context instead of re-creating V1 routing assumptions.

If schema context is missing or invalid, `memory query` must fail closed with a deterministic error/degraded response. It should name the schema-context problem and suggest `schema build <key>` or `schema check <key>`. It must not fall back to weak unschematized query behavior.

`memory query` should not auto-run `schema build`. Query should remain cheap, predictable, and side-effect-light. Schema rebuilding belongs to explicit schema commands or write workflows such as `project learn`.

`project learn` may read the live repository directly. Any durable Project Memory write produced from that read must preserve traceable evidence/provenance, such as file paths, commit/state pointers, source snippets, artifact ids, or explicit inference labels. The command should be practical enough to learn from the repo without requiring every source to pass through an intake inbox first.

`project learn` should apply routine Project Memory updates by default. The product loses too much value if the operator must review every run. Reviewable proposals and dry-run modes should exist for risky changes, debugging, and manual control, but the daily path is auto-apply with durable artifacts, provenance, and rollback/review trails.

`project learn` must switch from auto-apply to review/dry-run for:

- destructive deletes
- superseding a decision record
- low-confidence synthesis
- conflicting sources
- broad rewrites across multiple memory areas
- explicit `--review` or `--dry-run`

Routine additive or corrective updates with good provenance should auto-apply.

Every auto-applied `project learn` run must write an applied changeset record before reporting success. The record must include:

- command, project key, started/finished timestamps, and run id
- schema-context id/hash used for the run
- changed files and before/after hashes
- source evidence used for each durable wiki or state change
- risk classification and why auto-apply was allowed
- validation results
- rollback or review instructions

If any write in an auto-applied run fails validation, the run must stop in a degraded or needs-review state and leave enough record for the operator to inspect what changed. Broad manual rollback can be implemented later, but the first slice must at least make applied changes auditable and reproducible from git plus the changeset record.

## Phased Delivery

### Phase 0: TypeScript Core Runtime Migration

Move the core repo to a Bun/TypeScript-first architecture. Establish root package structure, shared TypeScript libraries for core product code, redesign the core runtime/pipeline layout where useful, create a V2 CLI vocabulary, port root scripts and pipeline orchestration, add targeted parity checks, and make Make a convenience layer. Keep the detached MCP interface outside the core package graph.

**Reconciled (2026-06-02):** Phase 0 is delivered by `docs/superpowers/plans/2026-06-02-v2-phase-0-clean-typescript-core.md` as a clean reference-quarantine rewrite (V1 → `legacy/`, `src/` written fresh, no parity target — ADR 0047), with a thin global-only schema (ADR 0049), an early `myelin status` walking-skeleton gate, and the BYO provider abstraction reimplemented for Codex + Claude Code (ADR 0051). "Targeted parity checks" above is superseded by "no V1 behavior is an acceptance target."

### Phase 1: Memory Foundation

Add SQLite-backed memory tables, deterministic event/candidate capture, project/session resolution, and basic CLI commands. No vector provider or automatic promotion is required.

### Phase 2: MCP Facade

Add high-level `query`, `how`, and `status` tools that route to existing project wiki query paths plus structured memory state. Preserve old tools as supporting tools.

### Phase 3: Session Continuity

Add project-scoped session candidates, bounded session summarization, latest-session pointers, and `what did we work on last session` support.

### Phase 4: Search Index

Add chunking, hashing, embeddings, and vector search over curated pages and session summaries. Gemini Embedding 2 is the preferred provider; quota and network failure must degrade to pending chunks.

### Phase 5: Project Memory Refinement

Teach the compiler/update pipeline to document product behavior and workflows instead of redundant code summaries.

### Phase 6: Practice And Preference Candidates

Collect cross-project practice and personal preference evidence as candidates. Promotion remains manual until candidate quality is proven.

## Non-Goals For First Slice

- no automatic practice promotion
- no automatic personal preference promotion
- no hooks that call LLMs
- no always-on agent swarm
- no dependence on a fixed Gemini free-tier quota

## Success Criteria

The first V2 slice is successful when:

- project docs remain the canonical curated project truth
- the repo has a clear Bun/TypeScript runtime foundation for new V2 work
- a V2 CLI vocabulary exists and old Make command names are aliases only where useful
- shared project/config/state/path logic has TypeScript ownership instead of new Python ownership
- selected Python/Bash behavior has parity coverage only when it still matters to V2 value, useful knowledge, provenance, operator intent, or detached interface contracts
- MCP integration remains detached and contract-based rather than source-shared
- tests and typecheck cover the new TypeScript infrastructure
- the next SQLite memory slice can be implemented without creating a second runtime boundary
