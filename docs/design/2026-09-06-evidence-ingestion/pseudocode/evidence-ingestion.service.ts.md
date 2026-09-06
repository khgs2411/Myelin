# EvidenceIngestionService

> Pseudocode artifact. Non-executable reference shape.

Accepted orchestration owner. Proposed filename: evidence-ingestion.service.ts;
source directory and public method name remain undecided. This artifact joins
the accepted contracts without defining the curator execution API.

## Inputs And Owners

- [IEvidenceIngestionRequest](evidence-ingestion.request.ts.md) supplies the working
  directory and capture source.
- [Application configuration](application.configuration.ts.md) supplies validated
  batch size and agents.evidenceCurator execution settings.
- WorkspaceContextService resolves trusted Project and workspace context.
- [EvidenceAdapterFactory](evidence-adapter.factory.ts.md) selects the
  [IEvidenceAdapter](evidence.adapter.ts.md) before claims are requested.
- [EvidenceManager](evidence-manager.ts.md) owns evidence access and lease behavior.
- [SessionMemoryManager](session-memory-manager.ts.md) owns publication coordination.
- SqliteDatabase supplies the existing writeTransaction boundary.

## Service Flow

The body below mixes TypeScript notation and explicit operations deliberately.
Unnamed manager operations describe accepted behavior, not invented API methods.

```typescript
class EvidenceIngestionService {
  // Input: IEvidenceIngestionRequest
  // Result: Promise<IEvidenceIngestionResult>
  // Public entry method name and dependency wiring are not selected here.

  Resolve request.workingDirectory through WorkspaceContextService.
  Continue with the resolved managed workspaceContext and trusted Project ID.
  If current Git context is unavailable, stop before claims.

  adapter = EvidenceAdapterFactory.Create(request.captureSourceKey);
  // Unsupported source fails before claiming evidence.

  claimRequest: IEvidenceClaimRequest = {
    workspaceContext,
    captureSourceKey: request.captureSourceKey,
    batchSize: configuration.evidenceIngestion.batchSize,
  };

  skippedCount = await EvidenceManager.CountUnavailableGitEvidence(
    workspaceContext, request.captureSourceKey,
  );
  // Count before claims: query failure creates no leases.

  Ask EvidenceManager to claim using claimRequest.
  // Manager transaction 1: select eligible evidence + create claims + commit.
  batch: IClaimedEvidenceBatch | null = the manager's result;

  If batch is null:
    Return {
      processedEvidenceCount: 0,
      createdMemoryIds: [],
      skippedUnavailableGitEvidenceCount: skippedCount,
    };

  Retain batch as application-owned context for every later manager operation.

  With no open database transaction:
    prepared = adapter.Prepare(batch.evidence);
    Invoke the Evidence curator through configured agent execution.
      Use prepared evidence and configuration.agents.evidenceCurator.
      // OPEN: concrete execution API and curator task implementation.
    Require successful execution and a structurally valid ICuratorResult.
      Require outcome === "completed" and a memories array.
    Validate the result against the complete original batch.
      Require valid drafts with support IDs belonging to batch.evidence.
      Apply the accepted content and observedAt rules.
      Accept zero drafts only as a valid complete evaluation.
    drafts: readonly ISessionMemoryDraft[] = validated result.memories;

  EvidenceManager handles any required renewal using the original batch.
  // Ingestion neither reads expiry nor calculates lease duration.
  // Expired claims can renew only while the complete batch remains owned.

  created = await SqliteDatabase.writeTransaction(async (transaction) => {
    // Publication transaction 2: database operations only, no agent invocation.
    Ask EvidenceManager to verify ownership of batch using transaction.
    If ownership is invalid, reject publication and roll back.

    entries = await SessionMemoryManager.Publish(
      workspaceContext.project.identity, drafts, transaction,
    );
    Ask EvidenceManager to complete batch using the same transaction.
    Return entries from this transaction callback.
  });
  // The shared commit must succeed before returning the caller result.

  Return {
    processedEvidenceCount: batch.evidence.length,
    createdMemoryIds: created entry IDs,
    skippedUnavailableGitEvidenceCount: skippedCount,
  };
}
```

## Failure And Publication Boundaries

If processing fails after a batch was claimed, roll back any failed publication
transaction before asking EvidenceManager to release the original batch. The
manager uses a short cleanup transaction and releases only still-owned processing
rows. Replaced or processed rows remain unchanged. Propagate the failure after
cleanup; do not return a successful ingestion result. Failures before a batch is
claimed have no returned batch to release. Expiry permits recovery when a process
cannot perform cleanup.

All agent work required to prepare publication finishes before the publication
transaction opens. Memory inserts and full-batch processing completion commit
together. A memory may reference only part of the batch, but completion always
covers the full evaluated batch. Empty drafts create no memories and still
permit successful evidence completion.

The service never accesses evidence repositories directly. It does not decide
retirement, supersession, or promotion. Its
[result](evidence-ingestion.result.ts.md) reports ingestion, not completion of
the separate memory reviewer.

The [curator response](curator.result.ts.md) records reported completion, not
proof of evaluation quality. The later curator task must require full-batch
evaluation. Concrete execution and task implementation remain later work; this
artifact does not authorize runtime implementation.
