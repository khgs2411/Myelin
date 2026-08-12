# Product model and storage boundaries

Myelin is a local-first, project-rooted memory system: repository code remains implementation truth, curated Project Memory is reviewable markdown, and SQLite supplies derived recall and workflow state rather than replacing either.

The checkout recorded for this run is available at [repository-identity.json](../repository-identity.json): project `llm-wiki`, branch `master`, commit `78cc13dfcc73145db780b80c38c7d247efd9eca9`, with the sanitized `origin` URL recorded there.

## Memory layers and authority

The model in `MYELIN.md` and `CONTEXT.md` has five memory types. Project Memory is the root scope; Session Memory belongs to one project by default; Practice and Personal Memory are promoted from project evidence; and Experience Log is raw evidence rather than truth.

| Layer | Authority and location | User-visible outcome |
| --- | --- | --- |
| Repository | The inspected codebase (`repo/`) is implementation truth. | Agents verify behavior against code when the curated record is incomplete or stale. |
| Project Memory | `projects/<key>/` contains canonical, human-reviewable Markdown; associated metadata, routing, provenance, and freshness live in `state/<key>/`. | A maintained project has navigable, durable knowledge without treating generated indexes as truth. |
| Preserved sources | `sources/<key>/`, including `inbox/`, keeps source evidence and runtime proposals separate from the wiki. | A proposal remains evidence until curation; it is not silently elevated to a factual page. |
| Session Memory and Experience Log | The repo-root SQLite database at `state/memory/memory.db` stores project-partitioned session memories, event/tombstone records, ingest jobs, candidates, query caches, and retrieval indexes. | Continuity, queueing, and retrieval can be efficient without making a database row canonical knowledge. |
| Practice and Personal Memory | Canonical Markdown, promoted from project-scoped evidence rather than free-floating notes. | Cross-project practices and user preferences can be maintained with provenance. |

The normal reading order is state, `index.md`, changelog or log, relevant wiki pages, preserved source evidence, then repository files when verification needs them. The scope is software repositories; non-repository material is not canonical Project Memory.

`src/runtime/layout.ts` encodes the boundary: a project wiki root is `projects/<key>/`, while sources, state, and runs are sibling roots. It also migrates historical nested layouts and rewrites recorded paths. Collisions abort the layout migration rather than overwriting either location. Moving an existing `state/memory.db` into `state/memory/memory.db` or changing stored retrieval paths changes generated state; it does not rewrite the underlying canonical Markdown by itself.

## Provenance, promotion, and source preservation

Canonical knowledge needs a traceable basis: source file paths, commit or state pointers, snippets, or an explicit inference label. Contradictions and uncertainty are retained instead of being smoothed into a claim.

Runtime inbox creation writes a validated JSON proposal under `sources/<key>/inbox/`. It currently accepts only the `project` target layer; requests for `practice` or `personal` return `unsupported_layer`. The item carries `evidence_refs`, rationale, confidence, risk, and creator information. This is intentionally source preservation, so auto-maintenance scheduling failure does not undo a successfully written inbox item (`src/inbox/runtime-inbox-items.ts`).

Promotion records source consumption separately and only marks supported project candidates or handoffs processed after terminal curation decisions. The supported terminal decisions are `applied_to_project_memory`, `already_covered`, `not_durable`, `belongs_to_other_layer`, and `insufficient_evidence` (`src/project/project-memory-source-consumption-reconciler.ts`). Missing SQLite state degrades reconciliation instead of fabricating completion. This makes an irreversible-looking queue transition auditable and prevents raw evidence from being discarded merely because a curation run was attempted.

Publishing canonical wiki output is deliberately guarded. It validates links and staged writes, preserves before/after hashes in apply records, and can reject publication on broken internal links or later canonical-state drift. In create mode, draft pages absent from the new draft can remove stale canonical Markdown, so create publication is destructive; maintenance should be used when retaining unrelated existing pages matters. The publication boundary rewrites a run-local `repository-identity.json` link to canonical state, as covered by `tests/project/project-memory-draft-promotion.test.ts`.

## SQLite is serving state, not curated truth

`src/memory/db.ts` opens one repo-root database at `state/memory/memory.db`, creates its parent directory as needed, uses WAL mode, enables foreign keys, runs migrations, and retries transient lock errors. The database is partitioned by `project_key`, rather than creating a database per project.

Its migrations (`src/memory/migrations.ts`) show the operational data boundary: `experience_events` and tombstones preserve captured activity and ingest outcomes; `session_memories` holds trusted project continuity; `memory_candidates` and handoff tables hold curation work; and query, embedding, FTS, and vector tables are derived serving structures. Session-memory lifecycle values are `active`, `superseded`, and `retracted`; candidate states are `pending`, `needs_review`, `processed`, and `rejected`.

Derived state may be rebuilt, migrated, rolled back, or pruned according to its specific command contract. In particular, embedding migration/rollback changes the active derived retrieval contract, while prune requires `--apply` and protects active and previous contracts. These actions can remove retired indexes, query-cache metadata, and vectors, but they must not delete canonical Session or Project Memory (`README.md`).

## Public query JSON boundary

Core query behavior lives once in `src/query/`; integrations consume it through the CLI instead of importing core source:

```bash
myelin memory query <project-key> "<question>" --json
```

The supported operation accepts `--limit N`, `--layer session|project`, `--max-inline-chars N`, `--branch current|<name>`, `--json`, and `--debug`. `session` is the default and `project` selects Project Memory retrieval; the removed `auto` layer is rejected. A branch filter applies to Session Memory context. `--debug` adds layer diagnostics; it does not change retrieval authority.

The JSON envelope exposes `answer`, `confidence`, `memory_scope`, `citations`, `candidate_ids`, `degraded`, `degraded_reason`, and `source_tools`, with detailed session and project match arrays. A successful session query reports `session_memory`; a successful project query reports `project_memory` and keeps its project matches separate. Retrieval errors fail closed into a degraded response with zero confidence and an explicit reason; the non-JSON CLI treats degraded output as a command failure. Tests cover JSON diagnostics, branch filtering, project-result shape, the rejected `auto` value, cache reuse, and degraded responses (`tests/commands/memory.test.ts`, `tests/query/memory-query-service.test.ts`).

Detached MCP implementations are outside the root package graph. They must call this CLI/JSON contract; neither a detached MCP checkout nor core runtime may import the other's source (`README.md`). This preserves one query implementation and a stable process/JSON integration boundary. The compatibility `LLM_WIKI_*` variables and `mcp__llm-wiki__*` namespace remain external contracts, while product code and documentation use Myelin naming.

## Known gaps

- The current tests validate the CLI contract and deterministic query service, but this snapshot contains no detached MCP implementation or end-to-end MCP consumer test. The process/JSON boundary is documented and enforced by package-graph policy, while consumer interoperability remains unverified here.
- SQLite/vector availability and provider credentials can make retrieval degraded at runtime. Query reports that condition explicitly; this subject does not claim live embedding-provider coverage from this snapshot.
