# Our App — Feature Shape

> Pseudocode artifact. Non-executable reference shape.

This artifact records only the implementation surface justified by the
[product pseudocode](./BRAIN.pseudocode.md) and
[architecture pseudocode](./architecture.pseudocode.md) so far. Expected future
responsibilities do not earn a file or boundary until concrete pseudocode
demonstrates an independently useful owner.

## Current design-unit catalog

This catalog is the current implementation surface justified by the design. It
is not a forecast, implementation plan, or list of work still required.

### Current source and semantic shape

```text
package.json
config.yaml

src/
  cli.ts
  application.ts

  session-maintenance/
    session-maintenance.ts
    session-maintenance-lifecycle.service.ts
    session-maintenance-policy.service.ts
    session-maintenance-schedule.service.ts
    session-maintenance-evidence.reader.ts

  capture/
    evidence-capture.service.ts
    capture-adapter.ts

  workspace/
    workspace-context.service.ts

  query/
    query.service.ts

  evidence/
    evidence-item.dto.ts
    evidence-insertion.service.ts
    evidence-acceptance.service.ts

  memory/
    [Memory product interoperability contract — representation OPEN]
    [Session Memory product — representation OPEN]
    [Project Memory product — representation OPEN]
    [Personal Memory product — representation OPEN]
    [Practice Memory product — representation OPEN]
    markdown/
      markdown-memory-document.ts

  storage/
    sqlite/
      sqlite-runtime.ts
      sqlite-database.ts
      models/
        project.model.ts
        evidence-item.model.ts
        evidence-acceptance-operation.model.ts
        session-maintenance-state.model.ts
        session-maintenance-policy.model.ts
        session-maintenance-request.model.ts
        session-maintenance-attempt.model.ts
      repositories/
        evidence-log.repository.ts
        evidence-acceptance-operation.repository.ts
        session-maintenance-state.repository.ts
        session-maintenance-policy.repository.ts
        session-maintenance-request.repository.ts

  agent/
    agent-adapter.ts

  providers/
    codex/
      codex-capture.adapter.ts
      codex-agent.adapter.ts
```

Every exact source path and bracketed semantic owner above has one matching
detail entry below. Bracketed entries are established design units, not
predicted paths. The detail entries distinguish design depth without creating
workflow status:

- A linked detail entry has an independently useful pseudocode artifact.
- An unlinked detail entry is justified by current design, but its deeper
  pseudocode has not yet earned a standalone artifact.
- `representation OPEN` or `filename OPEN` means that the semantic owner and
  its established job are selectable design units, while the named source-file
  detail is unresolved. It does not reopen the established responsibility.

### Semantic owners with representation open

These owners are justified by current behavior, but the design has not yet
established an exact source path:

| Design unit | Established responsibility | Unshaped edge |
| --- | --- | --- |
| Application installation owner | Publish the command, initialize machine state, and install provider capture mechanics | Script, package entry, or source-file representation |
| Project bootstrap application owner | Register one exact canonical directory through the Project model and atomically initialize its Session maintenance state | Concrete application service and relocation workflow |
| Memory product interoperability contract | Preserve tagged product identity, canonical reference, provenance, freshness, lifecycle visibility, and relationships across the Memory boundary without imposing shared behavior | Exact source representation and product-specific canonical reference shapes |
| Session Memory product | Own recent project and current-workspace continuity as independently reconcilable canonical SQLite records, including its product-specific query behavior | Canonical record, query-result representation, score threshold, other product operations, and curation lifecycle |
| Project Memory product | Own project documentation and its product-specific query behavior; authority follows repository behavior, explicit project decisions, and preserved evidence | Applicability, retrieval method and threshold, admission, publication, and maintenance owners |
| Personal Memory product | Own global user defaults and preferences plus their product-specific query behavior, applicability limits, and project exceptions | Retrieval method and threshold, admission, publication, and maintenance owners |
| Practice Memory product | Own reusable guidance for concrete technologies and techniques plus its product-specific query behavior and version applicability | Retrieval method and threshold, admission, publication, and maintenance owners |

### `package.json` — package and command publication metadata

