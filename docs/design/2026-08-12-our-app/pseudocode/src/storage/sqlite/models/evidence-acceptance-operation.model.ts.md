# `src/storage/sqlite/models/evidence-acceptance-operation.model.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination:
`src/storage/sqlite/models/evidence-acceptance-operation.model.ts`

This artifact defines the immutable Sequelize model for one successful evidence
acceptance operation. The base model owns columns. The exported model owns its
relation to `Project`.

```ts
// intentionally illustrative pseudocode

class BaseEvidenceAcceptanceOperation extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number

  @AllowNull(false)
  @Column({ type: DataType.TEXT, unique: true })
  declare operation_id: string

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare project_id: number

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare fingerprint_scheme: string

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare fingerprint_version: number

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare command_fingerprint: string

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare receipt_schema_version: number

  @AllowNull(false)
  @Column(DataType.JSON)
  declare receipt_json: EvidenceAcceptanceReceipt

  @AllowNull(false)
  @Column(DataType.DATE)
  declare committed_at: Date
}

@Table({
  tableName: "evidence_acceptance_operations",
  timestamps: false
})
class EvidenceAcceptanceOperation extends BaseEvidenceAcceptanceOperation {
  @BelongsTo(() => Project, "project_id")
  declare project?: Awaited<Project>
}

export default EvidenceAcceptanceOperation
```

## Table contract

```text
PRIMARY KEY (id)
UNIQUE (operation_id)
FOREIGN KEY (project_id) -> projects.id ON DELETE RESTRICT
```

`id` is the SQLite-owned row identity. `operation_id` is the application-owned
idempotency identity and the only established operation lookup coordinate.
Database uniqueness is the final constraint against committing two successful
records for the same operation. The internal row identity does not enter the
acceptance receipt or another application contract.

`project_id` records required project ownership. Restrictive deletion prevents
project removal from silently erasing idempotency guarantees. A future explicit
project-removal workflow must delete project-owned state deliberately.

The fingerprint scheme and version select the deterministic command
canonicalization contract. `command_fingerprint` is not unique: separate
operations may submit equal commands. It only detects conflicting reuse of one
`operation_id`.

`receipt_json` stores the complete versioned `EvidenceAcceptanceReceipt`. A
retry returns this stored value rather than recomputing evidence identities,
sequences, or maintenance results. An unsupported `receipt_schema_version`
produces incompatible durable state rather than a reconstructed receipt.

`committed_at` is the application-assigned timestamp for the successful
acceptance transaction. The service selects it inside that transaction. A
rollback leaves no durable record. Sequelize timestamps are disabled because
`created_at` would duplicate this meaning and `updated_at` would imply normal
mutation.

The normal persistence boundary may insert or retrieve this model through the
transaction supplied by `EvidenceAcceptanceService`. It exposes no update or
general delete behavior.
