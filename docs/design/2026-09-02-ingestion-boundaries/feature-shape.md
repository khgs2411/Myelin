# Ingestion Boundaries — Feature Shape

This focused shape separates captured work evidence from deliberate proposals
for durable memory. It also establishes the development-only fixture used to
prove captured-evidence and Session Memory behavior before provider hooks are
installed.

Design issue status: [Open Design Issues](design-issues.md).

## Feature Map

```text
[Project Bootstrap]
  -> public ProjectKey
      -> [Project Resolution]

(provider hook)
  -> [Provider Evidence Capture]
      -> [Captured Evidence Ingestion]

(development transcript file)
  -> [Development Capture Fixture]
      -> [Captured Evidence Ingestion]

[Captured Evidence Ingestion]
  -> [Evidence Acceptance]
      -> [Session Maintenance]
          -> [Session Memory]

[Session Memory]
  -> destination-specific candidate leads
      -> [Project Memory]
      -> [Personal Memory]
      -> [Practice Memory]

(human | agent)
  -> [Targeted Memory Insertion]
      -> [Project Resolution]
      -> [Targeted Insertion Operation Ledger]
      -> exactly one selected product Inbox:
          -> [Project Memory]
          -> [Personal Memory]
          -> [Practice Memory]

[Targeted Memory Insertion] -X-> [Session Memory]
[Targeted Memory Insertion] -X-> (direct canonical memory writes)
[Development Capture Fixture] -X-> (production distribution)
```

## Design Item Catalog

