# SessionMemoryRepository

> Pseudocode artifact. Non-executable reference shape.

Accepted persistence owner. Proposed filename: session-memory.repository.ts;
source directory remains undecided. The insertion signature below is accepted.

```typescript
// Non-executable method shape within SessionMemoryRepository.
public InsertBatch(
  projectId: number,
  drafts: readonly ISessionMemoryDraft[],
  transaction: Transaction,
): Promise<readonly SessionMemoryEntry[]>;
```

Return the created models with assigned IDs, or an empty array for no drafts.
The returned records remain uncommitted until the shared transaction commits.

```text
For each validated ISessionMemoryDraft, using the supplied transaction:
    Insert SessionMemoryEntry with trusted Project ID, content, and observedAt.
        SQLite assigns its canonical entry ID.
    Insert the draft's evidence links for that entry.
    Insert its active lifecycle row with null retirement reason and target.
```

SessionMemoryManager delegates persistence here. The repository uses the existing
entry, evidence-link, and lifecycle models and their constraints. Entry insertion,
non-empty evidence membership, and initial lifecycle are one publication unit.
The existing storage contract requires links before lifecycle insertion.

The repository does not invoke agents, select evidence for curation, update the
evidence ledger, or commit independently. The ingestion service's shared
transaction includes these writes and evidence completion. An empty draft list
creates no records. Persisted reads use concrete SessionMemoryEntry models.

Input and coordination contract: [SessionMemoryManager](session-memory-manager.ts.md).
