# Storage, SQLite, and Retrieval Indexes

Myelin stores runtime memory state in a repo-root SQLite database and uses retrieval indexes as rebuildable serving state over trusted memory records and canonical Project Memory markdown.

## Root SQLite State

The root database is `state/memory/memory.db`, opened through `src/memory/db.ts`. `memoryDbPath(root)` resolves that path under the repository root, and `openMemoryDb(root)` creates `state/` as needed, configures Bun SQLite, opens the database, applies pragmas, and runs migrations. The connection setup uses:

- `PRAGMA busy_timeout = 10000`
- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = ON`

`openMemoryDbAt(path)` supports `:memory:` and explicit file paths for tests. File-backed opens retry database-lock failures up to 25 times with a short synchronous backoff before surfacing the last error. This makes SQLite the shared serving substrate without forcing every caller to implement lock retry behavior.

ADR 0001 (`docs/adr/0001-root-sqlite-memory-db.md`) defines the boundary: V2 memory uses one repo-root SQLite database partitioned by `project_key`. Project wiki and state files remain the durable human-reviewable artifacts; SQLite is the generated serving, event, queue, and Session Memory substrate.

## Migrations And Tables

`src/memory/migrations.ts` owns schema evolution through an ordered `MIGRATIONS` array and a `schema_migrations(version, applied_at)` table. Each unapplied migration runs inside a transaction. If a migration throws, the transaction rolls back and the version is not recorded, so the next open can retry.

The current migration set creates and evolves these storage areas:

- `sessions` and `session_events` for the older session/event surface.
- `experience_events`, `hook_errors`, and `experience_event_tombstones` for provider hook capture, ingest leasing, and retained evidence.
- `ingest_jobs`, `session_memories`, `memory_candidates`, and handoff instruction tables for Experience Log to Session Memory processing.
- `session_memory_embeddings` for durable embedding metadata attached to trusted `session_memories`.
- `query_embedding_cache` for normalized retrieval-query embeddings keyed by project, provider, model, dimensions, purpose, and format version.
- `session_memory_contexts` and `session_memory_links` for branch-aware context and memory lifecycle relationships.
- `project_memory_retrieval_embeddings` for derived Project Memory section embedding metadata.
- `retrieval_maintenance_queue` for serving-state repair, hint refresh, poor retrieval feedback, and missing expected hits.
- `project_memory_hint_jobs` for semantic hint generation runs.

Migration helpers preserve old data where needed. For example, the tombstone migration rewrites the legacy terminal tombstone shape into the claim/finalize schema, and the Session Memory embedding migration backfills pending embedding rows for existing `session_memories`.

## SQLite Runtime And sqlite-vec

Vector search depends on `sqlite-vec`, which requires loadable extension support. `src/memory/sqlite-runtime.ts` configures Bun with `Database.setCustomSQLite()` once per process. Runtime resolution is:

1. `MYELIN_SQLITE_DYLIB_PATH` or `SQLITE_DYLIB_PATH` from process env.
2. The same keys from `.env`.
3. The same keys from `myelin.config`.
4. The vendored SQLite runtime from `vendor/sqlite/`.
5. Homebrew SQLite fallback paths on macOS.
6. Bun's default SQLite behavior when no custom runtime is found.

`vendor/sqlite/README.md` documents the current vendored runtime: `vendor/sqlite/darwin-arm64/libsqlite3.dylib`, SQLite `3.53.2`, sourced from Homebrew SQLite for the Apple Silicon prototype. ADR 0057 (`docs/adr/0057-vendor-sqlite-runtime-for-vector-extensions.md`) makes the vendored runtime the product contract for Apple Silicon macOS, with host SQLite as a convenience fallback.

`src/memory/sqlite-vec.ts` is the adapter layer. It loads `sqlite-vec`, reports availability, creates virtual tables, upserts vectors, and searches vectors. Availability failures are returned as explicit degraded reasons rather than hidden behind fallback search.

There are two sqlite-vec virtual tables:

- `session_memory_vec`: vectors for trusted Session Memory rows, partitioned by `project_key`.
- `project_memory_section_vec`: vectors for derived Project Memory section rows, also partitioned by `project_key`.

These virtual tables are created lazily by index/query paths via `ensureSessionMemoryVectorTable()` and `ensureProjectMemoryRetrievalVectorTable()`. They are not created by ordinary migrations because extension availability is runtime-dependent.

## Session Memory Indexing

Session Memory content is trusted SQLite memory. `session_memories` is the durable record table; `session_memory_embeddings` is embedding metadata for each active memory and embedding contract. New or migrated memories get deterministic embedding ids from `sessionMemoryEmbeddingId()` in `src/memory/session-memory-embeddings.ts`.

`src/memory/session-memory-indexer.ts` implements indexing:

1. Select pending `session_memory_embeddings` for the project and active embedding contract. `--retry-failed` includes failed rows.
2. Ensure sqlite-vec storage is available. If the derived vector table uses different dimensions, indexing drops and recreates it for the selected provider contract and requeues previously indexed metadata.
3. Load each `session_memories` row and normalize it through `src/memory/session-memory-text.ts`.
4. Call the configured embedding provider, batched when supported.
5. Validate embedding dimensions.
6. Upsert the vector into `session_memory_vec`.
7. Mark the embedding row `indexed` with `normalized_text_hash` and `indexed_at`, or mark it `failed` with `failure_reason` and incremented `retry_count`.

If sqlite-vec is unavailable, selected rows are marked failed and the result is degraded. The operator command is `myelin memory index session <project-key> [--limit N] [--batch-size N] [--retry-failed] [--json]`, registered in `src/commands/memory.ts` and documented in `docs/CLI.md`.

Session Memory query lives in `src/memory/session-memory-query.ts`. It first checks vector storage availability and indexed/pending counts. If sqlite-vec is unavailable, no rows are indexed, or only pending rows exist, it returns a degraded result with a concrete reason such as `session memory vector index has pending rows; run myelin memory index session`. Query embeddings use `query_embedding_cache` with purpose `retrieval_query`; document embeddings use purpose `retrieval_document`.

## Project Memory Retrieval Indexing

Project Memory content remains canonical in markdown under `projects/<key>/`. SQLite/vector rows for Project Memory are derived pointers, not trusted memory records. ADR 0062 (`docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`) is the key boundary: retrieval state derives from markdown and may be rebuilt; poor retrieval feedback goes to a retrieval-maintenance lane rather than ordinary Project Memory candidates.

`src/project/project-memory-markdown-sections.ts` extracts deterministic section manifests from wiki markdown. It writes `state/<key>/project-memory-retrieval/sections.json` with pages, sections, hashes, line ranges, snippets, categories, and warnings. A section id is derived from its heading path; a section hash is derived from normalized heading path plus normalized body text.

`src/memory/project-memory-retrieval-indexer.ts` implements Project Memory retrieval indexing:

1. Extract the current markdown section manifest.
2. Filter to indexable sections; current code indexes sections with `heading_level > 1`, so a page with only a top-level title has no retrievable section body.
3. Write the section manifest to project state.
4. Validate semantic hint files through `src/project/project-memory-hints.ts`.
5. Ensure or update `project_memory_retrieval_embeddings` rows keyed by project, wiki path, section id, section hash, hint hash, provider, model, dimensions, purpose, and format version.
6. Mark old rows `stale` when the section still exists but its hash changed, or `orphaned` when the section no longer exists.
7. Select pending rows, optionally failed rows, for indexing.
8. Normalize structural section text plus valid hints through `src/memory/project-memory-retrieval-text.ts`.
9. Embed, validate dimensions, upsert into `project_memory_section_vec`, and mark rows `indexed`.

The operator command is `myelin memory index project <project-key> [--limit N] [--batch-size N] [--retry-failed] [--json]`. `ProjectMemoryRetrievalIndexService` in `src/memory/project-memory-retrieval-index-service.ts` loads config, selects the active retrieval-document embedding contract, opens `state/memory/memory.db`, and runs the indexer.

`src/query/project-memory-query-service.ts` queries Project Memory retrieval. It embeds the question with purpose `retrieval_query`, searches `project_memory_section_vec`, hydrates vector hits through `project_memory_retrieval_embeddings`, then re-extracts markdown sections and returns inline content only when the current section hash still matches the indexed row. If the section is too large, missing, or hash-stale, the match becomes a reference with a reason instead of silently returning stale content.

## Freshness, Rebuild, And Degradation Rules

The strongest freshness rule is markdown wins for Project Memory. If Project Memory SQLite/vector state is missing, stale, orphaned, or disagrees with markdown, rebuild it from wiki files with `myelin memory index project <key>`. Do not edit `project_memory_retrieval_embeddings` as canonical knowledge.

Session Memory has a different boundary. `session_memories` rows are trusted SQLite memory records; their vector rows are derived retrieval state. If Session Memory vector state is missing or failed, re-run `myelin memory index session <key>` or retry failed rows with `--retry-failed`.

Vector dimensions belong to each embedding provider contract rather than a global setting. The supported configured provider values are `auto`, `ollama_nomic`, `ollama_qwen`, and `gemini`; all current defaults use 768 dimensions, but provider, model, dimensions, format version, and retrieval purpose remain a single contract identity even when widths match.

## Embedding-Contract Lifecycle

Embedding state is scope-owned for both `session_memory` and `project_memory`. It has three distinct views:

- The **active** contract is the persisted contract used for current indexing and query runtime.
- The **desired** contract is the configured explicit provider; it can differ from active and then reports that a migration is required.
- **Historical** contracts are inactive metadata/vector/query-cache rows. They are diagnostics and cleanup candidates, not active backlog or a reason to mark active retrieval unhealthy.

`auto` is only used when a scope has no active or discoverable indexed contract. It probes local Ollama candidates in priority order (Nomic, then Qwen), persists the selected contract, and later processes reuse that persisted active contract without reprobing. Gemini is supported only as an explicit configuration, not as an `auto` fallback. If the configured provider changes, runtime continues using the active contract; `myelin memory embeddings migrate [--apply]` stages and indexes the desired contract, verifies its vector rows, and activates it only when there are no failed or pending rows. `myelin memory embeddings rollback [--apply]` restores the previous contract when one exists.

`myelin memory embeddings prune [--apply]` previews or removes inactive/historical contracts while protecting the active and previous contracts. It refuses destructive cleanup until every active Session Memory or canonical Project Memory section has an indexed row under the active contract. This preserves rollback and prevents historical cleanup from destroying the only usable retrieval coverage. `tests/memory/embedding-contract-resolver.test.ts`, `tests/memory/embedding-contract-lifecycle-service.test.ts`, and `tests/status/embedding-retrieval-status.test.ts` cover sticky auto selection, explicit desired-versus-active migration state, activation/rollback, guarded pruning, and active-health status separated from historical failed rows.

Project learn integrates retrieval refresh after successful canonical writes. `src/project/project-memory-curator-service.ts` writes retrieval section and hint artifacts, then runs `ProjectMemoryRetrievalIndexService` with a larger limit. If retrieval indexing degrades or leaves pending rows, the run can report `completed_with_pending_index`: canonical Project Memory writes succeeded, but derived hints or retrieval indexing need follow-up. `docs/CLI.md` documents that status explicitly.

Query services fail closed for missing retrieval prerequisites:

- sqlite-vec unavailable: degraded with the sqlite-vec load reason.
- zero indexed rows with pending rows: degraded with an instruction to run the relevant `memory index` command.
- zero indexed rows and no pending rows: degraded because no usable vector index exists.
- Project Memory hit hash mismatch: degraded or reference-only, with markdown treated as authoritative.

`retrieval_maintenance_queue` stores repair work for `hint_refresh`, `index_repair`, `poor_retrieval_feedback`, and `missing_expected_hit`. Items dedupe by project, kind, wiki refs, query context, and feedback while pending/claimed/failed. This keeps retrieval repair separate from content curation.

## Verification Coverage

The storage and retrieval contracts are covered primarily under `tests/memory/` and command tests:

- `tests/memory/db.test.ts` covers DB open/migration behavior.
- `tests/memory/sqlite-runtime.test.ts` and `tests/memory/sqlite-vec.test.ts` cover custom SQLite selection and vector adapter behavior.
- `tests/memory/session-memory-indexer.test.ts`, `tests/memory/session-memory-index-service.test.ts`, and `tests/memory/session-memory-query.test.ts` cover Session Memory indexing and degraded query states.
- `tests/memory/project-memory-retrieval-storage.test.ts`, `tests/memory/project-memory-retrieval-indexer.test.ts`, and `tests/memory/project-memory-retrieval-text.test.ts` cover derived Project Memory retrieval rows, stale/orphaned behavior, hint validation, and normalized embedding text.
- `tests/memory/retrieval-maintenance-queue.test.ts` covers repair queue dedupe and lifecycle.
- `tests/commands/memory.test.ts` covers the `memory index session`, `memory index project`, and `memory query` command surfaces.

## Operational Notes

For local development, `bun src/cli.ts memory index session <key>` and `bun src/cli.ts memory index project <key>` are the direct CLI forms; the installed binary exposes the same commands as `myelin ...`. `make status PROJECT=<key>` and `make query PROJECT=<key> QUESTION="..."` are Makefile aliases over the CLI vocabulary, but new automation should call `myelin` or `bun src/cli.ts` directly.

Embedding behavior is controlled by config and environment. `EMBEDDING_NOMIC_MODEL` and `EMBEDDING_NOMIC_DIMENSIONS`, `EMBEDDING_QWEN_MODEL` and `EMBEDDING_QWEN_DIMENSIONS`, and `EMBEDDING_GEMINI_MODEL` and `EMBEDDING_GEMINI_DIMENSIONS` define independent contracts. `EMBEDDING_STUB_RESPONSES_DIR` supports deterministic tests, while `GOOGLE_API_KEY` or `GEMINI_API_KEY` is required for Gemini fallback. `EMBEDDING_BATCH_SIZE` controls default provider batching, with command-level `--batch-size` capped by config constants. Ollama requests set `keep_alive` to `0`, so the selected local model unloads after each probe or embedding batch.
