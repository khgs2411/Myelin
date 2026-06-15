# Session Memory Embedding Index Design

Status: Final design. Ready for external design/spec audit before implementation planning.

## Goal

Add embedding-backed internal retrieval to the trusted Session Memory write path without changing the agentic ingest contract that was just proven.

The next product slice should turn each durable `session_memories` row into searchable memory by deriving a Gemini embedding, storing it in a SQLite VEC index, and exposing retrieval through an internal Session Memory query facade. This proves the searchable Session Memory substrate needed before a later MCP/query slice exposes Session Memory to agents and Current Briefing v0.

## Current Context

The Experience Log to Session Memory ingest slice is implemented around a detached `myelin ingest <project-key>` worker. The worker creates tombstone-backed lease stubs for raw `experience_events`, keeps raw rows present until accepted terminal processing, lets a headless provider decide trusted outputs, and writes accepted low-risk outputs through `createSessionMemory` in `src/memory/session-memories.ts`.

Current storage:

- `session_memories` is the canonical trusted Session Memory table in `state/memory.db`.
- `createSessionMemory` inserts text, source references, provider metadata, confidence, risk, and timestamps.
- The current table has indexes for project and memory kind recency, but no embedding metadata or vector lookup.
- Existing `.tasks` files already identify `embedding-provider.md`, `vector-indexer.md`, and `query-facade.md` as deferred retrieval/indexing work.
- The previous ingest design explicitly deferred SQLite VEC, embeddings, and MCP/query retrieval to later work. This slice handles SQLite VEC, embeddings, and an internal retrieval facade; MCP tool exposure remains separate.

External implementation references:

- `sqlite-vec` JavaScript docs: <https://alexgarcia.xyz/sqlite-vec/js.html>
- `sqlite-vec` repository: <https://github.com/asg017/sqlite-vec>
- Gemini embeddings JavaScript docs: <https://ai.google.dev/gemini-api/docs/embeddings#javascript>

Verified constraints from those references:

- `sqlite-vec` can be loaded into Bun's SQLite connection through the `sqlite-vec` package, but macOS needs a SQLite build that supports loadable extensions.
- Myelin owns this runtime boundary through a vendored SQLite runtime where available, with explicit operator overrides and host Homebrew SQLite only as fallback. See `docs/adr/0057-vendor-sqlite-runtime-for-vector-extensions.md`.
- `sqlite-vec` stores/query vectors through `vec0` virtual tables and supports metadata, auxiliary columns, and partition keys.
- `sqlite-vec` is pre-v1, so Myelin should isolate it behind an internal adapter.
- Gemini embedding model name, output dimension, and task/query formatting must be part of the stored embedding contract so incompatible vectors are not mixed silently.

## User-Facing Behavior

Existing behavior should remain intact:

- `myelin ingest <project-key>` still starts detached Experience Log processing.
- The ingest agent still decides whether to create Session Memory, candidates, handoff instructions, or no output.
- A trusted `session_memories` row is still the canonical memory record.

New behavior:

- When a Session Memory row is created or updated, Myelin records that the row needs an embedding.
- A separate durable indexer/backfill path generates embeddings and writes or refreshes vector index entries.
- If embedding generation fails because of quota, network, provider configuration, sqlite-vec availability, or model error, the Session Memory row remains durable and the embedding status remains pending or failed for retry.
- Internal Myelin code can call a stable facade such as `query_session_memory(project_key, question, limit, filters)` instead of querying raw SQLite tables.
- Future MCP tools and Current Briefing v0 should consume Session Memory through that facade after a later exposure/integration slice, not through direct table dumps.
- Existing Session Memory rows created before this slice are marked pending by migration and indexed later through the same explicit indexer/backfill path.

## Out Of Scope

- MCP tool exposure for Session Memory retrieval.
- Current Briefing wiring or synthesis.
- Broader `memory query` behavior across all memory layers.
- Project, Practice, and Personal Memory vectorization.
- Moving canonical Session Memory truth out of `session_memories`.

## Technical Design

### Canonical Record And Derived Index

`session_memories` remains the source of truth. Embeddings are a derived retrieval index over the canonical row's searchable text.

The searchable text should be built deterministically from:

- `title`, when present
- `summary`
- selected stable fields from `payload_json` when safe and useful
- `memory_kind`
- source/provenance identifiers only as metadata, not as semantic filler

Payload fields are included only through a conservative normalizer. The normalizer may include useful scalar fields that are already part of trusted Session Memory, but it must not embed raw Experience Log text, bulky command output, complete transcripts, or arbitrary nested payload blobs. If the payload shape is unclear or unsafe, the embedding text falls back to `title`, `summary`, and `memory_kind`.

