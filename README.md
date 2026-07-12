# Myelin

Myelin is a local-first project memory system for software repositories.

It keeps durable project knowledge close to the repo: curated wiki pages, source provenance, freshness state, inbox items, and queryable status. The V2 runtime is Bun/TypeScript-first, with the core CLI exposed as `myelin`.

## Quick Start

From a trusted local clone, install dependencies and preview the machine installation:

```bash
bun install
./install
```

The preview is read-only. Apply it only after reviewing the reported launcher,
locator, provider, and PATH actions:

```bash
./install --apply
```

This copies a stable launcher to `~/.local/bin/myelin`, snapshots the runtime
under `~/.local/share/myelin/versions/`, and records the active immutable
version plus this checkout's durable data root in `~/.myelin/install.json`.
It does not create a symlink. A bare install selects
the sole supported provider detected on the machine. Select Codex explicitly,
or install only the command, with:

```bash
./install --provider codex
./install --provider codex --apply
./install --command-only --apply
```

If the launcher directory is unavailable through PATH, the installer reports
`<absolute-bin-dir> is not on PATH. Add it to your shell PATH before invoking myelin globally.`
Add the reported absolute directory to your shell PATH. The installer never
edits shell profiles.

Use the installed command from any working directory:

```bash
myelin status <project-key>
myelin schema check <project-key>
myelin schema build <project-key>
myelin memory query <project-key> "What should I know?"
myelin memory index session <project-key>
myelin memory maintain project <project-key>
myelin project learn <project-key> --dry-run
myelin ingest <project-key>
myelin ingest status <ingest-job-id>
```

`myelin status --json` emits the stable `myelin.status.v1` operational contract.
An observed `healthy`, `attention`, or `blocked` state exits zero; invocation or
identity failures that prevent construction of the contract exit nonzero.

Re-running `./install` previews repair or version-update work. Each successful
upgrade retains one previous version for rollback and removes older owned
versions. The version identity includes the package version, source revision,
and runtime content digest, so local dirty builds remain distinguishable from
their Git commit. Roll back or remove every inactive version with:

```bash
myelin install --rollback
myelin install --rollback --apply
./install --prune --apply
```

If the durable checkout moved,
preview from the new location and then explicitly rebind it:

```bash
./install
./install --rebind --apply
```

Use `./install --bin-dir /absolute/bin` for a custom launcher directory on the
initial install. A recorded installation will not silently move its launcher to
a different bin directory.

Uninstall is also preview-first. Provider-only removal preserves the launcher
and locator; full removal deletes all recorded Myelin-owned provider artifacts,
the copied launcher, locator, and manifest-owned runtime versions while preserving the checkout, config,
memory, state, and unrelated provider hooks:

```bash
myelin uninstall --provider codex
myelin uninstall --provider codex --apply
myelin uninstall
myelin uninstall --apply
```

## Contributor Source Usage

Contributors working inside this checkout may bypass the installed launcher
explicitly:

```bash
bun src/cli.ts status <project-key>
bun src/cli.ts memory query <project-key> "What should I know?"
```

The root `Makefile` remains a checkout-local convenience layer. It uses the
installed command by default and accepts an explicit source override:

```bash
make status PROJECT=<project-key>
make schema-check PROJECT=<project-key>
make schema-build PROJECT=<project-key>
make query PROJECT=<project-key> QUESTION="What should I know?"
make learn PROJECT=<project-key>
make ingest PROJECT=<project-key>
make status PROJECT=<project-key> MYELIN='bun src/cli.ts'
```

## Command Vocabulary

Myelin V2 uses product-language commands instead of the V1 pipeline names:

For the exhaustive command reference, including arguments, options, side effects, and examples, see `docs/CLI.md`.

| V1/operator habit | V2 command |
| --- | --- |
| `make compile PROJECT=<key>` | `myelin project learn <key>` / `make learn PROJECT=<key>` |
| `make update PROJECT=<key>` | `myelin ingest <key>` / `make ingest PROJECT=<key>` |
| Experience Log to Session Memory ingest | `myelin ingest <key>` / `myelin ingest status <ingest-job-id>` |
| Session Memory embedding index/backfill | `myelin memory index session <key> [--limit N] [--retry-failed] [--json]` |
| Project Memory candidate maintenance after bootstrap | `myelin memory maintain project <key> [--json]` |
| Review neutral terminal memory outcomes | `myelin memory review <key> [--json]` |
| `ask` / query helpers | `myelin memory query <key> "<question>"` / `make query ...` |
| `make init PROJECT=<key>` | `myelin project onboard <key>` / `make onboard PROJECT=<key>` |
| validate schema context | `myelin schema check <key>` / `myelin schema build <key>` |

