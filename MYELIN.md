# Myelin — Canonical Design

## 1. Purpose & How to Read This

This is the single canonical document for what Myelin is and why it is shaped this way. It is a product design, not a progress tracker — it describes the system as designed, independent of how much is implemented at any given moment. When this document and any other doc disagree, this document wins — except for `docs/adr/*` decision records, which it summarizes but never overrides.

Related reading:

- `CONTEXT.md` is the product-language glossary and records resolved naming/shape ambiguities.
- `docs/README.md` is the documentation map and canonical reading path.
- `docs/ROADMAP.md` is the canonical implementation checklist and current next step.
- `docs/archive/V2_SPEC.md` is the raw brainstorming source for the project-rooted memory model.
- `docs/IMPLEMENTATION_ALIGNMENT.md` maps the current codebase to this design and flags what to keep, reframe, or avoid extending blindly.
- `docs/adr/*` contains append-only decision records; this document summarizes them but does not override them.

Older designs — including superseded V2 predecessors — are in `docs/archive/`.

---

## 2. North Star

Myelin is a **project-rooted memory system for coding agents**, built on the LLM Wiki Pattern. It keeps durable project knowledge next to the repo — curated wiki pages, preserved sources, freshness state — and serves it to agents through a small semantic interface so that a new session starts from maintained memory instead of re-exploring the codebase. Around that core it derives session continuity, cross-project practices, personal working preferences, and raw experience, all from real project work rather than detached notes.

The product answers, for any repo:

- what is known about this project
- what happened last session
- how Liad normally works with this kind of task
- how we run recurring workflows (e.g. local Supabase, serverless functions)
- what evidence exists, and what still needs curation

## 3. Core Thesis & Principles

- **Projects are the source of lived truth.** Every other memory type is *derived* from real project work, not invented as free-floating notes. Project memory is the root.
- **Project docs capture what code does not cheaply reveal** — product behavior, feature intent, operating workflows, decisions, setup gotchas, manual QA flows, current work state, provenance. Myelin does not spend tokens summarizing code an agent can read directly.
- **Markdown is curated truth; SQLite is serving state.** Curated Project Memory lives in human-reviewable markdown + metadata JSON. SQLite holds recall, session, event, and queue state — it is never the canonical record. (ADR 0021, 0022, 0001.)
- **Capture cheap, reason rarely, promote with judgment.** Capture everything cheaply and deterministically; run LLM agents only at promotion boundaries where judgment is actually required. Hooks never call models and never mutate curated memory.
- **Bring-your-own-subscription.** Model work shells out to the operator's authenticated vendor CLI (Codex, Claude Code) in headless mode, with a configurable default and per-workload model profiles. Provider-pluggable for later backends. (ADR 0051.)
- **Provenance or it didn't happen.** Durable writes preserve traceable provenance (file paths, commit/state pointers, source snippets) or an explicit inference label. Mark uncertainty; preserve contradictions instead of smoothing them.
- **Fail closed.** When schema context or required state is missing, degrade explicitly with guidance — never fall back to an unschematized or silently weak answer. (ADR 0037.)

## 4. The Memory Model

Five memory types, one root. Each has a canonical storage home and a derivation path.

| Memory type | What it holds | Canonical store |
| --- | --- | --- |
| **Project Memory** | Curated per-project knowledge: behavior, features, decisions, runbooks, setup, current state, provenance | markdown wiki + state JSON |
| **Session Memory** | Project-scoped continuity: recent work, decisions, findings, next actions, blockers, "do not redo this" notes, task/branch/external-tracker context | SQLite (`session_memories` for trusted agent-written continuity; `sessions` / `session_events` remain the existing manual session surface) |
| **Practice Memory** | Canonical cross-project "how we do X", derived from project evidence, improved as better examples appear | markdown (canonical) |
| **Personal Memory** | Durable guidance about Liad's working preferences and agent-behavior expectations | markdown (canonical) |
| **Experience Log** | Raw captured agent activity, used as evidence, not truth | SQLite (event log) |

Relationships (from `CONTEXT.md`):

- **Project Memory** is the root scope; **Session Memory** belongs to exactly one project by default.
- **Practice Memory** is *promoted* from repeated or explicitly selected project evidence — references are provenance, not instructions ("the canonical local-Supabase practice lives here; Wodnix/Suitepath were evidence").
- **Personal Memory** is *promoted* from repeated user corrections, observed behavior, or explicit guidance.
- **Experience Log** feeds all of the above as evidence. An `answer.correction` event in SQLite does **not** repair curated Project Memory — agents still use `flag_stale_answer`/`enrich_gap` for that.
- A **Memory Candidate** targets exactly one scope (Project / Session / Practice / Personal) for later curation.

The promotion path is one directed flow:

