# Provider Evidence Capture — Feature Shape

This unit establishes one adapter-driven capture path from native input to
durable SQLite evidence. It includes the Codex adapter and the local
development fixture adapter. It excludes installed hook transport, evidence
reading, Session Memory, and targeted durable-memory insertion.

Where an earlier design unit differs, this active unit controls the capture
boundary. Earlier units remain unchanged historical records.

Open design frontier: [Open Design Issues](design-issues.md).

## Feature Map

```text
future automatic Codex transport
  -> trusted codex.hook entry + exact Codex input array
      -> [CaptureAdapterFactory]
          -> [CodexCaptureAdapter]
              -> CaptureResult array

local development fixture command
  -> trusted development.fixture entry + fixture input array
      -> [CaptureAdapterFactory]
          -> [DevelopmentCaptureAdapter]
              -> CaptureResult array

trusted capture source + CaptureResult array
  -> [EvidenceCaptureService]
      -> resolve WorkspaceContext for every result
      -> EvidenceItemDto array
          -> [EvidenceItemService]
              -> [EvidenceItem] : atomic, idempotent rows in SQLite evidence_items

targeted manual memory insertion -X-> capture path
capture path -X-> (evidence reading | memory curation | Session Memory)
```

Every native source owns its adapter and input format. Adapters converge on
`CaptureResult`. Everything after that seam is source-neutral. A future Claude
entry adds `ClaudeCaptureAdapter` and one factory registration. It does not
change the shared services or persistence contract.

## Design Item Catalog

| Design item | Representation |
| --- | --- |
| [CaptureAdapterFactory](#captureadapterfactory) | exact: `src/capture/capture-adapter.factory.ts` |
| [CodexCaptureAdapter](#codexcaptureadapter) | exact: `src/providers/codex/codex-capture.adapter.ts` |
| [DevelopmentCaptureAdapter](#developmentcaptureadapter) | exact: `src/development/development-capture.adapter.ts` |
| [EvidenceCaptureService](#evidencecaptureservice) | exact: `src/capture/evidence-capture.service.ts` |
| [EvidenceItemService](#evidenceitemservice) | exact: `src/evidence/evidence-item.service.ts` |
| [EvidenceItem](#evidenceitem) | exact: `src/storage/sqlite/models/evidence-item.model.ts` |

## New Or Revised Files Or Owners

### CaptureAdapterFactory

**Representation:** exact: `src/capture/capture-adapter.factory.ts`

**Evidence:** accepted provider-abstraction boundary

Selects one `CaptureAdapter` from the trusted capture entry. It is the only
owner of adapter selection. It does not normalize input, infer workspace
context, persist evidence, or know memory behavior.

Detailed boundary:
[`CaptureAdapterFactory`](pseudocode/src/capture/capture-adapter.factory.ts.md).

### CodexCaptureAdapter

**Representation:** exact: `src/providers/codex/codex-capture.adapter.ts`

**Evidence:** verified Codex input contract and accepted design

Validates one supported Codex-native payload, extracts source facts, preserves
the exact JSON input, and returns one `CaptureResult`.

It does not infer conversation structure, establish trusted route identity,
resolve a Project, construct an `EvidenceItemDto`, persist evidence, or assign
memory meaning.

Detailed boundary:
[`CodexCaptureAdapter`](pseudocode/src/providers/codex/codex-capture.adapter.ts.md).

### DevelopmentCaptureAdapter

**Representation:** exact: `src/development/development-capture.adapter.ts`

**Evidence:** explicit user requirement and accepted design

Validates one fixture-native record, preserves that exact record, and returns
one `CaptureResult`. The local command uses it to create controlled captured
evidence without installation or automatic hooks.

The fixture does not generate Codex JSON. It verifies the shared capture and
memory path, not the Codex parsing contract.

Detailed boundaries:
[Development Capture Fixture](pseudocode/development-capture-fixture.md) and
[`DevelopmentCaptureAdapter`](pseudocode/src/development/development-capture.adapter.ts.md).

### EvidenceCaptureService

**Representation:** exact: `src/capture/evidence-capture.service.ts`

**Evidence:** explicit user requirement and accepted design

Receives one trusted capture source and one ordered `CaptureResult` array. It
resolves every result through `WorkspaceContextService`, constructs the
complete `EvidenceItemDto` array, and delegates that array to
`EvidenceItemService`.

It does not select adapters, parse native input, write SQLite directly, read
evidence, or invoke memory processing.

Detailed boundary:
[`EvidenceCaptureService`](pseudocode/src/capture/evidence-capture.service.ts.md).

### EvidenceItemService

**Representation:** exact: `src/evidence/evidence-item.service.ts`

**Evidence:** accepted persistence ownership

Owns one atomic and idempotent evidence write. It validates replay against
existing rows, allocates project-local evidence sequences, and persists the
complete ordered DTO array as immutable `EvidenceItem` rows.

It does not parse source input, infer workspace context, read evidence for a
consumer, or invoke memory processing.

Detailed boundary:
[`EvidenceItemService`](pseudocode/src/evidence/evidence-item.service.ts.md).

### EvidenceItem

**Representation:** exact: `src/storage/sqlite/models/evidence-item.model.ts`

**Evidence:** accepted design and existing SQLite/Sequelize runtime

Owns one immutable captured-evidence row in `evidence_items`. The row preserves
its Project, project-local sequence, trusted capture source, normalized source
facts, exact native source, integrity digest, replay identity, and receipt
time.

Detailed boundary:
[`EvidenceItem`](pseudocode/src/storage/sqlite/models/evidence-item.model.ts.md).

## Existing Files Or Owners Relied On

`EvidenceCaptureService` uses the existing `WorkspaceContextService`.
`EvidenceItemService` uses the existing `SqliteDatabase` transaction boundary.
The existing `Project.lastAllocatedEvidenceSequence` supplies project-local
row ordering. This unit does not change their ownership.

## Admission Rule

This shape admits only the six classes that own adapter selection, source
normalization, capture coordination, evidence persistence, and the durable
row. Interfaces and DTOs remain derived contracts. Targeted insertion and all
evidence consumers remain separate boundaries.