The old command names are V1 concepts. Keep them out of new docs and scripts unless a legacy escape hatch is explicitly being discussed.

Top-level `ingest <key>` batches queued Experience Log rows by `INGEST_BATCH_SIZE` and launches one detached target-repo agent per batch. The default batch size is `100`; the maximum accepted batch size is `500`.

When `AUTO_PROJECT_MEMORY_MAINTENANCE=1`, runtime inbox writes and Session Memory ingest-created project candidates schedule detached Project Memory maintenance after `AUTO_PROJECT_MEMORY_MIN_PENDING_ITEMS` un-intaked inbox items or pending project candidates exist.

Session Memory vector retrieval is currently an internal facade. MCP exposure, Current Briefing consumption, broader `memory query` changes, and non-Session Memory vectorization are deferred follow-up work.

## Repository Layout

- `src/`: Bun/TypeScript core runtime, CLI commands, query, schema, inbox, and pipeline orchestration.
- `schema/`: global authored schema inputs for generated project schema context.
- `projects/`: curated project memory, state, logs, sources, runs, and wiki pages.
- `state/`: generated SQLite serving state; ignored, not curated truth.
- `docs/`: current product docs, ADRs, and historical archives.
- `.tasks/`: roadmap task stubs, not implementation plans.
- `tests/`: Bun test coverage for runtime, memory, project, schema, query, and command behavior.
- `vendor/`: vendored runtime dependencies such as the macOS SQLite library.

## Documentation

Start with `docs/README.md` for the canonical reading path.

The active docs are intentionally small:

- `MYELIN.md` — canonical product design.
- `CONTEXT.md` — glossary and resolved terminology.
- `docs/IMPLEMENTATION_ALIGNMENT.md` — current implementation mapped to the product shape.
- `docs/ROADMAP.md` — canonical implementation checklist and next step.

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

Embedding-backed indexing defaults to `EMBEDDING_PROVIDER=auto`: Myelin tries local `nomic-embed-text:v1.5` through Ollama first, local `qwen3-embedding:4b` second, then Google. Each provider owns its model and dimensions; all three defaults are 768 dimensions. Ollama requests use `keep_alive: "0"`, unloading the model after each probe or embedding batch; the next operation initializes it again. Configure `EMBEDDING_NOMIC_*`, `EMBEDDING_QWEN_*`, `EMBEDDING_GEMINI_*`, and `EMBEDDING_OLLAMA_URL` to override provider contracts. Google reads `GOOGLE_API_KEY` from `.env` or the process environment; `GEMINI_API_KEY` is accepted as a compatibility alias. Set `EMBEDDING_PROVIDER=ollama_nomic`, `ollama_qwen`, or `gemini` to disable automatic fallback. Running the matching memory index command rebuilds a dimension-mismatched derived vector table and requeues previously indexed rows for the selected contract.

On macOS, SQLite extension loading requires a non-Apple SQLite build. Myelin prefers its vendored SQLite runtime, falls back to Homebrew SQLite at `/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib` or `/usr/local/opt/sqlite/lib/libsqlite3.dylib`, and accepts `MYELIN_SQLITE_DYLIB_PATH` or `SQLITE_DYLIB_PATH` overrides.

## Query And MCP Boundary

Core owns query behavior in `src/query/`. Detached interfaces should consume:

```bash
myelin memory query <project-key> "<question>" --json
```

The JSON response includes `answer`, `confidence`, `memory_scope`, `citations`, `candidate_ids`, `degraded`, `degraded_reason`, and `source_tools`.

MCP implementations are detached from the root package graph. Do not import root `src/` from a local MCP checkout, and do not import MCP source from the core runtime.

## Compatibility Contracts

`LLM_WIKI_*` environment variables and the `mcp__llm-wiki__*` MCP tool namespace intentionally keep their existing names for compatibility. Per ADR 0050, these are external/env contracts, not current product naming. The product, CLI, docs, and root config file use **Myelin** and `myelin.config`.

## Status

Myelin is early-stage infrastructure. It favors explicit provenance, local-first operation, human-reviewable project memory, and conservative write workflows over speculative automation.
