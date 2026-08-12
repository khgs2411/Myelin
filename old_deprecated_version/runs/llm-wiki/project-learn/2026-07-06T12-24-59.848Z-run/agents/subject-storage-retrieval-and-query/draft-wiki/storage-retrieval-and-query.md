# Storage Retrieval And Query

Storage retrieval in Myelin is rooted in a single SQLite state database, with separate metadata and vector paths for Session Memory and Project Memory.

## Root SQLite State

The root state database lives at `state/memory.db`. `src/memory/db.ts` resolves that path, creates `state/` when needed, opens Bun SQLite, sets `busy_timeout`, enables WAL and foreign keys, and runs migrations before returning the handle.

`src/memory/migrations.ts` is the durable schema authority. The relevant retrieval tables are:

- `session_memories`, `session_memory_contexts`, and `session_memory_links` for agent-derived continuity records and branch-aware context.
- `session_memory_embeddings` for Session Memory embedding metadata.
- `project_memory_retrieval_embeddings` for Project Memory section-level embedding metadata.
- `query_embedding_cache` for normalized query embeddings reused by both retrieval layers.
- `retrieval_maintenance_queue` for project retrieval repair work such as hint refresh, index repair, poor retrieval feedback, and missing expected hits.
- `project_memory_hint_jobs` for generated Project Memory retrieval hint work.

SQLite runtime selection is part of retrieval correctness. `src/memory/sqlite-runtime.ts` calls `Database.setCustomSQLite()` once, preferring `MYELIN_SQLITE_DYLIB_PATH`, then `SQLITE_DYLIB_PATH`, then the same keys from `.env` or `myelin.config`, then the vendored runtime when available. `vendor/sqlite/README.md` explains the current Apple Silicon vendored SQLite runtime: it exists so `sqlite-vec` can load on macOS where Apple's system SQLite disables loadable extensions.

## Vector Storage And Degraded Availability

`src/memory/sqlite-vec.ts` owns the sqlite-vec boundary. It loads the extension through a small adapter, reports `{ available: false, reason }` when loading fails, and only then creates virtual vector tables:

- `session_memory_vec` stores Session Memory vectors partitioned by `project_key`.
- `project_memory_section_vec` stores Project Memory section vectors partitioned by `project_key`.

Search functions filter by project, model, dimensions, purpose, and embedding format version. Project Memory vector search also requires the corresponding row in `project_memory_retrieval_embeddings` to still have `status = 'indexed'`.

The design intentionally fails closed. Indexers mark selected rows failed when vector storage is unavailable, and query services return degraded results rather than synthesizing an answer from stale or missing vector infrastructure.

## Embedding Contracts And Query Cache

Embedding configuration comes from `src/runtime/config.ts`. The default contract uses Gemini embeddings, model `gemini-embedding-2`, 1536 dimensions, `formatVersion = 1`, and purpose-specific values:

- `retrieval_document` for stored memory and wiki section embeddings.
- `retrieval_query` for user questions.

`src/memory/embedding-provider-factory.ts` creates a stub provider when `EMBEDDING_STUB_RESPONSES_DIR` is configured; otherwise it creates the Gemini embedding provider using `GOOGLE_API_KEY` or `GEMINI_API_KEY`.

`src/memory/query-embedding-cache.ts` normalizes questions by trimming, collapsing whitespace, and lowercasing. Cache identity includes project key, normalized question, provider, model, dimensions, purpose, and format version. Cache hits update hit count and timestamps; cache misses call the provider and persist the query embedding JSON. Empty normalized questions and dimension mismatches are hard errors.

## Session Memory Indexing And Query

Session Memory embedding rows are created and tracked in `session_memory_embeddings` through `src/memory/session-memory-embeddings.ts`. Each row is keyed by `session_memory_id` plus the active embedding contract. Pending rows can be requeued with `ensurePendingSessionMemoryEmbedding`; indexed rows retain a normalized text hash, and failed rows retain a failure reason and retry count.

