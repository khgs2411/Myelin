# `src/storage/sqlite/models/evidence-item.model.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/storage/sqlite/models/evidence-item.model.ts`

`EvidenceItem` is the immutable Sequelize model for captured input.

```ts
class EvidenceItem extends Model {
  public id: SQLite-generated positive integer
  public projectId: ProjectIdentity
  public projectSequence: positive integer

  public captureSourceKey: string
  public nativeEventKind: string
  public nativeSessionReference: string | null
  public nativeInteractionReference: string | null
  public nativeOccurredAt: normalized timestamp | null

  public normalizedContent: string | null
  public workingDirectory: string
  public workspaceContextJson: exact serialized WorkspaceContext

  public rawSourceFormat: string
  public rawSourceContent: bytes stored as SQLite BLOB
  public rawSourceDigest: SHA-256 integrity digest computed by EvidenceItemRepository

  public replayScheme: string
  public replayKey: string
  public receivedAt: normalized timestamp
}

TABLE evidence_items
  primary key (id)
  foreign key (project_id) references projects(id)
  unique (project_id, project_sequence)
  unique (capture_source_key, project_id, replay_scheme, replay_key)

  reject UPDATE and DELETE through ordinary capture behavior
```

`SqliteSchema` adds the table through the next ordered migration and registers
the model during initialization. `EvidenceItemRepository` supplies all row values
except the SQLite identity.

The normalized projections support later ordered reads. The exact source and
workspace snapshot remain available for later curation. The model does not own
that reading or curation.

Captured Git context describes the state observed during capture, not the
state at the native event time. A delayed event from branch A can therefore
have a capture-time observation of branch B. Any branch supplied by the source
remains separate source data; it does not replace the observed workspace
context. Exact replay returns the existing evidence and preserves its original
workspace snapshot.

Replay uniqueness includes Project identity. The same source coordinates can
exist independently in different Projects. Capture does not move existing rows
when registration mapping changes.
