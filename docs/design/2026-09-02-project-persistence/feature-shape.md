# Project Persistence — Feature Shape

This shape maps the accepted persistence boundary for registered projects. It
supports many projects while the local prototype selects one hard-coded
project. It excludes public registration commands, project discovery,
resolution from caller input, relocation workflows, and schema migration
lifecycle.

Open design frontier: [Open Design Issues](design-issues.md).

## Feature Map

```text
(hard-coded local project configuration)
  -> [Application]
      -> one caller-owned IMMEDIATE transaction
          -> [Project Registration Store]
              -> [Project]
          -> [SessionMaintenanceLifecycleService]

[SqliteDatabase]
  -> [Project Registration Store]

[EvidenceLogRepository]
  -> [Project] : reserve and advance the project evidence-sequence frontier
```

## Design Item Catalog

| Design item | Representation |
| --- | --- |
| [Project Registration Store](#project-registration-store) | semantic: `Project Registration Store` |
| [Project](#project) | exact: `src/storage/sqlite/models/project.model.ts` |
| [Application](#application) | exact: `src/application.ts` |
| [SqliteDatabase](#sqlitedatabase) | exact: `src/storage/sqlite/sqlite-database.ts` |
| [SessionMaintenanceLifecycleService](#sessionmaintenancelifecycleservice) | exact: `src/session-maintenance/session-maintenance-lifecycle.service.ts` |
| [EvidenceLogRepository](#evidencelogrepository) | exact: `src/storage/sqlite/repositories/evidence-log.repository.ts` |

## New Or Revised Files Or Owners

### Project Registration Store

**Representation:** semantic: `Project Registration Store`

**Evidence:** accepted design and user requirement

Owns durable persistence access for many registered projects. The local
prototype uses this same owner with one hard-coded Project. It receives caller
transactions and does not own public registration, project discovery,
resolution, relocation, or Session lifecycle state.

### Project

**Representation:** exact: `src/storage/sqlite/models/project.model.ts`

**Evidence:** accepted design

Owns one durable project registration. It preserves an immutable private SQLite
identity, an immutable unique public `ProjectKey`, a unique replaceable
canonical root, an optional repository root, and a monotonic project evidence
sequence frontier. Project identity remains stable when an authorized
relocation changes its paths.

Accepted baselines:
[`Project` model](../2026-08-12-our-app/pseudocode/src/storage/sqlite/models/project.model.ts.md)
and
[Project Identity](../2026-09-02-ingestion-boundaries/pseudocode/project-identity.md).

## Existing Files Or Owners Relied On

### Application

**Representation:** exact: `src/application.ts`

**Evidence:** verified implementation and accepted design

Owns process-scoped composition. For the local prototype, it supplies one
hard-coded Project and coordinates Project persistence with Session lifecycle
initialization or validation in one write transaction.

Detailed local composition:
[`Application`](../2026-09-02-ingestion-implementation-foundation/pseudocode/src/application.ts.md).

### SqliteDatabase

**Representation:** exact: `src/storage/sqlite/sqlite-database.ts`

**Evidence:** verified implementation and accepted design

Owns the process-scoped Sequelize connection and managed `IMMEDIATE` write
transactions used by Project persistence.

### SessionMaintenanceLifecycleService

**Representation:** exact:
`src/session-maintenance/session-maintenance-lifecycle.service.ts`

**Evidence:** accepted design

Initializes Session maintenance state after a new Project is inserted in the
same transaction, or requires compatible state for an existing Project. It
does not register projects or repair missing state.

Detailed contract:
[`SessionMaintenanceLifecycleService`](../2026-08-12-our-app/pseudocode/src/session-maintenance/session-maintenance-lifecycle.service.ts.md).

### EvidenceLogRepository

**Representation:** exact:
`src/storage/sqlite/repositories/evidence-log.repository.ts`

**Evidence:** accepted design

Uses the Project row to reserve and advance one project-local evidence sequence
range inside the evidence-acceptance transaction. It does not own Project
registration.

Detailed contract:
[`EvidenceLogRepository`](../2026-08-12-our-app/pseudocode/src/storage/sqlite/repositories/evidence-log.repository.ts.md).

## Admission Rule

This shape admits only owners with an established responsibility in durable
Project persistence, fixed-project startup, or an existing direct consumer of
Project state. It does not use these owners as a design or implementation
sequence.
