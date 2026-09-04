# `src/storage/sqlite/models/evidence-item.model.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/storage/sqlite/models/evidence-item.model.ts`

`EvidenceItem` is the immutable Sequelize model for captured input.

```ts
class EvidenceItem extends Model {
  id: SQLite-generated positive integer
  projectId: ProjectIdentity
  projectSequence: positive integer

  captureSourceKey: string
  nativeEventKind: string
  nativeSessionReference: string | null
  nativeInteractionReference: string | null
  nativeOccurredAt: normalized timestamp | null

  normalizedContent: string | null
  workingDirectory: string
  workspaceContextJson: exact serialized WorkspaceContext

  rawSourceMediaType: string
  rawSourceContent: string
  rawSourceSha256: string

  replayScheme: string
  replayKey: string
  receivedAt: normalized timestamp
}

TABLE evidence_items
  primary key (id)
  foreign key (project_id) references projects(id)
  unique (project_id, project_sequence)
  unique (capture_source_key, project_id, replay_scheme, replay_key)

  reject UPDATE and DELETE through ordinary capture behavior
```

`SqliteSchema` adds the table through the next ordered migration and registers
the model during initialization. `EvidenceItemService` supplies all row values
except the SQLite identity.

The normalized projections support later ordered reads. The exact source and
workspace snapshot remain available for later curation. The model does not own
that reading or curation.
