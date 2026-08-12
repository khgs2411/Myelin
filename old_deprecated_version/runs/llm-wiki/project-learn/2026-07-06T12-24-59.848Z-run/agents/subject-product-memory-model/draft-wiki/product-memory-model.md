# Product Memory Model

Myelin is a local-first, project-rooted memory system for coding agents: it keeps durable repository knowledge in curated markdown, preserves evidence and provenance, and serves that knowledge through queryable state without making generated indexes the source of truth.

## Product Shape

The canonical product design lives in `MYELIN.md`. The short version is that Myelin is not a generic RAG system, a SQLite session tracker, or a repo documentation compiler. It is a maintained memory layer for software repositories, built on the LLM Wiki Pattern: preserved raw sources, an agent-maintained markdown wiki, and a schema/instructions layer that tells agents how to maintain that wiki. ADR 0022 names this pattern as the taxonomy origin and explicitly keeps SQLite and vector search as serving infrastructure around the curated wiki, not replacements for it.

For a project, Myelin should answer:

- what is known about this repository
- what happened in recent work
- what evidence supports the memory
- what is stale, missing, or still awaiting curation
- how Liad normally wants agents to work on this kind of task
- which recurring practices apply across projects

`MY_VISION.md` states the practical goal in operator terms: Project Memory should become living documentation that saves agents from repeatedly rediscovering the repository. Session Memory provides recent continuity and can create leads, but Project Memory must investigate the target repo and publish useful, repo-grounded documentation.

## Memory Layers

Myelin uses five memory types. `CONTEXT.md` is the glossary for their canonical names.

| Memory type | Role | Canonical home |
| --- | --- | --- |
| Project Memory | Curated per-project knowledge: behavior, feature intent, setup, runbooks, decisions, current state, contradictions, and provenance. | Markdown wiki plus metadata JSON under `projects/<key>/`. |
| Session Memory | Project-scoped continuity from recent work: decisions, findings, blockers, verification state, next actions, and "do not redo this" notes. | SQLite serving state, especially trusted `session_memories`; older `sessions` / `session_events` remain a manual session surface. |
| Practice Memory | Cross-project guidance for recurring work, derived from project evidence and improved as stronger examples appear. | Canonical markdown, with project references as provenance rather than instructions to copy blindly. |
| Personal Memory | Durable guidance about Liad's working preferences and agent behavior. | Canonical markdown, promoted from repeated corrections, observed behavior, or explicit guidance. |
| Experience Log | Raw captured agent activity used as evidence. | SQLite event log; evidence, not truth. |

Project Memory is the root. Session Memory belongs to a project; Practice and Personal Memory are promoted from project evidence; Experience Log feeds the other layers as raw evidence. A Memory Candidate targets exactly one scope and is a lead for later curation, not a canonical write.

The intended flow is:

```text
Experience Log
  -> Session Memory
  -> Project Memory
  -> Practice Memory candidates
  -> Personal Memory candidates
  -> canonical Practice / Personal Memory
```

The operating rule from `MYELIN.md` and `docs/IMPLEMENTATION_ALIGNMENT.md` is: capture cheaply, reason rarely, promote with judgment. Hooks and low-level capture append evidence or queue candidates; they do not call LLMs directly and do not mutate curated memory. Agentic work belongs at promotion boundaries where judgment is required.

## Project Layers

Each project is modeled as four layers, read in priority order:

1. `repo/`: implementation truth, meaning the actual target repository.
2. `sources/` and Experience Log evidence: preserved source material and raw captured work.
3. `wiki/`: synthesized human-readable Project Memory.
4. `state/`: metadata, routing, provenance, freshness, generated schema context, run state, and SQLite serving indexes.

The important boundary is that markdown is curated truth and SQLite is serving state. ADR 0021 keeps curated Project Memory as markdown plus metadata JSON during V2. SQLite can store recall, session continuity, event capture, queues, vector metadata, and derived retrieval rows, but it should not become the trusted Project Memory record unless a future design explicitly changes that boundary.

## Canonical Terminology

The product is named Myelin. ADR 0050 renames the product, CLI binary, root config, documentation, and design language to Myelin and `myelin.config`. The older `llm-wiki` name survives only where it is an external compatibility contract: `LLM_WIKI_*` environment variables and the `mcp__llm-wiki__*` MCP tool namespace.

New docs and scripts should use V2 product vocabulary:

- `project learn <key>`: Project Memory creation, maintenance, and source/inbox intake.
- top-level `ingest <key>`: Experience Log to Session Memory processing.
- `memory query <key> "<question>"`: current query facade seed.
- `memory index session <key>`: Session Memory embedding/index backfill.
- `schema check <key>` and `schema build <key>`: schema validation and generated schema-context maintenance.

Avoid reintroducing V1 names such as `compile`, `update`, `ask`, or `project ingest` as primary product language. The root `Makefile` may provide thin aliases, but the product surface is the `myelin` CLI.

## Current Boundaries

`docs/IMPLEMENTATION_ALIGNMENT.md` is the best snapshot for what exists versus what is target design.

The aligned foundation includes the Bun/TypeScript runtime in `src/`, the CLI registry, project discovery and state helpers, the provider abstraction for Codex and Claude, schema check/build, the detached MCP boundary, and the vendored SQLite runtime selection used for vector-extension support on macOS.

The Project Memory layer has moved beyond a scaffold. `docs/ROADMAP.md` records that `project learn` now uses bounded Project Memory packets, structured curator contracts, deterministic validation, markdown apply, source-consumption reconciliation, runtime inbox intake, derived Project Memory retrieval indexing, and create-mode quality gates. The quality bar was reset after a mechanically successful but shallow dogfood run: rendered markdown usefulness, answer-domain coverage, repo-grounded sections, citations, and answerability checks matter more than page count or curator-declared intent.

Session Memory is implemented more directly than Project Memory in the current roadmap: top-level `ingest <key>` processes Experience Log rows into trusted Session Memories and related candidates/handoffs, indexing is explicit through `memory index session`, and `memory query` can retrieve indexed Session Memories with branch filtering and degraded-state reporting. This does not make SQLite Project Memory; Session Memory rows are trusted memory records in SQLite, while Project Memory retrieval rows are rebuildable pointers into canonical markdown.

The query surface is still transitional. Core query behavior lives in `src/query/` and is exposed through `myelin memory query --json`; the future semantic interface should route across Project, Session, Practice, Personal, and state layers with `query`, `how`, and `status` facades. Current project-wiki and Session Memory query behavior should be treated as seeds for that interface, not the complete product.

## Non-Goals

Myelin should not:

- become generic RAG or treat vector search as the product
- mirror repository structure or summarize code an agent can read directly
- treat SQLite, conversation history, or raw Experience Log rows as curated truth
- ingest non-repository content as canonical Project Memory
- preserve V1 vocabulary at the cost of the V2 memory model
- make the detached MCP server own product logic
- let hooks or auto mode launch unbounded agentic workers
- create durable claims without provenance or explicit inference labels

The durable product boundary is narrow but strong: software repositories produce evidence; evidence becomes curated markdown only through grounded curation; derived state makes that memory queryable; and future agents can start from maintained project understanding instead of rebuilding context from scratch.