Defines the TypeScript package and maps the intentionally unresolved installed
command name to the built CLI entry. It pins `sqlite-vec` to an exact compatible
version, pins compatible Sequelize v7 alpha `@sequelize/core` and
`@sequelize/sqlite3` packages, and includes the application-owned SQLite runtime
assets in supported packages. It participates in distribution but does not
collapse command publication, machine-state initialization, provider-hook
installation, and MCP registration into one lifecycle owner.

### `config.yaml` — human-facing application defaults

Defines validated operator-editable defaults in product-specific maintenance
sections. The current shape includes `maintenance.session` with its
evidence-count threshold and elapsed interval. Application composition injects
the validated canonical effective values and digest into
`SessionMaintenanceScheduleService`. For each operation with newly accepted
evidence, scheduling uses its internal `SessionMaintenancePolicyService` to
create a new immutable `SessionMaintenancePolicy` revision only when those
values differ. Policy synchronization and eligibility share the acceptance
transaction. Future memory products add their own configuration sections and
policy contracts rather than entering one shared maintenance policy.

### [`src/session-maintenance/session-maintenance.ts`](./src/session-maintenance/session-maintenance.ts.md) — `SessionMaintenance`

Defines the composed Session maintenance domain façade. It exposes instance
capabilities named `lifecycle` and `schedule`. Application composition can hold
the façade, but each workflow receives only the capability it needs. The façade
owns no common transaction and does not expose models or repositories. Policy
synchronization is an internal schedule collaborator, not a public capability.
No `execution` capability exists until its claim, replacement, publication, and
completion contract is shaped.

### [`src/session-maintenance/session-maintenance-lifecycle.service.ts`](./src/session-maintenance/session-maintenance-lifecycle.service.ts.md) — `SessionMaintenanceLifecycleService`

Owns the Session state part of project bootstrap. It initializes state for a
new Project or requires state for an existing Project through the caller's
bootstrap transaction. It exposes no ensure or repair path.

### [`src/session-maintenance/session-maintenance-policy.service.ts`](./src/session-maintenance/session-maintenance-policy.service.ts.md) — `SessionMaintenancePolicyService`

Owns synchronization of one project's validated effective
`maintenance.session` configuration into immutable SQLite policy revisions.
Through the acceptance transaction supplied by scheduling, it loads the latest
revision, compares canonical effective values, and inserts
`latest revision + 1` only when they differ. The first revision is one. It
returns the exact policy snapshot used by scheduling. YAML parsing and project
selection stay outside this service, and it is not a public façade capability.
Only the project's first accepted Evidence Log sequence permits an absent
policy; later absence is incompatible durable state.

### [`src/session-maintenance/session-maintenance-schedule.service.ts`](./src/session-maintenance/session-maintenance-schedule.service.ts.md) — `SessionMaintenanceScheduleService`

Owns Session request eligibility, active-chain validation, frontier
calculation, and pending-request coalescing. It joins the evidence-acceptance
transaction, synchronizes its injected effective policy through the internal
policy service, reads raw state, request, and Evidence Log facts, and sends
exact request writes. It does not accept evidence, notify workers, execute
attempts, or advance successful progress.

### [`src/session-maintenance/session-maintenance-evidence.reader.ts`](./src/session-maintenance/session-maintenance-evidence.reader.ts.md) — `SessionMaintenanceEvidenceReader`

Defines the narrow Evidence Log read port required by elapsed-time scheduling.
It returns the first uncovered evidence `received_at` value after a supplied
project sequence. `EvidenceLogRepository` implements the port without taking
ownership of Session eligibility.

### Application installation owner — representation `OPEN`

Owns the machine-level operation that publishes the stable command, initializes
application state, and installs provider-specific capture mechanics once per
machine. It may later make the separate MCP integration available through the
same top-level installation experience. No concrete script, source file, or
package entry has yet been justified as this owner.

### [`src/cli.ts`](./src/cli.ts.md) — process entry boundary

Routes the application's four public process behaviors: project bootstrap,
automatic capture, brain query, and manual evidence insertion. It delegates
each behavior to its application owner and does not implement registration,
capture, retrieval, or memory evolution itself. This file becomes one installed
named command whose name is intentionally unresolved.

### [`src/application.ts`](./src/application.ts.md) — `Application`

