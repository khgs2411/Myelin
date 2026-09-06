# Evidence Ingestion — Open Design Issues

Established design: [Feature Shape](feature-shape.md).
Authority: user-approved [baseline](README.md#accepted-baseline).

All issues below are OPEN. They concern contracts reached by the accepted
ingestion flow. They do not define an implementation plan.

## Issue Index

- [Recovery of evidence with unavailable Git context](#recovery-of-evidence-with-unavailable-git-context)

## Recovery of evidence with unavailable Git context

**Evidence:** user-approved exclusion and deferred recovery in
[evidence selection](pseudocode/evidence-selection.md).

**Exposed by:** Some evidence has unavailable captured Git context. A later
successful observation cannot establish its historical branch.

**Established:** Normal ingestion excludes these records, leaves them unclaimed,
and reports their count within the matching Project, source, and directory.
Original evidence is immutable. Current Git state must not be substituted for
unavailable historical state.

**Unresolved:** Define an explicit recovery mechanism and its scope authority.

**Time to address:** Deferred by user approval. Normal ingestion can proceed
with the accepted exclusion and reporting behavior.

