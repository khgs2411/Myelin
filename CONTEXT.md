# Myelin

Myelin is a project-rooted memory system for coding agents, built on the LLM Wiki Pattern. This glossary defines the product language used in V2 planning and implementation. (The product was formerly named "llm-wiki"; see ADR 0050.)

## Language

**Project Memory**:
Curated project-specific knowledge that captures what code does not cheaply reveal.
_Avoid_: Project Brain, repo docs, codebase docs

**Curated Memory Format**:
Human-readable markdown pages plus metadata JSON for durable Project Memory.
_Avoid_: SQLite as curated truth

**LLM Wiki Pattern**:
The originating product pattern: raw sources, a maintained markdown wiki, and a schema/instructions layer that teaches agents how to maintain the wiki.
_Avoid_: generic RAG, codebase docs only

**Schema Layer**:
The instruction and convention layer that tells agents how to maintain Myelin.
_Avoid_: prompt only, undocumented agent habits

> **Phase-0 caveat (ADR 0049):** the schema vocabulary below is target design. Phase 0 ships a thin, global-only schema (`schema check` / `schema build` only). Project Schema, Schema Override, Schema Candidate and its lifecycle, the `candidates` / `apply` / `--global` CLI surface, and project-local candidate state are deferred past Phase 0.

**Typed Schema Rule**:
A machine-readable schema rule used for validation and deterministic enforcement.
_Avoid_: prose-only contract, unenforced convention

**Schema Rule Format**:
JSON files for typed schema rules, with markdown reserved for prose guidance.
_Avoid_: YAML for typed rules by default

**Schema Rule Authoring**:
Typed schema rules are written directly as JSON at first.
_Avoid_: generated rule DSL before need is proven

**Schema Rule Validator**:
TypeScript/Zod validators that validate hand-authored schema JSON and infer runtime types.
_Avoid_: JSON Schema as primary validator

**Project Schema**:
Project-local instructions and conventions that specialize the global schema for a specific project.
_Avoid_: duplicating global rules, hidden project habits

**Schema Override**:
A typed project-local exception that weakens or replaces a global schema rule and includes an explicit reason.
_Avoid_: silent weakening, implicit conflict

**Schema Candidate**:
A proposed schema change discovered from project evidence.
_Avoid_: silent schema mutation, casual behavior change

**Schema Candidate State**:
The lifecycle status for schema candidates.
_Avoid_: ambiguous pending item, hidden failure

**Schema CLI**:
Dedicated commands for checking, building, listing, and applying schema changes.
_Avoid_: hidden schema maintenance inside project learn

**Schema Context**:
Generated machine-readable state that compiles global and project-local schema instructions for agent consumption.
_Avoid_: hand-edited compiled prompts, hidden runtime prompt

**Session Memory**:
Project-scoped continuity about recent work, next actions, blockers, and verification state.
Trusted agent-written Session Memory from Experience Log ingest lives in `session_memories`; `sessions` / `session_events` remain the existing manual session surface until a later status/current-briefing integration.
_Avoid_: Session Brain, chat history

**Practice Memory**:
Canonical cross-project guidance for how recurring work is done, derived from project evidence and improved as better examples appear.
_Avoid_: Recipe Memory, Recipe Brain, playbook

**Personal Memory**:
Durable guidance about Liad's working preferences and agent-behavior expectations.
_Avoid_: Personal Brain, user prefs

**Experience Log**:
Raw captured agent activity used as evidence, not truth.
_Avoid_: Truth store, canonical memory

**Experience Log Tombstone**:
A small audit record that can begin as an in-progress lease stub for a raw Experience Log row, then becomes the terminal archive when ingest determines the row's output or no-output state.
_Avoid_: processed raw row, permanent transcript

**External Work Tracker**:
A project-management system used outside LLM Wiki that may appear as documented source evidence but is not a core product concept.
_Avoid_: Trello card, Jira issue, Linear issue, ClickUp task as product terms

**Auto Mode**:
A memory processing mode that marks records eligible for future bounded automation without allowing memory commands to launch unbounded agentic workers.
_Avoid_: Immediate execution, always-on learning

**Answer Correction**:
A high-signal memory event that records a corrected or incomplete answer as continuity evidence.
_Avoid_: Project Memory repair, gap-note replacement

