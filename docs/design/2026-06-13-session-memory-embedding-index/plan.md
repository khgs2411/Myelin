# Session Memory Embedding Index Implementation Plan Set

**Spec:** `spec.md`
**Agenda:** `agenda.md`
**Context:** `../../../CONTEXT.md`
**ADRs:** `../../adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`
**Status:** Chunk Plans Written

## Goal

Implement embedding-backed internal retrieval for trusted Session Memory by adding an embedding config contract, derived metadata/vector storage, Gemini/stub embedding providers, sqlite-vec adapter boundaries, pending-state integration for `session_memories`, an explicit indexer/backfill command, and an internal retrieval-only `query_session_memory` facade. The plan keeps `session_memories` canonical, keeps ingest detached-agent behavior unchanged, and defers MCP exposure and Current Briefing integration.

## Source Artifacts

- `docs/design/2026-06-13-session-memory-embedding-index/spec.md`
- `docs/design/2026-06-13-session-memory-embedding-index/agenda.md`
- `CONTEXT.md`
- `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/spec.md`
- `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/agenda.md`
- `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/plan.md`
- `docs/adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`
- `.tasks/06-retrieval-and-indexing/embedding-provider.md`
- `.tasks/06-retrieval-and-indexing/vector-indexer.md`
- `.tasks/05-semantic-interface/query-facade.md`
- Code paths inspected:
  - `package.json`
  - `myelin.config`
  - `src/cli.ts`
  - `src/commands/registry.ts`
  - `src/commands/ingest.ts`
  - `src/runtime/config.ts`
  - `src/runtime/llm-client.ts`
  - `src/memory/db.ts`
  - `src/memory/migrations.ts`
  - `src/memory/session-memories.ts`
  - `src/ingest/worker.ts`
  - `src/memory/db.test.ts`
  - `src/memory/session-memories.test.ts`
  - `src/commands/ingest.test.ts`
  - `src/runtime/runtime.test.ts`
- Test/validation commands discovered:
  - `bun test`
  - `bun run typecheck`
  - `git diff --check`

## Design Readiness Check

- Source artifact paths verified: Pass.
- Missing or unavailable artifacts: None.
- Open agenda questions or risks: None that change roadmap chunk boundaries.
- Spec / agenda / context / ADR consistency: Pass. The external design/spec re-audit returned `Ready for Development`, interpreted as ready for `$pmp-writing-plans`.
- Parent / child spec consistency: Not applicable. This is a follow-up design slice to the Experience Log ingest design, not a child spec.
- Accepted planning reconciliations:
  - The design says Session Memory rows may be "created or updated", while current code only exposes `createSessionMemory`. Roadmap assigns create-path integration to Chunk 05 and defers any update-path API to the same chunk only if implementation finds an existing update path or a concrete need. No product behavior changes from this reconciliation.
  - The sqlite-vec package is not currently in `package.json`; roadmap assigns dependency addition and runtime loading proof to Chunk 02.
- Blockers: None.

## Unresolved Decision Ownership

| Item | Type | Owning Chunk | Must Resolve Before | Notes |
| --- | --- | --- | --- | --- |
| Add sqlite-vec dependency and prove Bun/macOS load behavior | Implementation risk | `02-sqlite-vec-adapter-and-availability.md` | Implementation steps in owning chunk | Highest runtime risk from audit. Adapter must degrade cleanly when sqlite-vec cannot load. |
| Confirm current Gemini embedding API model/dimension behavior | Implementation verification | `03-embedding-provider-and-normalizer.md` | Implementation steps in owning chunk | Spec assumes `gemini-embedding-2` and 1536 dimensions unless implementation-time docs/local constraints force a documented adjustment. |
| Session Memory "created or updated" pending-state detail | Planning reconciliation | `05-session-memory-pending-integration.md` | Implementation steps in owning chunk | Current code has `createSessionMemory`; update support should not be invented unless needed by local patterns. |
| Active embedding contract resolver shared by schema, indexer, and query | Shared contract | `01-embedding-config-contract.md` | Implementation steps in owning chunk | Later chunks must use one resolver, not duplicate config parsing. |
| MCP exposure and Current Briefing consumption | Deferred scope | `08-docs-validation-and-source-set.md` | Implementation steps in owning chunk | Docs must state this is explicitly out of scope for this plan set. |

