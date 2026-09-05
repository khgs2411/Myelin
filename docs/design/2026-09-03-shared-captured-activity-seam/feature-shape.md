# LLM Wiki — Feature Shape

This is the current consolidated design unit for LLM Wiki. It maps the
established product boundaries and the detailed capture path from native input
to durable SQLite evidence. The root README owns the product overview;
ROADMAP.md owns delivery order. Capture remains separate from evidence
consumption, Session curation, and targeted durable-memory insertion.

This unit controls ongoing detailed design. Earlier units are historical
source records. The [unit index](README.md) records their consolidation.

Open design frontier: [Open Design Issues](design-issues.md).

## Feature Map

```text
[Application] : shared runtime lifetime
  -> [SqliteDatabase]
      -> [SqliteSchema] : model registration and migrations

future automatic Codex transport
  -> trusted codex.hook entry + exact Codex input array
      -> [Application] : compose capture operation only
        -> [CaptureAdapterFactory]
          -> [CodexCaptureAdapter]
              -> CaptureResult array

local development fixture command
  -> trusted development.fixture entry + fixture input array
      -> [Application] : compose capture operation only
        -> [CaptureAdapterFactory]
          -> [DevelopmentCaptureAdapter]
              -> CaptureResult array

trusted capture source + CaptureResult array
  -> [EvidenceCaptureService]
      -> [WorkspaceContextService] : resolve every input directory
      -> EvidenceItemDto array
          -> [EvidenceItemRepository]
              -> [SqliteDatabase] : atomic write transaction
                  -> [Project] : allocate Project evidence sequence
                  -> [EvidenceItem] : immutable rows in SQLite evidence_items

targeted manual memory insertion -X-> capture path
capture path -X-> (evidence reading | memory curation | Session Memory)

SQLite evidence_items
  -> [EvidenceIngestionService]
      -> [Session Memory]
          -> canonical Session rows in SQLite
          -> destination-specific candidate leads
              -> [Project Memory] : own Inbox and curator
              -> [Personal Memory] : own Inbox and curator
              -> [Practice Memory] : own Inbox and curator

explicit targeted proposal
  -> [EvidenceInsertionService]
      -> [Targeted Insertion Operation Ledger] : replay and receipt
      -> exactly one selected durable-product Inbox
          -> [Project Memory] | [Personal Memory] | [Practice Memory]
              -> product-owned canonical Markdown publication

memory curation
  -> [IAgentAdapter] : bounded execution and untrusted proposals
  -> owning memory product : admission and publication

question + current context
  -> [QueryService]
      -> each applicable memory product
      -> grouped qualified results with scope, freshness, and provenance

[EvidenceInsertionService] -X-> (evidence_items | Session Memory)
[IAgentAdapter] -X-> (canonical memory writes)
[QueryService] -X-> (capture | registration writes | memory curation)
```

Every native source owns its adapter and input format. Adapters converge on
`CaptureResult`. Everything after that seam is source-neutral. A future Claude
entry adds `ClaudeCaptureAdapter` and one factory construction branch. It does
not change the shared services or persistence contract.

Each adapter owns deterministic serialization of the complete native value
supplied to it. It recursively sorts object keys and preserves array order.
The format identifier includes the encoding version.

The accepted formats are:

| Native input | Format | Stored content |
| --- | --- | --- |
| JSON-compatible object | `json.v1` | UTF-8 JSON with recursively sorted object keys and no extra whitespace |
| String | `string.v1` | UTF-8 JSON string literal, including quotes and escapes |
| Bytes | `bytes.v1` | Exact supplied bytes |

Each adapter selects the format for its native input. It rejects unsupported
values before serialization. Serialization must not silently discard or convert
values. Decoding `string.v1` restores the complete string value. Shared
persistence stores the format and bytes without decoding them.

Object input retains every field and value, including unused fields, without
guaranteeing original JSON whitespace or object-key order. String and byte
input remain exact. Shared persistence receives serialized bytes plus a format
identifier and stores the content as a SQLite BLOB.

