# `src/storage/sqlite/models/session-maintenance-request.model.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination:
`src/storage/sqlite/models/session-maintenance-request.model.ts`

This artifact defines one finite Session Memory maintenance obligation over a
project-local Evidence Log range. A request owns scheduling state. It does not
own execution attempts or the successful covered frontier.

```ts
// intentionally illustrative pseudocode

type SessionMaintenanceRequestId = positive integer assigned by SQLite
type SessionMaintenanceRequestState = "pending" | "running" | "satisfied"
type SessionMaintenanceRequestPriority = "normal" | "immediate"

class BaseSessionMaintenanceRequest extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: SessionMaintenanceRequestId

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare project_id: number

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare from_sequence_exclusive: number

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare through_sequence_inclusive: number

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare state: SessionMaintenanceRequestState

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare priority: SessionMaintenanceRequestPriority

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare session_maintenance_policy_revision:
    SessionMaintenancePolicyRevision
}

@Table({
  tableName: "session_maintenance_requests",
  timestamps: false,
  indexes: [
    unique project_id where state == "pending",
    unique project_id where state == "running"
  ]
})
class SessionMaintenanceRequest extends BaseSessionMaintenanceRequest {}

export default SessionMaintenanceRequest
```

## Table contract

```text
PRIMARY KEY (id)
FOREIGN KEY (
  project_id,
  session_maintenance_policy_revision
) -> session_maintenance_policies(project_id, revision) ON DELETE RESTRICT

CHECK (session_maintenance_policy_revision > 0)
CHECK (from_sequence_exclusive >= 0)
CHECK (through_sequence_inclusive > from_sequence_exclusive)
CHECK (state IN ('pending', 'running', 'satisfied'))
CHECK (priority IN ('normal', 'immediate'))

CREATE UNIQUE INDEX one_pending_session_maintenance_request_per_project
  ON session_maintenance_requests(project_id)
  WHERE state = 'pending'

CREATE UNIQUE INDEX one_running_session_maintenance_request_per_project
  ON session_maintenance_requests(project_id)
  WHERE state = 'running'
```

The composite foreign key proves that the recorded policy revision belongs to
the same project as the request. A later configuration revision cannot change
the policy meaning of an existing request.

The partial unique indexes enforce multiplicity only. They allow one pending
successor beside one frozen running request. They do not enforce that active
ranges are contiguous, non-overlapping, or monotonic. The application service
must preserve those invariants inside its serialized transaction.

A pending request may extend `through_sequence_inclusive` and may promote from
normal to immediate priority. Its start sequence and policy revision do not
change. Transition to running freezes the complete evidence range and policy
revision. A failed or expired attempt leaves that request running. Successful
completion changes it to satisfied.

`id` is the durable request identity returned in acceptance receipts and later
referenced by attempts. Sequelize timestamps are disabled because no current
request decision depends on a generic creation or update time. Attempt leases
own execution timing.

The database migration owns the composite foreign key and partial-index SQL if
the Sequelize model API cannot express them faithfully. This artifact does not
replace either constraint with a weaker single-column association.

