# SessionMemoryManager

> Pseudocode artifact. Non-executable reference shape.

Accepted coordination owner. Proposed filename: session-memory-manager.ts;
source directory remains undecided. The publication signature below is accepted.

```typescript
interface ISessionMemoryDraft {
  readonly content: string;
  readonly observedAt: string | null;
  readonly evidenceIds: readonly number[];
}

// Non-executable method shape within SessionMemoryManager.
public Publish(
  projectId: number,
  drafts: readonly ISessionMemoryDraft[],
  transaction: Transaction,
): Promise<readonly SessionMemoryEntry[]>;
```

SessionMemoryManager receives the prepared drafts, the trusted Project ID, and
the shared publication transaction. It coordinates publication through
SessionMemoryRepository. Neither owner invokes an agent or commits independently.

The ingestion service supplies projectId from its resolved workspace, validated
drafts, and the open publication transaction. Publish delegates to the
repository's InsertBatch with those arguments. Both return created
SessionMemoryEntry models with assigned IDs, or an empty array for no drafts.
Returning does not mean committed: evidence completion and the shared commit
must still succeed. Failure rolls back the memory writes.

Before publication, application validation establishes non-empty content, at
least one supporting evidence item per draft, and membership of every referenced
evidence ID in the original claimed batch. observedAt follows the accepted
supporting-observation rule: latest supporting observation time, or null if
unknown, without substituting receipt or creation time.

This creation contract is not a second representation of persisted reads.
Reads return concrete SessionMemoryEntry models. The curator supplies neither
canonical entry IDs nor lifecycle state. Empty drafts are valid: create no
memory records but permit completion of the evaluated evidence batch.

```text
Before the transaction:
    Finish required agent work and validate proposed records against the batch.

EvidenceIngestionService opens the publication transaction:
    EvidenceManager verifies batch ownership.
    SessionMemoryManager receives drafts, trusted Project ID, and transaction.
        SessionMemoryRepository persists entries, evidence links, active lifecycles.
    EvidenceManager completes processing for the original batch.
Commit together or roll back together.
```

Retirement, supersession, and promotion decisions remain with the separate memory
reviewer. This publication contract creates active memories only.
