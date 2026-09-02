# LLM Wiki — Canonical Feature Shape

This file is the canonical application-wide map of accepted macro design. It
records what the application has established by design, whether or not that
design is implemented. It is not a roadmap, implementation plan, progress
ledger, or replacement for detailed design contracts.

Focused design units live in dated folders under `docs/design/`. When a focused
unit resolves a macro owner, responsibility, relationship, or boundary, that
result is reconciled here. The focused unit retains the detailed contract and
decision context. [ROADMAP.md](../../ROADMAP.md) owns workload sequence and
progress. Executable source remains the authority for implemented behavior.

Detailed design is layered by focused unit. The
[Our App design unit](2026-08-12-our-app/) establishes the initial product and
architecture baseline. The newer
[Ingestion Boundaries design unit](2026-09-02-ingestion-boundaries/) supersedes
that baseline for public project keys, targeted durable-memory insertion, and
development capture fixtures. When focused units overlap, the newer accepted
unit controls that boundary. The
[Local Ingestion Prototype Foundation](2026-09-02-ingestion-implementation-foundation/)
maps the concrete owners behind the fixed-project manual ingestion interface
before project discovery and installation are introduced. It does not
supersede the longer-term ingestion product boundaries.

Open design frontier:
[application-wide issues](2026-08-12-our-app/design-issues.md). The
[ingestion-boundary issue record](2026-09-02-ingestion-boundaries/design-issues.md)
currently contains no open issues.

## Feature Map

```text
[Application Installation]
  -> [Installed Command]

(human shell | provider hook | future MCP client)
  -> [Installed Command]
      -> [Application]
          -> [Project Bootstrap]
              -> [Project Resolution]
              -> [Workspace Context]
              -> [Evidence Store]

          -> [Targeted Memory Insertion]
              -> [Project Resolution]
              -> [Targeted Insertion Operation Ledger]
              -> exactly one selected product Inbox:
                  -> [Project Memory]
                  -> [Personal Memory]
                  -> [Practice Memory]

          -> [Provider Evidence Capture]
              -> [Capture Provider Boundary]
              -> [Workspace Context]
              -> [Captured Evidence Ingestion]

          -> [Query]
              -> [Workspace Context]
              -> [Session Memory]
              -> [Project Memory]
              -> [Personal Memory]
              -> [Practice Memory]
              -X-> [Agent Execution]

[Captured Evidence Ingestion]
  -> [Evidence Acceptance]

[Evidence Acceptance]
  -> [Evidence Store]
  -> [Session Maintenance]
      -> [Evidence Store]
      -> [Agent Execution]
      -> [Session Memory]

[Session Memory]
  -> destination-specific candidate leads
      -> [Project Memory]
      -> [Personal Memory]
      -> [Practice Memory]

[Session Memory] -------------\
[Project Memory] --------------+-> [Memory Interoperability]
[Personal Memory] -------------+
[Practice Memory] -------------/

[Project Memory] --------------\
[Personal Memory] --------------+-> [Canonical Markdown Document]
[Practice Memory] --------------/

[SQLite Runtime]
  -> [SQLite Database]
      -> [Evidence Store]
      -> [Session Maintenance]
      -> [Session Memory]

[Development Capture Fixture]
  -> [Project Resolution]
  -> [Captured Evidence Ingestion]

[Targeted Memory Insertion] -X-> [Session Memory]
[Targeted Memory Insertion] -X-> (direct memory writes)
[Provider Evidence Capture] -X-> (direct memory writes)
[Development Capture Fixture] -X-> (production distribution)
```

## Design Item Catalog

