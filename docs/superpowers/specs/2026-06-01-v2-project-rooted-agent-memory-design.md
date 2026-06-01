# V2 Project-Rooted Agent Memory Design

## Source Spec Audit

`V2_SPEC.md` is valuable raw source material, but it is not yet execution-ready. It captures the core product direction clearly: projects remain the root of lived truth, project docs should capture what code does not cheaply reveal, and background learning must be controlled instead of token-hungry. It also correctly separates cheap capture from expensive reasoning.

The draft is not yet ready as an implementation spec because it is a pasted conversation transcript rather than a normalized contract. It repeats concepts, mixes north-star architecture with V1 implementation choices, and does not name concrete data contracts, trigger defaults, commands, or migration boundaries. The most important design correction is that "agent memory" must not become an always-on swarm. Hooks and MCP callbacks should append events and enqueue candidates; agentic workers should run only at promotion boundaries with explicit modes, locks, budgets, and debounce rules.

### Evaluation Matrix

| Dimension | Score | Notes |
| --- | ---: | --- |
| Completeness | 3/5 | Strong conceptual coverage, but missing schemas, command contracts, and acceptance criteria. |
| Feasibility | 4/5 | Fits existing gap-note, auto-update, and MCP patterns; risk is scope size. |
| Clarity | 3/5 | Core phrases are strong, but transcript form makes decisions hard to locate. |
| Logical Flow | 3/5 | The hierarchy is right; sequencing needs a phased implementation boundary. |
| Scope & Risk | 2/5 | Full V2 covers several subsystems and needs staged delivery. |
| Developer Experience | 2/5 | No file map or task boundaries yet. |
| AI Readiness | 2/5 | Good autonomy instincts, but no explicit machine-readable rules yet. |

Verdict: needs curation before development. The design below preserves the gold from the draft while narrowing V2 into a project-rooted memory foundation that can be implemented incrementally.

## Goal

Turn llm-wiki from a repository documentation compiler into a project-rooted memory system for coding agents, without losing the curated project wiki that already works.

The V2 product should answer:

- what is known about this project
- what happened last session
- how Liad normally works with this kind of task
- how we do recurring workflows such as local Supabase or serverless functions
- what evidence exists, and what still needs curation

## Core Thesis

Projects are the source of lived truth. Other memory types are derived from real project work, not invented as detached notes.

Project docs should capture what code does not cheaply reveal:

- product behavior
- feature intent
- operating workflows
- decisions
- setup gotchas
- manual QA flows
- current work state
- useful provenance

The system should not spend tokens summarizing code that an agent can inspect directly.

## V2 North Star And First Slice

The V2 north star is a project-rooted memory system with curated project docs, project-scoped session continuity, canonical recipes, personal workflow memory, raw experience capture, SQLite structured memory, and vector recall.

The first implementation slice is narrower. It must build:

- a repo-root SQLite memory database partitioned by `project_key`
- deterministic event and candidate storage
- `off | queue | auto` mode parsing
- project-scoped session storage and a latest-session pointer
- a useful deterministic answer for "what did we work on last session?"
- `query`, `how`, and `what` MCP facades with stable response fields
- explicit automation policy metadata that says hooks do not call LLMs

The first implementation slice must not build:

- vector search
- Gemini embedding calls
- Codex hook installation
- automatic recipe promotion
- automatic personal preference promotion
- a rewrite of the project wiki compiler

The invariants that must hold across every slice are:

- markdown wiki plus state JSON remain human-reviewable curated truth
- SQLite/vector memory is serving, recall, and queue state unless a curator promotes content back to a durable artifact
- project references in recipes are provenance, not live instructions
- hooks append events and candidates only
- agentic workers require explicit mode, lock, budget, and debounce controls
- `enrich_gap(auto_update=True)` keeps the current detached `make update AUTO=1` behavior and lockfile guard

## Memory Model

### Project Brain

Project Brain remains the root memory scope. It owns the maintained project wiki, state files, source provenance, gap-note inbox, current task state, and project-scoped sessions.

It should answer project-specific questions such as:

- how a feature behaves
- what workflows exist
- what changed recently
- what is stale or blocked
- what the next session should know

### Session Brain

Session Brain is a project-scoped continuity layer, not an independent global scope.

It stores:

