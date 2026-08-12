# Storage, Retrieval, And Query

Storage, retrieval, and query in Myelin are split by trust boundary: curated Project Memory stays in markdown, while SQLite stores generated serving state, Session Memory, capture logs, queues, embedding metadata, and vector indexes.

## Truth Boundaries

Myelin's canonical design states the central boundary directly: markdown is curated truth and SQLite is serving state. Project Memory lives as human-reviewable markdown under `projects/<key>/wiki/` plus metadata JSON; SQLite must not become the source of curated project truth unless a future design changes that boundary (`MYELIN.md`, `docs/adr/0021-keep-curated-project-memory-in-markdown.md`).

Session Memory is the main exception to "durable memory means markdown": operational continuity records are canonical in the repo-root SQLite database. `docs/adr/0002-session-memory-starts-in-sqlite.md` makes `state/memory.db` the canonical store for Session Memory, while session-oriented wiki pages remain curated historical Project Memory written only through later Project Memory update or promotion flows.

The SQLite database is one repo-root generated serving layer at `state/memory.db`, partitioned by `project_key`. `src/memory/db.ts` opens it through `openMemoryDb(root)`, creates `state/` when needed, configures `busy_timeout`, WAL journaling, and foreign keys, then runs migrations. This database is generated state, not curated markdown.

## Memory Database Shape

The schema is migration-owned in `src/memory/migrations.ts`. Important storage groups include:

- `sessions` and `session_events` for the older/manual session surface.
- `experience_events`, `hook_errors`, and `experience_event_tombstones` for raw captured activity and ingest leasing/finalization.
- `ingest_jobs` for detached ingest job status.
- `session_memories` for trusted project-scoped continuity records, with lifecycle states `active`, `superseded`, and `retracted`.
- `session_memory_contexts` and `session_memory_links` for branch/repo context and relationships such as `supersedes`, `refines`, `contradicts`, and `duplicates`.
- `memory_candidates` and handoff instruction tables for cross-layer promotion work.
- `session_memory_embeddings`, `project_memory_retrieval_embeddings`, `query_embedding_cache`, `retrieval_maintenance_queue`, and `project_memory_hint_jobs` for retrieval/indexing support.

`src/memory/session-memories.ts` creates active Session Memory rows and, by default, also creates a pending embedding row using the default retrieval-document embedding contract. Supersession and retraction update lifecycle columns rather than deleting history.

The Experience Log is raw evidence, not truth. `src/memory/experience.ts` records provider/cwd/git-context events in `experience_events`, deduplicates with provider keys and tombstones, and uses tombstone-backed claiming so ingest workers can lease work without silently discarding source rows before output is accepted.

## Embedding Contracts And Providers

Embedding configuration is loaded from `myelin.config`, `.env`, and process environment in `src/runtime/config.ts`. Defaults are Gemini embeddings with model `gemini-embedding-2`, `1536` dimensions, format version `1`, and batch size `50`; `EMBEDDING_BATCH_SIZE` is capped by `MAX_EMBEDDING_BATCH_SIZE` at `500`.

`selectActiveEmbeddingContract(config, purpose)` creates the active contract for either `retrieval_document` or `retrieval_query`. Document embeddings and query embeddings intentionally use the same provider/model/dimensions/format version but different purposes. `src/memory/embedding-provider-factory.ts` uses stub responses when `EMBEDDING_STUB_RESPONSES_DIR` is set; otherwise it creates the Gemini provider from `GOOGLE_API_KEY`, falling back to `GEMINI_API_KEY`.

Query embeddings are cached in `query_embedding_cache`, keyed by project, normalized question, provider, model, dimensions, purpose, and format version. The query services report cache hit status and cache id when debug diagnostics are requested.

## sqlite-vec And SQLite Runtime

Vector search uses `sqlite-vec` virtual tables created in `src/memory/sqlite-vec.ts`:

- `session_memory_vec` stores Session Memory embeddings with `memory_id`, `project_key` partition key, model/dimension/purpose/version columns, and a `float[N]` embedding.
- `project_memory_section_vec` stores Project Memory section embeddings with `retrieval_row_id`, `wiki_path`, `section_id`, `project_key` partition key, model/dimension/purpose/version columns, and a `float[N]` embedding.

The vector tables are created only after `sqlite-vec` loads successfully. If the extension is unavailable, indexing and query paths degrade explicitly with a `sqlite-vec unavailable: ...` reason instead of using a weak fallback.

On macOS, Myelin owns a vendored SQLite runtime so loadable extensions can work even though Apple's system SQLite disables them. `src/memory/sqlite-runtime.ts` resolves SQLite in this order: `MYELIN_SQLITE_DYLIB_PATH`, `SQLITE_DYLIB_PATH`, values from `.env`, values from `myelin.config`, vendored SQLite, Homebrew SQLite on Darwin, then Bun's default behavior. `vendor/sqlite/README.md` records the current vendored runtime as `vendor/sqlite/darwin-arm64/libsqlite3.dylib`, SQLite `3.53.2`.

## Session Memory Indexing And Query

`myelin memory index session <project-key>` is implemented in `src/commands/memory.ts` through `SessionMemoryIndexService` and `src/memory/session-memory-indexer.ts`. It selects pending `session_memory_embeddings` rows for active Session Memory, optionally includes failed rows with `--retry-failed`, normalizes each row with `src/memory/session-memory-text.ts`, embeds in batches, upserts into `session_memory_vec`, and marks rows `indexed` with a normalized text hash. Failures mark individual rows `failed`, increment retry count, and return a degraded result.