Exposes the stable provider-neutral application façade used by the CLI:
`bootstrapProject`, `capture`, `query`, and `insertEvidence`. It delegates to
private application services without exposing the service graph or implementing
workflow logic. Its asynchronous static `create` factory method owns
process-scoped dependency composition, including one `SqliteDatabase`, from
capability-specific runtime configuration. `close` releases that process-scoped
infrastructure.

### Project bootstrap application owner — representation `OPEN`

Owns provider-neutral durable registration of one exact canonical directory as
an overseen project root. It canonicalizes the path, observes an optional Git
repository root, and uses one application transaction to create or return the
project row and require its product-owned `SessionMaintenanceState`. A newly
created project receives its initial Session state through
`SessionMaintenanceLifecycleService.initializeNewProject` in that transaction.
An existing project uses `requireInitializedProject`; a missing required row is
incompatible durable state. The bootstrap owner returns the immutable
SQLite-assigned project identity. Its source filename, concrete service
boundary, and relocation workflow remain unshaped.

### [`src/capture/evidence-capture.service.ts`](./src/capture/evidence-capture.service.ts.md) — `EvidenceCaptureService`

Exposes one provider-neutral capture operation to the CLI. It normalizes native
activity through its injected `CaptureAdapter`, ignores activity outside every
overseen root, and combines managed activity with its capture origin and
resolved workspace context to construct one capture-originated
`EvidenceCandidateDto`. It then delegates durable acceptance to
`EvidenceAcceptanceService`. It plays the facade role without placing the
architectural pattern in the class name.

### [`src/capture/capture-adapter.ts`](./src/capture/capture-adapter.ts.md) — `CaptureAdapter`

Defines the capability contract that every capture-capable provider implements.
It validates and converts exact native provider activity into exactly one
provider-neutral observation draft, ignored outcome, or rejected outcome. It
does not construct an evidence candidate or item, own route identity, resolve
workspace context, or store evidence.

### [`src/workspace/workspace-context.service.ts`](./src/workspace/workspace-context.service.ts.md) — `WorkspaceContextService`

Resolves workspace context through durable overseen-project registrations. For
capture, it matches the provider-observed working directory against the most
specific containing registration. For manual insertion, `resolveProjectRoot`
requires an exact registered project root. Managed context reuses registered
project identity and optional Git repository location and adds the active branch
when available. It does not discover or register projects, own provider-session
identity, inspect source for curation, or perform semantic workstream analysis.

### [`src/providers/codex/codex-capture.adapter.ts`](./src/providers/codex/codex-capture.adapter.ts.md) — `CodexCaptureAdapter`

Implements `CaptureAdapter` for Codex. It validates exact JSON from the
registered `UserPromptSubmit` and `Stop` hooks, preserves the raw input, and
normalizes user and assistant messages. It does not register or normalize
`SessionStart`; count/time maintenance checks occur when evidence is accepted.

### [`src/query/query.service.ts`](./src/query/query.service.ts.md) — `QueryService`

Owns the provider-neutral query workflow: resolving applicable memory,
passing the same question and product-applicable context to each independent
memory product, and returning the qualified typed core results without agentic
curation. Each product owns its retrieval method, product-local score,
qualification threshold, freshness and applicability filters, and result
representation. Session returns qualified records or parsed text. Project,
Personal, and Practice return grouped Markdown references. Managed projects
query all four products. Unmanaged directories query Personal and Practice
without becoming a failure or causing implicit project bootstrap. An optional
later aggregator may curate the complete core result through `AgentAdapter`,
but it is not part of `QueryService.query` and its representation remains
`OPEN`.

### [`src/evidence/evidence-item.dto.ts`](./src/evidence/evidence-item.dto.ts.md) — evidence DTO contracts

Defines the immutable provider-neutral `EvidenceCandidateDto` constructed by
capture and manual insertion and the accepted `EvidenceItemDto` created by
acceptance. Candidate fields own capture-or-insertion origin, workspace context,
source time, normalized string content, and exact source material. Acceptance
adds acceptance time, persists the row, receives its SQLite-assigned identity,
and then constructs `EvidenceItemDto`. Neither DTO is the SQLite row shape or
owns replay suppression. Both remain plain immutable data without a shared DTO
base class or DTO-owned behavior. Runtime validation is an explicit
acceptance-boundary contract whose concrete library and owner remain unshaped.

