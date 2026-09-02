# Project Persistence — Open Design Issues

Established design context: [Feature Shape](feature-shape.md).

## Issue Index

- [Exact Project model contract](#exact-project-model-contract)
- [Project Registration Store contract](#project-registration-store-contract)
- [Fixed local Project initialization seam](#fixed-local-project-initialization-seam)

### Exact Project model contract

**Evidence:** accepted design

**Exposed by:** the accepted [Project identity boundary](../2026-09-02-ingestion-boundaries/pseudocode/project-identity.md)
and the older [Project model baseline](../2026-08-12-our-app/pseudocode/src/storage/sqlite/models/project.model.ts.md),
which predates persistence of the accepted public `ProjectKey`.

**Established:**

- The exact destination is `src/storage/sqlite/models/project.model.ts`.
- A Project stores its private SQLite identity, public `ProjectKey`, canonical
  project root, optional repository root, and monotonic evidence-sequence
  frontier.
- The private identity and public key are immutable. Paths are replaceable
  without changing identity.
- The project root and public key are unique.

**Unresolved:** What exact Sequelize fields, database constraints, timestamp
behavior, and direct associations form the complete Project model required by
current consumers?

**Time to address:** Before the Project model is implemented.

### Project Registration Store contract

**Evidence:** accepted design and user requirement

**Exposed by:** the accepted semantic
[Project Registration Store](feature-shape.md#project-registration-store) and
the lack of an exact persistence owner in source or detailed design.

**Established:**

- One store supports many registered projects.
- The store uses the application-owned `SqliteDatabase`.
- Mutating operations join an explicit caller-supplied transaction.
- The store does not own path canonicalization, public registration,
  relocation, Session lifecycle, or a global singleton lifecycle.

**Unresolved:** What exact file and type own Project persistence, and what
minimum operations and result types do current Project consumers require?

**Time to address:** Before Application composition can construct Project
persistence.

### Fixed local Project initialization seam

**Evidence:** accepted design and user requirement

**Exposed by:** the
[local Application composition](../2026-09-02-ingestion-implementation-foundation/pseudocode/src/application.ts.md)
and the deferred general registration workflow.

**Established:**

- Application composition supplies one fixed LLM Wiki Project configuration.
- The final persistence model continues to support many projects.
- The startup transaction persists or obtains that Project before evidence
  intake becomes callable.
- New Project state calls `initializeNewProject`; existing Project state calls
  `requireInitializedProject`. Missing existing Session state is not repaired.
- The local CLI cannot select, register, resolve, or relocate a project.

**Unresolved:** What exact internal initialization call identifies the fixed
Project, distinguishes new from existing persistence, and returns the identity
and context required by Application without establishing the future public
registration workflow?

**Time to address:** Before the fixed local Project is composed into the
prototype.