## Approved Chunks

| Chunk | Purpose | Depends On | Enables | Status |
| --- | --- | --- | --- | --- |
| [`01-embedding-config-contract.md`](plans/01-embedding-config-contract.md) | Add embedding config parsing, active embedding contract types/resolver, env override behavior, and tests around `myelin.config`/environment precedence. Boundary: config/type contract only, no provider calls or SQLite schema. | None | [`02-sqlite-vec-adapter-and-availability.md`](plans/02-sqlite-vec-adapter-and-availability.md), [`03-embedding-provider-and-normalizer.md`](plans/03-embedding-provider-and-normalizer.md), [`04-embedding-storage-schema.md`](plans/04-embedding-storage-schema.md), [`06-indexer-backfill-command.md`](plans/06-indexer-backfill-command.md), [`07-session-memory-query-facade.md`](plans/07-session-memory-query-facade.md) | Written |
| [`02-sqlite-vec-adapter-and-availability.md`](plans/02-sqlite-vec-adapter-and-availability.md) | Add the sqlite-vec dependency and an isolated adapter that can load sqlite-vec, report availability, and degrade cleanly when unavailable. Boundary: adapter and dependency proof only, no Session Memory indexing workflow. | [`01-embedding-config-contract.md`](plans/01-embedding-config-contract.md) | [`04-embedding-storage-schema.md`](plans/04-embedding-storage-schema.md), [`06-indexer-backfill-command.md`](plans/06-indexer-backfill-command.md), [`07-session-memory-query-facade.md`](plans/07-session-memory-query-facade.md) | Written |
| [`03-embedding-provider-and-normalizer.md`](plans/03-embedding-provider-and-normalizer.md) | Add embedding provider abstraction, Gemini adapter, deterministic stub provider, and Session Memory searchable-text normalizer with unsafe-payload fallback. Boundary: provider/normalizer only, no DB writes or vector search. | [`01-embedding-config-contract.md`](plans/01-embedding-config-contract.md) | [`06-indexer-backfill-command.md`](plans/06-indexer-backfill-command.md), [`07-session-memory-query-facade.md`](plans/07-session-memory-query-facade.md) | Written |
| [`04-embedding-storage-schema.md`](plans/04-embedding-storage-schema.md) | Add embedding metadata schema, sqlite-vec virtual table creation through the adapter when available, pending-only migration for existing `session_memories`, repository helpers, and schema tests. Boundary: storage contracts only, no provider calls. | [`01-embedding-config-contract.md`](plans/01-embedding-config-contract.md), [`02-sqlite-vec-adapter-and-availability.md`](plans/02-sqlite-vec-adapter-and-availability.md) | [`05-session-memory-pending-integration.md`](plans/05-session-memory-pending-integration.md), [`06-indexer-backfill-command.md`](plans/06-indexer-backfill-command.md), [`07-session-memory-query-facade.md`](plans/07-session-memory-query-facade.md) | Written |
| [`05-session-memory-pending-integration.md`](plans/05-session-memory-pending-integration.md) | Integrate Session Memory creation with pending embedding metadata creation/refresh while keeping ingest provider-agnostic. Boundary: write-path pending state only, no Gemini calls or vector writes. | [`04-embedding-storage-schema.md`](plans/04-embedding-storage-schema.md) | [`06-indexer-backfill-command.md`](plans/06-indexer-backfill-command.md), [`07-session-memory-query-facade.md`](plans/07-session-memory-query-facade.md) | Written |
| [`06-indexer-backfill-command.md`](plans/06-indexer-backfill-command.md) | Implement the explicit indexer/backfill lifecycle that selects pending/failed rows for the active contract, calls the embedding provider, writes sqlite-vec rows when available, records retryable failures, and exposes `myelin memory index session`. Boundary: indexing/backfill only, no MCP or Current Briefing. | [`02-sqlite-vec-adapter-and-availability.md`](plans/02-sqlite-vec-adapter-and-availability.md), [`03-embedding-provider-and-normalizer.md`](plans/03-embedding-provider-and-normalizer.md), [`04-embedding-storage-schema.md`](plans/04-embedding-storage-schema.md), [`05-session-memory-pending-integration.md`](plans/05-session-memory-pending-integration.md) | [`07-session-memory-query-facade.md`](plans/07-session-memory-query-facade.md), [`08-docs-validation-and-source-set.md`](plans/08-docs-validation-and-source-set.md) | Written |
| [`07-session-memory-query-facade.md`](plans/07-session-memory-query-facade.md) | Implement internal retrieval-only `query_session_memory(project_key, question, limit, filters)` using active-contract query embeddings, project-scoped sqlite-vec search, metadata joins, and explicit degraded states. Boundary: internal facade only, no MCP tool exposure and no synthesis. | [`02-sqlite-vec-adapter-and-availability.md`](plans/02-sqlite-vec-adapter-and-availability.md), [`03-embedding-provider-and-normalizer.md`](plans/03-embedding-provider-and-normalizer.md), [`04-embedding-storage-schema.md`](plans/04-embedding-storage-schema.md), [`06-indexer-backfill-command.md`](plans/06-indexer-backfill-command.md) | [`08-docs-validation-and-source-set.md`](plans/08-docs-validation-and-source-set.md), later MCP/query design | Written |
| [`08-docs-validation-and-source-set.md`](plans/08-docs-validation-and-source-set.md) | Update config/docs/source-set notes, preserve explicit deferrals, and run full validation. Boundary: docs and verification only, no new behavior. | [`01-embedding-config-contract.md`](plans/01-embedding-config-contract.md) through [`07-session-memory-query-facade.md`](plans/07-session-memory-query-facade.md) | Execution handoff, later MCP/query slice | Written |