| Design item | Representation |
| --- | --- |
| [Project Bootstrap](#project-bootstrap) | semantic: `Project Bootstrap` |
| [Project Resolution](#project-resolution) | semantic: `Project Resolution` |
| [Provider Evidence Capture](#provider-evidence-capture) | exact: `src/capture/evidence-capture.service.ts` and capture adapters |
| [Development Capture Fixture](#development-capture-fixture) | semantic: `Development Capture Fixture` |
| [Captured Evidence Ingestion](#captured-evidence-ingestion) | exact: `src/capture/captured-evidence-ingestion.service.ts` |
| [Targeted Memory Insertion](#targeted-memory-insertion) | semantic: `Targeted Memory Insertion` |
| [Targeted Insertion Operation Ledger](#targeted-insertion-operation-ledger) | semantic: `Targeted Insertion Operation Ledger` |
| [Evidence Acceptance](#evidence-acceptance) | exact: `src/evidence/evidence-acceptance.service.ts` |
| [Session Maintenance](#session-maintenance) | exact: `src/session-maintenance/` |
| [Session Memory](#session-memory) | semantic: `Session Memory` |
| [Project Memory](#project-memory) | semantic: `Project Memory` |
| [Personal Memory](#personal-memory) | semantic: `Personal Memory` |
| [Practice Memory](#practice-memory) | semantic: `Practice Memory` |

## New Or Revised Files Or Owners

### Project Resolution

**Representation:** semantic: `Project Resolution`

**Evidence:** accepted design and user requirement

Owns translation of a stable public `ProjectKey` into the application's
internal SQLite project identity and current registered project context. The
key is an identifier, not an authentication secret or a database primary key.

Detailed boundary: [Project Identity](pseudocode/project-identity.md).

### Development Capture Fixture

**Representation:** semantic: `Development Capture Fixture`

**Evidence:** accepted design and user requirement

Owns one canonical internal development tool that reads an exact transcript
fixture, receives the fixed local project context from Application composition,
supplies deterministic development capture metadata, and enters the same
`CapturedEvidenceIngestionService` used by provider capture. It identifies its
source as `development.fixture`, is unavailable in production distribution,
and does not claim to prove project resolution or a real provider hook.

Detailed boundary:
[Development Capture Fixture](pseudocode/development-capture-fixture.md).

### Captured Evidence Ingestion

**Representation:** exact: `src/capture/captured-evidence-ingestion.service.ts`

**Evidence:** accepted design

Owns the shared deterministic conversion of a normalized capture observation,
trusted source identity, and resolved workspace context into captured evidence.
It constructs source material and `EvidenceCandidateDto`, completes replay
metadata, and delegates durable acceptance without resolving projects.

Detailed contract:
[`CapturedEvidenceIngestionService`](pseudocode/src/capture/captured-evidence-ingestion.service.ts.md).

### Targeted Memory Insertion

**Representation:** semantic: `Targeted Memory Insertion`

**Evidence:** accepted design and user requirement

Owns deliberate submission of an ordered batch to one explicitly selected
Project, Personal, or Practice Memory Inbox. It preserves exact content and
trusted entry-source provenance. It does not target Session Memory or write
canonical memory without the selected product's curation.

Detailed boundary:
[Targeted Memory Insertion](pseudocode/targeted-memory-insertion.md).

### Targeted Insertion Operation Ledger

**Representation:** semantic: `Targeted Insertion Operation Ledger`

**Evidence:** accepted design

Owns replay identity, request fingerprint, and immutable acceptance receipts
across Project, Personal, and Practice Memory targets. It commits one operation
record with the complete selected-product Inbox batch in one SQLite
transaction. It does not own candidate maintenance or canonical memory.

Detailed boundary:
[Durable Memory Inbox](pseudocode/durable-memory-inbox.md).

### Session Memory

**Representation:** semantic: `Session Memory`

**Evidence:** accepted design

Owns recent-work continuity derived from captured evidence. It is maintained
before it emits destination-specific candidate leads for more durable memory
products. Deliberate targeted insertion does not enter this product.

### Project Memory

**Representation:** semantic: `Project Memory`

**Evidence:** accepted design and user requirement

Owns its project-scoped SQLite Inbox candidate persistence, product-local
lifecycle, curation, and canonical durable memory. It may receive candidate
leads from Session Memory or deliberate proposals that explicitly select
Project Memory.

### Personal Memory

**Representation:** semantic: `Personal Memory`

**Evidence:** accepted design and user requirement

Owns its user-scoped SQLite Inbox candidate persistence, product-local
lifecycle, curation, and canonical durable memory. It may receive candidate
leads from Session Memory or deliberate proposals that explicitly select
Personal Memory.

### Practice Memory

**Representation:** semantic: `Practice Memory`

**Evidence:** accepted design and user requirement

Owns its practice-scoped SQLite Inbox candidate persistence, product-local
lifecycle, curation, and canonical durable memory. It may receive candidate
leads from Session Memory or deliberate proposals that explicitly select
Practice Memory.

## Existing Files Or Owners Relied On

### Project Bootstrap

**Representation:** semantic: `Project Bootstrap`

**Evidence:** accepted design

Creates or returns one registered project and its immutable public
`ProjectKey`. Project relocation can replace its path without replacing the
key.

### Provider Evidence Capture

**Representation:** exact: `src/capture/evidence-capture.service.ts` and capture
adapters

**Evidence:** accepted design

Normalizes captured provider activity, resolves its observed working directory
to workspace context, and delegates the normalized observation and resolved
context to `CapturedEvidenceIngestionService`.

### Evidence Acceptance

**Representation:** exact: `src/evidence/evidence-acceptance.service.ts`

**Evidence:** accepted design

Owns durable acceptance, provenance, replay behavior, and Session maintenance
obligation for captured evidence. Targeted durable-memory proposals do not use
this Session-specific scheduling contract.

### Session Maintenance

**Representation:** exact: `src/session-maintenance/`

**Evidence:** accepted design

Owns maintenance eligibility and progress for captured evidence that can change
Session Memory.

## Admission Rule

This shape admits only the accepted split between captured Session evidence,
targeted durable-memory proposals, stable public project keys, and the internal
development fixture. Every admitted owner and relationship is established by
accepted design or explicit user requirement.
