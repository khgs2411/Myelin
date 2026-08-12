# Project Memory Retrieval Quality Pseudocode Artifacts

Status: Draft

## Draft Shape Summary

These artifacts pin the planned shape for Project Memory retrieval quality before implementation planning. The shape keeps Project Memory markdown canonical, derives structural retrieval metadata deterministically, enriches search text through a separate hint-generation flow, stores SQLite/vector rows as rebuildable serving state, and replaces packet-wide lookup degradation with scoped evidence-aware gating.

## Assumptions Made

- Final product source paths are likely under `src/project/` for Project Memory packet/lookup contracts and `src/memory/` for SQLite/vector storage, matching existing Session Memory retrieval boundaries.
- `state/project-memory-retrieval/` is the project-local state home for structural manifests and category-scoped hint files.
- Root `state/memory.db` remains the SQLite home for vector metadata, retrieval maintenance queue rows, and embedding status rows.
- The first implementation can reuse existing embedding provider/config patterns, but Project Memory retrieval contracts must remain separate from Session Memory semantics.
- Hint-generation model orchestration is model-backed but separate from the Project Memory curator.

## Artifact Map

| Artifact | Type | Intended Destination | Responsibility |
| --- | --- | --- | --- |
| `ProjectMemoryRetrievalContracts.ts` | File-shaped | `src/project/project-memory-retrieval-contracts.ts` | Shared status vocabulary, refs, result shapes, and explicit evidence dependencies. |
| `ProjectMemoryMarkdownSections.ts` | File-shaped | `src/project/project-memory-markdown-sections.ts` | Deterministically extract page/heading/section records from canonical markdown. |
| `ProjectMemoryRetrievalStateFiles.md` | Boundary-shaped | `projects/<key>/state/project-memory-retrieval/*` | Defines project-local state files and wiki/state ownership boundaries. |
| `ProjectMemoryHintGenerationFlow.md` | Flow-shaped | Multiple files, likely `src/project/*` plus provider runner | Defines separate model-backed hint generation after markdown/structural metadata exists. |
| `ProjectMemoryRetrievalStorage.ts` | File-shaped | `src/memory/project-memory-retrieval-storage.ts` and migrations | Defines SQLite metadata, status rows, queue rows, and vector-table adapter shape. |
| `ProjectMemoryRetrievalIndexerFlow.md` | Flow-shaped | `src/memory/project-memory-retrieval-indexer.ts` plus command/service integration | Defines structural refresh, hint validation, embedding, indexing, and retry/failure posture. |
| `ProjectMemoryLookupIntegration.ts` | File-shaped | extend `src/project/project-memory-lookup.ts` and `src/project/project-memory-packet.ts` | Defines query path, fallback lookup, packet result shape, and quality metadata. |
| `ProjectMemoryCuratorEvidenceContract.md` | Boundary-shaped | extend `src/project/project-memory-curator-contracts.ts` and validator | Defines evidence dependencies, explicit no-op decisions, and scoped apply gating. |
| `RetrievalMaintenanceQueue.ts` | File-shaped | `src/memory/retrieval-maintenance-queue.ts` or equivalent | Defines dedicated queue for poor retrieval feedback, hint refresh, and index repair. |
| `ProjectLearnRetrievalLifecycle.md` | Flow-shaped | `src/project/project-memory-curator-service.ts` integration | Shows creation/maintenance sequencing around pre-write lookup, apply, post-write indexing, and review gates. |

## Cross-Artifact Relationships

- `ProjectMemoryMarkdownSections.ts` owns deterministic section ids and hashes consumed by state files, hints, embeddings, lookup results, and evidence dependencies.
- `ProjectMemoryRetrievalStateFiles.md` describes JSON artifacts produced or validated by section extraction and hint generation.
- `ProjectMemoryHintGenerationFlow.md` produces semantic hints that are validated and embedded by `ProjectMemoryRetrievalIndexerFlow.md`.
- `ProjectMemoryRetrievalStorage.ts` stores SQLite status/vector/queue state consumed by lookup, indexer, and maintenance flows.
- `ProjectMemoryLookupIntegration.ts` returns lookup results using `ProjectMemoryRetrievalContracts.ts` vocabulary.
- `ProjectMemoryCuratorEvidenceContract.md` consumes lookup result ids and canonical section refs so validation can gate proposals by actual dependencies.
- `RetrievalMaintenanceQueue.ts` receives semantic usefulness feedback from future query/MCP callers and feeds hint refresh/index repair work without creating Project Memory candidates.