### [`src/evidence/evidence-insertion.service.ts`](./src/evidence/evidence-insertion.service.ts.md) — `EvidenceInsertionService`

Owns deterministic insertion of an ordered batch of already-curated evidence
statements for one exact bootstrapped project root. It validates channel-specific
client-reference rules, resolves the exact root through
`WorkspaceContextService`, preserves each statement as exact `text/plain`
source material, constructs one provider-neutral `EvidenceCandidateDto` per
item, and delegates the atomic batch with immediate Session maintenance intent
to `EvidenceAcceptanceService`. It returns the acceptance receipt directly. It
does not invoke an agent, select a memory product, directly mutate memory, or
wait for curation. Inbox is a logical view over uncovered insertion-originated
Evidence Log items, not another store or queue.

### [`src/evidence/evidence-acceptance.service.ts`](./src/evidence/evidence-acceptance.service.ts.md) — `EvidenceAcceptanceService`

Owns the common deterministic acceptance boundary after evidence becomes
provider-neutral. One project-bound atomic operation validates DTOs, resolves
operation and source replay, assigns acceptance times and contiguous
project-local sequences, appends new evidence, receives SQLite-assigned evidence
identities, evaluates the active revisioned Session maintenance policy, creates
or coalesces a finite pending request, and stores the acceptance receipt. Its
accepted operation contract
requires one immutable, project-owned SQLite operation record containing the
versioned command fingerprint and complete versioned receipt for the owning
project's lifetime. It does not own the Evidence Log persistence
representation, source normalization, caller authority, correction
interpretation, maintenance execution, memory curation, or publication.

The service supplies each validated candidate plus acceptance-owned metadata
and owns the transaction semantics. `EvidenceLogRepository` owns row mapping,
append, and generated-identity return. The service then constructs the accepted
DTO. Source replay remains separate admission metadata persisted through a
nullable immutable projections on the accepted evidence row. Replay equality
uses a versioned fingerprint of the complete `EvidenceCandidateDto`;
acceptance-owned results do not participate. `EvidenceAcceptanceService` owns
replay classification, while `EvidenceLogRepository` owns lookup and storage.

This owner does not ingest accepted evidence into memory. Session Memory
ingestion is a later agentic workflow. Feature Shape does not predict its file
until that boundary is designed.

### [`src/storage/sqlite/repositories/evidence-log.repository.ts`](./src/storage/sqlite/repositories/evidence-log.repository.ts.md) — `EvidenceLogRepository`

Owns append-only mapping and insertion from one validated `EvidenceCandidateDto` plus
acceptance-owned time and project sequence to the append-only `EvidenceItem`
model. The established projection is hybrid:

- stable fields used for identity, ordering, filtering, and time queries become
  relational columns;
- project identity, project-local sequence, and nullable Git branch support the
  established project and branch retrieval behavior;
- complete nested origin, workspace context, and source-material detail remains
  available as lossless JSON;
- `EvidenceLogRepository` constructs one row object whose relational
  projections and lossless JSON derive from the same immutable candidate and
  acceptance metadata;
- one acceptance transaction inserts the row, so projections cannot commit
  independently; and
- stored evidence is append-only, so a relational projection cannot later
  diverge from its preserved JSON snapshot.

Its shaped `append` method requires the transaction supplied by
`EvidenceAcceptanceService`, stores optional replay identity and candidate
fingerprint projections, and returns only the SQLite-generated
`EvidenceItemId`. `reserveProjectSequenceRange` allocates one consecutive range
for the service's new items by advancing the owning Project's durable allocation
frontier through the caller-supplied `IMMEDIATE` transaction.
`findByReplayIdentity` returns the existing identity, project-local sequence,
and stored candidate fingerprint without leaking a Sequelize model. Replay
classification remains business logic in `EvidenceAcceptanceService`. Other
reads remain unshaped. The repository exposes no general update or delete
operation. The migration and future explicit-forgetting owners remain `OPEN`.

### [`src/storage/sqlite/repositories/evidence-acceptance-operation.repository.ts`](./src/storage/sqlite/repositories/evidence-acceptance-operation.repository.ts.md) — `EvidenceAcceptanceOperationRepository`

