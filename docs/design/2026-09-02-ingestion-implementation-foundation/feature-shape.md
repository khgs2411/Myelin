# Local Ingestion Prototype Foundation — Feature Shape

This shape maps the established owners behind the repository-local manual
ingestion interface. It uses fixed local project, repository, branch, and
database facts. It includes controlled Session capture fixtures and explicit
Project, Personal, and Practice Memory proposals. It excludes project
bootstrap, public project-key input, filesystem or Git inference, provider
hooks, Session maintenance execution, query, installation, and distribution.

Established product behavior comes from the
[canonical application shape](../feature-shape.md) and the
[Ingestion Boundaries design unit](../2026-09-02-ingestion-boundaries/feature-shape.md).

Open design frontier: [Open Design Issues](design-issues.md).

## Feature Map

```text
(fixed local database | project root | repository root | master branch)
  -> [src/cli.ts]
      -> [Application]
          -> [Project Registration Store] : ensure one fixed local project
          -> [SessionMaintenance] : ensure its lifecycle

(development transcript file)
  -> [src/cli.ts] : dev capture-fixture
      -> [Application]
          -> [Development Capture Fixture]
              -> [CapturedEvidenceIngestionService]
                  -> [EvidenceAcceptanceService]
                      -> [Evidence Persistence]
                      -> [SessionMaintenance] : schedule obligation

(human | agent supplied text, files, or explicit standard input)
  -> [src/cli.ts] : memory propose <project | personal | practice>
      -> [Application]
          -> [Targeted Memory Insertion]
              -> exactly one selected durable memory product Inbox

[Targeted Memory Insertion] -X-> [SessionMaintenance]
[Targeted Memory Insertion] -X-> (direct canonical memory writes)

[SqliteRuntime]
  -> [SqliteDatabase]
      -> [Project Registration Store]
      -> [Evidence Persistence]
      -> [SessionMaintenance]

[src/cli.ts] -X-> (bootstrap | path inference | branch inference)
[src/cli.ts] -X-> (package bin | host installation | stable machine protocol)
[Development Capture Fixture] -X-> (production distribution)
```

## Design Item Catalog

