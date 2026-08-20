# `src/storage/sqlite/models/evidence-item.model.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/storage/sqlite/models/evidence-item.model.ts`

This artifact defines the append-only Sequelize model for one accepted
Evidence Log item. The base model owns columns. The exported model owns its
relation to `Project`.

```ts
// intentionally illustrative pseudocode

class BaseEvidenceItem extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare project_id: number

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare project_sequence: number

  @AllowNull
  @Column(DataType.TEXT)
  declare branch: string | null

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare origin_kind: "capture" | "insertion"

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare origin_source_key: string

  @AllowNull(false)
  @Column(DataType.JSON)
  declare origin_json: EvidenceOrigin

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare content: string

  @AllowNull
  @Column(DataType.DATE)
  declare occurred_at: Date | null

  @AllowNull(false)
  @Column(DataType.DATE)
  declare received_at: Date

  @AllowNull(false)
  @Column(DataType.JSON)
  declare workspace_context_json: WorkspaceContext

  @AllowNull(false)
  @Column(DataType.JSON)
  declare source_material_json: EvidenceSourceMaterial

  @AllowNull
  @Column(DataType.TEXT)
  declare replay_domain: string | null

  @AllowNull
  @Column(DataType.TEXT)
  declare replay_scheme: string | null

  @AllowNull
  @Column(DataType.TEXT)
  declare replay_key: string | null

  @AllowNull
  @Column(DataType.TEXT)
  declare replay_fingerprint_scheme: string | null

  @AllowNull
  @Column(DataType.INTEGER)
  declare replay_fingerprint_version: number | null

  @AllowNull
  @Column(DataType.TEXT)
  declare replay_candidate_fingerprint: string | null
}

@Table({
  tableName: "evidence_items",
  timestamps: false
})
class EvidenceItem extends BaseEvidenceItem {
  @BelongsTo(() => Project, "project_id")
  declare project?: Awaited<Project>
}

export default EvidenceItem
```

## Table contract

```text
PRIMARY KEY (id)
FOREIGN KEY (project_id) -> projects.id
UNIQUE (project_id, project_sequence)
UNIQUE (replay_domain, replay_scheme, replay_key)
CHECK (origin_kind IN ("capture", "insertion"))
CHECK (
  every replay column is NULL
  OR every replay column is present
)

INDEX (project_id, branch, project_sequence)
INDEX (project_id, origin_kind, project_sequence)
```

The unique project sequence supports project-wide ordered retrieval. The branch
index supports branch-specific Session Memory retrieval. The origin-kind index
supports the logical Inbox view over insertion-originated evidence.
`origin_source_key` remains relational but unindexed because no established
query requires that index.

`branch`, `origin_kind`, and `origin_source_key` are immutable query projections
from the lossless JSON values. The persistence mapper derives every projection
and JSON snapshot from the same `EvidenceCandidateDto` plus
acceptance-owned `project_sequence` and `received_at` values. SQLite assigns
`id` during insertion.

The nullable replay columns are immutable acceptance metadata. They do not
enter `EvidenceOrigin` or either evidence DTO. Evidence without a reliable
source replay identity stores `NULL` in every replay column. Evidence with a
reliable identity stores the complete identity and versioned candidate
fingerprint as one all-or-none group. Composite uniqueness is the final
cross-command concurrency constraint.

`received_at` is the durable acceptance time. The model disables Sequelize
timestamps because `created_at` would duplicate it and `updated_at` would imply
that accepted evidence is normally mutable.

`EvidenceLogRepository` may append this model and look it up by source replay
identity through a caller-supplied transaction. Its other read surfaces remain
unshaped until concrete consumers establish their query contracts. It exposes
no general update or delete operation. A future explicit-forgetting owner may
receive a separate narrow deletion path; this model does not use SQLite
triggers that would make that required deletion impossible.