## Dependency Order

1. `01-embedding-config-contract.md`
2. `02-sqlite-vec-adapter-and-availability.md` and `03-embedding-provider-and-normalizer.md` can proceed in parallel after Chunk 01.
3. `04-embedding-storage-schema.md` depends on Chunks 01 and 02.
4. `05-session-memory-pending-integration.md` depends on Chunk 04.
5. `06-indexer-backfill-command.md` depends on Chunks 02, 03, 04, and 05.
6. `07-session-memory-query-facade.md` depends on Chunks 02, 03, 04, and 06.
7. `08-docs-validation-and-source-set.md` runs last after behavior lands.

## Shared Contracts

- Canonical memory:
  - `session_memories` remains the source of truth.
  - Embedding metadata and sqlite-vec rows are derived/rebuildable.
- Config:
  - `EMBEDDING_PROVIDER=gemini`
  - `EMBEDDING_GEMINI_MODEL=gemini-embedding-2`
  - `EMBEDDING_DIMENSIONS=1536`
  - `EMBEDDING_BATCH_SIZE=500`
  - `EMBEDDING_STUB_RESPONSES_DIR=<path>`
  - `GEMINI_API_KEY`
  - Environment values override `myelin.config`, matching existing config precedence.
- Active embedding contract:
  - V0 uses one configured active contract for Session Memory retrieval.
  - Contract identity includes provider, model, dimensions, purpose, and format version.
  - Historical contract metadata may exist, but query uses only the configured active contract.
- Embedding purposes:
  - `retrieval_document` for indexed Session Memory text.
  - `retrieval_query` for query text.
- Normalized searchable text:
  - Include `title`, `summary`, `memory_kind`, and selected safe scalar `payload_json` fields.
  - Exclude raw Experience Log text, bulky command output, complete transcripts, and arbitrary nested payload blobs.
  - Fall back to title/summary/kind when payload shape is unclear.
- Degraded states:
  - Missing `GEMINI_API_KEY`, sqlite-vec unavailable, pending vectors, failed vectors, no indexed vectors, and active-contract mismatch must be explicit.
  - Degraded retrieval must not silently table-dump or synthesize.
- Command boundary:
  - `myelin ingest <project-key>` remains Experience Log to Session Memory processing.
  - New index/backfill command must use Myelin vocabulary and must not be confused with `project ingest`.
  - No MCP tool is added in this plan set.

