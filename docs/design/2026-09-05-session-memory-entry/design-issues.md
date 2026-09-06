# Session Memory Entry — Open Design Issues

Established design: [Feature Shape](feature-shape.md).
Authority: [Project context](../../../CONTEXT.md).

Each issue below is OPEN. These are entry-contract questions exposed by the
accepted boundaries, not a complete Step 3 implementation backlog.

The user explicitly deferred both remaining issues on 2026-09-06. They remain
unresolved, but do not block completion of the current entry-contract design.
Promotion-based retirement must remain unavailable until its publication
reference can be validated.

## Issue Index

- [Promotion publication reference](#promotion-publication-reference)
- [Query workspace matching — Step 4](#query-workspace-matching--step-4)

## Promotion publication reference

**Evidence:** accepted separate lifecycle model and promotion condition in the
[lifecycle contract](pseudocode/session-memory-lifecycle.model.ts.md).

**Exposed by:** Retirement with reason `promoted` requires confirmed destination
publication. The lifecycle record must refer to that publication.

**Established:** One mutable lifecycle row belongs to each immutable entry.
State, reason, and supersededByEntryId are top-level fields. Application services
consume the concrete Sequelize models directly. Promotion proposals alone do
not authorize promotion-based retirement.

**Unresolved:** Define the durable reference linking retirement to confirmed
Project, Personal, or Practice publication.

**Time to address:** Before promotion-based retirement can be implemented;
the destination publication contract must supply the reference.

## Query workspace matching — Step 4

**Evidence:** explicit user decision to remove entry `applicability` and proposed
query direction recorded in the [entry contract](pseudocode/session-memory-entry.model.ts.md#query-direction-for-later-design).

**Exposed by:** The proposed query constructs WorkspaceContext, filters stored
evidence by workspace properties, and joins matching evidence to Session entries.

**Established:** Entries have no `applicability` field. Evidence IDs preserve
access to original workspace snapshots. Workspace metadata remains outside
searchable content. Capture-time state does not prove event-time state.

**Unresolved:** Select which workspace properties match and what matching means
when context is missing or an entry references evidence from different contexts.

**Candidates:** PROVISIONAL — the user's evidence-filter-first join direction.

**Time to address:** Step 4 query design. This later query question does not
block the current entry contract. Revisit entry fields only if query design
establishes a missing requirement.
