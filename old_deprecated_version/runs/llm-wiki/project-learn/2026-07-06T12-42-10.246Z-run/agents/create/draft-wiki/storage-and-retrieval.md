# Storage And Retrieval

Storage and retrieval in Myelin split curated Project Memory from generated serving state: markdown under `projects/<key>/wiki` remains the human-readable source of truth, while `state/memory.db` stores indexed rows, embeddings, queues, and query cache data used to retrieve that truth.

## Canonical Project Layout

The V2 project shell is rooted at `projects/<key>/`. `src/runtime/layout.ts` and `src/runtime/project-shell.ts` define the durable directories as `wiki/`, `state/`, `log/`, and `runs/`; `sources/` and `schema/` are optional and removed when empty during shell repair. Migration moves old root `index.md` into `wiki/index.md`, old `changelog.md` into `log/changelog.md`, old inbox material into `sources/inbox`, and old artifact runs into `projects/<key>/runs`.

Project discovery is state-backed. `src/runtime/projects.ts` discovers projects by reading `projects/<key>/state/project.json`, filters out `legacy` and `deprecated` lifecycles by default, and can resolve a project from a repo path using configured `repo_paths`. `src/runtime/state.ts` deliberately restricts state helpers to JSON filenames under `projects/<key>/state`, so callers cannot use state APIs to write arbitrary nested paths.

The design contract in `MYELIN.md` matches this code boundary: project markdown and metadata are curated Project Memory, while root SQLite is generated serving state. `MYELIN.md` also defines the expected top-level layout: `projects/<key>/index.md`, `wiki/`, `state/`, `runs/`, optional `log/`, optional `sources/`, optional `schema/`, and repo-root `state/memory.db`.

## Root SQLite Serving State

`src/memory/db.ts` owns the SQLite entrypoint. `memoryDbPath(root)` resolves to `state/memory.db`, and `openMemoryDb(root)` creates the `state/` directory, configures Bun SQLite, opens the DB with WAL mode, a 10-second busy timeout, foreign keys enabled, and runs migrations before returning the handle. File-backed opens retry database-lock failures; tests can use `openMemoryDbAt(":memory:")`.

`src/memory/migrations.ts` is the schema authority for generated serving state. The current migrations create and evolve:

- manual session tables: `sessions`, `session_events`
- raw capture and ingest tables: `experience_events`, `hook_errors`, `experience_event_tombstones`, `ingest_jobs`
- Session Memory tables: `session_memories`, `session_memory_contexts`, `session_memory_links`, `session_memory_embeddings`
- curation queues: `memory_candidates`, project/practice/personal handoff instruction tables
- embedding/query support: `query_embedding_cache`, `project_memory_retrieval_embeddings`
- retrieval maintenance: `retrieval_maintenance_queue`, `project_memory_hint_jobs`

Migrations are recorded in `schema_migrations` and applied transactionally. If a migration throws, the version is not recorded and the next open can retry from the last successful version.

## SQLite Runtime And sqlite-vec

Myelin depends on SQLite extension loading for vector search. `src/memory/sqlite-runtime.ts` configures Bun SQLite once per process, resolving a custom SQLite library in this order: `MYELIN_SQLITE_DYLIB_PATH`, `SQLITE_DYLIB_PATH`, the same keys from `.env`, the same keys from `myelin.config`, a vendored Apple Silicon macOS SQLite library, then Homebrew SQLite paths on macOS. If none applies, Bun's default SQLite is used.

`src/memory/sqlite-vec.ts` wraps `sqlite-vec` loading and vector-table operations. It does not create vector tables during base DB migration. Instead, index/query paths lazily ensure virtual tables:

- `session_memory_vec` for Session Memory vectors, partitioned by `project_key`
- `project_memory_section_vec` for Project Memory section vectors, also partitioned by `project_key`

Vector upserts delete the prior vector for the same row and embedding contract before inserting the new `Float32Array`. Vector search filters by project, model, dimensions, purpose, and format version. Project Memory search also filters vector hits through `project_memory_retrieval_embeddings` where status is `indexed`, so stale, orphaned, failed, or pending rows are not returned as valid vector hits.

## Embedding Contracts And Providers

`src/runtime/config.ts` defines the active embedding contract. Defaults are provider `gemini`, model `gemini-embedding-2`, 1536 dimensions, format version `1`, and batch size `50`, with a maximum batch size of `500`. The same contract shape is used for document embeddings and query embeddings; callers switch the purpose between `retrieval_document` and `retrieval_query`.

`src/memory/embedding-provider-factory.ts` creates either a stub provider when `EMBEDDING_STUB_RESPONSES_DIR` is configured, or a Gemini provider using `GOOGLE_API_KEY` first and `GEMINI_API_KEY` as an alias. `src/memory/embedding-provider.ts` formats Gemini document embeddings as titled text and query embeddings as search-result query text, supports batch embedding, and validates returned dimensionality.

Query embeddings are cached separately from document embeddings. `src/memory/query-embedding-cache.ts` normalizes questions by trimming, collapsing whitespace, and lowercasing; cache keys include project, normalized question, provider, model, dimensions, purpose, and format version. Cache hits increment hit counters and update timestamps.

## Session Memory Index And Query

Session Memory indexing is explicit operator work through `myelin memory index session <project-key>`, implemented in `src/commands/memory.ts` and `src/memory/session-memory-indexer.ts`. The indexer selects pending `session_memory_embeddings` rows for the active document contract, optionally includes failed rows with `--retry-failed`, normalizes each active Session Memory row, embeds in batches, writes vectors into `session_memory_vec`, and marks rows `indexed` with a normalized text hash. If sqlite-vec is unavailable or an embedding batch fails, selected rows are marked `failed` with retry counts and the command reports degraded indexing.