## Libraries And Conventions To Preserve

- Keep canonical Project Memory under `projects/<key>/wiki/**/*.md`.
- Keep machine-readable project state under `projects/<key>/state/`.
- Keep SQLite state under root `state/memory.db`.
- Reuse `openMemoryDb`, migrations, embedding provider contracts, query embedding cache, and sqlite-vec adapter patterns where practical.
- Use deterministic hashes for freshness and idempotency.
- Follow existing result shape conventions: counts, `degraded`, `degraded_reason`, failures, and source tool names.
- Do not make `/mcp` part of core package graph.

## Artifact Quality Checks

- All source-like artifacts start with the non-executable pseudocode header.
- Lifecycle artifacts name inputs, outputs, statuses, idempotency, and failure posture.
- Boundary artifacts include ownership and non-ownership rules.
- The set avoids implementation plans and chunk sequencing.

## Resolved Planning Inputs

- SQLite table names can be chosen during implementation planning, but they should visibly separate Project Memory retrieval state from Session Memory tables.
- Hint-generation jobs use both run artifacts and SQLite job/status rows: run artifacts preserve provider output and validation diagnostics; SQLite rows track retryable serving-state work and embedding/index status.
- Creation mode may report `completed_with_pending_index` when canonical markdown/state writes succeeded but mandatory hint generation, embedding, or indexing remains pending or partially failed.
- Maintenance-mode proposals that depend on fallback lookup require review and must not auto-apply.
- Creation-mode proposals may use fallback lookup as bootstrap context when direct candidate/source evidence supports the write.
- `ExplicitNoOpDecision` applies to any non-empty `project learn` packet that used fallback lookup and produced zero write proposals, in both creation and maintenance modes.

## Use Notes

Downstream pseudocode, planning, and implementation should preserve the ownership boundaries here unless new code evidence forces an explicit divergence. Exact field names can change, but the concepts must remain visible: deterministic section refs, hint freshness, evidence dependencies, scoped apply severity, and a dedicated retrieval-maintenance queue.

## Open Risks Or Allowed Divergence

- Hint-generation provider/model choice is intentionally unspecified; planning can choose a provider profile consistent with existing `Provider Abstraction`.
- Section id generation may need collision handling beyond the draft shape if real markdown contains duplicate headings.
- Existing legacy wiki pages may not match future structured entry conventions; heading-section indexing is the baseline.
- The first implementation may choose a read-only status command before full retrieval-maintenance queue processing, but queue ownership should not be collapsed into Project Memory candidates.

## Non-Executable Rule

Every source-like file in this folder is pseudocode reference material, not implementation.

## Source Artifacts

- `docs/design/2026-06-28-project-memory-retrieval-quality/spec.md`
- `docs/design/2026-06-28-project-memory-retrieval-quality/agenda.md`
- `CONTEXT.md`
- `docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`
- `docs/adr/0021-keep-curated-project-memory-in-markdown.md`
- `docs/adr/0057-vendor-sqlite-runtime-for-vector-extensions.md`
- `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`
- `docs/adr/0059-use-structured-project-memory-apply-payloads.md`
- `docs/adr/0060-use-apply-journal-for-project-memory-writes.md`

## Code Context Inspected

- `src/project/project-memory-lookup.ts`
- `src/project/project-memory-packet.ts`
- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-curator-validator.ts`
- `src/project/project-memory-candidate-intake-service.ts`
- `src/memory/db.ts`
- `src/memory/migrations.ts`
- `src/memory/session-memory-embeddings.ts`
- `src/memory/session-memory-indexer.ts`
- `src/memory/session-memory-query.ts`
- `src/memory/embedding-provider.ts`
- `src/memory/sqlite-vec.ts`
