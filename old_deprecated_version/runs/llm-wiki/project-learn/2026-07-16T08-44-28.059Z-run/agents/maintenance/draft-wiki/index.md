# Myelin

Myelin is a local-first memory system for software repositories: it preserves source evidence, curates Project Memory as Markdown, and uses SQLite and state files for serving and workflow state. This canonical documentation describes the `llm-wiki` repository; [repository identity](../repository-identity.json) records the deterministic checkout evidence.

## Start here

The CLI and its JSON contracts are the public operator and detached-integration boundary. Repository code is implementation truth; canonical Project Memory lives under `projects/<key>/`, while preserved sources, machine state, and run artifacts remain separate.

## Canonical documentation

- [Product model and storage boundaries](product-model.md) — memory layers, provenance, canonical Markdown, derived state, and integration boundaries.
- [CLI and JSON interfaces](cli-and-json-contracts.md) — registered commands, machine-readable contracts, validation, and compatibility names.
- [Project Memory lifecycle](project-memory-lifecycle.md) — bootstrap, learning modes, packets, publication, layout migration, and project-shell reset.
- [Experience Log ingest and Session Memory](ingest-and-session-memory.md) — capture, detached ingest, tombstone-backed evidence, Session Memory, candidates, handoffs, and manual sessions.
- [Retrieval and embedding lifecycle](retrieval-and-embedding-lifecycle.md) — query layers, retrieval freshness, indexing, embedding contracts, migration, rollback, and pruning.
- [Schema and runtime inbox workflows](schema-and-runtime-inbox.md) — global schema context, immutable inbox sources, candidate intake, and Project Memory maintenance.
- [Installation and capture integration](installation-and-capture.md) — preview-first installation, immutable runtime versions, Codex hooks, and safe removal.
- [Status and maintenance operations](status-and-maintenance.md) — operational status, review, detached workers, recovery, and automatic scheduling.
- [Behavior states and gate precedence](behavior-states-and-gates.md) — lifecycle enums, retrieval and status states, and validation/protection ordering.
- [Destructive operations](destructive-operations.md) — reset, installation removal, rollback, pruning, and failed-job resolution safeguards.
