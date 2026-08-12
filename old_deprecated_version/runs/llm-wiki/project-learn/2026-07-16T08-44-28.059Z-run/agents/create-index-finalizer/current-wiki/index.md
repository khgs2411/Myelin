# Myelin

Myelin is a local-first project memory system for software repositories: it preserves source evidence, curates Project Memory as markdown, keeps serving and workflow state in SQLite and state files, and exposes operator workflows through the `myelin` CLI.

## Current orientation

The public product boundary is the CLI and its JSON contracts. Core behavior lives in Bun/TypeScript under `src/`; detached MCP consumers must use the CLI/JSON boundary rather than importing core source. Project Memory is canonical markdown under `projects/<key>/`; SQLite is generated serving state for Session Memory, ingest, retrieval, and workflow queues.

The repository snapshot does not include the required sanitized `repository-identity.json` checkout evidence. Consequently, this orientation makes no assertion about the checkout's remote, branch, or repository identity. The runtime itself publishes that artifact after create/recreate Project Memory runs, but its current snapshot contents could not be verified.

## Canonical pages

- [Product model and storage boundaries](product-model.md) — memory layers, provenance, canonical versus derived state, and detached integrations.
- [CLI and JSON interfaces](cli-and-json-contracts.md) — registered commands, stable machine-readable outputs, argument validation, and compatibility names.
- [Project Memory lifecycle](project-memory-lifecycle.md) — bootstrap, learn, creation/maintenance modes, publication, and reset boundaries.
- [Experience Log ingest and Session Memory](ingest-and-session-memory.md) — detached ingest, leases/tombstones, memory rows, candidates, and reconciliation.
- [Retrieval and embedding lifecycle](retrieval-and-embedding-lifecycle.md) — layer selection, indexing, contract migrations, rollback, and protected pruning.
- [Schema and runtime inbox workflows](schema-and-runtime-inbox.md) — schema context, preserved inbox sources, and deterministic candidate intake.
- [Installation and capture integration](installation-and-capture.md) — immutable runtime installation, machine locator, provider hooks, and safe removal.
- [Status and maintenance operations](status-and-maintenance.md) — operational status, automatic maintenance scheduling, workers, and review queues.
- [Behavior states and gate precedence](behavior-states-and-gates.md) — supported enums, observable states, and guard ordering.
- [Destructive operations](destructive-operations.md) — reset, uninstall, rollback, prune, and their confirmation/protection rules.

## Evidence basis and coverage limits

This map is grounded in current command registration and implementation contracts, with regression tests in `tests/commands/`, `tests/ingest/`, `tests/memory/`, `tests/install/`, and `tests/status/`. Historical design documents explain intent only and are not the sole basis of the mapped behavior. The coverage report records the missing identity artifact and areas where end-to-end provider or concurrency coverage is not demonstrated by the inspected tests.