`src/memory/session-memory-indexer.ts` indexes Session Memory:

1. Select pending rows for the project and active document contract. `--retry-failed` includes failed rows.
2. Ensure `session_memory_vec` is available.
3. Load the active `session_memories` row.
4. Normalize the memory text with `src/memory/session-memory-text.ts`.
5. Embed in batches when the provider supports batch embedding.
6. Upsert the vector row and mark metadata indexed in one transaction.

Indexing returns counts for selected, indexed, failed, pending remaining, batch size, failures, and whether the run degraded.

`src/memory/session-memory-query.ts` queries Session Memory:

1. Count indexed and pending active embedding rows for the project and contract.
2. Ensure sqlite-vec storage is available.
3. If no indexed rows exist, return a degraded result. Pending rows produce the operator hint `run myelin memory index session`; zero pending rows report that no indexed rows exist.
4. Create or reuse a `retrieval_query` embedding from `query_embedding_cache`.
5. Search `session_memory_vec`, hydrate rows from `session_memories`, and apply optional filters for memory kind, lifecycle status, and branch context.

Hydrated matches include payload JSON, source event refs, branch contexts, timestamps, and vector distance. The default status filter is active Session Memory.

## Project Memory Retrieval Indexing

Project Memory retrieval is section-based. `src/project/project-memory-markdown-sections.ts` scans `projects/<key>/wiki/**/*.md`, computes page metadata, extracts headings, builds deterministic `section_id` values from heading paths, computes section hashes from heading path and normalized body text, and writes a generated manifest to `projects/<key>/state/project-memory-retrieval/sections.json`.

`src/memory/project-memory-retrieval-indexer.ts` indexes only structural sections below the page title (`heading_level > 1`). This is intentional: top-level page overview/body text is not embedded as a separate retrieval target. For each indexable section it:

1. Extracts the current markdown section manifest and writes it to state.
2. Validates Project Memory retrieval hints against the manifest.
3. Ensures a pending `project_memory_retrieval_embeddings` row keyed by project, wiki path, section id, section hash, hint hash, and embedding contract.
4. Marks previous rows stale when the same section now has a different hash, or orphaned when the section no longer exists.
5. Ensures `project_memory_section_vec` is available.
6. Normalizes section text with `src/memory/project-memory-retrieval-text.ts`, including page title, category, heading path, section text, and valid hints.
7. Embeds sections, upserts vectors, and marks retrieval metadata indexed with a `sha256:` normalized text hash.

The index result reports structural section count, valid/stale/orphaned hint counts, selected/indexed/failed counts, pending remaining, batch size, degraded status, degraded reason, and per-section failures.

`src/memory/project-memory-retrieval-index-service.ts` is the root-facing service wrapper. It loads config, selects the active document embedding contract, creates the embedding provider, opens the root memory DB when one is not injected, and delegates to the indexer.

## Project Memory Query And Markdown Resolution

`src/query/project-memory-query-service.ts` retrieves Project Memory through vector rows but resolves final answers back to canonical markdown.

The query flow is:

1. Count indexed and pending `project_memory_retrieval_embeddings` rows.
2. Ensure sqlite-vec storage is available.
3. Return degraded if no indexed rows exist. Pending rows produce the operator hint `run myelin memory index project`; no pending rows report that the index has no indexed rows.
4. Create or reuse a `retrieval_query` embedding from `query_embedding_cache`.
5. Search `project_memory_section_vec`.
6. Hydrate matching retrieval rows from SQLite.
7. Re-extract current markdown sections and compare each hit with the current canonical section.

Project Memory matches are returned as either:

- `inline_content`, when the current markdown section exists, the hash still matches the indexed row, and `body_text.length <= max_inline_chars`.
- `reference`, when content is too large, the hash is stale, the markdown section is missing, or the vector row cannot be hydrated.