- last session summary
- task/card/branch context
- what changed
- what was verified
- blockers
- next actions
- "do not redo this" notes

The default query "what did we work on last session?" resolves against the current project first.

### Recipe Brain

Recipe Brain stores canonical, project-agnostic workflows.

Recipes are not live instructions to "do it like project X." Project references are provenance, not authority. A recipe should say:

> This is how we run local Supabase stacks. It was derived from Wodnix and Suitepath. This recipe is the current canonical guidance.

If a later project improves the practice, the recipe can be updated and older projects remain evidence.

Recipe promotion is queue/manual by default in V2. Automatic promotion is deferred until the candidate quality is proven.

### Personal Brain

Personal Brain stores durable working preferences and agent-behavior guidance.

Examples:

- prefer simulation/manual flow validation for role-based product behavior
- keep implementation tickets concise
- use `rtk` commands when possible
- do not over-document code that can be read directly
- separate diagnosis from redesign unless asked

Personal Brain should be derived from repeated project evidence and explicit user corrections. Promotion is queue/manual by default in V2.

### Experience Log

Experience Log is the noisy substrate. It stores hook events, MCP calls, selected pages, failed searches, user corrections, opened files, tool outputs, and agent stop summaries.

It is evidence, not truth. It feeds session memory, gap notes, project updates, recipe candidates, and preference candidates.

## Serving Model

V2 adds SQLite as the structured local memory substrate and, in a later slice, vector search as a derived retrieval layer.

The first slice uses one repo-root SQLite database at `state/memory.db`, partitioned by `project_key`. It stores:

- project references
- sessions
- event log rows
- memory candidates
- recipe candidates
- preference candidates
- queue items

Later vector slices add index chunks and embedding metadata to the same serving layer.

Vector search stores embeddings for curated and semi-curated text:

- wiki pages
- session summaries
- recipes
- personal preferences
- selected source snippets
- raw event compactions

Markdown and JSON remain the human-reviewable durable truth. SQLite/vector indexes are serving and recall layers unless a specific promoted artifact is written back into the project wiki, recipe brain, or personal brain.

First-slice session summaries are stored only in SQLite. Existing `projects/<key>/wiki/sessions/` pages remain curated durable wiki artifacts written by the existing update/compile flows or by later project-brain curation. A SQLite session can become source evidence for a future wiki session page, but it is not automatically a wiki page.

### First-Slice Data Contract

The first slice must define stable storage fields before any agentic curation depends on them.

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

Session ids can come from hooks, an explicit CLI/MCP argument, a task/card id, or a generated id. The store must accept explicit ids so an agent can continue a known session. If no latest session exists for a project, `what` must return a deterministic low-confidence response with `memory_scope: "project_session"` and `degraded: true`, not fall through silently to a weak model.

## MCP Surface

The primary agent-facing surface should be small and semantic.

### `query`

Ask what is true or known.

Examples:

- "What did we work on last session?"
- "How does class visibility work?"
- "What does Liad prefer for tests?"
- "What is known about Supabase in this repo?"

`query` should route across project wiki, session memory, personal memory, recipes, and vector recall. It should return answer text, confidence, source memory scopes, citations/provenance, and any emitted candidate ids.

First-slice behavior: `query` may delegate to the existing `query_wiki` path for factual project answers, but it must wrap the result in the facade response contract below and set `degraded` when personal, recipe, or vector routing was requested but is not available yet.

### `how`

Ask for operating guidance.

Examples:

- "How do we run local Supabase?"
- "How should I test this feature?"
- "How do we create a DigitalOcean function?"
- "How should I approach this repo?"

`how` should prefer recipes, personal workflow guidance, project-specific runbooks, and current project overrides.

First-slice behavior: `how` may delegate to the existing `query_wiki` path while recipe and personal routing are not implemented, but it must say so through response metadata. It must not pretend canonical recipe or personal memory was consulted before those stores exist.

### `what`

Ask for state or inventory.

Examples:

- "What project am I in?"
- "What changed since last session?"
- "What sessions exist?"
- "What memory scopes are available?"
- "What is stale?"

`what` should be mostly deterministic and cheap.

First-slice behavior: `what` must deterministically answer latest-session questions from SQLite. Other `what` inventory queries may fall back to existing project metadata or return a deterministic degraded response that names the missing capability.

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
- `recipe`
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

