# Evidence Preparation Boundary

> Pseudocode artifact. Non-executable reference shape.

Authority: explicit user approval on 2026-09-07. This flow supersedes the parent
unit's source-specific preparation adapter and factory requirement. The
prepared-input contract remains separate from SQLite models.

```text
Capture — existing ICaptureAdapter implementations:
    Interpret the supported native event at the source boundary.
    Produce complete readable evidence in normalizedContent and its metadata.
    Preserve source meaning and attribution; do not summarize or curate.
    Set speakerRole from source facts:
        Codex UserPromptSubmit -> "user"
        Codex Stop -> "assistant"
        Development fixture -> fixture author's supplied role
        Unknown attribution -> null
    Retain the complete serialized native payload separately.

Capture handoff — EvidenceCaptureService:
    Copy speakerRole unchanged from CaptureResult into EvidenceItemDto.
    Pass workspace-resolved evidence candidates to EvidenceManager.

Admission — EvidenceManager:
    Apply the accepted content admission rule before repository insertion.

Persistence — EvidenceItemRepository:
    Store retained EvidenceItemDto values as EvidenceItem rows.
    Preserve speakerRole unchanged as source attribution,
        without interpreting statement authority.

Consumption — EvidenceIngestionService:
    Obtain the claimed batch through EvidenceManager's existing claim operation.
    For each stored row in batch order, construct prepared input:
        evidenceId <- row.id
        content <- row.normalizedContent, unchanged
        speakerRole <- row.speakerRole
        nativeEventKind <- row.nativeEventKind
        nativeSessionReference <- row.nativeSessionReference
        nativeInteractionReference <- row.nativeInteractionReference
        nativeOccurredAt <- row.nativeOccurredAt
    Pass prepared values to the existing curator execution boundary.
    Preserve existing result validation, claim ownership, and publication flow.

    Do not select an evidence preparation adapter or factory.
    Do not parse provider payloads or pass SQLite models to the curator.
```

This is a focused flow, not a replacement for the full ingestion service.
Selection, leases, and publication retain their established owners and behavior.
Missing native references and timestamps remain null; receipt time does not
substitute for source time. A missing preparation adapter no longer determines
whether stored evidence can be consumed. Capture-source scoping remains.

## Contract Additions

These are narrow field additions to existing contracts, not new owners:

```typescript
// src/capture/capture-adapter.ts — extend CaptureResult:
speakerRole: "user" | "assistant" | null;

// src/evidence/evidence-item.dto.ts — extend EvidenceItemDto:
speakerRole: "user" | "assistant" | null;

// src/evidence-ingestion/evidence-ingestion.types.ts — retained IPreparedEvidenceItem:
readonly speakerRole: "user" | "assistant" | null;
```

EvidenceCaptureService copies CaptureResult.speakerRole into EvidenceItemDto.
EvidenceManager preserves it on retained items. EvidenceItemRepository maps it
into the [EvidenceItem entity](src/storage/sqlite/models/evidence-item.model.ts.md).
The direct ingestion mapping above completes the path to the curator.

Source-specific derivation belongs to the
[development adapter](src/development/development-capture.adapter.ts.md) and the
[intended Codex adapter](src/providers/codex/codex-capture.adapter.ts.md).

## Speaker Role Contract

Accepted values on normalized evidence, stored evidence, and prepared input:
`"user" | "assistant" | null`. The property is named `speakerRole`.
Capture adapters own attribution. Ingestion copies the value; the curator does
not need to decode native event names to obtain it. Keep nativeEventKind as
source metadata.

The development fixture lets its author supply the role explicitly. Unknown
attribution remains null; do not infer it from the text. This revises the older
fixture input shape and the Codex design's statement that capture does not
assign roles. It does not assign roles to quoted speakers inside the content.

A speaker role is not a decision status or trust score. The curator must still
use content and context to distinguish requirements, proposals, and accepted
decisions. An assistant statement does not become an accepted decision merely
because its role is known.

The user confirmed that the development fixture has not inserted evidence.
For this development flow, the admission rule establishes non-whitespace
normalizedContent before storage. No legacy content fallback or placeholder
text is needed when constructing prepared input.

The approved [prepared-input contract](src/evidence-ingestion/evidence-ingestion.types.ts.md)
belongs in src/evidence-ingestion/evidence-ingestion.types.ts alongside the
existing ingestion contracts. No new runtime owner is required for the mapping.