`src/memory/session-memory-query.ts` is the default retrieval layer for `myelin memory query`. It first checks sqlite-vec availability and indexed/pending counts. If no indexed Session Memory rows exist, it fails closed with a degraded reason telling the operator whether rows are pending or absent. On success it embeds or reuses a cached query embedding, searches `session_memory_vec`, hydrates matches from `session_memories`, filters active rows by default, and can filter by memory kind, status, or git branch context.

## Project Memory Sections And Hints

Project Memory retrieval is built from markdown sections, not whole pages. `src/project/project-memory-markdown-sections.ts` recursively reads `projects/<key>/wiki/**/*.md`, records page metadata, extracts Markdown headings, computes stable section IDs from heading paths, hashes normalized heading/body text, records snippets and line ranges, and writes `projects/<key>/state/project-memory-retrieval/sections.json`.

The Project Memory retrieval indexer intentionally excludes top-level page-title sections by filtering to headings with `heading_level > 1`; tests in `tests/memory/project-memory-retrieval-indexer.test.ts` verify that page intro body text is not indexed as a top-level section. This keeps retrieval focused on named page subsections rather than entire page wrappers.

Hints are optional retrieval enrichments stored under `projects/<key>/state/project-memory-retrieval/hints/*.json`. `src/project/project-memory-hints.ts` validates hint entries against the current section manifest. A hint is valid only when its `wiki_path`, `section_id`, and `section_hash` still match and confidence is not `low`; otherwise it is classified as `stale`, `orphaned`, or `low_confidence`. Valid hints contribute keywords, aliases, topics, and query phrases to the normalized embedding text through `src/memory/project-memory-retrieval-text.ts`.

`src/memory/project-memory-hint-jobs.ts` stores hint-generation job state in SQLite. Jobs track project, category, required flag, section refs, provider/model/run ref, and statuses `pending`, `running`, `completed`, `failed`, or `skipped`.

## Project Memory Retrieval Index

Project Memory indexing is explicit through `myelin memory index project <project-key>`, implemented by `src/memory/project-memory-retrieval-index-service.ts` and `src/memory/project-memory-retrieval-indexer.ts`. The service loads config, selects the active `retrieval_document` contract, creates the embedding provider, opens `state/memory.db`, and indexes pending project sections.

The indexer flow is:

1. Extract the current wiki section manifest and write it to project state.
2. Validate existing hint files against that manifest.
3. Ensure a pending `project_memory_retrieval_embeddings` row for each indexable section plus valid hint hash.
4. Mark rows from prior manifests as `stale` when a section hash changed, or `orphaned` when a section disappeared.
5. Select pending rows, optionally including failed rows with `--retry-failed`.
6. Ensure the `project_memory_section_vec` table, embed normalized section text in batches, upsert vectors, and mark rows `indexed`.

`src/memory/project-memory-retrieval-storage.ts` gives each retrieval row a deterministic `pmr_` ID derived from project key, wiki path, section ID, section hash, hint hash, and embedding contract. Row statuses are `pending`, `indexed`, `failed`, `stale`, and `orphaned`; failed rows retain failure reasons and retry counts.

## Query Resolution

The public CLI surface is `myelin memory query <key> <question> [--layer session|project|auto] [--json] [--debug]`. `src/query/engine.ts` loads config, selects the document embedding contract, creates the embedding provider, opens `state/memory.db`, optionally resolves `--branch current`, and delegates to `src/query/memory-query-service.ts`.

Current code treats Session Memory as the default layer. `MemoryQueryService.query()` only calls Project Memory retrieval when `layer === "project"`; `auto` is accepted by argument parsing but currently falls through to the Session Memory path. This is a current implementation gap relative to the broader design in `MYELIN.md`, where the future query facade should route across Project, Session, Practice, and Personal Memory.

Project Memory query resolution lives in `src/query/project-memory-query-service.ts`. It checks sqlite-vec availability, fails closed when no indexed Project Memory rows exist, embeds or reuses the cached query embedding, searches `project_memory_section_vec`, hydrates row IDs from `project_memory_retrieval_embeddings`, and then re-extracts live markdown sections from `projects/<key>/wiki`. Hydration returns inline section content only when the current markdown section exists, its hash matches the indexed row, and its body length is within `--max-inline-chars`. Otherwise it returns a canonical reference with reason `too_large`, `stale_hash`, or `missing_markdown`; stale or missing markdown makes the result degraded instead of returning obsolete content.

`src/query/memory-query-service.ts` turns retrieval results into the facade response envelope: `answer`, `confidence`, `memory_scope`, `citations`, `candidate_ids`, `degraded`, `degraded_reason`, `source_tools`, and optional route diagnostics. Project Memory citations use `project_memory:<wiki_path>#<section_id>`; Session Memory citations use `session_memory:<id>`.

## Retrieval Maintenance And Current Gaps

`retrieval_maintenance_queue` exists in migrations and `tests/memory/retrieval-maintenance-queue.test.ts` verifies deduped feedback records such as poor retrieval feedback and missing expected hits. This queue is generated serving state for retrieval repair work, not curated truth.

The main known gaps are:

- `--layer auto` is parsed but does not yet compose or route across layers; it behaves like Session Memory retrieval in current code.
- Project Memory vector retrieval requires `myelin memory index project` to have indexed rows; without that, query fails closed even when markdown exists.
- Hint generation has job storage and hint validation, but this subject did not find a complete agentic hint-generation flow wired into query-time repair.
- `docs/IMPLEMENTATION_ALIGNMENT.md` still describes an older page-metadata query seed. Current code in `src/query/` and `src/memory/` is more authoritative for retrieval behavior.