**Memory Candidate**:
A proposed update or observation targeted at one memory scope for later curation.
_Avoid_: Untyped note, generic todo

**Layer Handoff Instruction**:
A durable downstream candidate/instruction/prompt/input record created by one memory-layer agent for a later memory-layer agent, with structured fields and prompt text.
_Avoid_: Hint, casual note, trusted memory

**Status Facade**:
The MCP tool for structured current state, inventory, and latest-session lookup.
_Avoid_: What facade, state query

**Query Facade**:
The MCP tool for explanatory knowledge answers, even when the natural-language question starts with "how."
_Avoid_: Guidance request, procedure request

**How Facade**:
The MCP tool for prescriptive operating guidance and recommended procedures.
_Avoid_: Explanation query, factual query

**Runtime Foundation**:
The shared execution substrate for product code, commands, and agent-facing integrations.
_Avoid_: Sidecar runtime, one-off wrapper

**Provider Abstraction**:
The bring-your-own-subscription runner layer that drives the operator's authenticated vendor CLI (Codex, Claude Code) in headless mode, with a configurable default and per-workload model profiles.
_Avoid_: single-provider lock-in, hardcoded model vendor

**Capture Provider**:
An agent environment integration, such as Codex hooks, that can emit raw session activity into Myelin.
_Avoid_: Codex as the product boundary, memory provider

**Capture Adapter**:
The provider-specific implementation that installs, normalizes, and routes capture events into Myelin's provider-neutral Experience Log.
_Avoid_: hardcoded hook script, core Codex logic

**Install Command**:
The machine-level setup command that configures selected Capture Providers for Myelin.
_Avoid_: per-repo onboarding, bootstrap

**Bootstrap Command**:
The per-repository command that creates a project memory shell and opts that repo into Myelin capture.
_Avoid_: init, onboard, global install

**Project Memory Shell**:
The minimum project-owned layout and metadata needed before curated Project Memory exists.
_Avoid_: generated project summary, invented wiki

**Core Runtime Migration**:
The complete migration of core Myelin behavior from Python/Bash to Bun/TypeScript.
_Avoid_: read-only migration, thin wrapper, partial runtime split

**Runtime Layout Migration**:
The deliberate redesign of core code and data layout during the TypeScript migration.
_Avoid_: mirror old tree by default, cosmetic folder move

**V2 Breakage Budget**:
The explicit willingness to break low-value V1 workflows in order to build the higher-value memory product.
_Avoid_: backward compatibility as default, parity at all costs

**V2 CLI Vocabulary**:
The command language that names product concepts directly instead of preserving V1 command names as the primary interface.
_Avoid_: compile/update as core concepts, Makefile as product API

**V2 Project Layout**:
The project-owned data layout based on sources, wiki, schema, state, log, and runs.
_Avoid_: repo-doc taxonomy, global artifacts as primary project state

**Learn Command**:
The V2 command for refreshing Project Memory from project evidence.
_Avoid_: compile

**Auto-Apply Learning**:
The default mode where routine Project Memory learning writes are applied automatically while leaving reviewable artifacts.
_Avoid_: mandatory review for every learn run, silent untraceable mutation

**Learning Review Gate**:
The conditions that force `project learn` out of auto-apply and into review or dry-run.
_Avoid_: review everything, auto-apply everything

**Ingest Command**:
The top-level `ingest <project-key>` command that starts bounded detached agentic evidence processing for a project, beginning with Experience Log to Session Memory.
_Avoid_: update, foreground-only drain, `project ingest`, source-specific operator command

**Detached Ingest Job**:
A background/headless provider-backed ingest run started by the Ingest Command, with a durable handle for status checks and follow-up.
_Avoid_: always-on auto mode, untracked provider run

**Core Runtime Module**:
The root `src/runtime/*` TypeScript module set for shared core repo behavior.
_Avoid_: packages/runtime, MCP-shared package

**MCP Interface Boundary**:
The detached agent-facing interface that communicates with LLM Wiki without becoming part of the core product logic or package graph.
_Avoid_: shared package, embedded runtime, product logic owner

## Relationships

