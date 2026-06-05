# Myelin — Canonical Design & Plan

## 1. Purpose & How to Read This

This is the single canonical document for Myelin: what it is, why it is shaped this way, and the plan to build the rest of it. It merges the product vision (design) with the build sequence (plan) and tracks what already exists. When this document and any other doc disagree, this document wins — except for `docs/adr/*` decision records, which it summarizes but never overrides.

**How to read this:** Sections 2–12 are the design (the whole vision, regardless of what is built). Sections 13–14 are the plan and the live status. Every capability carries a status marker so design and plan stay in one place:

- ✅ **Done** — built and verified in the current codebase.
- 🟡 **In progress** — partially built or actively under construction.
- ⬜ **Planned** — designed here, not yet built.

**Sources this consolidates:** `V2_SPEC.md` (raw vision), `docs/superpowers/specs/2026-06-01-v2-project-rooted-agent-memory-design.md` (normalized contract), `CONTEXT.md` (product language), `docs/adr/*` (decisions), and the Phase-0 / SQLite slice docs. Older V1 designs are in `docs/archive/`.

---

## 2. North Star

Myelin is a **project-rooted memory system for coding agents**, built on the LLM Wiki Pattern. It keeps durable project knowledge next to the repo — curated wiki pages, preserved sources, freshness state — and serves it to agents through a small semantic interface so that a new session starts from maintained memory instead of re-exploring the codebase. Around that core it derives session continuity, cross-project practices, personal working preferences, and raw experience, all from real project work rather than detached notes.

The product should be able to answer, for any repo:

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

| Memory type | What it holds | Canonical store | Status |
| --- | --- | --- | --- |
| **Project Memory** | Curated per-project knowledge: behavior, features, decisions, runbooks, setup, current state, provenance | markdown wiki + state JSON | ✅ exists; maintained by `learn`/`ingest` |
| **Session Memory** | Project-scoped continuity: recent work, decisions, findings, next actions, blockers, "do not redo this" notes, task/branch/external-tracker context | SQLite (`sessions`, `session_events`) | ✅ capture + recall; ⬜ markdown promotion |
| **Practice Memory** | Canonical cross-project "how we do X", derived from project evidence, improved as better examples appear | markdown (canonical) | ⬜ planned |
| **Personal Memory** | Durable guidance about Liad's working preferences and agent-behavior expectations | markdown (canonical) | ⬜ planned |
| **Experience Log** | Raw captured agent activity, used as evidence, not truth | SQLite (event log) | ⬜ planned |

Relationships (from `CONTEXT.md`):

- **Project Memory** is the root scope; **Session Memory** belongs to exactly one project by default.
- **Practice Memory** is *promoted* from repeated or explicitly selected project evidence — references are provenance, not instructions ("the canonical local-Supabase practice lives here; Wodnix/Suitepath were evidence").
- **Personal Memory** is *promoted* from repeated user corrections, observed behavior, or explicit guidance.
- **Experience Log** feeds all of the above as evidence. An `answer.correction` event in SQLite does **not** repair curated Project Memory — agents still use `flag_stale_answer`/`enrich_gap` for that.
- A **Memory Candidate** targets exactly one scope (Project / Session / Practice / Personal) for later curation.

The promotion path is one directed flow:

