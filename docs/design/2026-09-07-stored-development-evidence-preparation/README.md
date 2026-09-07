# Stored Development Evidence Preparation — Design Unit

This is the active design unit for **Prepare stored development evidence for
the curator** in [Roadmap Step 3](../../../ROADMAP.md#roadmap-step-3-create-session-memory-from-accepted-evidence).

- [Feature Shape](feature-shape.md): established owners and boundaries.
- [Design issue resolution](design-issues.md): application ingestion with the development no-op.
- [EvidenceManager pseudocode](pseudocode/src/evidence/evidence-manager.ts.md): content
  admission before persistence.
- [Preparation boundary pseudocode](pseudocode/evidence-preparation.md): capture
  normalization and direct construction of curator input.
- [Ingestion service pseudocode](pseudocode/src/evidence-ingestion/evidence-ingestion.service.ts.md):
  revised pre-claim flow and exact source filtering.
- [Prepared-input contract](pseudocode/src/evidence-ingestion/evidence-ingestion.types.ts.md):
  approved IPreparedEvidenceItem fields and placement with ingestion contracts.
- [EvidenceItem entity pseudocode](pseudocode/src/storage/sqlite/models/evidence-item.model.ts.md):
  stored speakerRole and persistence mapping.
- [Development capture pseudocode](pseudocode/src/development/development-capture.adapter.ts.md):
  fixture-supplied attribution.
- [Codex capture pseudocode](pseudocode/src/providers/codex/codex-capture.adapter.ts.md):
  hook-derived attribution for the later Codex implementation.
- [Parent ingestion unit](../2026-09-06-evidence-ingestion/README.md): selection,
  leases and publication contracts.

## Scope And Authority

Prepare stored development fixture evidence for the curator. This unit also
records the shared capture admission rule established during this discussion.
Real curator task design and execution remain separate roadmap work.

On 2026-09-07, the user selected EvidenceManager as the admission owner and
selected skipping contentless items rather than rejecting the capture batch.
The recorded rule treats null, empty, and whitespace-only normalizedContent as
contentless. Valid content and relative order are preserved. If no items remain,
nothing is stored.

The user also approved capture as the owner of all source-specific
interpretation. Normalized text and accompanying metadata supply the complete
readable captured evidence needed for normal curation. Ingestion constructs
prepared input directly; the curator does not receive SQLite model objects.
Raw native material remains available for traceability and inspection.

The user approved speakerRole as `user`, `assistant`, or null for unknown
attribution. Codex capture derives it from the supported hook event;
development capture takes the fixture author's supplied role. Capture carries
it through persistence, and ingestion copies it into prepared input. The role
identifies the source speaker, not whether a statement is approved or true.

This supersedes the parent unit's requirement for IEvidenceAdapter,
EvidenceAdapterFactory, and source-specific preparation implementations. The
prepared-input contract remains. The runtime now uses the direct preparation
boundary.

The user authorized implementation and behavior-focused unit tests on
2026-09-07. Capture admission, speaker attribution, persistence, direct
preparation, and the pre-claim executor-availability boundary are implemented.
Existing selection, lease, and publication contracts remain with the parent
unit.

Real curator task design and execution remain unimplemented.

## Development Data Baseline

User-provided context, 2026-09-07: the development fixture implementation has
not been used or tested and has not inserted evidence into SQLite. This session
has not independently inspected the database. No compatibility behavior for
previously stored contentless fixture evidence is required for this design.
No database reset or data cleanup is required by this decision.