**Evidence:** accepted product boundaries in [README](../../../README.md) and
the user's consolidation instruction. The map describes accepted design, not
implemented completion. Each durable product can inspect original evidence
through catch-up work when Session emits no lead.

## Design Item Catalog

| Design item | Representation |
| --- | --- |
| [Application](#application) | exact: `src/application.ts` |
| [ApplicationError](#applicationerror) | exact: `src/application-error.ts` |
| [CaptureAdapterFactory](#captureadapterfactory) | exact: `src/capture/capture-adapter.factory.ts` |
| [CodexCaptureAdapter](#codexcaptureadapter) | exact: `src/providers/codex/codex-capture.adapter.ts` |
| [DevelopmentCaptureAdapter](#developmentcaptureadapter) | exact: `src/development/development-capture.adapter.ts` |
| [EvidenceCaptureService](#evidencecaptureservice) | exact: `src/capture/evidence-capture.service.ts` |
| [EvidenceItemRepository](#evidenceitemrepository) | exact: `src/evidence/evidence-item.repository.ts` |
| [EvidenceItem](#evidenceitem) | exact: `src/storage/sqlite/models/evidence-item.model.ts` |
| [EvidenceIngestionService](#evidenceingestionservice) | semantic: accepted captured-evidence processing owner |
| [Session Memory](#session-memory) | semantic: recent-work memory product |
| [EvidenceInsertionService](#evidenceinsertionservice) | semantic: accepted targeted-proposal owner |
| [Targeted Insertion Operation Ledger](#targeted-insertion-operation-ledger) | semantic: cross-target insertion replay and receipts |
| [Project Memory](#project-memory) | semantic: Project memory product |
| [Personal Memory](#personal-memory) | semantic: Personal memory product |
| [Practice Memory](#practice-memory) | semantic: Practice memory product |
| [IAgentAdapter](#iagentadapter) | semantic: provider-neutral agent-execution contract |
| [QueryService](#queryservice) | semantic: accepted read-only federation owner |
| [WorkspaceContext](#workspacecontext) | exact: `src/workspace/workspace-context.ts` |
| [WorkspaceContextService](#workspacecontextservice) | exact: `src/workspace/workspace-context.service.ts` |
| [Project](#project) | exact: `src/storage/sqlite/models/project.model.ts` |
| [SqliteDatabase](#sqlitedatabase) | exact: `src/storage/sqlite/sqlite-database.ts` |
| [SqliteSchema](#sqliteschema) | exact: `src/storage/sqlite/sqlite-schema.ts` |

## New Or Revised Files Or Owners

### Application

**Representation:** exact: `src/application.ts`

**Evidence:** verified implementation and accepted design

Owns process-scoped runtime resources and operation-specific composition. Its
creation opens shared runtime resources only. A capture call constructs only
the capture services and asks `CaptureAdapterFactory` to construct only the
selected adapter. Other operations do not create capture entities.

Capture returns the ordered receipt on success and rejects with an ApplicationError
on failure. The accepted failure meanings are:

| Failure | Meaning |
| --- | --- |
| `capture:unsupported-source` | No adapter exists for the trusted source |
| `capture:invalid-input` | Invalid native input or empty batch |
| `capture:unmanaged-workspace` | A working directory has no managed Project |
| `capture:mixed-project-batch` | Items resolve to different Projects |
| `capture:replay-conflict` | Existing replay identity has different source format or bytes |
| `capture:failed` | Context resolution, digest computation, or persistence fails |

Errors carry safe diagnostics without native content. The local fixture command
reports failure and exits unsuccessfully. It emits a capture receipt only after
successful persistence. Failed batches add no rows or sequence advances.

Detailed boundary:
[`Application`](pseudocode/src/application.ts.md).

Command outcome is separate from capture outcome. File reading, JSON parsing,
and application startup failures occur before capture. They use
`cli:fixture-read-failed`, `cli:fixture-parse-failed`, and `cli:startup-failed`.
After successful capture, `cli:output-failed` or `cli:cleanup-failed` makes the
command exit unsuccessfully without undoing committed evidence or invalidating
the retained receipt. Cleanup must not replace an earlier error. Diagnostic
output contains only safe codes and registry-generated messages. If output
fails, the caller may lack confirmation; repeating the fixture remains safe.

### ApplicationError

**Representation:** exact: `src/application-error.ts`

**Evidence:** approved shared error registry pattern

Owns shared typed-error behavior. ERROR_DEFINITIONS maps domain-qualified codes
to safe messages and determines permitted constructor arguments. ErrorCode,
ErrorDomain, ErrorType, and ErrorArguments derive from this registry. One
ApplicationError class serves all domains. Optional causes remain internal;
the CLI prints only code and the registry-generated message.

Detailed boundary:
[`ApplicationError`](pseudocode/src/application-error.ts.md).

### CaptureAdapterFactory

**Representation:** exact: `src/capture/capture-adapter.factory.ts`

**Evidence:** accepted provider-abstraction boundary

Constructs one `ICaptureAdapter` for the trusted capture entry. It is the only
owner that knows the concrete adapter classes. It does not normalize input,
infer workspace context, persist evidence, or know memory behavior.

Detailed boundary:
[`CaptureAdapterFactory`](pseudocode/src/capture/capture-adapter.factory.ts.md).

### CodexCaptureAdapter

**Representation:** exact: `src/providers/codex/codex-capture.adapter.ts`

**Evidence:** verified Codex input contract and accepted design

Validates one supported Codex-native payload, extracts source facts, serializes
the complete native value, and returns one `CaptureResult`.

It does not infer conversation structure, establish trusted route identity,
resolve a Project, construct an `EvidenceItemDto`, persist evidence, or assign
memory meaning.

Detailed boundary:
[`CodexCaptureAdapter`](pseudocode/src/providers/codex/codex-capture.adapter.ts.md).

### DevelopmentCaptureAdapter

**Representation:** exact: `src/development/development-capture.adapter.ts`

**Evidence:** explicit user requirement and accepted design

Validates one fixture-native record, serializes its complete value, and returns
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
`EvidenceItemRepository`.

It does not select adapters, parse native input, write SQLite directly, read
evidence, or invoke memory processing.

Detailed boundary:
[`EvidenceCaptureService`](pseudocode/src/capture/evidence-capture.service.ts.md).

Validation ownership:

| Owner | Required checks |
| --- | --- |
| Adapter | Valid native input, required source facts and replay coordinates, lossless serialization |
| EvidenceCaptureService | Non-empty batch, managed context for every item, one Project for the complete batch |
| EvidenceItemRepository | Non-empty batch for one Project, source digests before the transaction, replay conflicts inside the transaction |

The repository trusts adapter-produced source facts and resolved context. It
does not repeat provider validation or decode source material. Any validation
failure rejects the complete batch. Capture does not require useful memory.

### EvidenceItemRepository

**Representation:** exact: `src/evidence/evidence-item.repository.ts`

**Evidence:** accepted persistence ownership

Owns one atomic and idempotent evidence write. It computes the SHA-256 integrity digest
over each `sourceMaterial.content` before opening the write transaction and
stores the digest with the evidence. SHA-256 is fixed for all capture sources;
adapters cannot select or configure it. It validates replay against
existing rows, allocates project-local evidence sequences, and persists the
complete ordered DTO array as immutable `EvidenceItem` rows. Within one replay
identity, the stored and incoming format and content bytes must both match.
A difference in either rejects the complete batch. Identical content under a
different replay identity can represent a separate event.

Replay means submitting the same native event to capture again. Its identity
is capture source + Project identity + replay scheme + replay key. Within the
same Project, matching format and bytes return existing evidence. A mismatch
rejects the batch. A different replay key represents a separate event even
when the content is identical.

Adapters construct replay keys as lowercase hexadecimal SHA-256 over UTF-8
compact JSON arrays of fixed coordinates:

| Replay scheme | Ordered coordinate array |
| --- | --- |
| `development-fixture/v1` | `[fixtureReference, itemIndex]` |
| `codex-hook/v1` | `[session_id, turn_id, hook_event_name]` |

Array order and coordinate types are preserved. Content is excluded. The
repository combines the resulting key and scheme with trusted capture source
and Project identity. This adapter-owned replay hash is distinct from the
repository-owned integrity digest of complete source content.

Replay is Project-scoped. If the directory resolves to a different Project,
the event is captured independently there; an exact replay already stored in
that Project still returns its existing reference. Original evidence remains
unchanged in the original Project. Capture neither moves evidence nor
deduplicates across Projects. Moving a Project root without changing its
identity does not by itself change replay identity.

It does not parse source input, infer workspace context, read evidence for a
consumer, or invoke memory processing.

Detailed boundary:
[`EvidenceItemRepository`](pseudocode/src/evidence/evidence-item.repository.ts.md).

### EvidenceItem

**Representation:** exact: `src/storage/sqlite/models/evidence-item.model.ts`

**Evidence:** accepted design and existing SQLite/Sequelize runtime

Owns one immutable captured-evidence row in `evidence_items`. The row preserves
its Project, project-local sequence, trusted capture source, normalized source
facts, exact native source, integrity digest, replay identity, and receipt
time.

Detailed boundary:
[`EvidenceItem`](pseudocode/src/storage/sqlite/models/evidence-item.model.ts.md).

### EvidenceIngestionService

**Representation:** semantic: accepted captured-evidence processing owner

**Evidence:** accepted design in README and user requirement

Coordinates reading a finite Project evidence frontier, Session curation,
validated reconciliation, durable candidate leads, and successful progress.
It starts after capture commits. Session owns eligibility and memory meaning.
This is distinct from the retired pre-persistence ingestion service.

### Session Memory

**Representation:** semantic: recent-work memory product

**Evidence:** accepted design and user requirement

Owns independently reconcilable recent-work entries in SQLite, evidence
selection and qualification, curation, applicability, lifecycle, retrieval,
and maintenance progress. It reads raw, unqualified evidence and existing
memory. Its curator proposes Session changes and destination-specific durable
leads. Session continuity is not repository truth; a lead is not authority for
a higher product. Step 3 designs this behavior. Step 5 proves the complete
continuity loop using that behavior.

### EvidenceInsertionService

**Representation:** semantic: accepted targeted-proposal owner

**Evidence:** accepted design in README and the targeted-insertion contract

Accepts exact ordered proposal content for one explicit Project, Personal, or
Practice target. Trusted entry context supplies provenance. The shared
insertion-operation ledger and selected product Inbox commit the batch and
receipt atomically. Acceptance returns before curation. This operation never
enters captured evidence or Session Memory.

### Targeted Insertion Operation Ledger

**Representation:** semantic: cross-target insertion replay and receipts

**Evidence:** accepted targeted-insertion contract

Owns operation correlation, ordered-request comparison, and immutable Inbox
acceptance receipts across durable targets. It joins the selected product
Inbox transaction. It owns no candidate lifecycle or canonical memory.
Detailed boundary: [Durable Inbox](pseudocode/durable-memory-inbox.md).

### Project Memory

**Representation:** semantic: Project memory product

**Evidence:** accepted design in README

Owns its Inbox, repository-grounded curation, canonical Markdown nodes,
applicability, reconciliation, and query. Repository behavior and explicit
Project decisions govern its authority. It reopens original evidence and
relevant source state before admitting a lead.

### Personal Memory

**Representation:** semantic: Personal memory product

**Evidence:** accepted design in README

Owns its Inbox, user-wide preferences, Project exceptions, canonical Markdown,
curation, lifecycle, and retrieval. Explicit guidance is strong evidence;
one Project constraint does not automatically become a global preference.

### Practice Memory

**Representation:** semantic: Practice memory product

**Evidence:** accepted design in README

Owns its Inbox, reusable technology and technique guidance, concrete
applicability, canonical Markdown, curation, lifecycle, and retrieval.
Observed use does not prove success. Practice preserves relevant versions,
modes, examples, failures, and constraints.

### IAgentAdapter

**Representation:** semantic: provider-neutral agent-execution contract

**Evidence:** accepted design in README

Executes bounded workflow-owned tasks through a configured provider and
returns untrusted proposals. Capture and execution are independently selected
capabilities. Workflows own prompts and admission; agents cannot publish
canonical memory. Core query requires no agent execution.

### QueryService

**Representation:** semantic: accepted read-only federation owner

**Evidence:** accepted design in README

Resolves applicable context and queries each applicable memory product.
Products own qualification, retrieval, and result shape. Federation preserves
their grouped results without comparing scores across products. Unmanaged
directories admit Personal and Practice queries without implicit registration.
Optional answer aggregation retains the unchanged core result.

## Existing Files Or Owners Relied On

### WorkspaceContext

**Representation:** exact: `src/workspace/workspace-context.ts`

**Evidence:** approved optional Git snapshot shape

An immutable value containing ProjectRegistration, the canonical working
directory (`workingDirectory`), and optional GitContext (`git`). The working
directory supplies workspace context without a separate Workspace entity.

GitContext records either an observed branch name, HEAD commit, and configured
upstream reference with its locally available commit, or an unavailable result.
Git is optional. No Git context means the registered Project has no repository;
unavailable Git observation does not make a managed Project unmanaged.
The context contains no file statuses, diffs, or untracked-file inventory.

Detailed value and null meanings:
[`WorkspaceContext`](pseudocode/src/workspace/workspace-context.ts.md).

### WorkspaceContextService

**Representation:** exact: `src/workspace/workspace-context.service.ts`

**Evidence:** verified implementation and accepted design

Reads immutable registrations through `ProjectRegistrationRepository`,
matches canonical directories to the most specific registered root, and
observes local Git context, including the branch's configured upstream reference
and commit, without fetching. It returns a managed immutable `WorkspaceContext`, an
unmanaged result, or a failure. It performs no registration or memory writes.
WorkspaceContext is a passive snapshot; later resolution creates another
snapshot instead of changing captured evidence.

Captured Git context describes the state observed during capture, not the
state at the native event time. A delayed event from branch A can therefore
have a capture-time observation of branch B. Any branch supplied by the source
remains separate source data; it does not replace the observed workspace
context. Exact replay returns the existing evidence and preserves its original
workspace snapshot.

### Project

**Representation:** exact: `src/storage/sqlite/models/project.model.ts`

**Evidence:** verified implementation and accepted design

Owns private SQLite identity, immutable user-assigned public key, canonical
roots, and `lastAllocatedEvidenceSequence`. It owns no branch or Session
progress state. The development seed establishes `llm-wiki` in this permanent
multi-project model. Normal operations consume existing registration.

### SqliteDatabase

**Representation:** exact: `src/storage/sqlite/sqlite-database.ts`

**Evidence:** verified implementation and accepted design

Owns process-scoped Sequelize access, managed IMMEDIATE write transactions,
and cleanup. SqliteRuntime supplies the packaged driver and extension
initialization. EvidenceItemRepository uses this transaction boundary.

### SqliteSchema

**Representation:** exact: `src/storage/sqlite/sqlite-schema.ts`

**Evidence:** verified implementation and accepted design

Registers models, validates migration history as a known prefix, and applies
ordered explicit migrations before database opening completes. Schema
establishment does not seed Project data.

## Admission Rule

This shape consolidates accepted product owners and verified runtime owners.
Capture retains its detailed adapter-to-SQLite boundary. Higher memory
products retain their own semantics and delivery steps. The map does not add
services, tables, or behavior from superseded designs merely because older
pseudocode named them.