Owns transaction-scoped lookup and immutable insertion for the
`EvidenceAcceptanceOperation` model. `findByOperationId` returns the stored
command fingerprint and versioned raw receipt without exposing a Sequelize
model. `appendSuccessfulOperation` maps one validated successful operation and
returns no internal row identity. The repository does not own transactions,
fingerprint comparison, conflict classification, receipt validation, updates,
or general deletion.

### Memory product interoperability contract — representation `OPEN`

Defines the common exchange boundary across Session, Project, Personal, and
Practice Memory. Every reference remains tagged by product and exposes stable
canonical identity, an exact canonical version or reference, provenance,
freshness, lifecycle visibility, and relationships. It does not define one
memory payload or require shared save, update, search, hydrate, maintain,
scope, lifecycle-transition, or maintenance behavior. Each product owns its
query behavior and produces its own qualified result shape. References cross
the boundary as query outputs rather than inputs to a root hydration service.
The exact source representation and the product-specific canonical reference
shapes remain unshaped.

### Session Memory product — representation `OPEN`

Owns curated continuity about recent work within one project, with
current-workspace and project-wide applicability. Its canonical content is
SQLite, and one canonical record is one independently reconcilable memory
node. It does not become authoritative project truth merely because it is the
freshest memory product. It owns its query retrieval, scoring, qualification
threshold, freshness and applicability filters, and Session-specific result.
The exact record-versus-parsed-text result, canonical record and reference
schema, other product operations, and curation lifecycle remain unshaped.

### Project Memory product — representation `OPEN`

Owns human-readable documentation about how one project works and why. Its
authority follows repository behavior, explicit project decisions, and
preserved evidence. Its canonical content is durable Markdown using the shared
canonical Markdown document shape. It owns its retrieval, product-local
scoring and threshold, applicability filters, and qualified Markdown-reference
results. Its exact retrieval method, admission, publication, and maintenance
owners remain unshaped.

### Personal Memory product — representation `OPEN`

Owns the user's cross-cutting defaults, preferences, writing styles,
architectural choices, and collaboration preferences. It is global by default
but supports applicability limits and project exceptions. Its canonical
content is durable Markdown using the shared canonical Markdown document
shape. It owns its retrieval, product-local scoring and threshold,
applicability filters, and qualified Markdown-reference results. Its exact
retrieval method, admission, publication, and maintenance owners remain
unshaped.

### Practice Memory product — representation `OPEN`

Owns reusable guidance about how the user employs a concrete technology or
technique, including versions, modes, examples, constraints, failures, and
gotchas. Its canonical content is durable Markdown using the shared canonical
Markdown document shape. It owns its retrieval, product-local scoring and
threshold, subject and version filters, and qualified Markdown-reference
results. Its exact retrieval method, admission, publication, and maintenance
owners remain unshaped.

### [`src/memory/markdown/markdown-memory-document.ts`](./src/memory/markdown/markdown-memory-document.ts.md) — canonical Markdown document shape

Defines and validates the portable Markdown representation shared by Project,
Personal, and Practice Memory. It owns the flat YAML property profile,
immutable memory-node identity, standard Markdown relationship links, AST
parsing, and semantic-section extraction used by publication, indexing, and
query-result reference construction. It does not own filesystem publication,
SQLite indexing, product-local retrieval ranking, or memory admission.

### `src/storage/sqlite/sqlite-runtime.ts` — packaged SQLite runtime

Selects and initializes the application-owned SQLite runtime before any
connection is opened. Supported application packages include a compatible
SQLite driver with FTS5 enabled and the pinned `sqlite-vec` extension, so
ordinary use does not depend on Apple SQLite, Homebrew, or another host SQLite
installation. It supplies the compatible driver and per-connection extension
initialization to `SqliteDatabase`; Sequelize does not replace this owner.
Platform packaging, binary provenance, and the unsupported-host failure
contract still require deeper design.

### [`src/storage/sqlite/sqlite-database.ts`](./src/storage/sqlite/sqlite-database.ts.md) — `SqliteDatabase`

Owns one process-scoped Sequelize connection lifecycle. `Application.create`
opens it after `SqliteRuntime` initializes, injects the same instance into
SQLite repositories, and closes it during process cleanup. It provides the
managed `IMMEDIATE` write-transaction boundary required by evidence acceptance.
It is neither a global singleton nor a generic database base class. Additional
repository and migration files remain absent until their concrete operations
are shaped.

