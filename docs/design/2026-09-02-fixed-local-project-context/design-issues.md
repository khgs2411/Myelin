# Fixed Local Project Context — Open Design Issues

Established design context: [Feature Shape](feature-shape.md).

## Issue Index

| Issue | Status | Provisional candidates |
| --- | --- | --- |
| [Exact Project model contract](#exact-project-model-contract) | `OPEN` | none |
| [Project Registration Store contract](#project-registration-store-contract) | `OPEN` | none |
| [Fixed registration compatibility](#fixed-registration-compatibility) | `OPEN` | none |
| [SQLite schema lifecycle](#sqlite-schema-lifecycle) | `OPEN` | none |

## Project Persistence

### Exact Project model contract

**Evidence:** accepted design

**Exposed by:** The accepted
[Project identity boundary](../2026-09-02-ingestion-boundaries/pseudocode/project-identity.md)
requires a public `ProjectKey`, while the older
[Project model baseline](../2026-08-12-our-app/pseudocode/src/storage/sqlite/models/project.model.ts.md)
does not persist that key.

**Established:**

- The exact destination is `src/storage/sqlite/models/project.model.ts`.
- A Project has a private SQLite identity and an immutable unique public key.
- It records one canonical project root and an optional repository root.
- It owns the project evidence-sequence frontier.
- Branch state is not stored on the Project.

**Unresolved:** Which exact Sequelize fields, constraints, timestamp behavior,
and direct associations form the Project model used by this unit?

**Time to address:** Before the first Project row can be persisted.

### Project Registration Store contract

**Evidence:** accepted design and user requirement

**Exposed by:** `Application` must create or load the fixed Project through a
durable multi-project persistence owner, but no exact store contract exists.

**Established:**

- The store supports many registered projects.
- This unit supplies one fixed Project configuration.
- Store operations join an explicit caller-supplied transaction.
- The result distinguishes a newly created Project from an existing Project.
- The store does not own Session lifecycle state or future public registration.

**Unresolved:** Which exact type and operation contract accept the fixed
registration facts and return the durable Project registration and creation
disposition?

**Time to address:** Before `Application` can compose the fixed context.

### Fixed registration compatibility

**Evidence:** user requirement and accepted design

**Exposed by:** Every invocation supplies the same hard-coded Project key and
paths, while the durable store can already contain a Project row.

**Established:**

- Repeated compatible invocations load the same durable Project.
- Project key and private identity are immutable.
- Paths do not change through this prototype operation.
- Relocation remains a separate future operation.
- The initializer does not silently repair incompatible durable state.

**Unresolved:** Which persisted coordinates define a compatible match, and
which key or path mismatches fail the invocation as incompatible durable state?

**Time to address:** Before create-or-load behavior can be deterministic and
idempotent.

## SQLite Schema

### SQLite schema lifecycle

**Evidence:** verified implementation and accepted design

**Exposed by:** `SqliteDatabase.open` creates a Sequelize connection without
registered application models or application-table migrations. This unit
introduces the first required persistent models.

**Established:**

- Sequelize owns relational model mapping and ordinary persistence access.
- `SqliteDatabase` owns one process-scoped database lifecycle.
- `Application` must establish compatible schema before it uses the Project or
  Session persistence owners.
- Schema failure must stop the invocation before Project initialization.

**Unresolved:** Which owner registers models, versions and applies migrations,
exposes registered models to repositories, and reports incompatible schema
state during an invocation?

**Time to address:** Before this unit can implement its first durable model.
