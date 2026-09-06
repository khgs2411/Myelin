# `src/storage/sqlite/models/evidence-processing-ledger.model.ts`

> Pseudocode artifact. Non-executable reference shape.

Accepted model contract from the design conversation. Intended destination
follows the existing SQLite model directory; no runtime model is created here.

```typescript
class EvidenceProcessingLedger {
  public declare evidenceId: number; // Primary key and FK to EvidenceItem.id.
  public declare status: "processing" | "void" | "processed";
  public declare attemptId: string;
  public declare leaseExpiresAt: string | null; // UTC ISO timestamp.
}
```

## Relationships And Constraints

- Each EvidenceItem has zero or one ledger row. Each ledger row belongs to
  exactly one existing EvidenceItem. evidenceId needs no separate surrogate ID.
- All columns except leaseExpiresAt are required. attemptId must be non-empty.
- SQLite restricts status to the three declared values.
- processing requires a non-null leaseExpiresAt.
- void and processed require a null leaseExpiresAt.
- Project, source, and workspace remain on EvidenceItem. Repository filters
  follow that relationship rather than duplicate those fields on the ledger.

## State Changes

Claiming sets processing, a new attempt ID, and an expiry. All evidence rows
claimed in one batch receive the same attempt ID and expiry. Success sets
processed; failure sets void. Both clear expiry and retain the last attempt ID.
A retry replaces attempt ID and expiry. No row means never claimed. There is no
attempt-history table in this design.

[EvidenceLedgerRepository](evidence-ledger.repository.ts.md) owns reads and
mutations. Ownership checks protect completion and failure writes. Expiry permits
reclamation; a late attempt can renew atomically if it still owns every batch
row. See the repository's lease validity contract.