### [`src/storage/sqlite/models/project.model.ts`](./src/storage/sqlite/models/project.model.ts.md) — `Project`

Defines the `projects` Sequelize model populated by project bootstrap. Its base
class owns the auto-increment integer identity, unique canonical oversight
root, nullable Git repository root, monotonic Evidence Log allocation frontier,
and timestamps. Session maintenance state references Project from its own
product boundary; Project owns no Session-specific columns or reverse Session
association. Version one has no separate repository identity,
sequence-counter model, or table.

### [`src/storage/sqlite/models/session-maintenance-state.model.ts`](./src/storage/sqlite/models/session-maintenance-state.model.ts.md) — `SessionMaintenanceState`

Defines Session Memory's one project-scoped maintenance cursor. Its project
foreign key is also its primary key. The row stores the last Evidence Log
sequence covered by successful Session maintenance and the corresponding
successful-maintenance time. Bootstrap uses the Session lifecycle capability to
create the initial zero-and-null state through the Session repository in the
same application transaction as a new Project. The model owns same-row cursor
checks but does not copy the Project's allocation frontier or introduce a
generic memory-product discriminator.

### [`src/storage/sqlite/models/session-maintenance-policy.model.ts`](./src/storage/sqlite/models/session-maintenance-policy.model.ts.md) — `SessionMaintenancePolicy`

Defines immutable, project-effective Session maintenance policy revisions in
`session_maintenance_policies`. The composite project-and-revision identity
stores the evidence-count threshold, elapsed interval, and configuration
digest. The highest revision is active; there is no mutable active pointer or
separate revision table. A digest is not unique because returning to older
effective values still creates a new revision.

### [`src/storage/sqlite/models/session-maintenance-request.model.ts`](./src/storage/sqlite/models/session-maintenance-request.model.ts.md) — `SessionMaintenanceRequest`

Defines each finite Session maintenance obligation in
`session_maintenance_requests`. A request owns one project-local Evidence Log
range, pending/running/satisfied lifecycle, normal/immediate priority, and the
composite reference to the `SessionMaintenancePolicy` revision that caused its
eligibility. One pending request and one frozen running request may coexist for
a project. Same-row checks close its state, priority, and sequence vocabulary.
Two partial unique indexes enforce at most one pending and at most one running
request per project; the application transaction owns range relationships.

### `src/storage/sqlite/models/session-maintenance-attempt.model.ts` — `SessionMaintenanceAttempt`

Defines execution history for Session maintenance requests in
`session_maintenance_attempts`. Each attempt belongs to one request and owns
its execution state, lease, and failure evidence. Failed or expired attempts
do not reopen the request frontier. The exact claim, replacement, and
completion-fence schema remains unresolved with the execution boundary.

### [`src/storage/sqlite/repositories/session-maintenance-state.repository.ts`](./src/storage/sqlite/repositories/session-maintenance-state.repository.ts.md) — `SessionMaintenanceStateRepository`

Owns transaction-scoped initialization, required snapshot loading, and guarded
covered-frontier advancement for `SessionMaintenanceState`. Its advance method
accepts the exact frozen request frontier and successful time, checks that the
frontier moves forward without exceeding the owning Project's allocated
Evidence Log sequence, updates both cursor fields atomically, and requires
exactly one affected state row. It does not own eligibility, attempt success,
completion fencing, transactions, or another memory product's progress.

### [`src/storage/sqlite/repositories/session-maintenance-policy.repository.ts`](./src/storage/sqlite/repositories/session-maintenance-policy.repository.ts.md) — `SessionMaintenancePolicyRepository`

Owns transaction-scoped latest-revision lookup and immutable insertion for
`SessionMaintenancePolicy`. `SessionMaintenancePolicyService` compares
canonical effective values and supplies exact insert values inside the
acceptance transaction passed through `SessionMaintenanceScheduleService`. The
repository does not decide whether configuration changed, compute eligibility,
own transactions, or serve another memory product.

### [`src/storage/sqlite/repositories/session-maintenance-request.repository.ts`](./src/storage/sqlite/repositories/session-maintenance-request.repository.ts.md) — `SessionMaintenanceRequestRepository`

