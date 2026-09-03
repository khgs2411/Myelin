# Local Project Seed — Feature Shape

Establish one durable Project registration for this repository in the local
development database. The registration uses the final multi-project Project
model. This unit excludes reusable project registration, bootstrap, discovery,
relocation, invocation-context resolution, installation, evidence intake, and
Session Memory state.

## Feature Map

```text
[SqliteDatabase]
  -> [SqliteSchema] : register models and establish versioned schema
      -> [Project] : create projects table and immutable-key trigger

(fixed local seed facts)
  -> [Local Project Seed Script]
      -> [SqliteDatabase] : open schema-current database and transact
      -> [Project] : insert or verify key "llm-wiki"

[SqliteSchema] -X-> (local Project row)
[Local Project Seed Script] -X-> (registration command | bootstrap | relocation)
```

## Design Item Catalog

| Design item | Representation |
| --- | --- |
| [Project](#project) | exact: `src/storage/sqlite/models/project.model.ts` |
| [SqliteSchema](#sqliteschema) | exact: `src/storage/sqlite/sqlite-schema.ts` |
| [Local Project Seed Script](#local-project-seed-script) | exact: `scripts/seed-local-project.ts` |
| [SqliteDatabase](#sqlitedatabase) | exact: `src/storage/sqlite/sqlite-database.ts` |

## New Or Revised Files Or Owners

### Project

**Representation:** exact: `src/storage/sqlite/models/project.model.ts`

**Evidence:** accepted design and user requirement

Owns one durable registration in the application's multi-project data model.
It stores a generated private SQLite identity, the immutable user-assigned
public key `llm-wiki`, the canonical project root, the canonical repository
root, and the project evidence-sequence frontier. Branch state does not belong
to the Project row.

The public key is a lowercase ASCII slug of 1–64 characters. Single hyphens
may separate alphanumeric segments. SQLite enforces key and root uniqueness,
prevents key mutation, and requires a non-negative evidence-sequence frontier.
The model has no timestamps or associations.

The local seed creates data through this permanent model. It does not create a
prototype-only project representation.

Established baselines:
[Project model](../2026-08-12-our-app/pseudocode/src/storage/sqlite/models/project.model.ts.md)
and
[Project identity boundary](../2026-09-02-ingestion-boundaries/pseudocode/project-identity.md).
The current user requirement changes the public key source from
application-generated to user-assigned while preserving public and private
identity separation.

Detailed design:
[`Project`](pseudocode/src/storage/sqlite/models/project.model.ts.md).

### SqliteSchema

**Representation:** exact: `src/storage/sqlite/sqlite-schema.ts`

**Evidence:** accepted design and verified Sequelize capability

Owns the complete Sequelize model registry, ordered immutable migration
registry, migration-history validation, and application-schema establishment.
It establishes the schema inside one `IMMEDIATE` transaction and rejects a
migration history that is not an exact known prefix.

Detailed design:
[`SqliteSchema`](pseudocode/src/storage/sqlite/sqlite-schema.ts.md).

### Local Project Seed Script

**Representation:** exact: `scripts/seed-local-project.ts`

**Evidence:** accepted design and user requirement

Owns one explicit development-only action that seeds or verifies this
repository's fixed Project row. It accepts no arguments, treats an exact match
as a successful replay, and rejects every key or path conflict without
updating durable state.

Detailed design:
[`Local Project Seed Script`](pseudocode/scripts/seed-local-project.ts.md).

## Existing Files Or Owners Relied On

### SqliteDatabase

**Representation:** exact: `src/storage/sqlite/sqlite-database.ts`

**Evidence:** verified implementation and accepted design

Owns the process-scoped Sequelize connection, SQLite capability validation,
managed write transactions, and cleanup boundary for the local database at
`.llm-wiki-dev/state.sqlite`.

## Admission Rule

The shape admits only the durable Project representation and the implemented
database owner that persists it, plus the accepted schema and development-seed
owners required to establish that state safely. General project registration
remains outside this unit.
