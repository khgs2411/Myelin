# ProjectMemoryRetrievalIndexerFlow

Pseudocode artifact. Non-executable reference shape for planning.

## Draft Shape

The indexer turns canonical markdown plus valid hints into SQLite/vector serving state. It is idempotent and rebuildable.

## Inputs

- root
- project key
- active embedding contract
- embedding provider
- limit / batch size
- retry failed flag
- optional category or changed-section filter

## Outputs

```text
ProjectMemoryRetrievalIndexResult
  project_key
  structural_sections_seen
  hints_valid
  hints_stale
  hints_orphaned
  selected
  indexed
  failed
  pending_remaining
  degraded
  degraded_reason?
  failures[]
```

## Flow

1. Extract deterministic sections from `wiki/`.
2. Write or update `state/project-memory-retrieval/sections.json`.
3. Load `state/project-memory-retrieval/hints/*.json`.
4. Validate hints against current section refs and hashes.
5. Write `hint-status.json`.
6. Exclude invalid/stale/orphaned hints from normalized embedding text.
7. Ensure pending SQLite embedding metadata rows for current sections and active contract.
8. Mark missing old rows stale/orphaned.
9. Ensure sqlite-vec table availability.
10. Batch embed normalized text.
11. Upsert vectors and mark rows indexed in one transaction per row or batch.
12. Mark failures with retry counts.

## Normalized Embedding Text

Preferred order:

```text
title: <page title>
category: <category>
heading_path: <heading path>
section_text: <section body/snippet>
keywords: <valid hint keywords>
aliases: <valid hint aliases>
topics: <valid hint topics>
query_phrases: <valid hint query phrases>
```

Do not include:

- raw run artifacts;
- full source transcripts;
- invalid/stale/orphaned hints;
- unrelated page sections.

## Terminal States

- `indexed`: current section + hints + embedding contract have vector row.
- `pending`: row needs embedding.
- `failed`: embedding/vector write failed and may be retried.
- `stale`: markdown section hash changed after row creation.
- `orphaned`: wiki path/section no longer exists.

## Idempotency

Unchanged section hash, hint hash, and embedding contract should not re-embed. Changed section or hint hash creates or refreshes pending row for the active contract.

## Failure Posture

- Missing wiki directory degrades index result but does not delete old rows automatically.
- Invalid hint JSON degrades hint validation and excludes that hint file.
- Embedding provider failure marks selected rows failed.
- sqlite-vec unavailable marks selected rows failed/degraded.
- Canonical markdown remains readable through fallback lookup even when indexing fails.
