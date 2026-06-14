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
bun src/cli.ts memory index session <project-key>
bun src/cli.ts project learn <project-key> --dry-run
bun src/cli.ts project ingest <project-key>
bun src/cli.ts ingest <project-key>
bun src/cli.ts ingest status <ingest-job-id>
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
| Experience Log to Session Memory ingest | `myelin ingest <key>` / `myelin ingest status <ingest-job-id>` |
| Session Memory embedding index/backfill | `myelin memory index session <key> [--limit N] [--retry-failed] [--json]` |
| `ask` / query helpers | `myelin memory query <key> "<question>"` / `make query ...` |
| `make init PROJECT=<key>` | `myelin project onboard <key>` / `make onboard PROJECT=<key>` |
| validate schema context | `myelin schema check <key>` / `myelin schema build <key>` |

The old command names are V1 concepts. Keep them out of new docs and scripts unless a legacy escape hatch is explicitly being discussed.

`project ingest <key>` processes queued source/inbox material through the project-memory pipeline. Top-level `ingest <key>` starts a detached provider-backed Experience Log to Session Memory job and returns a durable handle.

Top-level `ingest <key>` batches queued Experience Log rows by `INGEST_BATCH_SIZE` and launches one detached target-repo agent per batch. The default batch size is `100`; the maximum accepted batch size is `500`.

Session Memory vector retrieval is currently an internal facade. MCP exposure, Current Briefing consumption, broader `memory query` changes, and non-Session Memory vectorization are deferred follow-up work.

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

Embedding-backed Session Memory indexing reads `GOOGLE_API_KEY` from `.env` or the process environment. `GEMINI_API_KEY` is accepted as a compatibility alias.

On macOS, SQLite extension loading requires a non-Apple SQLite build. Myelin prefers its vendored SQLite runtime, falls back to Homebrew SQLite at `/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib` or `/usr/local/opt/sqlite/lib/libsqlite3.dylib`, and accepts `MYELIN_SQLITE_DYLIB_PATH` or `SQLITE_DYLIB_PATH` overrides.

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