```mermaid
Experience Log (raw events)
  → Session Memory (project-scoped continuity)
    → Project Memory (curated wiki updates)
    → Practice Memory candidate (cross-project)
    → Personal Memory candidate (preferences)
      → canonical Practice / Personal Memory
```

## 5. The Four Layers

Myelin treats every project as four layers, read in priority order:

1. **`repo/`** — implementation truth (the actual code).
2. **`raw/` and `sources/`** — preserved source material, never rewritten during ingestion.
3. **`wiki/`** — synthesized, human-readable understanding (curated truth).
4. **`state/`** — machine-readable metadata, routing, provenance, freshness; plus the SQLite serving layer.

Default read priority for an agent: `state/` → `index.md` → `changelog`/`log/` → relevant `wiki/` pages → preserved raw/sources → repo files when verification requires it.

Scope is **software repositories only**. Non-repo content is not ingested as canonical project memory.

## 6. Schema Layer

The Schema Layer is the instruction/convention layer that teaches agents how to maintain Myelin. It has a global layer plus per-project specialization, expressed as human-readable markdown guidance *and* typed JSON rules validated by Zod, compiled into a generated `schema-context.json` the agent consumes.

| Piece | Description |
| --- | --- |
| Global schema (`schema/`) | `global.md` + typed JSON rules (page taxonomy, provenance fields, memory scopes, CLI vocabulary) |
| `schema check` / `schema build` | read-only validate; compile schema context (writes by default, `--dry-run` previews) |
| Generated schema context | `projects/<key>/state/schema-context.json` (per-project), freshness-checked (sha256 of inputs); regenerate on input change, skip if unchanged (ADR 0025) |
| Project-local schema | per-project conventions that specialize the global schema |
| Schema Override | typed project-local exception that weakens/replaces a global rule, with a reason |
| Schema Candidate + lifecycle | proposed schema changes discovered from evidence; states `pending/applied/rejected/superseded/failed` (ADR 0046); dedicated `candidates`/`apply`/`--global` CLI (ADR 0032) |

Query and learn both depend on schema context: `project learn` rebuilds stale context before learning and stops on validation failure; `memory query` fails closed (suggesting `schema build`/`check`) when context is missing or invalid (ADR 0034, 0037, 0038).

## 7. Runtime & Provider Abstraction

The core is **Bun/TypeScript-first** (ADR 0009, 0013, 0047). Root `src/` owns project discovery, config, state, the provider abstraction, query, schema, inbox, pipeline orchestration, and operator commands. Normal operation requires no Python or `.venv`.

The **Provider Abstraction** (`src/runtime/llm-client.ts`) is the BYO-subscription runner (ADR 0051):

- Drives **Codex** (`codex exec --sandbox read-only`, prompt on stdin, JSON on stdout) and **Claude Code** (`claude -p --output-format json`).
- `DEFAULT_PROVIDER` + `MODEL` + per-call override; per-workload profiles (pipeline vs query) incl. Codex reasoning-effort tiers, configured in `myelin.config`.
- Stub mode (`LLM_STUB_RESPONSES_DIR`) for deterministic tests.
- Clean provider seam so a third backend (e.g. Gemini) can be added later — Gemini is most likely to appear first as an *embedding* provider, a separate concern.

Codex stages must run `--sandbox read-only` and return JSON on stdout (never write artifacts directly and narrate) — a preserved guard against a historic failure mode.

## 8. The Pipeline

Two existing operator verbs refresh Project Memory from evidence (ADR 0017):

- **`project learn <key>`** (was `compile`) — broad Project Memory refresh. Stages: `sense → impact → propose → apply → validate`. Routine updates auto-apply with provenance; destructive deletes, decision-record supersession, low-confidence synthesis, conflicting sources, and broad rewrites are forced to review/dry-run (ADR 0019, 0020).
- **`project ingest <key>`** (was `update`) — process queued source/inbox items. Stages: `ingest → apply → validate`.

The top-level **`ingest <key>`** command is a separate agentic evidence-processing path introduced by ADR 0056. It starts a detached provider-backed ingest job that turns Experience Log rows into Session Memory and downstream layer handoff inputs. It must not be treated as a synonym for the older source/inbox `project ingest` pipeline.

Stage instructions live as data under `stages/<stage-id>/` and run through a stage runner; deterministic apply / structural-validate / commit are code, not model calls. The fuller pipeline also defines `acceptance`, `reconcile`, `self-correct`, and `measure` stages (ADR 0053).

Every auto-applied `learn` run writes an applied **changeset record** — run id, schema-context hash, before/after file hashes, source evidence per change, risk classification, and validation results — so changes are reproducible from git plus the record. A write that fails validation stops the run in a `needs-review` state with enough record to inspect what changed.