| Design item | Representation |
| --- | --- |
| [src/cli.ts](#srcclits) | exact: `src/cli.ts` |
| [Application](#application) | exact: `src/application.ts` |
| [Project Registration Store](#project-registration-store) | semantic: `Project Registration Store` |
| [Development Capture Fixture](#development-capture-fixture) | semantic: `Development Capture Fixture` |
| [CapturedEvidenceIngestionService](#capturedevidenceingestionservice) | exact: `src/capture/captured-evidence-ingestion.service.ts` |
| [EvidenceAcceptanceService](#evidenceacceptanceservice) | exact: `src/evidence/evidence-acceptance.service.ts` |
| [Targeted Memory Insertion](#targeted-memory-insertion) | semantic: `Targeted Memory Insertion` |
| [Evidence Persistence](#evidence-persistence) | exact: evidence models and repositories under `src/storage/sqlite/` |
| [SessionMaintenance](#sessionmaintenance) | exact: `src/session-maintenance/` and its SQLite persistence |
| [SqliteRuntime](#sqliteruntime) | exact: `src/storage/sqlite/sqlite-runtime.ts` |
| [SqliteDatabase](#sqlitedatabase) | exact: `src/storage/sqlite/sqlite-database.ts` |

## New Or Revised Files Or Owners

### src/cli.ts

**Representation:** exact: `src/cli.ts`

**Evidence:** accepted design and user requirement

Owns one repository-local Bun command tree for manual ingestion. It supplies
fixed local prototype facts, exposes `dev capture-fixture` and
`memory propose <project | personal | practice>`, acquires exact input, routes
each operation through `Application`, presents safe results, and closes the
application. It does not bootstrap or discover a project.

Detailed design:
[`src/cli.ts`](pseudocode/src/cli.ts.md).

### Application

**Representation:** exact: `src/application.ts`

**Evidence:** verified implementation and accepted design

Owns process-scoped composition and the provider-neutral application facade.
For the local prototype, it ensures one fixed Project row and its Session
maintenance lifecycle, injects the fixed context into capture and targeted
memory proposals, and owns one SQLite lifecycle.

Detailed local composition:
[`src/application.ts`](pseudocode/src/application.ts.md).

Broader application boundary:
[`src/application.ts`](../2026-08-12-our-app/pseudocode/src/application.ts.md).

### Project Registration Store

**Representation:** semantic: `Project Registration Store`

**Evidence:** accepted design

Owns the private SQLite Project row required by evidence and Session foreign
keys. For this prototype, it ensures only the one fixed local project supplied
by application composition. It does not expose registration or resolution to
the CLI.

Detailed persistence baseline:
[`Project` model](../2026-08-12-our-app/pseudocode/src/storage/sqlite/models/project.model.ts.md).

### Development Capture Fixture

**Representation:** semantic: `Development Capture Fixture`

**Evidence:** accepted design and user requirement

Owns conversion of one exact transcript fixture into a deterministic
development capture observation. It receives the fixed local context from
application composition and delegates to the same captured-evidence ingestion
service later provider capture will use.

### CapturedEvidenceIngestionService

**Representation:** exact: `src/capture/captured-evidence-ingestion.service.ts`

**Evidence:** accepted design

Owns deterministic conversion of the fixture observation and supplied local
context into evidence candidates with source material and replay metadata. It
delegates durable acceptance and does not inspect the filesystem or Git.

Detailed contract:
[`CapturedEvidenceIngestionService`](../2026-09-02-ingestion-boundaries/pseudocode/src/capture/captured-evidence-ingestion.service.ts.md).

### EvidenceAcceptanceService

**Representation:** exact: `src/evidence/evidence-acceptance.service.ts`

**Evidence:** accepted design

Owns validation, replay classification, the outer immediate transaction,
durable evidence append, Session scheduling, and immutable acceptance receipts.

Detailed contract:
[`EvidenceAcceptanceService`](../2026-08-12-our-app/pseudocode/src/evidence/evidence-acceptance.service.ts.md).

### Targeted Memory Insertion

**Representation:** semantic: `Targeted Memory Insertion`

**Evidence:** accepted design and user requirement

Owns atomic submission of one ordered proposal batch to the explicitly
selected Project, Personal, or Practice Memory Inbox. It preserves exact
content, optional replay identity, and trusted CLI provenance. It does not
target Session Memory or publish canonical memory without product-owned
curation.

Detailed contract:
[Targeted Memory Insertion](../2026-09-02-ingestion-boundaries/pseudocode/targeted-memory-insertion.md).

### Evidence Persistence

**Representation:** exact: `EvidenceItem` and `EvidenceAcceptanceOperation`
models with `EvidenceLogRepository` and
`EvidenceAcceptanceOperationRepository` under `src/storage/sqlite/`

**Evidence:** accepted design

Owns append-only evidence rows, local-project evidence sequence allocation,
source replay lookup, completed-operation lookup, and immutable receipt
persistence through caller-supplied transactions.

Detailed contracts:
[`EvidenceItem`](../2026-08-12-our-app/pseudocode/src/storage/sqlite/models/evidence-item.model.ts.md),
[`EvidenceAcceptanceOperation`](../2026-08-12-our-app/pseudocode/src/storage/sqlite/models/evidence-acceptance-operation.model.ts.md),
[`EvidenceLogRepository`](../2026-08-12-our-app/pseudocode/src/storage/sqlite/repositories/evidence-log.repository.ts.md),
and
[`EvidenceAcceptanceOperationRepository`](../2026-08-12-our-app/pseudocode/src/storage/sqlite/repositories/evidence-acceptance-operation.repository.ts.md).

### SessionMaintenance

**Representation:** exact: `src/session-maintenance/` services with Session
maintenance models and repositories under `src/storage/sqlite/`

**Evidence:** accepted design

Provides the lifecycle capability required when the fixed local project is
ensured and the scheduling capability required by evidence acceptance. This
prototype slice does not execute maintenance or publish Session Memory.

Detailed contracts:
[`SessionMaintenance`](../2026-08-12-our-app/pseudocode/src/session-maintenance/session-maintenance.ts.md),
[`SessionMaintenanceLifecycleService`](../2026-08-12-our-app/pseudocode/src/session-maintenance/session-maintenance-lifecycle.service.ts.md),
and
[`SessionMaintenanceScheduleService`](../2026-08-12-our-app/pseudocode/src/session-maintenance/session-maintenance-schedule.service.ts.md).

## Existing Files Or Owners Relied On

### SqliteRuntime

**Representation:** exact: `src/storage/sqlite/sqlite-runtime.ts`

**Evidence:** verified implementation and accepted design

Validates Bun 1.4, resolves the packaged SQLite driver and sqlite-vec extension,
and initializes every connection before Sequelize uses it.

### SqliteDatabase

**Representation:** exact: `src/storage/sqlite/sqlite-database.ts`

**Evidence:** verified implementation and accepted design

Owns one application-scoped Sequelize connection lifecycle and managed
`IMMEDIATE` write transactions. All prototype repositories receive this
instance and explicit transaction handles.

Detailed contract:
[`SqliteDatabase`](../2026-08-12-our-app/pseudocode/src/storage/sqlite/sqlite-database.ts.md).

## Admission Rule

This shape admits only owners established by verified implementation, accepted
design, or explicit user requirement and required for the fixed-project manual
ingestion interface. Each item owns a responsibility that cannot coherently
remain with another admitted owner. Independently useful detailed design
artifacts are linked instead of copied.