The indexer should hash this normalized searchable text plus the embedding model contract. If neither the text nor embedding contract changed, it should skip re-embedding.

Ingest does not call the embedding provider directly. Session Memory writes create or refresh pending embedding metadata; the indexer owns Gemini calls, sqlite-vec writes, retries, and backfill.

### Embedding Provider

Embedding generation should use a provider abstraction separate from Codex/Claude chat execution.

Gemini is the first real embedding provider because it is a practical free-tier option for inserts and reads. The implementation must not depend on a fixed free quota. It should:

- read Gemini API credentials from environment/config
- support deterministic stubs for tests
- store provider, model, dimension, text hash, and status
- treat quota/provider failures as index freshness failures, not Session Memory write failures

### Embedding Config Contract

Embedding config is separate from chat/model profiles in `myelin.config`.

Initial config keys:

- `EMBEDDING_PROVIDER=gemini`
- `EMBEDDING_GEMINI_MODEL=gemini-embedding-2`
- `EMBEDDING_DIMENSIONS=1536`
- `EMBEDDING_STUB_RESPONSES_DIR=<path>` for deterministic embedding-provider tests when a CLI/runtime stub path is needed

Credentials should come from `GEMINI_API_KEY`. Missing credentials degrade indexing/query embedding and do not block Session Memory writes or pending metadata creation.

The default model and dimensions should be verified against the current Gemini docs during implementation. As of this design, Gemini documents `gemini-embedding-2`, JavaScript `embedContent`, retrieval-specific prompt formatting, and default 3072-dimensional vectors with recommended smaller output dimensions including 1536.

Document embeddings use purpose `retrieval_document`; query embeddings use purpose `retrieval_query`. For `gemini-embedding-2`, the provider adapter owns the retrieval prompt formatting:

- document: `title: {title-or-none} | text: {normalized-memory-text}`
- query: `task: search result | query: {question}`

The embedding metadata must persist provider, model, dimensions, purpose, text hash, and format version so incompatible vectors are never mixed silently.

### Embedding Contract Versioning

V0 has one configured active embedding contract for Session Memory retrieval at a time. Multiple historical contracts may exist in metadata to support model/dimension migration, but query uses only the configured active contract. The indexer processes pending rows for the active contract unless an explicit future migration/reindex command requests another contract.

### SQLite VEC Adapter

`sqlite-vec` should live behind an internal retrieval adapter. Public code should not depend on vec0 table names or sqlite-vec-specific query syntax.

The adapter owns:

- loading sqlite-vec into the Bun SQLite connection
- creating/migrating vector tables
- inserting/replacing vector rows
- project-scoped KNN search
- availability checks and clear degraded states

Metadata tables must be created even when sqlite-vec cannot be loaded. sqlite-vec load/install failure blocks vector-table creation and vector indexing only; it does not block Session Memory writes, pending embedding metadata, or non-vector migration.

Runtime loading must prefer Myelin's vendored SQLite runtime before host fallbacks so Apple Silicon macOS does not require a separate SQLite installation. Platform support is explicit: a platform is host-independent only after it has a vendored runtime under `vendor/sqlite/<platform>-<arch>/`.

### Query Facade

The first facade should be narrow and Session Memory-specific:

```text
query_session_memory(project_key, question, limit, filters)
```

It should:

- embed the query text with the same provider/model/dimension contract used by indexed Session Memory rows
- retrieve vector matches scoped to `project_key`
- return machine-readable matches with memory ids, summaries, scores/distances, memory kinds, source refs, and degraded state
- support filters for `memory_kind`, recency, confidence/risk, and provider metadata where useful
- expose when retrieval is unavailable because vectors are pending, sqlite-vec is unavailable, credentials are missing, or provider quota failed

This facade returns ranked retrieval matches only. It does not synthesize answers and does not expose a new MCP tool in this slice. A later MCP/query integration slice should expose this facade to agents and let Current Briefing perform any briefing synthesis above it.

## Data / State

The design should add derived embedding state without overloading `session_memories`.

Likely tables:

- `session_memory_embeddings`: one row per embedded Session Memory record and embedding contract.
- `session_memory_vec`: sqlite-vec virtual table holding the vector and enough partition/auxiliary metadata for project-scoped lookup.

The non-vector embedding table should track:

- session memory id
- project key
- source table/entity kind
- embedding provider
- embedding model
- embedding dimension
- embedding purpose, such as `retrieval_document`
- embedding format version
- active contract marker or enough metadata for the query facade to select the configured active contract
- normalized text hash
- status: pending, indexed, failed
- failure reason / retry metadata
- created, updated, indexed timestamps

