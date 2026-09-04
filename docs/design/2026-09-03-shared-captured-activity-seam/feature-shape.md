# Shared Captured-Activity Seam — Feature Shape

This unit establishes the provider-neutral boundary between source-specific
capture and shared captured-evidence ingestion. It does not define the later
evidence DTOs, durable acceptance, fixture command, or automatic hook runtime.
Where an earlier design unit differs, this unit controls the current boundary.
Earlier units remain unchanged historical records.

Open design frontier: [Open Design Issues](design-issues.md).

## Feature Map

```text
installed Codex hook invocation
  -> exact Codex UserPromptSubmit or Stop JSON + "codex.hook"
      -> [Provider Evidence Capture]

controlled completed-turn fixture
  -> [Development Capture Fixture]
      -> ordered exact controlled Codex payloads + "development.fixture"
          -> [Provider Evidence Capture]

[Provider Evidence Capture]
  -> [Codex Capture Adapter]
      -> one [Captured Activity Observation] per payload
          -> resolve payload cwd to WorkspaceContext

[Captured Activity Observation] + trusted route identity + resolved WorkspaceContext
  -> [Captured Evidence Ingestion]
      -> later EvidenceCandidateDto construction and durable acceptance
```

The automatic and fixture routes meet at Provider Evidence Capture and use the
same Codex adapter. They do not create separate parsing or downstream evidence
contracts.

## Design Item Catalog

| Design item | Representation |
| --- | --- |
| [Provider Evidence Capture](#provider-evidence-capture) | exact: `src/capture/evidence-capture.service.ts` |
| [Codex Capture Adapter](#codex-capture-adapter) | exact: `src/providers/codex/codex-capture.adapter.ts` |
| [Development Capture Fixture](#development-capture-fixture) | semantic: `Development Capture Fixture` |
| [Captured Activity Observation](#captured-activity-observation) | exact: `CapturedActivityObservation` |
| [Captured Evidence Ingestion](#captured-evidence-ingestion) | exact: `src/capture/captured-evidence-ingestion.service.ts` |

## New Or Revised Files Or Owners

### Captured Activity Observation

**Representation:** exact: `CapturedActivityObservation`

**Evidence:** accepted design

Represents exactly one normalized, content-bearing source event before
candidate construction. One top-level completed Codex turn therefore produces
one user-message observation and one assistant-message observation. The two
observations preserve their shared native session and turn coordinates, but do
not become one synthetic turn object.

Each observation carries one closed product-semantic kind:

```text
conversation.user-message
conversation.assistant-message
```

The Codex adapter preserves the separate source-native event kind and maps
`UserPromptSubmit` and `Stop` to the product kinds for both routes. Shared
ingestion and later Session curation do not interpret Codex event names to
recover product meaning.

Detailed boundary:
[Captured Activity Observation](pseudocode/captured-activity-observation.md).

## Existing Files Or Owners Relied On

### Provider Evidence Capture

**Representation:** exact: `src/capture/evidence-capture.service.ts`

**Evidence:** accepted design

Coordinates one capture invocation. Application composition binds its trusted
route identity and Codex adapter. It normalizes the exact payload, resolves the
observation's working directory to `WorkspaceContext`, and delegates the
observation, identity, and context to captured-evidence ingestion.

Detailed boundary:
[`EvidenceCaptureService`](pseudocode/src/capture/evidence-capture.service.ts.md).

### Codex Capture Adapter

**Representation:** exact: `src/providers/codex/codex-capture.adapter.ts`

**Evidence:** verified Codex input contract and accepted design

Will validate and interpret one exact Codex-shaped JSON input from either
route, preserve that exact input as raw source, and produce either one captured
activity observation or a non-evidence outcome. The trusted route identity
remains outside the payload and observation. Automatic hook installation,
delivery recovery, and transcript reconciliation remain in Roadmap Step 7.

Detailed boundary:
[`CodexCaptureAdapter`](pseudocode/src/providers/codex/codex-capture.adapter.ts.md).

### Development Capture Fixture

**Representation:** semantic: `Development Capture Fixture`

**Evidence:** accepted user requirement and design

Will supply one controlled `UserPromptSubmit` payload and one controlled `Stop`
payload in that order through provider evidence capture configured with the
same Codex adapter and the trusted `development.fixture` route identity. It
does not construct observations, accept evidence directly, or write Session
Memory.

Detailed boundary:
[Development Capture Fixture](pseudocode/development-capture-fixture.md).

### Captured Evidence Ingestion

**Representation:** exact: `src/capture/captured-evidence-ingestion.service.ts`

**Evidence:** accepted design

Receives one captured activity observation with trusted capture-source
identity and an already resolved `WorkspaceContext`. It owns later candidate
construction and delegation to durable acceptance. It does not parse native
provider input or resolve a Project.

Detailed boundary:
[`CapturedEvidenceIngestionService`](pseudocode/src/capture/captured-evidence-ingestion.service.ts.md).

## Exclusions

- `EvidenceCandidateDto` and `EvidenceItemDto` field contracts;
- SQLite evidence schema and acceptance behavior;
- the development fixture file and CLI request contract;
- Codex hook installation, delivery reliability, and recovery; and
- Session Memory curation or storage.

## Admission Rule

This shape admits only the accepted one-event observation cardinality, the
shared Codex parsing path, the provider-neutral activity kinds, and the
established ownership boundaries.
