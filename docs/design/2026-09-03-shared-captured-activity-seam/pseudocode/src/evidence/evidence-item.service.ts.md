# `src/evidence/evidence-item.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/evidence/evidence-item.service.ts`

`EvidenceItemService` owns durable captured-evidence persistence.

```ts
type CapturedEvidenceReference = Readonly<{
  evidenceId: number
  projectSequence: number
  disposition: "inserted" | "existing"
}>

class EvidenceItemService {
  constructor(private readonly sqliteDatabase: SqliteDatabase) {}

  async insertBatch(
    items: ReadonlyNonEmptyArray<EvidenceItemDto>
  ): Promise<ReadonlyArray<CapturedEvidenceReference>> {
    require all items belong to one Project

    return sqliteDatabase.writeTransaction(transaction => {
      FOR EACH item in order
        replayIdentity = {
          captureSourceKey: item.captureSourceKey,
          projectId: item.workspaceContext.project.id,
          scheme: item.replay.scheme,
          key: item.replay.key
        }

        existing = find EvidenceItem by replayIdentity through transaction

        IF existing exists
          require existing raw-source digest equals item.sourceMaterial.sha256
          append existing reference to result
          continue

        projectSequence = allocate next Project evidence sequence
          through transaction

        row = insert one EvidenceItem through transaction from:
          item
          projectSequence
          current receipt time

        append inserted row reference to result

      return ordered result
    })
  }
}
```

The transaction commits every new row and sequence allocation together. Exact
replay returns existing rows. Reuse of one replay identity with different
source bytes fails the complete operation. The service performs no retry loop.

The service does not parse source input, infer workspace context, read evidence
for a consumer, or invoke memory processing.