The vector table should be treated as rebuildable derived state. It should not be the only place where embedding status or provenance lives.

Migrations must not call Gemini or any external embedding provider. When migration finds existing `session_memories` rows without embedding metadata, it should create pending embedding metadata only. A dedicated indexer/backfill command then embeds those rows under normal provider, quota, retry, and status rules.

## Integrations

- `src/memory/session-memories.ts`: write path should create or refresh pending embedding metadata around Session Memory creation.
- `src/ingest/worker.ts`: should not become embedding-provider-aware unless implementation needs a narrow hook after `createSessionMemory`.
- `src/memory/db.ts` and `src/memory/migrations.ts`: own schema and sqlite-vec availability checks.
- `myelin.config`: should define embedding provider/model defaults separately from pipeline/query chat model profiles.
- Future MCP layer: should call the Session Memory query facade and not raw tables, but MCP tool exposure is out of scope for this slice.

## Error Handling

Embedding/indexing failures should be explicit and recoverable.

Resolved decision:

- Session Memory writes commit even if embedding fails.
- Failed embeddings are marked pending or failed with retryable metadata.
- Query facade returns degraded state when vector retrieval is unavailable.
- Query facade does not silently synthesize or table-dump around missing vector retrieval.
- A dedicated indexer/backfill command can rebuild or retry embeddings for a project.

This avoids losing trusted memory because the embedding quota was exhausted or sqlite-vec was unavailable on the local machine.

## Testing Strategy

Repo-native tests should cover:

- migrations create embedding metadata tables and sqlite-vec virtual tables when available
- memory writes create pending/indexed embedding metadata according to provider behavior
- embedding text normalization includes safe payload fields and falls back when payload shape is unsafe
- unchanged searchable text skips re-embedding
- changed summary/payload causes re-embedding
- provider failure leaves Session Memory durable and embedding retryable
- missing Gemini credentials leave rows pending/failed without blocking memory writes
- sqlite-vec unavailable still creates metadata tables and reports degraded vector availability
- query uses only the configured active embedding contract
- query facade scopes retrieval by project key
- query facade reports degraded state clearly when sqlite-vec or credentials are unavailable
- stub provider makes tests deterministic and network-free

Verification commands should remain:

```bash
bun test
bun run typecheck
git diff --check
```

## Planning Boundary Guidance

This design should later split into focused implementation chunks:

- Embedding provider contract and Gemini/stub implementations.
- SQLite schema and sqlite-vec adapter.
- Config parsing for embedding provider/model/dimension and credential/degraded-state handling.
- Session Memory pending-state integration.
- Session Memory indexer/backfill command.
- Internal Session Memory retrieval-only query facade.
- Existing-row pending migration and explicit backfill/reindex behavior.
- Docs/config/verification pass.

The implementation plan should not combine all retrieval scopes at once. Project, Practice, and Personal Memory vectorization can reuse the same adapter later, but this slice should finish Session Memory first.

Later MCP/query integration for Current Briefing consumption is a follow-up slice, not an implementation chunk in this design.

## Acceptance Criteria

- New trusted Session Memory writes produce durable pending embedding metadata.
- The dedicated indexer/backfill path produces indexed vectors when provider credentials and sqlite-vec are available.
- Existing trusted Session Memory rows can be backfilled without provider calls during migration or query.
- Embedding failures do not delete, roll back, or hide Session Memory.
- The embedding contract records provider, model, dimension, purpose, format version, active-contract selection data, and text hash.
- `query_session_memory` retrieves project-scoped Session Memory by semantic similarity through the facade.
- Retrieval exposes degraded states instead of silently falling back to table dumps.
- Current Briefing has a clear later dependency path to read Session Memory through the facade, but no MCP or Current Briefing integration ships in this slice.

## Assumptions

- Gemini is the first real embedding provider.
- sqlite-vec is the first local vector index.
- The initial configured embedding contract is Gemini `gemini-embedding-2` with 1536 output dimensions unless implementation-time docs or local constraints force a documented adjustment.
- The current `session_memories` row shape is sufficient canonical content for v0 embeddings.
- Backfilling existing Session Memory rows is needed because live dogfood already created rows before embeddings existed.

## Resolved Design Decisions

- Session Memory writes commit independently from embedding/index success.
- Ingest does not call Gemini or sqlite-vec directly; it only marks embedding work pending.
- Embedding text uses deterministic selected trusted fields, with fallback to title/summary/kind.
- `query_session_memory` is retrieval-only and returns ranked matches, not synthesized answers.
- Existing rows are marked pending by migration and indexed through explicit backfill.
- MCP tool exposure and Current Briefing consumption are deferred to a later slice.