```
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

| Piece | Description | Status |
| --- | --- | --- |
| Global schema (`schema/`) | `global.md` + typed JSON rules (page taxonomy, provenance fields, memory scopes, CLI vocabulary) | ✅ Done |
| `schema check` / `schema build` | read-only validate; compile schema context (writes by default, `--dry-run` previews) | ✅ Done |
| Generated schema context | `projects/<key>/state/schema-context.json` (per-project), freshness-checked (sha256 of inputs); regenerate on input change, skip if unchanged (ADR 0025) | ✅ Done |
| Project-local schema | per-project conventions that specialize the global schema | ⬜ Planned (ADR 0049 defers) |
| Schema Override | typed project-local exception that weakens/replaces a global rule, with a reason | ⬜ Planned |
| Schema Candidate + lifecycle | proposed schema changes discovered from evidence; states `pending/applied/rejected/superseded/failed` (ADR 0046); dedicated `candidates`/`apply`/`--global` CLI (ADR 0032) | ⬜ Planned |

Phase-0 ships **thin, global-only** schema; the project-local/override/candidate machinery is target design, deferred (ADR 0049). Query and learn both depend on schema context: `project learn` rebuilds stale context first and stops on validation failure; `memory query` fails closed (suggesting `schema build`/`check`) when context is missing or invalid (ADR 0034, 0037, 0038).

## 7. Runtime & Provider Abstraction

✅ **Done.** The core is **Bun/TypeScript-first** (ADR 0009, 0013, 0047). Root `src/` owns project discovery, config, state, the provider abstraction, query, schema, inbox, pipeline orchestration, and operator commands. V1 Python/Bash was quarantined to `legacy/` and then deleted; normal operation needs no Python or `.venv`.

The **Provider Abstraction** (`src/runtime/llm-client.ts`) is the BYO-subscription runner (ADR 0051):

- Drives **Codex** (`codex exec --sandbox read-only`, prompt on stdin, JSON on stdout) and **Claude Code** (`claude -p --output-format json`).
- `DEFAULT_PROVIDER` + `MODEL` + per-call override; per-workload profiles (pipeline vs query) incl. Codex reasoning-effort tiers, configured in `myelin.config`.
- Stub mode (`LLM_STUB_RESPONSES_DIR`) for deterministic tests.
- Clean provider seam so a third backend (e.g. Gemini, ⬜ not wired) can be added later — Gemini is most likely to appear first as an *embedding* provider, a separate concern.

Codex stages must run `--sandbox read-only` and return JSON on stdout (never write artifacts directly and narrate) — a preserved guard against a historic failure mode.

## 8. The Pipeline

Two operator verbs refresh Project Memory from evidence (ADR 0017):

- **`project learn <key>`** (was `compile`) — broad Project Memory refresh. Phase-0 stages: `sense → impact → propose → apply → validate`. Auto-applies routine updates with provenance by default; forces review/dry-run for destructive deletes, decision-record supersession, low-confidence synthesis, conflicting sources, or broad rewrites (ADR 0019, 0020). ✅
- **`project ingest <key>`** (was `update`) — process queued source/inbox items. Phase-0 stages: `ingest → apply → validate`. ✅

Stage instructions live as data under `stages/<stage-id>/` and are executed by a stage runner; deterministic apply / structural-validate / commit are code, not model calls.

**Deferred stages** (⬜, ADR 0053): acceptance, reconcile, self-correct, and `measure`. Validate failure currently surfaces and stops (no auto-reconcile). Internal pipeline semantics beyond the Phase-0 subset are explicitly provisional and will be redesigned in a later phase.

**Auditability** (⬜ target design): every auto-applied `learn` run must write an applied **changeset record** — run id, schema-context hash, before/after file hashes, source evidence per change, risk classification, and validation results — so changes are reproducible from git plus the record. A write that fails validation stops the run in a degraded / `needs-review` state with enough record to inspect what changed.

## 9. Capture & Promotion

This is the largest unbuilt area and the heart of the "compounding memory" vision. The governing rule: **capture everything cheaply, reason over almost nothing immediately, promote with agents only at clear value triggers.**

### 9.1 Work tiers

| Tier | Examples | Rule |
| --- | --- | --- |
| **Deterministic / scripted** | capture hook events, normalize into SQLite, detect project/session from cwd+git, chunk + hash + skip-unchanged, maintain tables/indexes, lexical search, route obvious `status` queries, enforce budgets/locks/debounce | code, never agents |
| **Automated, not agentic** | event ingestion, periodic compaction, embedding changed chunks, update `latest_session` pointer, build inventory, create cheap candidate records ("possible gap", "session has unsummarized events") | background, frequent, no durable-truth decisions |
| **Agentic** | summarize a meaningful session, decide whether raw events contain durable knowledge, update project wiki pages, turn repeated evidence into a Practice candidate, promote Personal preferences, reconcile contradictions, synthesize answers when retrieval is insufficient | only when judgment is required; debounced, budgeted, locked |
| **Manual / operator** | full project `learn`, cross-project Practice promotion, Personal promotion, superseding a canonical practice, changing decision records, draining large queues, expensive index rebuilds | requires explicit command or flag |

### 9.2 Trigger model ⬜

Every write-ish memory action has a mode: `off` (capture raw only) · `queue` (create candidate/inbox items, no agents) · `auto` (create candidates **and** spawn a bounded background worker). Defaults by source, e.g.: hook event → `queue/compact`; user correction → `auto`; explicit `enrich_gap` → `auto` (current behavior); session stop → `queue` a summary candidate, not a full project-memory update; commit/PR complete → `auto` project-memory update candidate; Practice/Personal promotion → `queue` only.

**Auto Mode never lets a memory command launch unbounded agentic workers** — it marks records eligible for *bounded* future processing (ADR 0004).

### 9.3 The background agents ⬜

Defined by responsibility, not by model:

1. **Event Collector** — always-on via hooks/MCP callbacks; writes structured events cheaply. Never reasons.
2. **Session Curator** — at session stop / periodically; maintains "what did we work on last session?".
3. **Gap Curator** — after low-confidence query, flagged bad answer, failed route, or user correction; turns missing knowledge into inbox work (close to today's `query_wiki → gap-note → ingest`).
4. **Project Memory Curator** — after meaningful sessions/commits or explicit `learn`; keeps project docs behavior-focused. (The evolved `learn`.)
5. **Practice Promoter** — after repeated cross-project patterns or explicit note; derives canonical "how we do X".
6. **Personal Promoter** — after repeated user corrections/preferences; grows Personal Memory.
7. **Indexer** — after content changes; deterministically chunk/hash/skip/embed and maintain SQLite + vector rows. Embedding providers sit behind a provider interface; the Indexer caches by content hash and tolerates quota/network failure by **leaving chunks pending** — no dependence on a fixed free-tier quota.

**Policy for the spec** (⬜): hooks never call LLMs, never mutate curated memory, only append raw events + enqueue candidates; deterministic workers may run continuously; agentic workers require explicit trigger + debounce + budget + lock; do **not** start with automatic Practice/Personal promotion — collect evidence first, promote manually until the shape is proven.

### 9.4 Memory-slice data contract ⬜

Manual event recording is intentionally **high-signal only** — it must not mirror future hook behavior by logging every file read, command, MCP query, or chat turn; high-volume capture belongs to the deferred Experience Log / Event Collector slice. The initial allowed event types are:

- `session.note`, `session.stop`, `memory.candidate`, `answer.correction`.

A `memory.candidate` event carries a `candidate_type` that routes it to exactly one memory scope (Project / Session / Practice / Personal); agents must not invent labels outside the allowed set. Memory-candidate / queue records move through statuses `pending → processed → needs-review` (distinct from the *schema*-candidate states in §6). An `answer.correction` is SQLite-only continuity evidence and does **not** repair curated Project Memory — agents still use `flag_stale_answer` / `enrich_gap` for that.

## 10. Agent-Facing Interface (MCP)

Agents reach Myelin through a **detached** MCP server (`/mcp`), kept out of the core package graph; integration is contracts only — files, commands, env, JSON — with no cross-boundary source imports (ADR 0011, 0048). The detached server is now Bun/TypeScript and Python-free.

The target public surface is three semantic facades (ADR 0005), resolving the `query/how/what` naming from the vision:

- **`query`** — explanatory knowledge ("What did we work on last session?", "How does class visibility work?"). The main interface; routes across project wiki, Session, Personal, and Practice Memory plus vector recall, and sets `degraded` when a requested scope is not available yet. 🟡 exists today as the current query tools (`query_wiki`, `plan_query`, …).
- **`how`** — prescriptive operating guidance ("How do we run local Supabase?"); prefers Practice Memory, **Personal workflow guidance**, project-specific runbooks, and current project overrides. ⬜
- **`status`** — structured current state / inventory / latest-session lookup ("What project am I in?", "What's recent?", "What's stale?"). Structured-first, prose only as convenience. ⬜ as a facade (today `status` is a CLI command).

Supporting (non-primary) tools remain: `list_wiki_projects`, `get_wiki_page`, `plan_query`, `enrich_gap`, `flag_stale_answer`, `create_inbox_item`, `list_brain_pages`, `find_brain_pages`, `get_page_neighbors`, `get_version`. Facades require an explicit `project_key` unless `LLM_WIKI_PROJECT` scopes the server. `LLM_WIKI_*` env and the `mcp__llm-wiki__*` namespace keep their names as compatibility contracts (ADR 0050).

Core owns query logic once; the detached MCP consumes it via the `myelin memory query --json` contract whose envelope is `answer, confidence, memory_scope, citations, candidate_ids, degraded, degraded_reason, source_tools`.

## 11. Retrieval

- **Structured recall** 🟡 — SQLite recall over sessions/events works through the `session recent`/`show` CLI (✅), but is **not yet wired into `status` / automatic session-bootstrap continuity** (⬜, slice #2). The query path is built; the automatic-recall path is not.
- **Vector recall** ⬜ — `sqlite-vec` + embeddings (a Gemini *embedding* provider is the likely first wiring) for semantic search over wiki pages, session summaries, and practices. The Indexer agent (§9.3) maintains the vector rows: chunk → hash → skip unchanged → embed changed → write; quota/network failure degrades to **pending chunks**. Vector search is a retrieval layer *over* curated truth, not a replacement for it — Myelin is not generic RAG.

## 12. Data Layout

```
projects/<key>/
  sources/   preserved source material
  wiki/      curated markdown pages (Project Memory)
  schema/    project-local schema (⬜ deferred)
  state/     metadata, routing, provenance, freshness, generated schema-context.json
  log/       changelog / run logs
  runs/      pipeline run artifacts