## 9. Capture & Promotion

This is the heart of the "compounding memory" vision. The governing rule: **capture everything cheaply, reason over almost nothing immediately, promote with agents only at clear value triggers.**

### 9.1 Work tiers

| Tier | Examples | Rule |
| --- | --- | --- |
| **Deterministic / scripted** | capture hook events, normalize into SQLite, detect project/session from cwd+git, chunk + hash + skip-unchanged, maintain tables/indexes, lexical search, route obvious `status` queries, enforce budgets/locks/debounce | code, never agents |
| **Automated, not agentic** | event ingestion, periodic compaction, embedding changed chunks, update `latest_session` pointer, build inventory, create cheap candidate records ("possible gap", "session has unsummarized events") | background, frequent, no durable-truth decisions |
| **Agentic** | summarize a meaningful session, decide whether raw events contain durable knowledge, update project wiki pages, turn repeated evidence into a Practice candidate, promote Personal preferences, reconcile contradictions, synthesize answers when retrieval is insufficient | only when judgment is required; debounced, budgeted, locked |
| **Manual / operator** | full project `learn`, cross-project Practice promotion, Personal promotion, superseding a canonical practice, changing decision records, draining large queues, expensive index rebuilds | requires explicit command or flag |

### 9.2 Trigger model

Every write-ish memory action has a mode: `off` (capture raw only) · `queue` (create candidate/inbox items, no agents) · `auto` (create candidates **and** spawn a bounded background worker). Defaults by source, e.g.: hook event → `queue/compact`; user correction → `auto`; explicit `enrich_gap` → `auto`; session stop → `queue` a summary candidate, not a full project-memory update; commit/PR complete → `auto` project-memory update candidate; Practice/Personal promotion → `queue` only.

**Auto Mode never lets a memory command launch unbounded agentic workers** — it marks records eligible for *bounded* future processing (ADR 0004).

### 9.3 The background agents

Defined by responsibility, not by model:

1. **Event Collector** — always-on via hooks/MCP callbacks; writes structured events cheaply. Never reasons.
2. **Session Curator** — at session stop / periodically; maintains "what did we work on last session?".
3. **Gap Curator** — after low-confidence query, flagged bad answer, failed route, or user correction; turns missing knowledge into inbox work (generalizes the `query_wiki → gap-note → ingest` loop).
4. **Project Memory Curator** — after meaningful sessions/commits or explicit `learn`; keeps project docs behavior-focused. (The evolved `learn`.)
5. **Practice Promoter** — after repeated cross-project patterns or explicit note; derives canonical "how we do X".
6. **Personal Promoter** — after repeated user corrections/preferences; grows Personal Memory.
7. **Indexer** — after content changes; deterministically chunk/hash/skip/embed and maintain SQLite + vector rows. Embedding providers sit behind a provider interface; the Indexer caches by content hash and tolerates quota/network failure by **leaving chunks pending** — no dependence on a fixed free-tier quota.

**Policy:** hooks never call LLMs, never mutate curated memory, only append raw events + enqueue candidates; deterministic workers may run continuously; agentic workers require explicit trigger + debounce + budget + lock; automatic Practice/Personal promotion is not the starting point — evidence is collected first and promotion stays manual until the shape is proven.

### 9.4 Memory-slice data contract

Manual event recording is intentionally **high-signal only** — it does not log every file read, command, MCP query, or chat turn; high-volume capture belongs to the Experience Log / Event Collector. The allowed event types are:

- `session.note`, `session.stop`, `memory.candidate`, `answer.correction`.

A `memory.candidate` event carries a `candidate_type` that routes it to exactly one memory scope (Project / Session / Practice / Personal); labels outside the allowed set are not valid. Memory-candidate / queue records use stored statuses such as `pending`, `processed`, `needs_review`, and `rejected` (distinct from the *schema*-candidate states in §6). Human CLI filters may accept hyphenated aliases such as `needs-review`, but JSON/state should use the stored enum value. An `answer.correction` is SQLite-only continuity evidence and does **not** repair curated Project Memory — agents use `flag_stale_answer` / `enrich_gap` for that.

## 10. Agent-Facing Interface (MCP)

Agents reach Myelin through a **detached** MCP server (`/mcp`), kept out of the core package graph; integration is contracts only — files, commands, env, JSON — with no cross-boundary source imports (ADR 0011, 0048). The detached server is Bun/TypeScript.

The public surface is three semantic facades (ADR 0005):

- **`query`** — explanatory knowledge ("What did we work on last session?", "How does class visibility work?"). The main interface; routes across project wiki, Session, Personal, and Practice Memory plus vector recall, and sets `degraded` when a requested scope cannot be served.
- **`how`** — prescriptive operating guidance ("How do we run local Supabase?"); prefers Practice Memory, Personal workflow guidance, project-specific runbooks, and current project overrides.
- **`status`** — structured current state / inventory / latest-session lookup ("What project am I in?", "What's recent?", "What's stale?"). Structured-first, prose only as convenience.

