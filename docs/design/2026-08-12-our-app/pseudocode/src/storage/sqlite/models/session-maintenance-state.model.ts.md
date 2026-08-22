# `src/storage/sqlite/models/session-maintenance-state.model.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination:
`src/storage/sqlite/models/session-maintenance-state.model.ts`

This artifact defines the Sequelize model for Session Memory's maintenance
progress over one project's Evidence Log. The state belongs to Session Memory,
not to the `Project` model. It references project identity because Session
Memory is project-scoped.

```ts
// intentionally illustrative pseudocode

class BaseSessionMaintenanceState extends Model {
  @PrimaryKey
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare project_id: number

  @AllowNull(false)
  @Default(0)
  @Column(DataType.INTEGER)
  declare last_covered_evidence_sequence: number

  @AllowNull
  @Column(DataType.DATE)
  declare last_successful_maintenance_at: Date | null
}

@Table({
  tableName: "session_maintenance_states",
  timestamps: false
})
class SessionMaintenanceState extends BaseSessionMaintenanceState {
  @BelongsTo(() => Project, "project_id")
  declare project?: Awaited<Project>
}

export default SessionMaintenanceState
```

## Table contract

```text
PRIMARY KEY (project_id)
FOREIGN KEY (project_id) -> projects.id ON DELETE RESTRICT
CHECK (last_covered_evidence_sequence >= 0)
CHECK (
  (last_covered_evidence_sequence = 0
    AND last_successful_maintenance_at IS NULL)
  OR
  (last_covered_evidence_sequence > 0
    AND last_successful_maintenance_at IS NOT NULL)
)
```

`project_id` is both the row identity and project foreign key. One project can
therefore have at most one Session maintenance state. The model has no separate
auto-increment identity because the state has no lifecycle outside its owning
project's Session Memory product.

Project bootstrap creates this row with covered sequence zero and no successful
maintenance time in the same application transaction that creates a new
`Project`. Bootstrap of an already-registered project requires its existing
Session state. Absence is incompatible durable state rather than an implicit
zero cursor.

`last_covered_evidence_sequence` is the highest project-local Evidence Log
sequence completed by successful Session maintenance. Zero means Session
maintenance has never succeeded. Because every request owns a non-empty
evidence range, a positive covered sequence and successful timestamp appear
together.

The model does not copy `Project.last_allocated_evidence_sequence`. SQLite
cannot express their cross-table ordering as a normal row `CHECK`. The guarded
advance operation compares both rows through one caller-supplied `IMMEDIATE`
transaction before it updates this state.

Only the Session maintenance persistence boundary creates, reads, or advances
this model. Higher memory products own separate eligibility and frontier state.
`Project` has no Session-specific columns or reverse Session association.
Sequelize timestamps are disabled because the successful-maintenance timestamp
already records the meaningful state transition.
