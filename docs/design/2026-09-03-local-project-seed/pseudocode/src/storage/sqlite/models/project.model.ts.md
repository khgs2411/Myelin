# `src/storage/sqlite/models/project.model.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/storage/sqlite/models/project.model.ts`

This model makes the SQLite `projects` table the authoritative store for every
registered Project. It uses one permanent multi-project representation. The
local prototype inserts one row; it does not create a separate JSON, YAML, or
prototype-only registry.

```ts
// intentionally illustrative pseudocode

type ProjectIdentity = positive integer assigned by SQLite
type ProjectKey = user-assigned lowercase ASCII slug, 1–64 characters
type CanonicalDirectoryPath = absolute canonical directory path

PROJECT_KEY_GRAMMAR = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

class Project extends Sequelize Model {
  declare id: ProjectIdentity
  declare key: ProjectKey
  declare rootPath: CanonicalDirectoryPath
  declare repositoryRootPath: CanonicalDirectoryPath | null
  declare lastAllocatedEvidenceSequence: non-negative integer
}

MODEL_DEFINITION Project {
  table: "projects"
  timestamps: false

  property mapping:
    rootPath -> root_path
    repositoryRootPath -> repository_root_path
    lastAllocatedEvidenceSequence -> last_allocated_evidence_sequence

  columns:
    id:
      SQLite INTEGER PRIMARY KEY AUTOINCREMENT
      private relational identity

    key:
      SQLite TEXT NOT NULL
      public identity selected by the user
      validate against PROJECT_KEY_GRAMMAR before persistence

    root_path:
      SQLite TEXT NOT NULL
      canonical project root

    repository_root_path:
      SQLite TEXT NULL
      canonical repository root when the Project is repository-backed

    last_allocated_evidence_sequence:
      SQLite INTEGER NOT NULL DEFAULT 0
      durable allocation frontier for project evidence

  constraints:
    UNIQUE (key)
    UNIQUE (root_path)
    CHECK (last_allocated_evidence_sequence >= 0)

  trigger projects_key_immutable:
    BEFORE UPDATE OF key
    WHEN new key differs from old key
    reject the update
}

LOCAL_SEED_ROW {
  id: assigned by SQLite
  key: "llm-wiki"
  root_path: "/Users/liadgoren/Repositories/llm-wiki"
  repository_root_path: "/Users/liadgoren/Repositories/llm-wiki"
  last_allocated_evidence_sequence: 0
}
```

## Identity and mutation boundary

`id` is private database identity. Relations use it as their foreign key.
Callers use the stable `key` value. This unit changes the earlier key origin:
the user supplies the key instead of the application generating it.

The Project model has no timestamps and declares no associations. Reached
features can add navigation only when a concrete consumer requires it.

The local seed assigns `llm-wiki` once. Normal application invocations do not
create, replace, or update this row. A later registration or relocation design
must preserve both identities and explicitly own permitted path changes.

## Storage boundary

The prototype stores the table in `.llm-wiki-dev/state.sqlite`. SQLite
constraints are the final authority for key uniqueness, root uniqueness, and a
valid evidence-sequence frontier.

The Project model maps durable state. It does not:

- discover or canonicalize paths;
- inspect Git or store active branch state;
- implement registration, bootstrap, or relocation;
- create Session Memory state; or
- own evidence or memory-product behavior.
