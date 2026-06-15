# AGENTS.md

## Purpose

This file is the execution contract for agents operating inside Myelin.

Myelin maintains durable project memory for software repositories: curated markdown wiki pages, raw/source preservation, machine-readable state, freshness signals, inbox items, and query contracts.

Prefer this file over ad hoc phrasing unless the user explicitly overrides it for the current task.

## Developer Quick Start

```bash
# Install dependencies
bun install

# Project/runtime status
make status PROJECT=<key>

# Query project memory
make query PROJECT=<key> QUESTION="What should I know?"

# Build or validate generated schema context
make schema-build PROJECT=<key>
make schema-check PROJECT=<key>

# Broad project-memory refresh, formerly "compile"
make learn PROJECT=<key>

# Drain queued inbox/source items, formerly "update"
make ingest PROJECT=<key>

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
| `update` source/inbox processing | `project ingest <key>` |
| agentic Experience Log to Session Memory processing | `ingest <key>` |
| Session Memory embedding backfill/indexing | `memory index session <key>` |
| `ask` | `memory query <key> "<question>"` |
| `init` | `project onboard <key>` |
| validation-only schema work | `schema check <key>` |
| generated schema-context rebuild | `schema build <key>` |

Do not reintroduce V1-concept Make targets as primary product vocabulary. If a temporary legacy escape hatch is needed, name it explicitly as legacy.

`project ingest <key>` and top-level `ingest <key>` are intentionally different. `project ingest` drains queued source/inbox material through the project-memory pipeline. `ingest` starts a detached provider-backed Experience Log to Session Memory job and returns a durable handle.

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
| `EMBEDDING_PROVIDER`, `EMBEDDING_GEMINI_MODEL`, `EMBEDDING_DIMENSIONS` | Session Memory embedding provider/model/dimension profile. |
| `EMBEDDING_STUB_RESPONSES_DIR` | Use canned embedding responses for deterministic embedding/index tests. |
| `GOOGLE_API_KEY`, `GEMINI_API_KEY` | Gemini embedding credential; `GOOGLE_API_KEY` is preferred, `GEMINI_API_KEY` is accepted as an alias. |
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
- `raw/`: global unclassified intake.
- `concepts/`: cross-project knowledge.
- `stages/`: V2 pipeline stage instruction assets.
- `mcp/`: detached MCP interface boundary.

Do not make `/mcp` part of the root package graph. Core query behavior lives in `src/query/`; detached MCP consumers use the CLI/JSON contract from `myelin memory query --json`.

## Pipeline Development Gotchas

- Codex-backed stages must run with `--sandbox read-only`.
- LLM-stage prompts must require JSON on stdout; do not ask the model to write artifacts directly.
- Top-level `myelin ingest <key>` counts queued Experience Log rows and launches detached target-repo agents according to the ingest runtime profile. Workers create tombstone-backed lease stubs without deleting raw rows before provider output is accepted; terminal commit finalizes tombstones and archives source rows.
- On macOS, sqlite-vec requires a SQLite build that supports loadable extensions. Myelin prefers its vendored SQLite runtime, falls back to Homebrew SQLite, and can be overridden with `MYELIN_SQLITE_DYLIB_PATH`.
- Session Memory vector indexing is explicit operator work: use `myelin memory index session <key> [--limit N] [--retry-failed] [--json]`.
- Session Memory vector retrieval is an internal facade in this slice; MCP exposure, Current Briefing integration, broader `memory query`, and non-Session Memory vectorization are deferred.
- Query must fail closed when schema context is missing or invalid; it should suggest `schema build` or `schema check`.
- `project learn` verifies schema freshness before learning work.
- Inbox lockfiles can strand on hard kills; lockfiles live at `projects/<key>/state/.update.lock`.
- Detached update logs live under `projects/<key>/logs/`.

## System Model

Scope: software repositories only. Do not ingest non-repo content as canonical project memory.

Treat Myelin as four layers:

- `repo/`: implementation truth
- `raw/` and `sources/`: preserved source material
- `wiki/`: synthesized human-readable understanding
- `state/`: machine-readable metadata, routing, provenance, and freshness

Default read priority:

1. `state/`
2. `index.md`
3. `changelog.md` or `log/`
4. relevant `wiki/` pages
5. preserved raw/source files
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