| Design item | Representation |
| --- | --- |
| [Application Installation](#application-installation) | semantic: `Application Installation` |
| [Installed Command](#installed-command) | exact: `src/cli.ts` |
| [Application](#application) | exact: `src/application.ts` |
| [Project Bootstrap](#project-bootstrap) | semantic: `Project Bootstrap` |
| [Project Resolution](#project-resolution) | semantic: `Project Resolution` |
| [Workspace Context](#workspace-context) | exact: `src/workspace/workspace-context.service.ts` |
| [Targeted Memory Insertion](#targeted-memory-insertion) | semantic: `Targeted Memory Insertion` |
| [Targeted Insertion Operation Ledger](#targeted-insertion-operation-ledger) | semantic: `Targeted Insertion Operation Ledger` |
| [Provider Evidence Capture](#provider-evidence-capture) | exact: `src/capture/evidence-capture.service.ts` |
| [Capture Provider Boundary](#capture-provider-boundary) | exact: `src/capture/capture-adapter.ts` and provider adapters |
| [Development Capture Fixture](#development-capture-fixture) | semantic: `Development Capture Fixture` |
| [Captured Evidence Ingestion](#captured-evidence-ingestion) | exact: `src/capture/captured-evidence-ingestion.service.ts` |
| [Evidence Acceptance](#evidence-acceptance) | exact: `src/evidence/evidence-acceptance.service.ts` |
| [Evidence Store](#evidence-store) | exact: SQLite evidence models and repositories |
| [Session Maintenance](#session-maintenance) | exact: Session maintenance services and persistence |
| [Memory Interoperability](#memory-interoperability) | semantic: `Memory Interoperability` |
| [Session Memory](#session-memory) | semantic: `Session Memory` |
| [Project Memory](#project-memory) | semantic: `Project Memory` |
| [Personal Memory](#personal-memory) | semantic: `Personal Memory` |
| [Practice Memory](#practice-memory) | semantic: `Practice Memory` |
| [Query](#query) | exact: `src/query/query.service.ts` |
| [Canonical Markdown Document](#canonical-markdown-document) | exact: `src/memory/markdown/markdown-memory-document.ts` |
| [Agent Execution](#agent-execution) | exact: provider-neutral and Codex agent adapters |
| [SQLite Runtime](#sqlite-runtime) | exact: `src/storage/sqlite/sqlite-runtime.ts` |
| [SQLite Database](#sqlite-database) | exact: `src/storage/sqlite/sqlite-database.ts` |

## New Or Revised Files Or Owners

### Application Installation

**Representation:** semantic: `Application Installation`

**Evidence:** accepted design

Owns publication of the installed command, application-state initialization,
and installation or removal of provider capture mechanics. It does not own
project bootstrap or provider-specific memory behavior.

Detailed boundary:
[architecture pseudocode](2026-08-12-our-app/pseudocode/architecture.pseudocode.md).

### Installed Command

**Representation:** exact: `src/cli.ts`

**Evidence:** accepted design

Owns process input, application-operation routing, structured machine results,
safe diagnostics, and process cleanup. It exposes bootstrap, targeted memory
insertion, capture, and query without implementing their workflows. The
repository-local manual interface names targeted insertion
`memory propose <project | personal | practice>` and exposes the capture fixture
only as `dev capture-fixture`. Production distribution omits the `dev` family.

Detailed contract:
[`src/cli.ts`](2026-08-12-our-app/pseudocode/src/cli.ts.md).

### Application

**Representation:** exact: `src/application.ts`

**Evidence:** accepted design and verified outer-shell implementation

Owns process-scoped composition and the provider-neutral public application
facade. It constructs one SQLite database lifecycle, injects capabilities into
workflow owners, delegates public operations, and closes infrastructure.

Detailed contract:
[`src/application.ts`](2026-08-12-our-app/pseudocode/src/application.ts.md).

Focused local composition:
[`src/application.ts`](2026-09-02-ingestion-implementation-foundation/pseudocode/src/application.ts.md).

### Project Bootstrap

**Representation:** semantic: `Project Bootstrap`

**Evidence:** accepted design

Owns durable registration of one exact canonical project root, creation or
reuse of its immutable public `ProjectKey`, and coordination of the product
state required for a new or existing project. Query and insertion do not
silently create or repair project registration.

Detailed boundary:
[Project Identity](2026-09-02-ingestion-boundaries/pseudocode/project-identity.md).

### Project Resolution

**Representation:** semantic: `Project Resolution`

**Evidence:** accepted design and user requirement

Owns translation of the stable public `ProjectKey` used by CLI, MCP, function,
and internal-development requests into the private SQLite project identity and
current registered context. The key is not a database identity or an
authentication secret.

Detailed boundary:
[Project Identity](2026-09-02-ingestion-boundaries/pseudocode/project-identity.md).

### Workspace Context

**Representation:** exact: `src/workspace/workspace-context.service.ts`

**Evidence:** accepted design

Owns provider-neutral resolution of observed directories against registered
projects and construction of current workspace context after explicit project
resolution. It returns managed, unmanaged, or failed context without persisting
project state.

Detailed contract:
[`WorkspaceContextService`](2026-08-12-our-app/pseudocode/src/workspace/workspace-context.service.ts.md).

### Targeted Memory Insertion

**Representation:** semantic: `Targeted Memory Insertion`

**Evidence:** accepted design and user requirement

Owns atomic submission of ordered, already-curated content to one explicitly
selected Project, Personal, or Practice Memory Inbox. It resolves the public
project key, preserves exact content and trusted entry-source provenance, and
supports replay-safe client references. It does not target Session Memory or
write canonical memory without the selected product's curation.

Detailed contract:
[Targeted Memory Insertion](2026-09-02-ingestion-boundaries/pseudocode/targeted-memory-insertion.md).

### Targeted Insertion Operation Ledger

**Representation:** semantic: `Targeted Insertion Operation Ledger`

**Evidence:** accepted design

Owns replay identity, versioned ordered-request fingerprints, and immutable
acceptance receipts across Project, Personal, and Practice Memory targets. It
commits one operation record with the complete selected-product Inbox batch in
one SQLite transaction. It does not own product-local candidate lifecycle,
curation, or canonical memory.

Detailed contract:
[Durable Memory Inbox](2026-09-02-ingestion-boundaries/pseudocode/durable-memory-inbox.md).

### Provider Evidence Capture

**Representation:** exact: `src/capture/evidence-capture.service.ts`

**Evidence:** accepted design

Owns the bounded non-agentic capture workflow. It receives one injected capture
adapter, normalizes native activity, resolves its observed working directory,
and delegates the normalized observation plus resolved workspace context to
`CapturedEvidenceIngestionService`. Unmanaged activity does not become durable
evidence. Captured evidence is authoritative Session input; it is not Session
Memory itself.

Detailed contract:
[`EvidenceCaptureService`](2026-08-12-our-app/pseudocode/src/capture/evidence-capture.service.ts.md).

### Capture Provider Boundary

**Representation:** exact: `src/capture/capture-adapter.ts` and
`src/providers/codex/codex-capture.adapter.ts`

**Evidence:** accepted design

Owns provider-native activity validation and normalization. Provider identity
comes from the selected application route, and provider payloads cannot change
that route or enter the memory model directly.

Detailed contracts:
[`CaptureAdapter`](2026-08-12-our-app/pseudocode/src/capture/capture-adapter.ts.md)
and
[`CodexCaptureAdapter`](2026-08-12-our-app/pseudocode/src/providers/codex/codex-capture.adapter.ts.md).

### Development Capture Fixture

**Representation:** semantic: `Development Capture Fixture`

**Evidence:** accepted design and user requirement

Owns the canonical internal development tool for submitting an exact transcript
file as controlled captured evidence. Application composition binds its fixed
local project context. The tool supplies development capture provenance and
delegates to `CapturedEvidenceIngestionService`. It is not available in
production and does not claim to verify project resolution, real hook parsing,
or installation.

Detailed boundary:
[Development Capture Fixture](2026-09-02-ingestion-boundaries/pseudocode/development-capture-fixture.md).

### Captured Evidence Ingestion

**Representation:** exact: `src/capture/captured-evidence-ingestion.service.ts`

**Evidence:** accepted design

Owns the shared deterministic conversion of a normalized capture observation,
trusted source identity, and resolved `WorkspaceContext` into captured evidence.
It constructs source material and `EvidenceCandidateDto`, completes replay
metadata, and delegates durable evidence acceptance. It never resolves a
project key, project path, or observed working directory.

Detailed contract:
[`CapturedEvidenceIngestionService`](2026-09-02-ingestion-boundaries/pseudocode/src/capture/captured-evidence-ingestion.service.ts.md).

### Evidence Acceptance

**Representation:** exact: `src/evidence/evidence-acceptance.service.ts`

**Evidence:** accepted design

Owns idempotent durable acceptance of provider-neutral captured evidence and
the same transaction's Session maintenance obligation. It preserves provenance
and source material, assigns acceptance metadata, and returns a durable receipt.
Targeted durable-memory insertion uses the selected product's Inbox contract
instead of this Session scheduling path.

Detailed contracts:
[`EvidenceAcceptanceService`](2026-08-12-our-app/pseudocode/src/evidence/evidence-acceptance.service.ts.md)
and
[`EvidenceCandidateDto`](2026-08-12-our-app/pseudocode/src/evidence/evidence-item.dto.ts.md).

### Evidence Store

**Representation:** exact: SQLite Project, EvidenceItem, and acceptance-operation
models with their evidence repositories

**Evidence:** accepted design

Owns private SQLite project identity, the public project key, append-only
captured evidence, project-local evidence sequence allocation, replay lookup,
and immutable acceptance receipts. It does not own evidence meaning, memory
admission, or workflow transactions.

Detailed contracts:
[`Project`](2026-08-12-our-app/pseudocode/src/storage/sqlite/models/project.model.ts.md),
[`EvidenceItem`](2026-08-12-our-app/pseudocode/src/storage/sqlite/models/evidence-item.model.ts.md),
[`EvidenceAcceptanceOperation`](2026-08-12-our-app/pseudocode/src/storage/sqlite/models/evidence-acceptance-operation.model.ts.md),
[`EvidenceLogRepository`](2026-08-12-our-app/pseudocode/src/storage/sqlite/repositories/evidence-log.repository.ts.md),
and
[`EvidenceAcceptanceOperationRepository`](2026-08-12-our-app/pseudocode/src/storage/sqlite/repositories/evidence-acceptance-operation.repository.ts.md).

### Session Maintenance

**Representation:** exact: `src/session-maintenance/` services with Session
maintenance models and repositories

**Evidence:** accepted design

Owns Session Memory initialization, effective policy revision, maintenance
eligibility, pending obligation coalescing, and the covered evidence frontier.
The facade exposes only lifecycle and scheduling capabilities. It does not own
maintenance execution. Its evidence frontier contains captured evidence, not
targeted durable-memory proposals.

Detailed contracts:
[`SessionMaintenance`](2026-08-12-our-app/pseudocode/src/session-maintenance/session-maintenance.ts.md),
[`SessionMaintenanceLifecycleService`](2026-08-12-our-app/pseudocode/src/session-maintenance/session-maintenance-lifecycle.service.ts.md),
[`SessionMaintenancePolicyService`](2026-08-12-our-app/pseudocode/src/session-maintenance/session-maintenance-policy.service.ts.md),
[`SessionMaintenanceScheduleService`](2026-08-12-our-app/pseudocode/src/session-maintenance/session-maintenance-schedule.service.ts.md),
and
[`SessionMaintenanceEvidenceReader`](2026-08-12-our-app/pseudocode/src/session-maintenance/session-maintenance-evidence.reader.ts.md).

### Memory Interoperability

**Representation:** semantic: `Memory Interoperability`

**Evidence:** accepted design

Owns the minimum shared vocabulary that lets four independent memory products
participate in one brain. It preserves product identity, canonical references,
provenance, freshness, lifecycle visibility, and relationships without
imposing one storage model or behavioral interface.

Detailed boundary:
[product pseudocode](2026-08-12-our-app/pseudocode/BRAIN.pseudocode.md).

### Session Memory

**Representation:** semantic: `Session Memory`

**Evidence:** accepted design

Owns recent continuity for one project with current-workspace applicability.
Its canonical content is independently reconcilable SQLite memory records. It
owns Session-specific maintenance, freshness, retrieval, and result semantics.

Detailed boundary:
[product pseudocode](2026-08-12-our-app/pseudocode/BRAIN.pseudocode.md).

### Project Memory

**Representation:** semantic: `Project Memory`

**Evidence:** accepted design

Owns durable repository-scoped knowledge derived from repository behavior,
explicit project decisions, and preserved evidence. Its canonical content is
human-readable Markdown, and it owns its applicability, maintenance, retrieval,
result semantics, SQLite Inbox candidate persistence, product-local Inbox
lifecycle, and curation of explicit Project Memory proposals.

Detailed boundary:
[product pseudocode](2026-08-12-our-app/pseudocode/BRAIN.pseudocode.md).

### Personal Memory

**Representation:** semantic: `Personal Memory`

**Evidence:** accepted design

Owns durable user defaults, preferences, and collaboration guidance across
projects while preserving applicability limits and project exceptions. Its
canonical content is human-readable Markdown, and it owns its maintenance,
retrieval, result semantics, SQLite Inbox candidate persistence, product-local
Inbox lifecycle, and curation of explicit Personal Memory proposals.

Detailed boundary:
[product pseudocode](2026-08-12-our-app/pseudocode/BRAIN.pseudocode.md).

### Practice Memory

**Representation:** semantic: `Practice Memory`

**Evidence:** accepted design

Owns reusable, evidence-supported guidance for concrete technologies and
techniques across projects. Its canonical content is human-readable Markdown,
and it owns generalization, version applicability, maintenance, retrieval, and
result semantics, SQLite Inbox candidate persistence, product-local Inbox
lifecycle, and curation of explicit Practice Memory proposals.

Detailed boundary:
[product pseudocode](2026-08-12-our-app/pseudocode/BRAIN.pseudocode.md).

### Query

**Representation:** exact: `src/query/query.service.ts`

**Evidence:** accepted design

Owns provider-neutral read orchestration. It resolves query context, invokes
each applicable product's query capability, and returns grouped qualified
results without comparing private product scores or requiring agentic
aggregation.

Detailed contract:
[`QueryService`](2026-08-12-our-app/pseudocode/src/query/query.service.ts.md).

### Canonical Markdown Document

**Representation:** exact: `src/memory/markdown/markdown-memory-document.ts`

**Evidence:** accepted design

Owns the portable Markdown representation shared by Project, Personal, and
Practice Memory. It defines canonical identity, properties, relationships,
parsing, and semantic-section extraction without owning publication or
product-local retrieval.

Detailed contract:
[`MarkdownMemoryDocument`](2026-08-12-our-app/pseudocode/src/memory/markdown/markdown-memory-document.ts.md).

### Agent Execution

**Representation:** exact: `src/agent/agent-adapter.ts` and
`src/providers/codex/codex-agent.adapter.ts`

**Evidence:** accepted design

Owns provider-neutral execution of bounded agent tasks and the Codex-specific
process adapter. Memory workflows may use this capability and validate its
untrusted results. Core query does not depend on agent execution.

Detailed boundary:
[architecture pseudocode](2026-08-12-our-app/pseudocode/architecture.pseudocode.md).

## Existing Files Or Owners Relied On

### SQLite Runtime

**Representation:** exact: `src/storage/sqlite/sqlite-runtime.ts`

**Evidence:** verified implementation and accepted design

Validates the Bun runtime, resolves packaged SQLite capabilities, and applies
required connection initialization before application storage opens. It owns
neither ORM behavior nor product persistence semantics.

Detailed design:
[architecture pseudocode](2026-08-12-our-app/pseudocode/architecture.pseudocode.md).

### SQLite Database

**Representation:** exact: `src/storage/sqlite/sqlite-database.ts`

**Evidence:** verified implementation and accepted design

Owns one process-scoped Sequelize connection lifecycle and managed immediate
write transactions. It supplies shared infrastructure to repositories without
becoming a service locator or generic database abstraction.

Detailed contract:
[`SqliteDatabase`](2026-08-12-our-app/pseudocode/src/storage/sqlite/sqlite-database.ts.md).

## Admission Rule

This Feature Shape admits only accepted macro owners and verified implemented
owners needed to understand the integrated application. Exact source paths can
represent accepted design before implementation; their evidence records state
that boundary. Semantic owners appear only where accepted design establishes
the responsibility without requiring a physical representation.

Focused design units own detailed contracts and decision context. The linked
Open Design Issues artifacts own unresolved design. The roadmap owns work order
and progress. Every admitted owner and relationship has accepted design or
verified implementation evidence.