The default instruction to agents should be: start with `query`, `how`, or `what`; use lower-level tools only when the high-level result asks for enrichment, correction, or raw-page inspection.

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
- route obvious `what` queries to structured state
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
- possible recipe evidence
- possible preference evidence
- session has unsummarized events

### Agentic

These require model judgment:

- summarize a meaningful session
- decide whether raw events contain durable project knowledge
- update project brain pages
- turn repeated project evidence into a recipe candidate
- promote recipe candidates to canonical recipe memory
- promote repeated user behavior to personal workflow memory
- reconcile contradictions
- synthesize an answer when deterministic retrieval is insufficient
- validate whether a stale or missing answer should become an inbox item

### Manual Or Confirm-First

These require an explicit command, flag, or operator review:

- full project compile
- cross-project recipe promotion
- personal workflow promotion
- superseding a canonical recipe
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

- project-scoped lock for project-brain and session curation jobs
- global lock for cross-project recipe and preference promotion
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
| Explicit `enrich_gap` | auto, preserving current behavior |
| Session stop | queue session-summary candidate |
| Manual "remember this" | auto |
| Commit or PR complete | auto project-brain candidate |
| Cross-project recipe candidate | queue |
| Preference candidate | queue |
| Recipe promotion | manual |
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

Deterministic. Runs after memory/wiki/session/recipe changes.

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

### Project Brain Curator

Agentic. Evolves current `make update` behavior.

It asks whether a source changes product behavior, setup/runbook knowledge, current state, or only code that can be inspected directly. It prefers focused wiki updates over new pages.

### Gap Curator

Agentic. Preserves the existing `query_wiki -> gap-note -> enrich_gap -> auto-update` loop.

It turns low-confidence answers, stale-answer flags, and user corrections into focused project updates.

### Recipe Promoter

Agentic and manual/queue by default.

It promotes repeated project evidence into canonical workflows only after review.

### Preference Promoter

Agentic and manual/queue by default.

It promotes repeated user corrections and project behavior into durable personal workflow memory only after review.

## Commands

V2 should add commands that mirror the current `make compile` and `make update` control model:

```bash
make memory-index PROJECT=<key>
make memory-session PROJECT=<key> AUTO=1
make memory-update PROJECT=<key> AUTO=1
make memory-drain PROJECT=<key>
make memory-promote-recipes
make memory-promote-preferences
```

The first implementation slice does not need all commands. It should introduce the memory substrate, queue/mode model, and at least one useful project-scoped session workflow.

## Phased Delivery

### Phase 1: Foundation

Add SQLite-backed memory tables, deterministic event/candidate capture, project/session resolution, and basic CLI commands. No vector provider or automatic promotion is required.

### Phase 2: MCP Facade

Add high-level `query`, `how`, and `what` tools that route to existing project wiki query paths plus structured memory state. Preserve old tools as supporting tools.

### Phase 3: Session Continuity

Add project-scoped session candidates, bounded session summarization, latest-session pointers, and `what did we work on last session` support.

### Phase 4: Search Index

Add chunking, hashing, embeddings, and vector search over curated pages and session summaries. Gemini Embedding 2 is the preferred provider; quota and network failure must degrade to pending chunks.

### Phase 5: Project Brain Refinement

Teach the compiler/update pipeline to document product behavior and workflows instead of redundant code summaries.

### Phase 6: Recipe And Preference Candidates

Collect cross-project recipe and personal preference evidence as candidates. Promotion remains manual until candidate quality is proven.

## Non-Goals For First Slice

- no automatic recipe promotion
- no automatic personal preference promotion
- no hooks that call LLMs
- no always-on agent swarm
- no rewrite of existing project wiki layout
- no loss of current `enrich_gap(auto_update=True)` behavior
- no dependence on a fixed Gemini free-tier quota

## Success Criteria

The first V2 slice is successful when:

- project docs remain the canonical curated project truth
- events and candidates can be captured without LLM calls
- a project-scoped latest session can be stored and queried
- `query`, `how`, and `what` can be introduced without removing old MCP tools
- expensive agentic work is gated by `off | queue | auto`
- recipe and preference promotion are queued/manual by default
- the design leaves room for SQLite/vector retrieval without making vector memory truth
