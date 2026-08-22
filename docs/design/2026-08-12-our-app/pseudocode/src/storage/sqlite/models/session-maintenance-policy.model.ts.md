# `src/storage/sqlite/models/session-maintenance-policy.model.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination:
`src/storage/sqlite/models/session-maintenance-policy.model.ts`

This artifact defines one immutable revision of the effective Session Memory
maintenance policy for one project. It does not define policy for Project,
Personal, or Practice Memory.

```ts
// intentionally illustrative pseudocode

type SessionMaintenancePolicyRevision = positive integer

class BaseSessionMaintenancePolicy extends Model {
  @PrimaryKey
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare project_id: number

  @PrimaryKey
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare revision: SessionMaintenancePolicyRevision

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare evidence_count_threshold: number

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare elapsed_interval: normalized positive duration

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare configuration_digest: string
}

@Table({
  tableName: "session_maintenance_policies",
  timestamps: false
})
class SessionMaintenancePolicy extends BaseSessionMaintenancePolicy {
  @BelongsTo(() => Project, "project_id")
  declare project?: Awaited<Project>
}

export default SessionMaintenancePolicy
```

## Table contract

```text
PRIMARY KEY (project_id, revision)
FOREIGN KEY (project_id) -> projects.id ON DELETE RESTRICT
CHECK (revision > 0)
CHECK (evidence_count_threshold > 0)
CHECK (elapsed_interval > 0)
```

Each row is an immutable effective-policy snapshot. The highest revision for a
project is its active Session policy. There is no mutable active-policy pointer
and no separate policy-revision table.

The first effective policy has revision one. Configuration synchronization
compares canonical effective Session values with the latest stored row inside
the serialized evidence-acceptance transaction supplied through Session
scheduling. It inserts `latest revision + 1` only when those values differ and
uses the exact resulting row for that operation's eligibility decision.

`configuration_digest` supports deterministic comparison and diagnosis, but it
is not unique. Returning to values used by an older policy creates a new
revision because it is a new effective-policy transition.

A Session maintenance request records both project identity and the policy
revision that caused its eligibility. Its composite foreign key therefore
preserves the exact policy meaning after later configuration changes.

A new Project can have no policy row until its first newly accepted evidence.
That acceptance creates revision one atomically with its evidence, scheduling
result, and receipt. A stored operation replay or replay-only new operation does
not create a policy revision. Policy absence after the first accepted project
sequence is incompatible durable state.

Sequelize timestamps are disabled. Revision order records policy transitions,
and no established behavior requires a second creation timestamp.
