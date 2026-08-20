# `src/storage/sqlite/repositories/evidence-acceptance-operation.repository.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination:
`src/storage/sqlite/repositories/evidence-acceptance-operation.repository.ts`

`EvidenceAcceptanceOperationRepository` owns lookup and immutable insertion for
successful evidence acceptance operations. `EvidenceAcceptanceService` owns
the transaction, fingerprint comparison, conflict classification, receipt
validation, and application results.

```ts
// intentionally illustrative pseudocode

type StoredEvidenceAcceptanceOperation = Readonly<{
  operationId: ApplicationOperationId
  projectId: ProjectIdentity
  commandFingerprint: Readonly<{
    scheme: string
    version: positive integer
    digest: string
  }>
  storedReceipt: Readonly<{
    schemaVersion: positive integer
    json: unknown
  }>
  committedAt: normalized timestamp
}>

type SuccessfulEvidenceAcceptanceOperation = Readonly<{
  operationId: ApplicationOperationId
  projectId: ProjectIdentity
  commandFingerprint: Readonly<{
    scheme: string
    version: positive integer
    digest: string
  }>
  receipt: Readonly<{
    schemaVersion: positive integer
    value: EvidenceAcceptanceReceipt
  }>
  committedAt: normalized timestamp
}>

class EvidenceAcceptanceOperationRepository {
  async findByOperationId(
    operationId: ApplicationOperationId,
    transaction: SqliteTransaction
  ): Promise<StoredEvidenceAcceptanceOperation | null> {
    row = find one EvidenceAcceptanceOperation through the supplied transaction
      where operation_id == operationId

    IF row does not exist
      return null

    return {
      operationId: row.operation_id,
      projectId: row.project_id,
      commandFingerprint: {
        scheme: row.fingerprint_scheme,
        version: row.fingerprint_version,
        digest: row.command_fingerprint
      },
      storedReceipt: {
        schemaVersion: row.receipt_schema_version,
        json: row.receipt_json
      },
      committedAt: row.committed_at
    }
  }

  async appendSuccessfulOperation(
    operation: SuccessfulEvidenceAcceptanceOperation,
    transaction: SqliteTransaction
  ): Promise<void> {
    insert one EvidenceAcceptanceOperation through the supplied transaction:
      operation_id: operation.operationId
      project_id: operation.projectId
      fingerprint_scheme: operation.commandFingerprint.scheme
      fingerprint_version: operation.commandFingerprint.version
      command_fingerprint: operation.commandFingerprint.digest
      receipt_schema_version: operation.receipt.schemaVersion
      receipt_json: operation.receipt.value
      committed_at: operation.committedAt
  }
}
```

Both methods require the transaction supplied by `EvidenceAcceptanceService`.
The repository does not create, commit, roll back, or nest transactions.
Operation lookup therefore participates in the same serialized write boundary
as evidence append, maintenance eligibility, and receipt insertion.

`findByOperationId` returns an immutable persistence projection instead of a
Sequelize model. The repository preserves the receipt schema version and raw
stored JSON. It does not decide whether the runtime can decode that receipt or
whether a reused operation identity conflicts with the current command.

`appendSuccessfulOperation` returns no row identity because no established
application contract consumes the internal SQLite-assigned `id`. Uniqueness on
`operation_id` remains the final concurrent-admission constraint.

The repository exposes no update or general delete operation. A rejected or
rolled-back acceptance operation never enters this table. Future explicit
project removal requires its own narrow persistence path.