state/
  memory.db  ✅ repo-root SQLite serving layer (git-ignored; sessions today)
schema/      ✅ global authored schema inputs
stages/      ✅ pipeline stage instruction assets (data)
concepts/    cross-project knowledge
raw/         unclassified global intake
mcp/         detached MCP interface (not in the root package graph)
```

One repo-root SQLite DB partitioned by `project_key` (ADR 0001), not one DB per project. It is generated serving state and git-ignored.

## 13. Roadmap / Build Sequence

The implementation order follows the original vision sequence: behavior-focused project docs → SQLite substrate → vector retrieval → hooks/capture → promotion agents → cross-project promotion. Each slice produces working, testable software.

| # | Slice | Status | Governing ADRs |
| --- | --- | --- | --- |
| 0 | **Phase 0 — clean Bun/TS core** (runtime, provider abstraction, thin schema, query, inbox, `learn`/`ingest`, `status`; V1 deleted) | ✅ Done | 0047–0053, 0009, 0013 |
| 1 | **SQLite substrate + Session Memory** (`state/memory.db`, migrations; `session start/log/close/recent/show`) | ✅ Done | 0001, 0002 |
| 2 | **Recall into startup** — wire Session Memory recall into `myelin status` so a new session is bootstrapped automatically | ⬜ Next | 0002 |
| 3 | **Experience Log + hooks (capture)** — Event Collector; deterministic event ingestion; `off/queue/auto` trigger model | ⬜ | 0003, 0004 |
| 4 | **Session Curator + markdown promotion** — auto-summarize sessions; promote durable session rows into `wiki/sessions/*.md` | ⬜ | 0002, 0021 |
| 5 | **Vector recall** — `sqlite-vec`, embedding provider, Indexer agent | ⬜ | — |
| 6 | **Practice Memory** — promotion from cross-project evidence; `how` facade | ⬜ | 0005 |
| 7 | **Personal Memory** — promotion from repeated corrections/preferences | ⬜ | — |
| 8 | **Project-local schema** — project schema, overrides, candidate lifecycle, `candidates`/`apply`/`--global` | ⬜ | 0023, 0024, 0030, 0031, 0032, 0040–0046, 0049 |
| 9 | **MCP facade reshaping** — `query`/`how`/`status` semantic facades over the detached server | ⬜ | 0005, 0011, 0048 |

Slice ordering after #2 is directional, not contractual — sequence is revisited as each lands.

## 14. Status Matrix

At-a-glance: capability → state → where it lives → governing decision.

| Capability | Status | Code / data | ADR |
| --- | --- | --- | --- |
| Bun/TS core runtime | ✅ | `src/runtime/*`, `src/cli.ts` | 0009, 0013, 0047 |
| Provider abstraction (Codex, Claude) | ✅ | `src/runtime/llm-client.ts` | 0051 |
| Thin global schema + `check`/`build` | ✅ | `src/schema/*`, `schema/` | 0049 |
| Query on schema context, fail-closed | ✅ | `src/query/*` | 0037, 0038, 0048 |
| Inbox + auto-update | ✅ | `src/inbox/*` | — |
| Pipeline `learn` / `ingest` (Phase-0 stages) | ✅ | `src/pipeline/*`, `stages/` | 0053 |
| `status` command | ✅ | `src/commands/` | — |
| SQLite substrate (WAL, FK, migrations) | ✅ | `src/memory/{db,migrations}.ts`, `state/memory.db` | 0001 |
| Session Memory capture + recall | ✅ | `src/memory/sessions.ts`, `src/commands/session.ts` | 0002 |
| Recall wired into `status` | ⬜ | — | 0002 |
| Experience Log + hooks | ⬜ | — | 0003, 0004 |
| Session Curator (auto-summary) | ⬜ | — | — |
| Session → markdown promotion | ⬜ | — | 0002, 0021 |
| Vector recall (`sqlite-vec`, embeddings) | ⬜ | — | — |
| Practice Memory + `how` facade | ⬜ | — | 0005 |
| Personal Memory | ⬜ | — | — |
| Project-local schema / overrides / candidates | ⬜ | — | 0023, 0024, 0030, 0031, 0032, 0040–0046, 0049 |
| MCP `query`/`how`/`status` facades | 🟡 | `/mcp` (detached, TS) | 0005, 0011, 0048 |
| Advanced pipeline (acceptance/reconcile/self-correct/measure) | ⬜ | — | 0053 |
| Gemini provider (runner + embeddings) | ⬜ | — | 0051 |

## 15. Decision Index

The decisions in `docs/adr/` (`000N-<slug>.md`) are append-only — superseded by newer ADRs, never edited. Read the recent scope decisions (0047–0053) first. Thematic guide:

- **Memory & SQLite:** 0001 (root DB), 0002 (session in SQLite), 0003 (PM tools = source evidence), 0004 (auto-mode launches no workers), 0006, 0007, 0021 (markdown curated truth), 0022 (LLM Wiki pattern).
- **Runtime & boundary:** 0009 (Bun/TS), 0011 (MCP detached), 0012, 0013 (core migration first), 0014, 0047 (quarantine + rewrite), 0048 (core owns query), 0052 (seed core from MCP TS). *(0008 and 0010 are superseded — by 0009 and 0011 respectively — and are not live decisions.)*
- **Product direction:** 0015 (V2 over V1), 0016/0017 (V2 CLI vocabulary, learn/ingest/query/session), 0050 (Myelin name), 0051 (BYO multi-provider).
- **Schema:** 0023–0035 (global+project layers, typed JSON rules, Zod, dedicated schema CLI at 0032), 0040–0046 (candidate storage/IDs/states/apply + V2 project layout), 0049 (Phase-0 thin global-only).
- **Query:** 0005 (query/how/status facades), 0036/0037/0038 (schema-gated, fail-closed, side-effect-light).
- **Learn/ingest:** 0018 (read live repo), 0019 (auto-apply default), 0020 (gate risky changes).
- **Phase-0 scope:** 0049 (thin schema), 0053 (pipeline stage scope).

A first task in the project-local-schema slice could be a generated `docs/adr/README.md` index; until then this section is the guide.

## 16. Non-Goals

- Generic RAG, or a vector store as the primary product.
- Mirroring repo structure / summarizing code an agent can read directly.
- Treating SQLite as curated truth.
- Treating conversation history as canonical project knowledge.
- Ingesting non-repo content as canonical project memory.
- Backward compatibility with V1 at the cost of the V2 brain.
- Making the detached MCP server own product logic.
- Depending on a fixed embedding free-tier (e.g. Gemini) quota — capture degrades to pending chunks instead.

## 17. Glossary

The canonical product language lives in `CONTEXT.md` — Project / Session / Practice / Personal Memory, Experience Log, Schema Layer and its vocabulary, the Query/How/Status facades, Provider Abstraction, Auto Mode, and the resolved naming ambiguities. This document uses those terms; it does not redefine them.
