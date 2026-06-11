# Myelin

Myelin is a local-first project memory system for software repositories.

It keeps durable project knowledge close to the repo: curated wiki pages, source provenance, freshness state, inbox items, and queryable status. The V2 runtime is Bun/TypeScript-first, with the core CLI exposed as `myelin`.

## Quick Start

Install dependencies:

```bash
bun install
```

Run the CLI directly:

```bash
bun src/cli.ts status <project-key>
bun src/cli.ts schema check <project-key>
bun src/cli.ts schema build <project-key>
bun src/cli.ts memory query <project-key> "What should I know?"
bun src/cli.ts project learn <project-key> --dry-run
bun src/cli.ts project ingest <project-key>
```

The root `Makefile` is only a thin convenience layer over the same CLI:

```bash
make status PROJECT=<project-key>
make schema-check PROJECT=<project-key>
make schema-build PROJECT=<project-key>
make query PROJECT=<project-key> QUESTION="What should I know?"
make learn PROJECT=<project-key>
make ingest PROJECT=<project-key>
```

## Command Vocabulary

Myelin V2 uses product-language commands instead of the V1 pipeline names:

| V1/operator habit | V2 command |
| --- | --- |
| `make compile PROJECT=<key>` | `myelin project learn <key>` / `make learn PROJECT=<key>` |
| `make update PROJECT=<key>` | `myelin project ingest <key>` / `make ingest PROJECT=<key>` |
| `ask` / query helpers | `myelin memory query <key> "<question>"` / `make query ...` |
| `make init PROJECT=<key>` | `myelin project onboard <key>` / `make onboard PROJECT=<key>` |
| validate schema context | `myelin schema check <key>` / `myelin schema build <key>` |

The old command names are V1 concepts. Keep them out of new docs and scripts unless a legacy escape hatch is explicitly being discussed.

## Repository Layout

- `src/`: Bun/TypeScript core runtime, CLI commands, query, schema, inbox, and pipeline orchestration.
- `schema/`: global authored schema inputs for generated project schema context.
- `projects/`: curated project memory, state, logs, sources, runs, and wiki pages.
- `raw/`: unclassified global intake.
- `concepts/`: cross-project knowledge.
- `stages/`: V2 pipeline instruction assets.
- `mcp/`: detached MCP interface boundary; it is not part of the root package graph.

## Documentation

Start with `docs/README.md` for the canonical reading path.

The active docs are intentionally small:

- `MYELIN.md` — canonical product design.
- `CONTEXT.md` — glossary and resolved terminology.
- `docs/IMPLEMENTATION_ALIGNMENT.md` — current implementation mapped to the product shape.
- `docs/DONE.md` and `docs/TODO.md` — built inventory and known gaps.

Historical brainstorming, superseded specs, and implementation plans live under `docs/archive/`.

## Runtime And Verification

Use Bun for normal development:

```bash
bun test
bun run typecheck
make test
make typecheck
```

Model-backed workflows use the operator's authenticated vendor CLIs through the provider abstraction. Configure defaults in `myelin.config`; environment variables can still override local config for a run.

## Query And MCP Boundary

Core owns query behavior in `src/query/`. Detached interfaces should consume:

```bash
myelin memory query <project-key> "<question>" --json
```

The JSON response includes `answer`, `confidence`, `memory_scope`, `citations`, `candidate_ids`, `degraded`, `degraded_reason`, and `source_tools`.

The `/mcp` directory remains detached. Do not import root `src/` from `/mcp`, and do not import `/mcp` source from the core runtime.

## Compatibility Contracts

`LLM_WIKI_*` environment variables and the `mcp__llm-wiki__*` MCP tool namespace intentionally keep their existing names for compatibility. Per ADR 0050, these are external/env contracts, not current product naming. The product, CLI, docs, and root config file use **Myelin** and `myelin.config`.

## Status

Myelin is early-stage infrastructure. It favors explicit provenance, local-first operation, human-reviewable project memory, and conservative write workflows over speculative automation.
