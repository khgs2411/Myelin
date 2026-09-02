# LLM Wiki — Open Design Issues

Established design context: [Canonical Feature Shape](feature-shape.md).

This file is the application-wide entry point for material unresolved design.
It is not a roadmap, implementation checklist, or progress ledger. Each issue
can open one focused design unit. That unit owns its accepted Feature Shape,
detailed contracts, and any narrower issues exposed during design.

Longer-horizon unresolved product decisions remain in the
[Our App issue record](2026-08-12-our-app/design-issues.md). The
[Ingestion Boundaries issue record](2026-09-02-ingestion-boundaries/design-issues.md)
currently contains no open issue. This file does not duplicate those focused
records.

## Issue Index

- [Project persistence contract](#project-persistence-contract)
- [SQLite schema lifecycle and model registration](#sqlite-schema-lifecycle-and-model-registration)

## Implementation-enabling design frontier

### Project persistence contract

**Evidence:** accepted design, user requirement, and verified implementation

**Exposed by:** [Project Bootstrap](feature-shape.md#project-bootstrap),
[Project Identity](2026-09-02-ingestion-boundaries/pseudocode/project-identity.md),
the existing [Project model baseline](2026-08-12-our-app/pseudocode/src/storage/sqlite/models/project.model.ts.md),
and the [local Application composition](2026-09-02-ingestion-implementation-foundation/pseudocode/src/application.ts.md).

**Established:**

- Persistence supports many registered projects.
- Each Project has an immutable private SQLite identity and an immutable,
  unique public `ProjectKey`.
- The canonical project root is unique and replaceable. The optional repository
  root is also replaceable through explicit relocation.
- Each Project owns its durable evidence-sequence frontier.
- The local prototype supplies one hard-coded project through Application
  composition. It does not expose registration, resolution, or relocation.
- Project creation and Session lifecycle initialization share one caller-owned
  write transaction. Existing projects require existing Session state without
  silent repair.
- Current source implements the process-scoped SQLite lifecycle but no Project
  model or persistence owner.

**Unresolved:** What exact Sequelize Project model, persistence owner,
transactional operations, result vocabulary, and associations implement this
accepted multi-project boundary and support the fixed local prototype without
designing general registration or relocation?

**Time to address:** Before `Application.create` can establish the fixed local
Project and make evidence intake callable.

Focused design unit:
[Project Persistence](2026-09-02-project-persistence/feature-shape.md).

### SQLite schema lifecycle and model registration

**Evidence:** accepted design and verified implementation

**Exposed by:** the selected Sequelize persistence stack, the
[SQLite database boundary](2026-08-12-our-app/pseudocode/src/storage/sqlite/sqlite-database.ts.md),
and the absence of models or schema initialization in the executable outer
shell.

**Established:**

- Sequelize owns ordinary relational model mapping and transactions.
- SQLite-specific versioned migrations can use parameterized raw SQL through
  the same database boundary.
- `Application.create` owns process-scoped database composition.
- Current source authenticates and verifies SQLite capabilities. It does not
  register models or establish application tables.

**Unresolved:** Which owner defines the model registry, migration source of
truth, schema versioning, migration execution order, and startup failure
contract?

**Time to address:** Before the first persistent application model is
implemented.