Reference-only matches preserve canonical citations such as `project_memory:wiki/setup/index.md#setup`. Stale hash and missing markdown references mark the query result degraded, because the vector hit cannot safely be treated as current inline knowledge.

## Facade And CLI Behavior

`src/query/engine.ts` is the root query entrypoint. It loads config, selects the document embedding contract, creates the embedding provider, optionally resolves `--branch current` through the registered target repo, opens `state/memory.db`, and delegates to `MemoryQueryService`.

`src/query/memory-query-service.ts` keeps Session Memory and Project Memory result shapes separate:

- Default and `--layer session` route to Session Memory.
- `--layer project` routes to Project Memory.
- `--layer auto` is accepted by CLI parsing but currently behaves like the default Session Memory route because `MemoryQueryService.query()` only special-cases `project`.

The deterministic response service does not call an answer-synthesis LLM. It builds an answer string from matches, computes confidence from vector distance, emits citations, and can include layer diagnostics when `--debug` is requested.

`src/commands/memory.ts` wires the operator commands:

- `myelin memory query <key> <question> [--limit N] [--layer session|project|auto] [--max-inline-chars N] [--branch current|<name>] [--json] [--debug]`
- `myelin memory index session <key> [--limit N] [--batch-size N] [--retry-failed] [--json]`
- `myelin memory index project <key> [--limit N] [--batch-size N] [--retry-failed] [--json]`

`docs/CLI.md` still describes `memory query` primarily as Session Memory retrieval; the command implementation and tests now also cover `--layer project` and `memory index project`.

## Retrieval Maintenance Queue

`src/memory/retrieval-maintenance-queue.ts` stores repair work for Project Memory retrieval only. Items have `target_layer = 'project'`, status lifecycle `pending`, `claimed`, `processed`, `rejected`, or `failed`, and kind values:

- `hint_refresh`
- `index_repair`
- `poor_retrieval_feedback`
- `missing_expected_hit`

Queue entries dedupe by project, kind, sorted wiki refs, query context, and feedback. Pending, claimed, and failed duplicates reuse the existing item instead of creating another row.

## Tested Contracts

Focused tests under `tests/memory/` and `tests/query/` cover the current contracts:

- `tests/memory/db.test.ts`, `sqlite-runtime.test.ts`, and `sqlite-vec.test.ts` cover database setup, custom SQLite runtime selection, and vector table behavior.
- `tests/memory/session-memory-indexer.test.ts`, `session-memory-query.test.ts`, and `query-embedding-cache.test.ts` cover Session Memory indexing, degraded query behavior, branch/status filtering, and query cache reuse.
- `tests/memory/project-memory-retrieval-storage.test.ts`, `project-memory-retrieval-indexer.test.ts`, and `project-memory-retrieval-text.test.ts` cover Project Memory retrieval row identity, stale/orphaned status, hint inclusion, top-level-heading exclusion, and unavailable vector storage.
- `tests/query/project-memory-query-service.test.ts` verifies current markdown hydration, sectioned storage questions, too-large reference returns, stale-hash degradation, and missing-markdown degradation.
- `tests/query/memory-query-service.test.ts` verifies deterministic facade responses and keeps Project Memory matches separate from Session Memory matches.
- `tests/commands/memory.test.ts` verifies `memory query --layer project` JSON shape and `memory index project` command output.

## Known Gaps And Cautions

- `--layer auto` is parsed but not a true multi-layer router yet; it falls through to Session Memory behavior unless the caller explicitly chooses `--layer project`.
- `docs/CLI.md` lags the command implementation for Project Memory query/index options.
- Project Memory query returns deterministic retrieved content or references; it does not synthesize a final natural-language answer from multiple Project Memory sections.
- Retrieval maintenance queue storage exists, but this subject did not find an automated repair worker that consumes all queue kinds end to end.
- sqlite-vec availability remains a runtime dependency. When the extension or compatible SQLite runtime is missing, indexing and query correctly degrade rather than falling back to an alternate vector implementation.
