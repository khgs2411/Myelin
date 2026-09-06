# EvidenceLedgerRepository

> Pseudocode artifact. Non-executable reference shape.

Accepted owner: `EvidenceLedgerRepository`. Proposed filename:
`evidence-ledger.repository.ts`; source directory remains undecided.
The claim, ownership, completion, release, and renewal signatures below record
the user-approved contract. Their implementation remains outside this artifact.

One ledger row per evidence item holds current state across retries. No row
means never claimed. States are `processing`, `void` (retryable failure), and
`processed` (successful evaluation, including zero-memory results). Batch rows
share attempt identity and lease expiry. Retries replace ownership. No attempt
history is retained. The [ledger model](evidence-processing-ledger.model.ts.md)
defines its evidence relationship and database constraints.

```text
EvidenceLedgerRepository:
    Read processing records with ledger filters.
    Write claims for evidence IDs selected by EvidenceManager.
    Verify ownership and update expiry or processing status.
    Use the transaction supplied by EvidenceManager.
```

EvidenceManager coordinates reads and writes through this repository and
EvidenceItemRepository. This repository owns ledger persistence only. It does
not fetch evidence batches or coordinate cross-repository transactions.
The accepted persistence signatures are recorded below.

## Claim Write Contract

```typescript
// Non-executable method shape within EvidenceLedgerRepository.
public ClaimEvidence(
  evidenceIds: readonly number[],
  attemptId: string,
  leaseExpiresAt: string,
  transaction: Transaction,
): Promise<void>;
```

EvidenceManager selects eligible evidence and generates the attempt ID and
expiry. It calls ClaimEvidence within the same write transaction used for
selection. The repository upserts one row for each supplied evidence ID, setting
status to processing and applying the shared attemptId and leaseExpiresAt.

This operation neither selects evidence nor commits independently. Eligibility
is established by the manager's selection within that transaction; no second
eligibility query is required here. Empty selection returns null from the
manager without creating an attempt or calling ClaimEvidence.

The accepted [evidence filter and convenience-read API](evidence-item.repository.ts.md)
belongs to EvidenceItemRepository. It includes unclaimed, void, processing,
processed, and eligible evidence reads. Those methods are not ledger repository
methods; this owner returns and mutates processing records.

## Ownership Verification Contract

```typescript
// Non-executable method shape within EvidenceLedgerRepository.
public VerifyOwnership(
  evidenceIds: readonly number[],
  attemptId: string,
  transaction: Transaction,
): Promise<boolean>;
```

Returns true only when every supplied evidence ID has a ledger row with status
processing and the expected attemptId. Missing or mismatched rows return false.
EvidenceManager supplies every ID from the original claimed batch.

Expiry is not an ownership predicate: an expired attempt can still own its rows
and renew them. Verification is used after claiming, before renewal or
publication/completion. It is not part of initial ClaimEvidence, whose input
was selected for eligibility in the same write transaction.

The dependent renewal or completion uses the same transaction as verification.
Do not reuse a successful verification after its transaction ends.

## Completion Contract

```typescript
// Non-executable method shape within EvidenceLedgerRepository.
public CompleteEvidence(
  evidenceIds: readonly number[],
  attemptId: string,
  transaction: Transaction,
): Promise<void>;
```

EvidenceManager calls CompleteEvidence after ownership verification and after
the prepared Session records have been inserted, but before the publication
transaction commits. These inserts are SQLite writes, not agent invocations.
All agent work required to prepare publication and application validation of
its proposed records finishes before this transaction begins.

The update targets supplied evidence IDs still processing under the supplied
attemptId. Set status to processed, clear leaseExpiresAt, and retain attemptId.
Do not commit independently. If completion fails, the transaction rolls back
the Session writes as well. A valid zero-memory result skips Session inserts
but still completes the evidence in this transaction.
Successful completion always covers the complete original batch. Individual
memory evidence links may cover a subset, but that subset must not replace the
batch IDs supplied to CompleteEvidence. Partial batch completion is not supported.

## Failure Release Contract

```typescript
// Non-executable method shape within EvidenceLedgerRepository.
public ReleaseEvidence(
  evidenceIds: readonly number[],
  attemptId: string,
  transaction: Transaction,
): Promise<void>;
```

After processing fails, EvidenceIngestionService asks EvidenceManager to release
the original batch. The manager opens a short transaction and calls this method.
If a publication transaction failed, it must roll back before this cleanup
transaction starts.

Update only supplied evidence IDs still processing under the supplied attemptId:
set status to void, clear leaseExpiresAt, and retain attemptId. Leave replaced
claims and already processed or void rows unchanged. Repeated calls make no
further changes.

Release can affect only the remaining owned portion of a batch. Unlike renewal
or publication, cleanup does not require ownership of every original row and
must not be blocked by a failed whole-batch VerifyOwnership check. Commit only
through the manager's transaction.

## Renewal Contract

```typescript
// Non-executable method shape within EvidenceLedgerRepository.
public RenewEvidence(
  evidenceIds: readonly number[],
  attemptId: string,
  leaseExpiresAt: string,
  transaction: Transaction,
): Promise<void>;
```

When renewal is needed, EvidenceManager opens a short write transaction and
calls VerifyOwnership for the complete original batch. If any claim is missing
or replaced, reject renewal. Otherwise call RenewEvidence with a new expiry and
commit. Verification and renewal use the same transaction.

RenewEvidence updates only leaseExpiresAt for the supplied evidence IDs still
processing under the supplied attemptId. Status and attempt identity remain
unchanged. The manager supplies the new expiry; ingestion does not calculate it.
An expired lease can be renewed. The whole batch renews or nothing changes.

## Lease Validity

Expiry makes evidence eligible for another attempt to claim. It does not, by
itself, prevent the existing attempt from renewing. Use a long lease duration;
its exact value is still to be selected. No periodic renewal mechanism is
required by this accepted slice.

A late result can renew only if every original batch row still has status
processing and the expected attemptId. EvidenceManager checks and extends all
claims atomically through this repository.
If any row fails, renew none and reject publication by the old attempt. A
renewal must check the original batch membership, not only the rows that still
match its attempt ID.

Handled errors and exceptions release owned processing claims to void and clear
expiry. Failure cleanup must not alter rows with a different attemptId or rows
already processed. Expiry permits recovery when a stopped process cannot release
its claims. Completion still verifies ownership in the publication transaction.

## Shared Publication Transaction

`EvidenceIngestionService` coordinates the existing
`SqliteDatabase.writeTransaction` boundary. All persistence operations receive
the same transaction; none commits independently.

```text
With no open database transaction:
    Finish agent execution and all agent work required to prepare publication.
    Validate the proposed records in application code.

EvidenceIngestionService starts one SQLite write transaction:
    EvidenceManager verifies ownership through EvidenceLedgerRepository.
    Insert prepared Session entries, evidence links, and lifecycle rows into SQLite.
        SessionMemoryManager delegates to SessionMemoryRepository using this transaction.
    EvidenceManager calls EvidenceLedgerRepository.CompleteEvidence.
Commit all writes together, or roll back all writes on failure.
```

The ledger repository owns ledger operations, not memory publication. The
ingestion service coordinates the combined operation through EvidenceManager
without accessing either evidence repository directly. This prevents
publication without progress and progress without the
intended publication. Evaluation coverage and concrete API contracts remain in
[Open Design Issues](../design-issues.md).