- **Project Memory** is the root source of lived truth for a project.
- **Curated Memory Format** remains markdown plus metadata JSON; SQLite is serving, recall, session, event, and queue state.
- **LLM Wiki Pattern** is the essence of the product: sources are preserved, the wiki compounds knowledge, and the schema guides agent maintenance.
- The **Schema Layer** has global product rules plus project-local **Project Schema** conventions.
- **Project Schema** extends or narrows global rules by default; a **Schema Override** is required to weaken or replace them.
- **Schema Candidate** changes are queued by default; only narrow high-confidence additive conventions can auto-apply.
- **Schema Candidate State** values are `pending`, `applied`, `rejected`, `superseded`, and `failed`.
- **Schema CLI** makes schema maintenance explicit.
- The **Schema Layer** includes readable markdown guidance and **Typed Schema Rule** files for enforceable contracts.
- The **Schema Rule Format** is JSON for typed rules and markdown for prose.
- **Schema Rule Authoring** starts as hand-authored JSON; higher-level generation is deferred until authoring pain is proven.
- **Schema Rule Validator** uses Zod in TypeScript; JSON Schema export is optional later.
- **Schema Context** is generated state; authored schema files stay human-readable.
- **Session Memory** belongs to exactly one **Project Memory** scope by default.
- **Practice Memory** is promoted from repeated or explicitly selected project evidence.
- **Personal Memory** is promoted from repeated user corrections, project behavior, or explicit user guidance.
- **Experience Log** feeds **Session Memory** first as raw evidence; **Project Memory**, **Practice Memory**, and **Personal Memory** work is derived from session-level interpretation.
- Memory types and storage layers are separate axes: **Experience Log**, **Session Memory**, and candidate/handoff state live in root SQLite; **Project Memory** lives in project wiki/state/sources; **Practice Memory** and **Personal Memory** canonical homes are deferred until promotion designs.
- Trusted **Session Memory** is stored in root SQLite in a dedicated `session_memories` table; embeddings are retrieval support, not the canonical memory record.
- A future **Session Memory Query Facade** should hide the SQLite/vector implementation from MCP callers and agents.
- Early **Experience Log** entries are explicit high-signal records for continuity or later curation, not routine tool-call logging.
- An **Experience Log Tombstone** can reserve a raw **Experience Log** row as an in-progress lease while the raw row remains present, then receives final output or no-output metadata when ingest completes and archives the row.
- An **External Work Tracker** can provide source evidence for memory, but Myelin does not model tracker-specific concepts as product primitives.
- **Auto Mode** can mark **Experience Log** entries or candidates for later processing, but it is distinct from an explicit **Detached Ingest Job** started by the **Ingest Command**.
- A **Detached Ingest Job** runs its provider session from the target repository cwd, on `master` for the first implementation.
- An **Answer Correction** in SQLite does not repair curated **Project Memory**; agents must still use `flag_stale_answer` or `enrich_gap` when the wiki should be updated.
- A **Memory Candidate** targets exactly one of **Project Memory**, **Session Memory**, **Practice Memory**, or **Personal Memory**.
- A **Memory Candidate** is a proposed memory output, while a **Layer Handoff Instruction** is downstream agent input; they use separate queues.
- A **Layer Handoff Instruction** tells a future memory-layer agent what to read, query, fetch, compare, or verify; it includes structured fields plus prompt text, uses separate Project/Practice/Personal queues behind function/facade access, and is not trusted higher-layer memory by itself.
- The **Status Facade** reads state-oriented memory such as latest **Session Memory** and should not be used for general knowledge answers.
- The **Status Facade** returns structured state first, with a short prose answer only as a convenience.
- MCP facades require an explicit project key unless the server environment provides `LLM_WIKI_PROJECT`.
- The **Query Facade** answers explanatory questions; the **How Facade** recommends actions or procedures.
- The **Runtime Foundation** should support Project Memory, Session Memory, Practice Memory, Personal Memory, and the agent-facing MCP tools without creating separate product runtimes.
- The **Provider Abstraction** lets any wired backend (Codex, Claude Code today) operate Myelin under the user's own subscription; it is provider-pluggable, and a third backend such as Gemini can be added later (not wired today).
- A **Capture Provider** is not the same as the **Provider Abstraction**: capture observes agent activity, while the provider abstraction runs Myelin workloads.
- A **Capture Adapter** belongs behind the capture facade so provider-native events become provider-neutral **Experience Log** rows.
- The **Install Command** configures machine-level **Capture Provider** integrations; the **Bootstrap Command** opts a specific repo into saved capture.
- A **Bootstrap Command** creates a **Project Memory Shell**, not curated **Project Memory**.
- The **Core Runtime Migration** replaces Python/Bash entrypoints for normal core operation with Bun/TypeScript implementations.
- The **Runtime Layout Migration** can change directories and data structures when the new layout has a clear purpose and migration path.
- The **V2 Breakage Budget** prioritizes building the powerful brain over preserving weak V1 behavior.
- The **V2 CLI Vocabulary** should expose product concepts directly, with Make targets only as convenience aliases where useful.
- **V2 Project Layout** keeps project-owned sources, wiki, schema, state, logs, and runs together under `projects/<key>/`.
- The **Learn Command** is the broad Project Memory refresh verb.
- **Auto-Apply Learning** is the default for day-to-day usefulness.
- A **Learning Review Gate** is required for destructive, conflicting, low-confidence, or broad memory changes.
- The **Ingest Command** is the explicit operator-triggered entrypoint for bounded agentic project evidence processing. In the current ingest design, it starts a **Detached Ingest Job** instead of requiring the operator to wait for a foreground agent run.
- The **Core Runtime Module** is the first implementation shape for core TypeScript runtime helpers.
- The **MCP Interface Boundary** keeps `/mcp` detached from core product logic; it communicates through stable repo files, commands, and JSON contracts.

