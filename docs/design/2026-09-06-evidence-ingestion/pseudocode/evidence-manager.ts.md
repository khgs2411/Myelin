# EvidenceManager

> Pseudocode artifact. Non-executable reference shape.

Accepted coordination owner. Proposed filename: evidence-manager.ts; source
directory and exact API signatures remain under design.

EvidenceManager coordinates the existing EvidenceItemRepository and the new
EvidenceLedgerRepository. EvidenceIngestionService processes claimed evidence;
it does not implement selection-and-lease business logic.

## Unavailable Git Evidence Count

```typescript
// Non-executable method shape within EvidenceManager.
public CountUnavailableGitEvidence(
  workspaceContext: WorkspaceContext,
  captureSourceKey: CaptureSourceKey,
): Promise<number>;
```

Delegate counting to EvidenceItemRepository. Count evidence with unavailable
captured Git context in the matching Project, exact capture source, and canonical
directory. Apply no processing-status filter or batch limit. The count represents
records present when queried; it is not a live total.

Ingestion calls this before requesting claims, including when selection will
return null. A count failure therefore creates no leases. The claimed batch
contract remains unchanged. Recovery of excluded evidence stays deferred.

## Claim Input Contract

User-approved input shape:

```typescript
interface IEvidenceClaimRequest {
  readonly workspaceContext: WorkspaceContext;
  readonly captureSourceKey: CaptureSourceKey;
  readonly batchSize: number;
}
```

EvidenceIngestionService supplies workspaceContext resolved by
WorkspaceContextService, captureSourceKey from the ingestion request, and
batchSize from validated application configuration. WorkspaceContext and
CaptureSourceKey are existing types.

EvidenceManager applies the accepted matching and eligibility rules and claims
the selected evidence in one transaction. The operation returns
IClaimedEvidenceBatch or null. Attempt IDs and lease expiry remain internal to
EvidenceManager; they are not caller-selected request fields.

## Claimed Batch Contract

User-approved return shape:

```typescript
interface IClaimedEvidenceBatch {
  readonly attemptId: string;
  readonly evidence: readonly EvidenceItem[];
}
```

EvidenceItem is the existing concrete SQLite model. The evidence array contains
the original claimed batch in projectSequence order. Return the batch only
after all claims commit. If selection finds no eligible evidence, return null
and create no attempt.

EvidenceIngestionService passes this batch back for renewal, completion, and
failure release. EvidenceManager checks every original evidence ID against the
attempt ID; it must not infer original membership only from rows that still
match that attempt. Lease expiry stays inside the manager and ledger.

The batch is application-owned claim context. Agent output cannot replace its
attempt ID or original evidence membership.

## Coordination

### Whole-Batch Evaluation

The claimed batch is one evaluation unit. The curator evaluates all prepared
evidence and may propose zero or more memories. Each memory may use only a
subset of that evidence as support; support membership does not determine
processing completion.

Successful completion marks the entire original batch processed, including
evidence that supports no published memory. Partial batch completion is not
supported. If execution fails or the result is invalid, publish nothing and
release the claims still owned by that attempt. Memory review remains separate.

### Transaction Sequence

The normal ingestion pipeline has two separate database transactions. The first
selects and claims evidence, then commits before returning the batch. Agent
preparation and execution occur outside a database transaction. The second
verifies current ownership and commits memory publication with processing
completion. If ownership has changed during agent work, publish nothing.

For renewal and publication, EvidenceManager passes every original evidence ID
and the attempt ID to EvidenceLedgerRepository.VerifyOwnership. Verification
and its dependent writes stay in the same transaction. Initial claiming does
not call VerifyOwnership; it establishes ownership after eligibility selection.

```text
Capture:
    EvidenceCaptureService normalizes and prepares evidence.
    EvidenceManager delegates insertion to EvidenceItemRepository.

Claim:
    EvidenceManager opens one SqliteDatabase write transaction.
        EvidenceItemRepository reads evidence matching workspace/source filters
            and ledger eligibility, before ordering and limiting.
            Use one query with a ledger join or existence condition.
            Eligible: no ledger row, void, or expired processing.
        Generate the attempt ID and expiry for a non-empty selection.
        EvidenceLedgerRepository.ClaimEvidence receives the selected evidence IDs,
            shared attempt ID, expiry, and the same transaction.
    Commit together and return the claimed batch.

Lease lifecycle:
    EvidenceManager coordinates expiry, atomic renewal, completion, and failure
        release through EvidenceLedgerRepository.
    Preserve the accepted attempt ownership checks for every mutation.
    For renewal, verify the complete original batch in a short write transaction.
        If valid, call RenewEvidence with a manager-calculated expiry and commit.
        Otherwise renew nothing. Expired claims can renew if still owned.
    On failure, open a short cleanup transaction and call ReleaseEvidence.
        Release only original rows still processing under this attempt ID.
        Do not require whole-batch ownership or alter replaced claims.

Publication:
    Finish required agent work and validate proposed records before opening SQLite's
        publication transaction. No agent invocation occurs inside it.
    EvidenceIngestionService opens the shared publication transaction.
        EvidenceManager verifies claim ownership through the ledger repository.
        Insert the prepared Session records through memory persistence.
            SessionMemoryManager delegates to SessionMemoryRepository using this transaction.
        EvidenceManager calls EvidenceLedgerRepository.CompleteEvidence.
    All participants use that same transaction; commit or roll back together.
```

EvidenceItemRepository retains its name and existing insertion contract. Extend
it for evidence reads; do not introduce an EvidenceRepository alongside it.
Capture normalization stays in EvidenceCaptureService. The manager does not
interpret evidence, invoke agents, or publish memories.

Filtered evidence reads belong to EvidenceItemRepository. EvidenceManager
combines evidence filters with ledger eligibility; EvidenceLedgerRepository
reads and writes processing records. The [evidence repository API](evidence-item.repository.ts.md)
defines evidence filters and results. The ledger artifact defines the accepted
persistence signatures; the manager's claimed batch result is established above.
This separation must not introduce a fetch/claim race or apply
ledger eligibility after the batch limit.

The approved query relationship permits EvidenceItemRepository to reference
ledger records in its evidence-selection query. Its result remains EvidenceItem
models; EvidenceLedgerRepository owns ledger record operations. EvidenceManager
supplies eligibility criteria and one shared time value for expiry comparison.
Both repositories receive the same write transaction. Do not fetch a separate
unbounded list of eligible IDs or filter ledger eligibility after the limit.

The manager uses the accepted [selection](evidence-selection.md) and
[lease rules](evidence-ledger.repository.ts.md#lease-validity).
