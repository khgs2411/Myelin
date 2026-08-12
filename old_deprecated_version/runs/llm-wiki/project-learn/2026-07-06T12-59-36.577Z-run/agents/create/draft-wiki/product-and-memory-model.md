# Product And Memory Model

Myelin is a local-first, project-rooted memory system for software repositories that helps coding agents start from maintained project knowledge instead of rediscovering the repo every session.

## Canonical Product Shape

`MYELIN.md` is the canonical product design. It says Myelin is built on the LLM Wiki Pattern: preserve raw sources, maintain curated markdown Project Memory, keep freshness/provenance state, and serve that knowledge to agents through a small semantic interface. `README.md` gives the operator quick start and repo layout, while `CONTEXT.md` owns product vocabulary and resolved naming choices. `docs/IMPLEMENTATION_ALIGNMENT.md` maps implementation to the target shape, and `docs/ROADMAP.md` is the current implementation progress tracker.

The north star is durable memory from real project work. Myelin should answer, for a software repo:

- what is known about the project
- what happened recently
- how recurring workflows are run
- what evidence supports memory claims
- what still needs curation or verification

The governing rule is: capture cheaply, reason rarely, promote with judgment. Hooks and low-level capture append evidence or candidates; agentic work belongs at promotion boundaries such as session summarization, Project Memory updates, or Practice/Personal promotion.

## Memory Types

Myelin has five memory types, with Project Memory as the root:

| Memory type | Role | Canonical home |
| --- | --- | --- |
| Project Memory | Curated per-project knowledge: behavior, feature intent, setup, runbooks, decisions, current state, contradictions, and provenance | `projects/<key>/wiki/` markdown plus project state JSON |
| Session Memory | Project-scoped continuity from recent work: decisions, findings, blockers, verification state, next actions, and what not to redo | SQLite trusted Session Memory rows, with branch/repo context metadata |
| Practice Memory | Cross-project guidance for recurring work, promoted from repeated or selected project evidence | Markdown canonical memory |
| Personal Memory | Durable guidance about Liad's working preferences and agent-behavior expectations | Markdown canonical memory |
| Experience Log | Raw captured agent activity used as evidence, not truth | SQLite event log |

The intended derivation path is one-directional: raw project work enters the Experience Log, meaningful continuity becomes Session Memory, durable repo-grounded knowledge becomes Project Memory, and repeated or explicit higher-level lessons become Practice or Personal candidates before promotion. A Memory Candidate is only a lead for curation; it is not canonical memory.

## Layers And Truth

Myelin treats each project as four layers:

- `repo/`: implementation truth, used when code verification is required.
- `sources/` and Experience Log evidence: preserved source material and raw evidence, not rewritten during ingestion.
- `wiki/`: synthesized human-readable Project Memory, the curated truth agents should reuse.
- `state/`: machine-readable metadata, routing, provenance, freshness, generated schema context, and SQLite serving state.

There are two related priorities to keep distinct. For quick agent orientation, `AGENTS.md` and `MYELIN.md` say the default read path is `state/`, then `index.md`, changelog/log material, relevant wiki pages, preserved sources, and finally repo files when verification is needed. For truth claims, repo code and preserved evidence constrain curated memory; SQLite indexes and generated state are serving layers, not the canonical record.

Project scope is software repositories only. Non-repo content can be evidence or external context only when explicitly classified, but it should not become canonical Project Memory for Myelin.

## Vocabulary

Use Myelin V2 product language:

- Say `Project Memory`, not Project Brain, repo docs, or codebase docs.
- Say `Session Memory`, not chat history or Session Brain.
- Say `Experience Log` for raw captured activity; do not call it a truth store.
- Say `project learn <key>` for Project Memory creation, maintenance, and source/inbox intake.
- Say top-level `ingest <key>` for Experience Log to Session Memory processing.
- Say `memory query <key> "<question>"` for the query surface.
- Treat `LLM_WIKI_*` environment variables and the `mcp__llm-wiki__*` MCP namespace as compatibility contracts, not current product naming.

The semantic agent-facing target is three facades: `query` for explanatory knowledge, `how` for prescriptive operating guidance, and `status` for current state, inventory, and freshness. `README.md` and `AGENTS.md` both emphasize that the Makefile is a thin alias layer; new automation should call Myelin vocabulary through `bun src/cli.ts` or the `myelin` binary.

## Schema And Serving State

The Schema Layer teaches agents how to maintain Myelin. In the current Phase-0 shape, `schema/` contains global markdown guidance and typed JSON rules, while `schema check <key>` and `schema build <key>` validate and generate per-project `schema-context.json`. `CONTEXT.md` notes that project-local schema, overrides, schema candidates, and apply flows are target vocabulary beyond the thin Phase-0 schema.

SQLite is serving state. It stores Experience Log events, Session Memory, query/index state, queues, and generated retrieval/index rows. Project Memory markdown remains the canonical curated record. Project Memory retrieval indexes are rebuildable pointers into canonical markdown, not a replacement source of truth.

## Product Non-Goals

Myelin is not:

- generic RAG or a vector store as the primary product
- a repo-structure mirror or code summarizer for code agents can read directly
- a SQLite-first memory product where generated state becomes curated truth
- a system that treats conversation history as canonical project knowledge
- an ingestion system for non-repo content as canonical Project Memory
- a V1 compatibility project at the cost of the V2 memory model
- a design where detached MCP owns product logic
- a system that depends on fixed embedding free-tier quota; failed embedding work should leave pending chunks or degraded state

## Current Implementation Boundary

The implementation is active and some docs reflect different snapshots. `docs/IMPLEMENTATION_ALIGNMENT.md` is useful for product fit and cautions, but `docs/ROADMAP.md` is the better progress source when status conflicts arise. The stable foundation includes the Bun/TypeScript CLI, runtime helpers, provider abstraction, project layout, schema check/build, detached MCP boundary, Experience Log capture, Session Memory ingest/index/query, and Project Memory learn/apply/retrieval mechanics. The roadmap also records a product-quality reset: mechanically valid Project Memory output is not sufficient unless the rendered markdown is useful, grounded, and answerable for future agents.

Future agents should preserve the central boundary: Project Memory is repo-grounded living documentation; Session Memory is recent project-scoped continuity; candidates and handoffs are leads; Experience Log is evidence; state and indexes serve retrieval but do not become truth.