## Example dialogue

> **Dev:** "Should I copy the Wodnix Supabase setup?"
> **Domain expert:** "No. Use the current **Practice Memory** for local Supabase. Wodnix can be provenance, but the practice is canonical."

## Flagged ambiguities

- "Recipe Memory" was used for canonical cross-project guidance, but "recipe" sounded too narrow and checklist-like. Resolved: use **Practice Memory**.
- "card" was used as shorthand for work context, but that ties the product language to one project-management tool. Resolved: use **External Work Tracker** only when discussing source evidence, not product shape.
- "auto" could imply immediate background agent execution. Resolved: **Auto Mode** marks eligibility for future bounded processing; existing `enrich_gap(auto_update=True)` remains the current auto-spawn exception.
- "`what`" was proposed as the state/inventory MCP facade, but it overlaps with normal knowledge questions. Resolved: use **Status Facade** and expose the MCP tool as `status`.
- "how" can mean either explanation or procedure. Resolved: use **Query Facade** for explanations such as "How does X work?" and **How Facade** for guidance such as "How should I do X?"
- The globally installed MCP server cannot reliably know the caller's current working directory. Resolved: agents pass `project_key` explicitly, or operators configure `LLM_WIKI_PROJECT` for a scoped server instance.
- The MCP implementation surface changed from the old Python server to the current TypeScript/Bun package under `/mcp`, and this points to a broader product-runtime direction. Resolved: new V2 infrastructure should build on a shared **Runtime Foundation** instead of adding more Python runtime surfaces.
- The repo needs shared TypeScript infrastructure without turning the MCP server into product logic. Resolved: keep `/mcp` detached and gitignored; communicate through stable contracts rather than workspace/package imports.
- Internal TypeScript package structure is premature while `/mcp` is detached. Resolved: start with root `src/runtime/*` for core runtime helpers, not `packages/runtime`.
- A read-only TypeScript foundation is insufficient. Resolved: the first V2 implementation slice is a complete core runtime migration to Bun/TypeScript, with Python/Bash used only as a temporary reference during porting.
- This is a major refactor, not a small parity-only port. Resolved: the plan should deliberately reconsider directory and data structures instead of preserving the old Python/Bash tree by default.
- V1 llm-wiki currently provides limited operator value and is barely used. Resolved: breaking existing behavior is acceptable when it moves toward the V2 brain, but useful project knowledge and provenance should not be discarded casually.
- The product originated from Karpathy's LLM Wiki pattern. Resolved: V2 should still preserve that essence rather than becoming generic RAG or only a codebase-documentation tool.
- Schema should co-evolve with domains. Resolved: use one global schema/instructions layer plus project-local schemas that specialize it.
- Project schemas may extend or narrow global schema by default. Resolved: weakening/replacing a global rule requires a typed override record with a reason.
- `project learn` may discover project-local schema conventions, but schema changes affect future agent behavior. Resolved: queue schema candidates by default; auto-apply only narrow additive conventions with high confidence.
- Schema maintenance should not be hidden inside learning. Resolved: add dedicated schema commands for check, build, candidates, and apply.
- `schema build <key>` writes generated schema context by default; use `--dry-run` to preview without writing.
- `schema check <key>` is read-only; schema fixing is a separate future command if needed.
- **Schema Candidate** storage is generated project state JSON in this slice, not SQLite.
- **Schema Candidate** IDs are globally unique, and each candidate stores `project_key` for ownership.
- `schema candidates <key>` lists project-local candidates by default; use `--include-global` to include relevant global schema candidates.
- Applying a global schema candidate requires explicit `schema apply <candidate-id> --global`.
- `project learn` does not generate global schema candidates; global schema candidates require explicit cross-project workflows or operator intent.
- Global schema candidate generation is deferred until cross-project Practice/Personal promotion exists; the migration slice supports storage/list/apply mechanics only.
- Project-local schema candidates live in `projects/<key>/state/schema-candidates.json`; global schema candidates live in root `state/schema-candidates.json`.
- Project-local `schema apply` rebuilds that project's schema context; global `schema apply --global` rebuilds schema context for all registered projects or fails/rolls back.
- `project learn <key>` automatically rebuilds stale schema context before learning and stops if schema validation fails.
- Schema functionality is implemented before `project learn` so learning uses the correct taxonomy, review gates, and provenance rules from the start.
- Schema functionality is also implemented before `memory query` so query behavior uses taxonomy, scopes, freshness rules, and provenance expectations from the start.
- `memory query` fails closed when schema context is missing or invalid; it should suggest `schema build <key>` or `schema check <key>` rather than falling back to unschematized query behavior.
- `memory query` does not auto-run `schema build`; query should stay cheap, predictable, and side-effect-light.
- `schema apply <candidate-id>` rebuilds schema context immediately after applying authored schema changes; if rebuild fails, apply must fail or roll back.
- Schema layout is root `schema/` for global instructions, `projects/<key>/schema/` for project-local instructions, and generated `state/schema-context.json` or equivalent for compiled agent consumption.
- **Schema Context** regenerates when schema inputs change and is freshness-checked during `project learn`; unchanged inputs should not cause rewrites.
- Old command names carry old product assumptions. Resolved: introduce a V2 CLI vocabulary and keep Make only as convenience aliases where useful.
- V2 CLI is operator-facing; default output is human-readable, with `--json` for machine-readable output. Detached MCP remains the agent API.
- `compile` and `update` are V1 mechanics. Resolved: use `project learn <key>` for broad Project Memory refresh, `project ingest <key>` for queued source/inbox processing, and top-level `ingest <key>` for detached Experience Log to Session Memory processing.
- The **Learn Command** may read the live repo directly, but durable Project Memory writes require traceable evidence and provenance.
- `project learn` should apply routine curated Project Memory updates by default. Review/proposal modes are opt-out controls for risky or manual workflows, not the daily default.
- `project learn` must leave auto-apply for destructive deletes, decision-record supersession, low-confidence synthesis, conflicting sources, broad multi-area rewrites, or explicit `--review` / `--dry-run`.
- Manual memory event recording could become noisy if it mirrors hooks. Resolved: record only high-signal events such as `session.note`, `session.stop`, `memory.candidate`, and `answer.correction`.
- `answer.correction` overlaps with the existing gap/inbox flow. Resolved: **Answer Correction** is SQLite evidence only; `flag_stale_answer` and `enrich_gap` remain the canonical Project Memory repair path.
- `memory.candidate` is generic as an event type, but candidate routing must not be arbitrary. Resolved: **Memory Candidate** records use a typed target scope.
- V2 project data layout is `projects/<key>/sources/`, `wiki/`, `schema/`, `state/`, `log/`, and `runs/`; old global artifacts are reference material during migration, not the target layout.
