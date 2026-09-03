# Fixed Local Project Context — Feature Shape

> Superseded by the
> [unified Fixed Local Project Context unit](../2026-09-03-fixed-local-project-context/feature-shape.md).

For each repository-local prototype CLI invocation, establish one known LLM
Wiki workspace context backed by durable Project and Session lifecycle state.
This unit excludes general project registration, caller-selected project
resolution, filesystem or Git inference, relocation, evidence intake,
installation, and distribution.

Open design frontier: [Open Design Issues](design-issues.md).

## Feature Map

```text
(fixed local project, repository, branch, and database configuration)
  -> [Application]
      -> [SqliteDatabase] : open, transact, close
      -> one caller-owned IMMEDIATE transaction
          -> [Project Registration Store]
              -> [Project]
          -> [SessionMaintenanceLifecycleService]
      -> (fixed WorkspaceContext for this invocation)

[Project] -X-> (active branch state)
[Application] -X-> (project discovery | Git inspection | public project selection)
```

## Design Item Catalog

| Design item | Representation |
| --- | --- |
| [Application](#application) | exact: `src/application.ts` |
| [Project Registration Store](#project-registration-store) | semantic: `Project Registration Store` |
| [Project](#project) | exact: `src/storage/sqlite/models/project.model.ts` |
| [SqliteDatabase](#sqlitedatabase) | exact: `src/storage/sqlite/sqlite-database.ts` |
| [SessionMaintenanceLifecycleService](#sessionmaintenancelifecycleservice) | exact: `src/session-maintenance/session-maintenance-lifecycle.service.ts` |

## New Or Revised Files Or Owners

### Application

**Representation:** exact: `src/application.ts`

**Evidence:** verified implementation, accepted design, and user requirement

Owns one complete invocation composition. It opens one process-scoped database,
supplies the fixed local configuration, coordinates Project persistence and
Session lifecycle state in one write transaction, constructs the fixed
`WorkspaceContext`, and closes the database after the operation finishes.

Detailed invocation shape:
[`Application`](pseudocode/src/application.ts.md).

### Project Registration Store

**Representation:** semantic: `Project Registration Store`

**Evidence:** accepted design and user requirement

Owns durable access to registrations in the final multi-project data model.
For this prototype, it creates or loads the one fixed LLM Wiki Project through
a caller-supplied transaction and reports whether the Project was created or
already existed. It does not own Session state, public registration,
resolution, relocation, or project discovery.

### Project

**Representation:** exact: `src/storage/sqlite/models/project.model.ts`

**Evidence:** accepted design

Owns one durable project registration. It holds the private SQLite identity,
immutable public `ProjectKey`, canonical project root, optional repository
root, and project evidence-sequence frontier. The fixed branch belongs to the
invocation `WorkspaceContext`; it is not durable Project state.

Accepted baselines:
[`Project` model](../2026-08-12-our-app/pseudocode/src/storage/sqlite/models/project.model.ts.md)
and
[Project Identity](../2026-09-02-ingestion-boundaries/pseudocode/project-identity.md).

## Existing Files Or Owners Relied On

### SqliteDatabase

**Representation:** exact: `src/storage/sqlite/sqlite-database.ts`

**Evidence:** verified implementation and accepted design

Owns the process-scoped Sequelize connection, managed `IMMEDIATE` transaction,
and cleanup boundary used during local context initialization.

### SessionMaintenanceLifecycleService

**Representation:** exact:
`src/session-maintenance/session-maintenance-lifecycle.service.ts`

**Evidence:** accepted design

Initializes Session maintenance state for a newly created Project or requires
compatible existing state for an existing Project. Both operations join the
Project transaction. Missing state for an existing Project is not repaired.

Detailed contract:
[`SessionMaintenanceLifecycleService`](../2026-08-12-our-app/pseudocode/src/session-maintenance/session-maintenance-lifecycle.service.ts.md).

## Admission Rule

This is the smallest established macro shape for producing one trustworthy
fixed local `WorkspaceContext` on every invocation. Each admitted owner either
controls the invocation, persists its durable identity, supplies its atomic
transaction, or establishes the required Session lifecycle state.
