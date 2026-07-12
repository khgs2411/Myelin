# AGENTS.md

## Purpose

This file is the execution contract for agents operating inside Myelin.

Myelin maintains durable project memory for software repositories: curated markdown wiki pages, source-evidence preservation, machine-readable state, freshness signals, inbox items, and query contracts.

Prefer this file over ad hoc phrasing unless the user explicitly overrides it for the current task.

## Developer Quick Start

```bash
# Install dependencies
bun install

# Preview/apply immutable machine runtime installation
./install
./install --apply

# Roll back or prune inactive managed runtime versions
myelin install --rollback --apply
./install --prune --apply

# Project/runtime status
make status PROJECT=<key>

# Query project memory
make query PROJECT=<key> QUESTION="What should I know?"

# Build or validate generated schema context
make schema-build PROJECT=<key>
make schema-check PROJECT=<key>

# Broad project-memory refresh, formerly "compile"
make learn PROJECT=<key>

# Process queued Experience Log rows into Session Memory
make ingest PROJECT=<key>

# Maintain already-curated Project Memory from runtime inbox and candidates
bun src/cli.ts memory maintain project <key>

# Review neutral terminal memory outcomes for operator follow-up
bun src/cli.ts memory review <key>

# Index pending Session Memory embeddings
bun src/cli.ts memory index session <key>

# Tests and typecheck
bun test
bun run typecheck
```

The Makefile is a thin alias layer. New automation should call `myelin` vocabulary through `bun src/cli.ts` or the `myelin` binary, not V1 command names.

## V2 Command Vocabulary

| Old V1 concept | Myelin V2 command |
| --- | --- |
| `compile` | `project learn <key>` |
| Project Memory bootstrap/create-or-maintain | `project learn <key>` |
| Project Memory post-bootstrap candidate maintenance | `memory maintain project <key>` |
| agentic Experience Log to Session Memory processing | `ingest <key>` |
| Session Memory embedding backfill/indexing | `memory index session <key>` |
| `ask` | `memory query <key> "<question>"` |
| `init` | `project onboard <key>` |
| validation-only schema work | `schema check <key>` |
| generated schema-context rebuild | `schema build <key>` |

Do not reintroduce V1-concept Make targets as primary product vocabulary. If a temporary legacy escape hatch is needed, name it explicitly as legacy.

There is no active `project ingest <key>` command. `project learn <key>` runs deterministic Project Memory runtime-inbox intake before packet construction. Top-level `ingest <key>` starts a detached provider-backed Experience Log to Session Memory job and returns a durable handle.

## Environment And Config

Root config is `myelin.config`.

Important runtime variables:

| Var | Effect |
| --- | --- |
| `DEFAULT_PROVIDER=codex` / `claude` | Default provider when no override is passed. |
| `MODEL=codex/<id>` / `claude/<id>` / `<codex-model>` | Per-run model selector. |
| `MODEL_REASONING_EFFORT=<tier>` | Codex reasoning override. |
| `PIPELINE_CODEX_MODEL`, `QUERY_CODEX_MODEL` | Workload model profiles. |
| `PIPELINE_CLAUDE_MODEL`, `QUERY_CLAUDE_MODEL` | Workload model profiles. |
| `INGEST_BATCH_SIZE` | Experience Log rows assigned to each detached ingest agent; max 500, default 100. |
| `EMBEDDING_PROVIDER`, `EMBEDDING_NOMIC_MODEL`, `EMBEDDING_NOMIC_DIMENSIONS`, `EMBEDDING_QWEN_MODEL`, `EMBEDDING_QWEN_DIMENSIONS`, `EMBEDDING_GEMINI_MODEL`, `EMBEDDING_GEMINI_DIMENSIONS`, `EMBEDDING_OLLAMA_URL`, `EMBEDDING_BATCH_SIZE` | Embedding profiles. `auto` tries Ollama Nomic, Ollama Qwen, then Google; each provider owns its dimensions. |
| `EMBEDDING_STUB_RESPONSES_DIR` | Use canned embedding responses for deterministic embedding/index tests. |
| `GOOGLE_API_KEY`, `GEMINI_API_KEY` | Gemini embedding credential; `GOOGLE_API_KEY` is preferred, `GEMINI_API_KEY` is accepted as an alias. |
| `AUTO_MEMORY_MAINTENANCE`, `AUTO_MEMORY_MIN_CAPTURED_EVENTS`, `AUTO_MEMORY_COOLDOWN_MS`, `AUTO_MEMORY_DRAIN_POLL_INTERVAL_MS`, `AUTO_MEMORY_DRAIN_TIMEOUT_MS`, `AUTO_MEMORY_INDEX_LIMIT` | Optional hook-triggered Session Memory maintenance scheduler. When enabled, capture schedules a detached worker that runs Experience Log ingest and Session Memory indexing after enough queued captured events. |
| `AUTO_PROJECT_MEMORY_MAINTENANCE`, `AUTO_PROJECT_MEMORY_MIN_PENDING_ITEMS`, `AUTO_PROJECT_MEMORY_COOLDOWN_MS` | Optional Project Memory maintenance scheduler. When enabled, runtime inbox writes and Session Memory ingest-created project candidates schedule detached Project Memory maintenance after enough un-intaked inbox items or pending project candidates exist. |
| `MYELIN_SQLITE_DYLIB_PATH`, `SQLITE_DYLIB_PATH` | Optional SQLite dynamic library path override for extension loading; Myelin uses its vendored runtime when available. |
| `LLM_STUB_RESPONSES_DIR=<path>` | Use canned LLM responses for deterministic tests. |
| `UPDATE_PROJECTS_ROOT`, `UPDATE_ARTIFACTS_ROOT`, `UPDATE_STAGES_ROOT` | Test/runtime root overrides. |
| `CODEX_BIN`, `CLAUDE_BIN` | Override vendor CLI binary paths. |

