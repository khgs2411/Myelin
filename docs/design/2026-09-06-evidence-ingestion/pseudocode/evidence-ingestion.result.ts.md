# Evidence ingestion result

> Pseudocode artifact. Non-executable reference shape.

Accepted caller result. Proposed filename: evidence-ingestion.result.ts;
source directory remains undecided.

```typescript
interface IEvidenceIngestionResult {
  readonly processedEvidenceCount: number;
  readonly createdMemoryIds: readonly number[];
  readonly skippedUnavailableGitEvidenceCount: number;
}
```

EvidenceIngestionService returns this result to the CLI or maintenance caller.

- With no eligible batch, processedEvidenceCount is zero and createdMemoryIds
  is empty. No attempt is created.
- After successful evaluation and commit, processedEvidenceCount is the full
  claimed batch size. createdMemoryIds contains the IDs returned by publication;
  it can be empty when evaluation produces no memories.
- skippedUnavailableGitEvidenceCount reports excluded evidence with unavailable
  captured Git context within the matching Project, source, and canonical
  directory. It does not count unrelated evidence or merely leased evidence.
- For a processed batch, return success only after publication and evidence
  completion commit together. A repository or manager return alone is not a
  committed outcome.
- Failures propagate as errors after cleanup; do not return a success-shaped
  result. Unavailable current Git context still prevents claiming and is not
  equivalent to an empty eligible batch.

This result reports ingestion, not completion of the separate memory review.
Ingestion obtains the skipped count through
[EvidenceManager.CountUnavailableGitEvidence](evidence-manager.ts.md#unavailable-git-evidence-count)
before claiming. It is a snapshot at query time, with no batch limit or
processing-status filter.
