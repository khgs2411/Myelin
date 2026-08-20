# `src/storage/sqlite/models/project.model.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/storage/sqlite/models/project.model.ts`

This artifact defines the Sequelize model for one project overseen by our app.
The base model owns columns. The exported model owns relations as related
models enter the design.

```ts
// intentionally illustrative pseudocode

class BaseProject extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number

  @AllowNull(false)
  @Column({ type: DataType.TEXT, unique: true })
  declare root_path: string

  @AllowNull
  @Column(DataType.TEXT)
  declare repository_root_path: string | null

  @AllowNull(false)
  @Default(0)
  @Column(DataType.INTEGER)
  declare last_allocated_evidence_sequence: number

  declare created_at: timestamp
  declare updated_at: timestamp
}

@Table({
  tableName: "projects",
  timestamps: true,
  underscored: true
})
class Project extends BaseProject {
  @HasMany(() => EvidenceItem, "project_id")
  declare evidenceItems?: Awaited<EvidenceItem[]>

  @HasMany(() => EvidenceAcceptanceOperation, "project_id")
  declare evidenceAcceptanceOperations?: Awaited<EvidenceAcceptanceOperation[]>
}

export default Project
```

## Table contract

```text
PRIMARY KEY (id)
UNIQUE (root_path)
CHECK (last_allocated_evidence_sequence >= 0)
```

`id` is an SQLite-assigned, immutable project identity. `root_path` is the
canonical directory whose exact scope our app oversees. The registration owner
canonicalizes it before persistence. Database uniqueness is the final
concurrency constraint against registering the same root twice.

`repository_root_path` is nullable. A value records the canonical Git
repository root observed during bootstrap. `NULL` means the overseen project is
not Git-backed. Version one does not create a separate repository identity,
model, or table.

`last_allocated_evidence_sequence` is the durable Evidence Log allocation
frontier for this project. Bootstrap initializes it to zero.
`EvidenceLogRepository.reserveProjectSequenceRange` advances it inside the
acceptance transaction. It never decreases, including after evidence is
explicitly forgotten, so a past project-local sequence is never reused.

Sequence allocation is a normal mutation of the project row. Sequelize updates
`updated_at` through its standard timestamp behavior. A separate purpose-built
timestamp enters the model only if a concrete consumer later needs to
distinguish registration changes from other project-state changes.

The project-registration workflow populates this model during bootstrap. It
returns an existing row when the canonical `root_path` is already registered,
or inserts a new row and returns its SQLite-generated `id`. The model does not
canonicalize paths, inspect Git, or own bootstrap behavior.

The project root is replaceable without changing `id`. The relocation workflow
that updates `root_path` and `repository_root_path` remains `OPEN`.