## Spec Coverage Map

| Spec Requirement | Covered By | Notes |
| --- | --- | --- |
| Embedding config separate from chat/model profiles | `01-embedding-config-contract.md` | Includes env precedence and active contract resolver. |
| sqlite-vec isolated behind adapter and degraded availability | `02-sqlite-vec-adapter-and-availability.md` | Early risk-reduction chunk. |
| Gemini/stub embedding provider and deterministic tests | `03-embedding-provider-and-normalizer.md` | Includes current API verification and network-free tests. |
| Safe searchable text contract with fallback | `03-embedding-provider-and-normalizer.md` | Keeps raw Experience Log out of embedding text. |
| Embedding metadata and vector storage | `04-embedding-storage-schema.md` | Metadata exists even if sqlite-vec cannot load. |
| Existing rows marked pending without provider calls | `04-embedding-storage-schema.md` | Migration/backfill contract. |
| New Session Memory writes create pending metadata | `05-session-memory-pending-integration.md` | Keeps ingest provider-agnostic. |
| Dedicated indexer/backfill owns Gemini/sqlite-vec writes | `06-indexer-backfill-command.md` | Handles pending/failed retryable lifecycle. |
| Internal retrieval-only `query_session_memory` facade | `07-session-memory-query-facade.md` | Ranked matches only; no synthesis/MCP. |
| Explicit deferral of MCP and Current Briefing | `08-docs-validation-and-source-set.md` | Keeps follow-up slice clean. |
| Repo-native validation | `01-embedding-config-contract.md` through `08-docs-validation-and-source-set.md` | Targeted tests per chunk plus full validation at the end. |

## Verification Strategy

- Use targeted Bun tests during chunk execution:
  - `src/runtime/runtime.test.ts` for embedding config parsing and env precedence.
  - `src/memory/db.test.ts` for migrations and sqlite-vec metadata/table behavior.
  - new memory/vector adapter tests for sqlite-vec availability/degraded states.
  - new embedding provider tests with deterministic stubs and no network.
  - `src/memory/session-memories.test.ts` for pending metadata creation.
  - command tests under `src/commands/*.test.ts` for the index/backfill command.
  - query facade tests for project scoping, active-contract selection, degraded states, and ranked-match output.
- Use `bun test` as the broad behavioral suite.
- Use `bun run typecheck` after code-changing chunks.
- Use `git diff --check` after doc and code edits.
- Live Gemini calls are not required in CI; provider tests must use stubs.

## Risks And Sequencing Notes

- sqlite-vec runtime loading is the highest technical risk. Keep Chunk 02 early and isolated so later chunks can consume a clear availability/degraded adapter.
- Config and active-contract selection touch config parsing, storage, indexing, and query. Chunk 01 must establish a single shared resolver before schema/index/query code exists.
- Provider behavior must remain network-free in tests. Chunk 03 should not require a real Gemini key.
- Migrations must not call Gemini. Chunk 04 must prove existing rows become pending without provider calls.
- Ingest must remain provider-agnostic. Chunk 05 should integrate through `createSessionMemory`/repository boundaries, not through `src/ingest/worker.ts` provider logic.
- The index/backfill command should be explicit operator work. It must not make query or migration opportunistically call Gemini.
- MCP exposure, Current Briefing consumption, broader `memory query`, and non-Session Memory vectorization remain out of scope.

## Execution Handoff

Recommended next skill after chunk plans are written and approved: `$pmp-executing-plans`.

Execution should load:

- `docs/design/2026-06-13-session-memory-embedding-index/plan.md`
- selected chunk plan files under `docs/design/2026-06-13-session-memory-embedding-index/plans/`
- source artifacts listed above

Recommended execution modes:

- execute one chunk
- execute selected chunks
- execute all chunks in dependency order

Execution must stop on unclear plan steps, failed verification, code/spec conflict, missing dependencies, unexpected sqlite-vec runtime behavior that changes design assumptions, or user-requested changes.

## User Approval

Roadmap was approved by the user before chunk plan generation. Chunk plan files are written and ready for external full plan-set audit.
