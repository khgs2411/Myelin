# Myelin Global Schema

The global schema layer — the product-wide instructions and typed rules that teach agents how to maintain Myelin. Project-local schema, overrides, and schema candidates are target design deferred past Phase 0 (ADR 0049); this slice ships global rules only.

## What lives here

- `global.md` — this guidance (human- and agent-readable intent).
- `rules/*.json` — hand-authored typed rules, validated by Zod and compiled into `projects/<key>/state/schema-context.json` (shape in `schema-context.md`).

## Typed rules (Phase 0)

- `rules/source-classification.json` — the fields and enums every ingested source must resolve to before integration.
- `rules/memory-scopes.json` — the scopes a query result may draw from; mirrors the MCP facade `memory_scope`.
- `rules/page-taxonomy.json` — wiki page categories, organized by compounding knowledge value rather than source-code shape. These supersede the V1 `wiki/{architecture,systems,modules,...}` folders; the Task-5 migration maps old pages into these categories.

## Provenance (guidance)

Durable wiki/state writes must carry traceable provenance: concrete `file_path:line` citations, commit/state pointers, source snippets, or an explicit inference label. Do not present stale content as verified fact.

## CLI vocabulary (guidance)

Operator verbs: `bootstrap`, `project learn|ingest`, `memory query`, `status`, `schema check|build`, `session close`. `schema candidates|apply` are deferred (ADR 0049). Old `compile`/`update`/`ask` names are not the product vocabulary.

> Source-classification guidance originated in the former root `schemas/source-classification.md` (now removed). It is captured here and as typed rules in `schema/rules/source-classification.json`.