Returns raw pending and running request snapshots and applies exact guarded
writes selected by `SessionMaintenanceScheduleService`: insert pending, extend
its frontier, or promote its priority. It has no upsert or coalescing method.
The repository enforces row, project, state, and allocated-frontier guards,
while the schedule service owns eligibility and active-range relationships.
Execution-owned state transitions remain outside this design unit.

### [`src/storage/sqlite/models/evidence-item.model.ts`](./src/storage/sqlite/models/evidence-item.model.ts.md) — `EvidenceItem`

Defines the append-only `evidence_items` Sequelize model. Its base class owns
the auto-increment identity, project ownership and sequence, nullable branch,
normalized origin projections, normalized content, evidence times, and
lossless origin, workspace-context, and source-material JSON. It also owns the
nullable all-or-none replay identity and versioned candidate-fingerprint
projections. The exported class owns the `Project` relation. Its table contract
owns the project foreign key, project-sequence and replay-identity uniqueness,
origin-kind and replay-completeness checks, and established project, branch,
and Inbox indexes. Sequelize timestamps are disabled.

### [`src/storage/sqlite/models/evidence-acceptance-operation.model.ts`](./src/storage/sqlite/models/evidence-acceptance-operation.model.ts.md) — `EvidenceAcceptanceOperation`

Defines the immutable `evidence_acceptance_operations` Sequelize model. Its
base class owns the SQLite-assigned row identity, unique application operation
identity, required project ownership, versioned command fingerprint, versioned
complete receipt JSON, and application-assigned commit timestamp. The exported
class owns the `Project` relation. Its table contract owns operation-identity
uniqueness and restrictive project deletion. Sequelize timestamps are
disabled, and successful operation rows expose no normal mutation path.

### `src/agent/agent-adapter.ts` — `AgentAdapter`

Defines the provider-neutral capability for executing a bounded agent task.
Memory-maintenance workflows and an optional future query-result aggregator
may depend on this capability rather than on provider- and workflow-specific
adapters. The core query workflow does not depend on it.

### `src/providers/codex/codex-agent.adapter.ts` — `CodexAgentAdapter`

Implements `AgentAdapter` through the Codex CLI. Codex command construction,
process interaction, and provider-result parsing stop at this owner; curation
and optional query-result aggregation semantics remain in their application
workflows.

## Current relationship