`src/memory/session-memory-query.ts` is fail-closed around the vector index. It first checks sqlite-vec availability and counts indexed/pending rows for the active embedding contract. If there are no indexed rows, it returns a degraded result that says either `session memory vector index has pending rows; run myelin memory index session` or `session memory vector index has no indexed rows`. When the index is available, it embeds or reuses the query embedding, searches `session_memory_vec`, hydrates matching active `session_memories`, applies optional filters for memory kind, branch, and status, and returns matches ordered by vector distance.

Branch filtering is context-aware: `--branch current` resolves the target repo branch before query, and matching uses `session_memory_contexts` rather than only a denormalized field on the memory row.

## Project Memory Section Indexing And Query

Project Memory retrieval is an index over canonical markdown sections, not a replacement for the markdown. `src/project/project-memory-markdown-sections.ts` walks `projects/<key>/wiki/`, reads markdown files, extracts headings into section records, computes page and section hashes, records heading paths, snippets, and line ranges, and writes the generated manifest to `projects/<key>/state/project-memory-retrieval/sections.json`.

`myelin memory index project <project-key>` is implemented through `ProjectMemoryRetrievalIndexService` and `src/memory/project-memory-retrieval-indexer.ts`. The indexer filters out non-indexable sections, validates optional retrieval hints, ensures a `project_memory_retrieval_embeddings` row for each current section hash plus hint hash, marks changed indexed rows `stale`, marks removed-section rows `orphaned`, embeds pending rows, upserts vectors into `project_memory_section_vec`, and marks rows `indexed`.

Project retrieval rows can be `pending`, `indexed`, `failed`, `stale`, or `orphaned`. The stable row id includes project key, wiki path, section id, section hash, hint hash, provider, model, dimensions, purpose, and format version (`src/memory/project-memory-retrieval-storage.ts`). That means changed markdown creates a new pending row and marks the previous row stale instead of pretending the old vector is still fresh.

`src/query/project-memory-query-service.ts` searches only indexed Project Memory retrieval rows. It then re-extracts current markdown sections and hydrates vector hits from markdown. If the current section is missing, the result is reference-only with `missing_markdown`; if the section hash no longer matches, it is reference-only with `stale_hash`; if the section body is larger than `--max-inline-chars`, it is reference-only with `too_large`. Inline content is returned only when the current markdown exists, matches the indexed hash, and fits the inline budget.

`src/project/project-memory-lookup.ts` is a separate fallback markdown search used by Project Memory maintenance flows. It tokenizes page titles/headings/body snippets and returns `fallback_markdown_search` results with advisory or proposal-scoped severity. This is not the same as vector-backed `memory query`.

## Query Facade And Response Shape

The core query implementation lives in `src/query/`, and `docs/adr/0048-core-owns-query-mcp-consumes-via-contract.md` says detached MCP consumers must call the core CLI/JSON contract rather than duplicating query logic. `src/query/engine.ts` loads config, selects the active retrieval-document embedding contract, creates the embedding provider, opens `state/memory.db`, resolves optional branch scope, and delegates to `MemoryQueryService`.

The current query code is a small service-composition boundary, not a committed OO hierarchy for future retrieval layers. `queryMemory` constructs `MemoryQueryService` with the database, embedding contract, and embedding provider; `MemoryQueryService` then delegates to the Session Memory runner or Project Memory runner and uses deterministic response shaping. That is the verified current implementation shape, while broader multi-layer query object design remains deferred.

`myelin memory query <project-key> "<question>"` defaults to Session Memory because `MemoryQueryService.query()` routes to Project Memory only when `--layer project` is passed. The parser accepts `--json`, `--debug`, `--branch <name|current>`, `--layer session|project|auto`, `--max-inline-chars N`, and `--limit N`; current service behavior treats `auto` like the Session Memory default because only `layer === "project"` selects Project Memory.

The JSON response envelope is stable across layers:

- `answer`
- `confidence`
- `memory_scope`
- `citations`
- `candidate_ids`
- `degraded`
- `degraded_reason`
- `source_tools`
- `matches`
- `project_memory_matches`
- optional `layers` diagnostics when `--debug` is used

The response service in `src/query/memory-query-service.ts` is deterministic. For Session Memory, it concatenates matching memory ids, kinds, titles, and summaries. For Project Memory, it returns inline section content or a reference with the degradation reason. Confidence is derived from the first vector distance and is capped lower for degraded Project Memory references.

If the response is degraded and the caller did not request `--json`, the CLI returns failure with the degraded answer. JSON callers receive the structured envelope.

## Maintenance And Failure Modes

Retrieval is designed to expose weak state rather than hide it:

- Missing sqlite-vec support degrades indexing and query with an explicit reason.
- Pending Session Memory rows tell operators to run `myelin memory index session`.
- Pending Project Memory rows tell operators to run `myelin memory index project`.
- Failed embedding rows remain available for `--retry-failed`.
- Changed Project Memory sections become stale, removed ones become orphaned, and stale/missing hits are returned as references rather than inline content.
- Large Project Memory sections are returned by reference to avoid oversized inline answers.

`retrieval_maintenance_queue` records Project Memory retrieval repair work such as `hint_refresh`, `index_repair`, `poor_retrieval_feedback`, and `missing_expected_hit` with dedupe keys and sources (`mcp_query`, `cli_query`, `project_learn`, or `operator`). This queue is state for improving retrieval behavior, not a source of curated memory truth.

ADRs `0037` and `0038` additionally define the intended query posture around schema context: memory query should fail closed when schema context is missing or invalid and should not run `schema build` itself. The current storage/query code shown here handles the retrieval side of that fail-closed behavior; schema validation belongs to the schema/query integration boundary.
