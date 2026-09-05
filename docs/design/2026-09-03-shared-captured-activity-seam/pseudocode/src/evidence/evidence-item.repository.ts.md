# `src/evidence/evidence-item.repository.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/evidence/evidence-item.repository.ts`

`EvidenceItemRepository` owns durable captured-evidence persistence.

```ts
type CapturedEvidenceReference = Readonly<{
  evidenceId: number
  projectSequence: number
  disposition: "inserted" | "existing"
}>

interface IEvidenceItemRepository {
  insertBatch(
    items: readonly EvidenceItemDto[]
  ): Promise<readonly CapturedEvidenceReference[]>
}

class EvidenceItemRepository implements IEvidenceItemRepository {
  public constructor(private readonly sqliteDatabase: SqliteDatabase) {}

  public async insertBatch(
    items: ReadonlyNonEmptyArray<EvidenceItemDto>
  ): Promise<ReadonlyArray<CapturedEvidenceReference>> {
    require a non-empty ordered item array
      otherwise throw ApplicationError("capture:invalid-input")
    require all items belong to one Project
      otherwise throw ApplicationError("capture:mixed-project-batch")

    preparedItems = items map in order:
      {
        item,
        sourceDigest: SHA-256(item.sourceMaterial.content)
      }

    return sqliteDatabase.writeTransaction(transaction => {
      FOR EACH { item, sourceDigest } in preparedItems in order
        replayIdentity = {
          captureSourceKey: item.captureSourceKey,
          projectId: item.workspaceContext.project.identity,
          scheme: item.replay.scheme,
          key: item.replay.key
        }

        existing = find EvidenceItem by replayIdentity through transaction

        IF existing exists
          require existing.rawSourceFormat == item.sourceMaterial.format
          require existing.rawSourceContent equals item.sourceMaterial.content byte for byte
            // Either mismatch throws ApplicationError("capture:replay-conflict").
            // The complete transaction rolls back.
          // Preserve the original snapshot even if current Git state differs.
          append existing reference to result
          continue

        projectSequence = allocate next Project evidence sequence
          through transaction

        row = insert one EvidenceItem through transaction from:
          item
          sourceDigest
          projectSequence
          current receipt time

        append inserted row reference to result

      return ordered result
    })
  }
}
```

The repository computes each SHA-256 integrity digest from the serialized source bytes
before opening the write transaction. It stores the digest with each new row.
SHA-256 is fixed for all capture sources. Adapters cannot select or configure it.
The digest does not define event identity or establish source truth.

The transaction commits every new row and sequence allocation together. Exact
replay returns existing rows. Reuse of one replay identity with different
preserved native source fails the complete operation. The repository performs no retry loop.

The repository does not parse source input, infer workspace context, read evidence
for a consumer, or invoke memory processing.

The repository trusts adapter-produced source facts and resolved workspace
context. It does not repeat provider validation or decode source material.
Any validation failure rejects the complete batch.

Replay means submitting the same native event to capture again. Its identity
is capture source + Project identity + replay scheme + replay key. Within the
same Project, matching format and bytes return existing evidence. A mismatch
rejects the batch. A different replay key represents a separate event even
when the content is identical.

Replay is Project-scoped. If the directory resolves to a different Project,
the event is captured independently there; an exact replay already stored in
that Project still returns its existing reference. Original evidence remains
unchanged in the original Project. Capture neither moves evidence nor
deduplicates across Projects. Moving a Project root without changing its
identity does not by itself change replay identity.