```text
package.json
  -> declares the built cli.ts entry for command publication

application installation owner (representation OPEN)
  -> publishes the stable named command
  -> initializes application-owned machine state
  -> installs Codex capture hooks once per machine
  -> later makes the separate MCP integration available when it exists

human shell | provider hooks
  -> installed named command
      -> cli.ts
          -> capture command fixes provider and channel identity
          -> create immutable CaptureInvocationContext
          -> preserve exact provider-native input
          -> resolve runtime configuration for that capture route
          -> Application.create(runtime configuration)
              -> construct selected capture capability
                  codex capture configuration -> CodexCaptureAdapter
              -> inject CaptureInvocationContext and CodexCaptureAdapter
                 directly into EvidenceCaptureService
              -> retain independent agent-execution configuration
              -> construct and inject AgentAdapter only when a shaped memory
                 curation or optional query-result aggregation owner requires it
              -> construct application services
              -> return Application instance

          -> route bootstrap command
              -> Application.bootstrapProject(exact directory path)
                  -> project bootstrap application owner (representation OPEN)
                      -> one application write transaction
                      -> immutable ProjectIdentity
                      -> replaceable canonical oversight root
                      -> optional canonical Git repository root
                      -> Project model
                          -> new Project
                              -> sessionMaintenance.lifecycle.initializeNewProject
                                  -> SessionMaintenanceStateRepository.initialize
                                  -> product-owned initial SessionMaintenanceState
                          -> existing Project
                              -> sessionMaintenance.lifecycle.requireInitializedProject
                                  -> required existing SessionMaintenanceState

          -> route capture command
              -> Application.capture(exact native activity)
                  -> EvidenceCaptureService
                      -> injected CodexCaptureAdapter through CaptureAdapter
                      -> WorkspaceContextService
                          -> failed workspace context
                              -> safe capture failure
                          -> unmanaged
                              -> ignored without persistence
                          -> managed WorkspaceContext
                              -> construct capture-originated EvidenceCandidateDto
                              -> EvidenceAcceptanceService
                                  -> one atomic acceptance transaction
                                      -> EvidenceLogRepository.append
                                          -> append hybrid EvidenceItem row through supplied transaction
                                          -> return SQLite-generated identity
                                      -> construct accepted EvidenceItemDto
                                      -> sessionMaintenance.schedule.afterEvidenceAccepted
                                          -> SessionMaintenancePolicyService.synchronize
                                              -> injected effective values
                                              -> exact revision in the acceptance transaction
                                          -> state, request, and first-uncovered evidence facts
                                          -> policy-based Session maintenance eligibility
                                          -> exact request insert, extension, or priority promotion
                                      -> stored acceptance receipt

          -> route query command
              -> Application.query({ question, workingDirectory })
                  -> QueryService
                      -> WorkspaceContextService.resolve(workingDirectory)
                      -> managed scope: Session, Project, Personal, Practice
                      -> unmanaged scope: Personal, Practice
                      -> invoke each applicable product query capability
                          -> product-owned retrieval method and index access
                          -> product-local score and qualification threshold
                          -> product-owned freshness and applicability filters
                          -> product-specific qualified result shape
                      -> typed core QueryResult without agentic curation
                          -> Session records or parsed text
                          -> grouped Project, Personal, Practice Markdown references
                          -> product-local relevance, freshness, product outcomes

              core QueryResult
                  -> optional result aggregator — representation OPEN
                      -> configured AgentAdapter
                          -> CodexAgentAdapter
                      -> curated response plus unchanged core QueryResult

          -> route insert command
              -> Application.insertEvidence(invocation context, insertion request)
                  -> EvidenceInsertionService
                      -> require exact bootstrapped project root
                      -> require ordered evidence-content items
                      -> WorkspaceContextService.resolveProjectRoot
                          -> reject invalid or unregistered root
                          -> managed WorkspaceContext
                      -> preserve exact item strings as text/plain source material
                      -> construct one insertion-originated EvidenceCandidateDto per item
                      -> derive replay-safe batch operation identity when clientReference exists
                      -> EvidenceAcceptanceService
                          -> one atomic acceptance transaction
                              -> EvidenceLogRepository.append for each new item
                                  -> append hybrid EvidenceItem rows through supplied transaction
                                  -> return SQLite-generated identities
                              -> construct accepted EvidenceItemDto values
                              -> sessionMaintenance.schedule.afterEvidenceAccepted
                                  -> SessionMaintenancePolicyService.synchronize
                                      -> injected effective values
                                      -> exact revision in the acceptance transaction
                                  -> state, request, and first-uncovered evidence facts
                                  -> immediate Session maintenance eligibility
                                  -> exact request insert, extension, or priority promotion
                              -> stored acceptance receipt

Inbox
  -> logical view over uncovered insertion-originated EvidenceItems
  -> Session maintenance request, attempt, and cursor remain the processing owners

canonical Markdown publication | derived indexing | query-result reference construction
  -> canonical Markdown document shape
      -> flat Obsidian-compatible YAML properties
      -> immutable memory-node identity
      -> standard Markdown links
      -> AST-derived semantic sections

Application.create
  -> initialize packaged SQLite runtime before opening SQLite
      -> application-owned SQLite driver with FTS5
      -> pinned packaged sqlite-vec extension
  -> SqliteDatabase.open
      -> pinned Sequelize v7 alpha + @sequelize/sqlite3
      -> authenticate and verify FTS5 and sqlite-vec capability
      -> one process-scoped database instance
      -> inject the same instance into SQLite repositories
  -> Application.close
      -> close the process-scoped Sequelize connection

maintenance owner not yet shaped
  -> injected AgentAdapter
      -> CodexAgentAdapter
  -> publication owners not yet shaped
```

The future MCP server will reach our app through a formal client abstraction
whose initial implementation invokes the installed command's versioned machine
protocol. The client and MCP owners do not enter the predicted source tree
until their concrete contracts are designed.

## Admission rule

A file enters this feature shape only when an established product behavior or
technical boundary requires an owner that cannot coherently remain in a file
already listed here. Plausible future abstractions remain absent until they
meet that standard.

When a listed owner gains an independently useful source-shaped pseudocode
artifact, its heading links to that artifact. Owners without such an artifact
remain unlinked rather than pointing to an empty placeholder.