`LLM_WIKI_*` variables and the `mcp__llm-wiki__*` MCP tool namespace are compatibility/env contracts kept unchanged under ADR 0050. They are not Myelin product naming.

`myelin.config` is loaded first, `.env` is loaded second for local secrets, and process environment variables override both.

## Repo Layout

- `src/`: Bun/TypeScript core runtime, CLI commands, schema, query, inbox, and pipeline orchestration.
- `schema/`: global authored schema inputs.
- `projects/<key>/`: project memory, wiki pages, state, sources, logs, and runs.
- `state/`: generated SQLite serving state; ignored, not curated truth.
- `docs/`: current product docs, ADRs, and historical archives.
- `.tasks/`: roadmap task stubs, not implementation plans.
- `tests/`: Bun test coverage.
- Detached MCP consumers use the CLI/JSON contract; MCP implementation source is not part of the root package graph.

Do not make a local MCP checkout part of the root package graph. Core query behavior lives in `src/query/`; detached MCP consumers use the CLI/JSON contract from `myelin memory query --json`.

## Pipeline Development Gotchas

- Codex-backed stages must run with `--sandbox read-only`.
- LLM-stage prompts must require JSON on stdout; do not ask the model to write artifacts directly.
- Top-level `myelin ingest <key>` counts queued Experience Log rows and launches detached target-repo agents according to the ingest runtime profile. Workers create tombstone-backed lease stubs without deleting raw rows before provider output is accepted; terminal commit finalizes tombstones and archives source rows.
- Optional auto Session Memory maintenance is scheduled from capture hooks only after the Experience Log row is stored. Ordinary events use the configured threshold and cooldown; `SessionStart` forces a bounded drain of leftover rows so a short prior session is not stranded below threshold. Hooks do not run ingest or indexing synchronously. Codex `Stop` means assistant turn complete, not session end.
- Optional auto Project Memory maintenance is scheduled only when runtime inbox items are created or Session Memory ingest creates project-scoped candidates. Project inbox intake itself must not schedule auto maintenance, because inbox intake is the first stage of the Project Memory maintenance job.
- On macOS, sqlite-vec requires a SQLite build that supports loadable extensions. Myelin prefers its vendored SQLite runtime, falls back to Homebrew SQLite, and can be overridden with `MYELIN_SQLITE_DYLIB_PATH`.
- Session Memory vector indexing is explicit operator work: use `myelin memory index session <key> [--limit N] [--batch-size N] [--retry-failed] [--json]`.
- `memory query <key> "<question>"` is the future multi-layer query facade; in the current slice it queries indexed Session Memory vectors only and uses cached query embeddings.
- Session Memory vector retrieval requires indexed rows from `myelin memory index session <key>` and fails closed when sqlite-vec, credentials, or the vector index are unavailable. MCP exposure, Current Briefing integration, and non-Session Memory vectorization are deferred.
- `project learn` verifies schema freshness before learning work.
- Inbox lockfiles can strand on hard kills; lockfiles live at `projects/<key>/state/.update.lock`.
- Detached update logs live under `projects/<key>/logs/`.

## System Model

Scope: software repositories only. Do not ingest non-repo content as canonical project memory.

Treat Myelin as four layers:

- `repo/`: implementation truth
- source evidence and `sources/`: preserved source material
- `wiki/`: synthesized human-readable understanding
- `state/`: machine-readable metadata, routing, provenance, and freshness

Default read priority:

1. `state/`
2. `index.md`
3. `changelog.md` or `log/`
4. relevant `wiki/` pages
5. preserved source evidence
6. repo files where verification or implementation requires them

## Non-Negotiable Rules

Always:

- preserve provenance for meaningful updates
- prefer updating canonical pages over creating new pages
- keep source material separate from synthesized knowledge
- mark uncertainty when knowledge is incomplete or stale
- leave reusable session memory after meaningful work

Never:

- treat conversation history as canonical project knowledge
- silently discard inbox items
- rewrite or delete preserved source files during ingestion
- present stale wiki content as verified fact
- create speculative architecture claims without a source or explicit inference label
- create durable pages when an existing canonical page should be updated instead

## Source Processing

Before integrating any new source, decide:

- `source_kind`
- `ownership`
- `destination`
- `update_targets`
- `action`

Allowed `action` values are `update-existing-pages`, `create-new-page-and-update-index`, `log-only`, `reject`, and `needs-review`.

When a source is consumed:

1. classify it
2. preserve the original
3. update the smallest canonical surface that makes the knowledge reusable
4. update state/provenance metadata
5. append a changelog or log entry
6. leave a terminal source status

## Wiki Writing Rules

- Separate sourced facts from inferred synthesis.
- Keep summaries compact and reusable.
- Prefer concrete statements over vague prose.
- Preserve contradictions instead of smoothing them away.
- Ground claims with concrete file-path citations when possible.
- Do not add YAML frontmatter or wiki-construction narration to wiki pages.
- Open wiki pages with a one-sentence description of the subject.

## Escalation Rules

Proceed without confirmation for reads, searches, classification, metadata updates, stale marking, routine session summaries, and narrowly scoped implementation work.

Ask before high-impact multi-page rewrites, decision-record changes, ambiguous ownership choices, rejecting potentially useful sources, deleting preserved sources, or reorganizing canonical page structure.

## Success Condition

A good run leaves the repository easier to understand in the next session than it was before this session started.
