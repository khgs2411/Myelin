# `src/evidence/evidence-item.repository.ts`

> Pseudocode artifact. Non-executable reference shape.

This extends the existing EvidenceItemRepository. Its name and insertion
contract remain unchanged. The user accepted the filters, convenience reads,
concrete model results, and query relationship below during this design unit.
No runtime implementation is included.

## Evidence Read Contract

```typescript
interface IEvidenceFilters {
  readonly workspaceContext: WorkspaceContext;
  readonly captureSourceKey: CaptureSourceKey;
  readonly limit: number;
  readonly processing:
    | { readonly kind: "unclaimed" }
    | {
        readonly kind: "status";
        readonly status: "processing" | "void" | "processed";
      }
    | {
        readonly kind: "eligible";
        readonly at: string; // Shared UTC timestamp supplied by EvidenceManager.
      };
}

type EvidenceScopeFilters = Omit<IEvidenceFilters, "processing">;

class EvidenceItemRepository {
  // Existing insertBatch behavior and result remain unchanged.

  public GetEvidence(filters: IEvidenceFilters, transaction: Transaction)
    : Promise<readonly EvidenceItem[]>;

  public GetAllUnclaimedEvidence(filters: EvidenceScopeFilters, transaction: Transaction)
    : Promise<readonly EvidenceItem[]>;
  public GetAllVoidEvidence(filters: EvidenceScopeFilters, transaction: Transaction)
    : Promise<readonly EvidenceItem[]>;
  public GetAllProcessingEvidence(filters: EvidenceScopeFilters, transaction: Transaction)
    : Promise<readonly EvidenceItem[]>;
  public GetAllProcessedEvidence(filters: EvidenceScopeFilters, transaction: Transaction)
    : Promise<readonly EvidenceItem[]>;
  public GetAllEligibleEvidence(filters: EvidenceScopeFilters, at: string, transaction: Transaction)
    : Promise<readonly EvidenceItem[]>;
}
```

These are non-executable method declarations. Transaction is the existing
Sequelize transaction type. WorkspaceContext, CaptureSourceKey, and EvidenceItem
reuse existing project types and the concrete SQLite model. Reads do not map
models into a second evidence DTO.

## Selector Semantics

| Selector | Predicate |
| --- | --- |
| unclaimed | No ledger row exists for the evidence item. |
| status | Ledger status equals the supplied value, without interpreting expiry. |
| eligible | No ledger row, or void, or processing with an expired lease at the supplied time. |

Convenience methods supply their fixed selector and delegate to GetEvidence.
Their filters omit processing so callers cannot replace that selector.
GetAllEligibleEvidence also requires the manager's shared timestamp. Despite
the GetAll names, every method respects the supplied limit.

All reads apply the accepted [workspace and source matching rules](evidence-selection.md),
apply processing eligibility before the limit, and return concrete EvidenceItem
models in projectSequence order. Empty reads return an empty array. Reads never
establish claims or update processing state.

## Repository Coordination

EvidenceItemRepository may join or reference the ledger in its evidence query.
It does not need to fetch an intermediate list of eligible evidence IDs. The
transaction argument controls execution and is separate from query filters.

[EvidenceManager](evidence-manager.ts.md) supplies scope, eligibility, limit,
and a shared expiry-check time. In a single write transaction, it reads evidence
here and writes claims through [EvidenceLedgerRepository](evidence-ledger.repository.ts.md).
Both operations commit together before the manager returns the claimed batch.

EvidenceLedgerRepository owns ledger record reads and writes. EvidenceManager
owns lease business logic and cross-repository transaction coordination.
EvidenceIngestionService processes claimed evidence without accessing either
repository directly. Capture insertion also routes through EvidenceManager,
while existing insertion semantics remain with EvidenceItemRepository.

## Unavailable Captured Git Count

EvidenceManager delegates its CountUnavailableGitEvidence read to this
repository. Count rows by matching Project ID, exact capture source, canonical
working directory, and unavailable captured Git context. This is a separate
count query, with no processing-status predicate and no batch limit. Do not
apply the normal branch-matching filter that would exclude the rows being counted.
The result is a snapshot at query time; the read does not establish leases.