Supporting (non-primary) tools: `list_wiki_projects`, `get_wiki_page`, `plan_query`, `enrich_gap`, `flag_stale_answer`, `create_inbox_item`, `list_brain_pages`, `find_brain_pages`, `get_page_neighbors`, `get_version`. Facades require an explicit `project_key` unless `LLM_WIKI_PROJECT` scopes the server. `LLM_WIKI_*` env and the `mcp__llm-wiki__*` namespace keep their names as compatibility contracts (ADR 0050).

Core owns query logic once; the detached MCP consumes it via the `myelin memory query --json` contract whose envelope is `answer, confidence, memory_scope, citations, candidate_ids, degraded, degraded_reason, source_tools`.

## 11. Retrieval

- **Structured recall** — SQLite queries over `session_memories` and existing manual session state back `status` and continuity reads deterministically.
- **Vector recall** — `sqlite-vec` + embeddings (a Gemini *embedding* provider is the likely first wiring) for semantic search over wiki pages, session summaries, and practices. The Indexer agent (§9.3) maintains the vector rows: chunk → hash → skip unchanged → embed changed → write; quota/network failure degrades to **pending chunks**. Vector search is a retrieval layer *over* curated truth, not a replacement for it — Myelin is not generic RAG.

## 12. Data Layout

```
projects/<key>/
  readme.md  project-brain entrypoint
  index.md   project-folder navigation
  wiki/      curated markdown pages (Project Memory), with index.md in every folder
  state/     metadata, routing, provenance, freshness, generated schema-context.json, with index.md
  log/       changelog and memory history, with index.md
  runs/      command-scoped run artifacts, with index.md
  sources/   optional preserved source material, created only when preserved sources exist
  schema/    optional project-local schema, created only when project-local rules exist
state/
  memory.db  repo-root SQLite serving layer (git-ignored)
schema/      global authored schema inputs
stages/      pipeline stage instruction assets (data)
concepts/    cross-project knowledge
raw/         unclassified global intake
mcp/         detached MCP interface (not in the root package graph)
```

One repo-root SQLite DB partitioned by `project_key` (ADR 0001), not one DB per project. It is generated serving state and git-ignored.

## 13. Decision Index

The decisions in `docs/adr/` (`000N-<slug>.md`) are append-only — superseded by newer ADRs, never edited. Thematic guide:

- **Memory & SQLite:** 0001 (root DB), 0002 (session in SQLite), 0003 (PM tools = source evidence), 0004 (auto-mode launches no workers), 0006, 0007, 0021 (markdown curated truth), 0022 (LLM Wiki pattern).
- **Runtime & boundary:** 0009 (Bun/TS), 0011 (MCP detached), 0012, 0013 (core migration first), 0014, 0047 (quarantine + rewrite), 0048 (core owns query), 0052 (seed core from MCP TS). *(0008 and 0010 are superseded — by 0009 and 0011 respectively — and are not live decisions.)*
- **Product direction:** 0015 (V2 over V1), 0016/0017 (V2 CLI vocabulary, learn/ingest/query/session), 0050 (Myelin name), 0051 (BYO multi-provider).
- **Schema:** 0023–0035 (global+project layers, typed JSON rules, Zod, dedicated schema CLI at 0032), 0040–0046 (candidate storage/IDs/states/apply + V2 project layout), 0049 (thin global-only schema).
- **Query:** 0005 (query/how/status facades), 0036/0037/0038 (schema-gated, fail-closed, side-effect-light).
- **Learn/ingest:** 0018 (read live repo), 0019 (auto-apply default), 0020 (gate risky changes).
- **Scope:** 0049 (thin schema), 0053 (pipeline stage scope).

## 14. Non-Goals

- Generic RAG, or a vector store as the primary product.
- Mirroring repo structure / summarizing code an agent can read directly.
- Treating SQLite as curated truth.
- Treating conversation history as canonical project knowledge.
- Ingesting non-repo content as canonical project memory.
- Backward compatibility with V1 at the cost of the V2 brain.
- Making the detached MCP server own product logic.
- Depending on a fixed embedding free-tier (e.g. Gemini) quota — capture degrades to pending chunks instead.

## 15. Glossary

The canonical product language lives in `CONTEXT.md` — Project / Session / Practice / Personal Memory, Experience Log, Schema Layer and its vocabulary, the Query/How/Status facades, Provider Abstraction, Auto Mode, and the resolved naming ambiguities. This document uses those terms; it does not redefine them.
