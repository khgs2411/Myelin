# Stored Development Evidence Preparation — Feature Shape

This unit maps evidence admission before persistence and source preparation
before curator execution. Capture and preparation retain separate boundaries.

## Feature Map

```text
Native capture input
  -> ICaptureAdapter
       complete readable event evidence and speakerRole
       user | assistant | null (unknown)
       retain complete serialized native payload separately
  -> normalized and workspace-resolved capture input
  -> EvidenceManager
       skip null, empty, or whitespace-only normalizedContent
       preserve retained content and relative order
       no retained items -> no persistence
       retained items -> EvidenceItemRepository -> SQLite

EvidenceManager selects and claims stored rows
  -> EvidenceIngestionService
       construct one prepared item per claimed row, preserving order
       copy stored speakerRole without interpretation
  -> curator execution boundary (prepared values, not SQLite models)
```

Evidence: the capture call into EvidenceManager and repository persistence are
verified implementation. Content admission is accepted user design from
2026-09-07. Capture normalization ownership and direct prepared-input construction
were approved by the user on 2026-09-07. The one-to-one output boundary is
preserved from the parent ingestion contract.

## Design Item Catalog

| Item | Representation |
| --- | --- |
| [EvidenceManager](#evidencemanager) | exact |
| [ICaptureAdapter](#icaptureadapter) | exact |
| [EvidenceIngestionService](#evidenceingestionservice) | exact |
| [EvidenceItemRepository](#evidenceitemrepository) | exact |

## New Or Revised Files Or Owners

### EvidenceManager

**Representation:** exact — `src/evidence/evidence-manager.ts`.

**Evidence:** accepted user design, 2026-09-07; verified insertion delegation in
[current source](../../../src/evidence/evidence-manager.ts).

Own the shared admission rule before repository insertion. Skip contentless
items using normalizedContent, without rejecting otherwise valid retained
items. Whitespace inspection does not modify retained text. Apply this rule to
all capture sources that use the manager. Persist nothing when all items are
skipped. See [focused pseudocode](pseudocode/src/evidence/evidence-manager.ts.md).

### ICaptureAdapter

**Representation:** exact — `src/capture/capture-adapter.ts`, implemented by
source-specific capture adapters.

**Evidence:** existing capture interface; explicit user approval on 2026-09-07
of the stronger normalization contract.

Own source-specific interpretation at capture. Supply the complete readable
representation of the supported captured event through normalizedContent and
its accompanying metadata. Preserve meaning and attribution without summarizing
or deciding memory value. Completeness concerns the captured event, not an
entire conversation. Retain the complete serialized native payload separately
for traceability and inspection. Normal curation uses normalized evidence.

Accepted design, user approval on 2026-09-07: capture produces speakerRole as
`user`, `assistant`, or null when unknown. Codex maps UserPromptSubmit to user
and Stop to assistant. The development fixture supplies the author's explicit
role. CaptureResult and EvidenceItemDto carry the role into stored EvidenceItem
metadata. Attribution identifies the source speaker; it does not establish
statement truth, requirement status, or user acceptance.

### EvidenceIngestionService

**Representation:** exact — `src/evidence-ingestion/evidence-ingestion.service.ts`.

**Evidence:** verified orchestration owner in current source; explicit user
approval on 2026-09-07 of direct prepared-input construction.

Receive claimed rows from EvidenceManager and construct the prepared-input
contract directly from normalized stored fields. Preserve evidence identity,
order, text, and attribution, including the stored speakerRole. The curator receives values rather than SQLite
models. Source-specific preparation adapters and their factory are not part of
this approved flow. Preparation does not curate evidence or complete processing.
See [boundary pseudocode](pseudocode/evidence-preparation.md).

User-approved on 2026-09-07: captureSourceKey is an exact stored-evidence filter.
Ingestion has no supported-source registry. If no eligible rows match, return
its existing empty result after pre-claim checks succeed. Workspace resolution
and configured executor selection retain their existing boundaries. See the
[service pseudocode](pseudocode/src/evidence-ingestion/evidence-ingestion.service.ts.md).


Accepted representation, user approval on 2026-09-07: IPreparedEvidenceItem lives
with the existing ingestion contracts in src/evidence-ingestion/evidence-ingestion.types.ts.
The [type pseudocode](pseudocode/src/evidence-ingestion/evidence-ingestion.types.ts.md)
records its fields. No separate mapping class or service owns this conversion.

## Existing Files Or Owners Relied On

### EvidenceItemRepository

**Representation:** exact — `src/evidence/evidence-item.repository.ts`.

**Evidence:** verified implementation in
[current source](../../../src/evidence/evidence-item.repository.ts).

Own atomic persistence and replay handling for the retained batch supplied by
EvidenceManager. Preserve supplied source metadata, including the accepted
speakerRole field on stored EvidenceItem records. Return durable evidence
references in retained input order.

The speakerRole persistence extension is accepted user design from 2026-09-07;
it is not present in the current runtime model.

## Admission Rule

EvidenceManager owns the changed admission decision. EvidenceItemRepository
owns its persistence destination. ICaptureAdapter owns source interpretation.
EvidenceIngestionService owns construction of curator input. Each item names a
distinct established responsibility. Other callers,
SQLite, and the curator boundary are flow context rather than additional items.
