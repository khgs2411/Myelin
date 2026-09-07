# `src/evidence-ingestion/evidence-ingestion.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Focused revision to the existing service. User-approved on 2026-09-07:
remove preparation-adapter selection and treat captureSourceKey solely as an
exact filter over stored evidence. No ingestion source registry replaces it.

```typescript
class EvidenceIngestionService {
  // Remove the EvidenceAdapterFactory constructor dependency.
  // Preserve existing workspace, manager, publication, database,
  // configuration, and curator-executor dependencies.

  public async Ingest(
    request: IEvidenceIngestionRequest,
  ): Promise<IEvidenceIngestionResult> {
    // Resolve the requested workspace through the existing resolver.
    // Preserve failure for unmanaged workspace or unavailable current Git.
    // Do not check captureSourceKey against a supported-source registry.

    // Count excluded unavailable-Git evidence through EvidenceManager,
    // using the resolved workspace and exact request.captureSourceKey.
    // Ask EvidenceManager to select and claim evidence with the same scope
    // and configured batch size, using its existing atomic operation.

    // If no eligible rows match, return the existing empty result:
    // processedEvidenceCount: 0
    // createdMemoryIds: []
    // skippedUnavailableGitEvidenceCount: the count obtained above

    // For a claimed batch, retain the existing failure-handling boundary:
    //   drafts <- await this.prepareAndCurate(batch)
    //   Renew the original batch's lease; stop if ownership has changed.
    //   In one short publication transaction:
    //     verify ownership of the complete original batch
    //     publish validated drafts
    //     mark the complete original batch processed
    //   Return the existing committed ingestion result.
    // On failure, release claims still owned by this attempt and propagate
    // the failure. A failed publication transaction rolls back before release.
  }

  private async prepareAndCurate(
    batch: IClaimedEvidenceBatch,
  ): Promise<readonly ISessionMemoryDraft[]> {
    // Remove the former IEvidenceAdapter parameter.
    // Construct one IPreparedEvidenceItem per row in batch.evidence:
    //   evidenceId <- row.id
    //   content <- row.normalizedContent, unchanged
    //   speakerRole <- row.speakerRole
    //   nativeEventKind <- row.nativeEventKind
    //   nativeSessionReference <- row.nativeSessionReference
    //   nativeInteractionReference <- row.nativeInteractionReference
    //   nativeOccurredAt <- row.nativeOccurredAt
    // Preserve input order; do not filter, interpret, or summarize here.

    // result <- await curatorExecutor.Execute(
    //   preparedEvidence, configuration.agents.evidenceCurator)
    // Return the existing validateCuratorResult(result, batch.evidence).
    // Mapping, execution, and validation run without an open DB transaction.
    // Failures propagate to Ingest's existing claim-release boundary.
  }
}
```

Application still selects the configured curator executor when composing the
service for ingestion. Unsupported execution configuration fails before claims.
Removing source-adapter selection does not remove this independent execution
check. Application no longer supplies an EvidenceAdapterFactory to this service.

An unknown captureSourceKey has no matching stored rows and returns the normal
empty result after the existing pre-claim checks succeed. A known source with
no eligible rows behaves the same way. No supported-source error is introduced
for ingestion. Capture retains its own adapter selection and validation.

The [preparation flow](../../evidence-preparation.md) defines direct field mapping.
The parent ingestion unit continues to control claim ownership, whole-batch
evaluation, and atomic publication. This sketch does not revise those contracts.

User-approved on 2026-09-07: direct mapping remains inside the existing private
prepareAndCurate method with its adapter parameter removed. Its caller retains
the established lease renewal, ownership verification, atomic publication, and
failure cleanup sequence. A completed curator result with zero memories still
uses the normal whole-batch completion path.
