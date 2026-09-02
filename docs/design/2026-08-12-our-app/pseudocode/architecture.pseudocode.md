# Our App — Architecture and Stack

> Pseudocode artifact. Non-executable reference shape.
>
> Ingestion supersession: The
> [Ingestion Boundaries design unit](../../2026-09-02-ingestion-boundaries/feature-shape.md)
> controls public project keys, targeted durable-memory insertion, and the
> development capture fixture. Conflicting identity and manual-insertion text
> below remains only as the initial architecture baseline.

This artifact defines the application's established technical boundaries and
stack direction. Product semantics live in `BRAIN.pseudocode.md`; integrated
macro owners live in the
[canonical application shape](../../feature-shape.md); active design work lives
in [Open Design Issues](../design-issues.md).

## Stack direction

```ts
APPLICATION OurApp {
  language: TypeScript
  typeChecking: strict
  modules: ESM
  shape: modular monolith

  owns:
    provider-neutral domain contracts
    provider activity normalization
    autonomous maintenance orchestration
    provider process lifecycle
    canonical memory publication
    semantic retrieval and query
    installed command contract and its versioned machine protocol
    project oversight registration
    machine integration installation contract
    shared application use cases behind the installed command

  doesNotOwn:
    AI-provider authentication
    AI-provider model execution
    provider-native event production
    the user's source repository
}
```

All external inputs enter the TypeScript application as `unknown` and become
trusted only after runtime validation. Static TypeScript types never substitute
for validating hooks, provider results, CLI input, MCP requests, stored state,
or Markdown-derived metadata.

## Dependency direction

```text
Direct Callers
  human shell | provider hooks
                  |
                  v
Installed Named Command <---------------- CLI-backed AppClient
  versioned machine protocol                        ^
                  |                                 |
                  v                            future MCP tools
Public Application Use Cases
  bootstrap project | capture | propose durable memory | query
                         |
                         v
Product Contracts
  evidence | context | session | project | personal | practice
                         |
                         v
Infrastructure Adapters
  providers | process execution | SQLite | Markdown | semantic index | filesystem

Autonomous Maintenance Driver
  invokes internal maintenance use cases against the same product contracts
```

Dependencies point inward. Entry surfaces and infrastructure adapters do not
own memory meaning, admission policy, or query semantics.

Once introduced, the MCP server initially reaches our app through a formal
transport-neutral client contract backed by the installed command. MCP tool
handlers depend on that client contract rather than constructing argv or
parsing human-oriented output themselves.

The installed command exposes a deliberately versioned machine protocol over
the same application use cases used by human-facing command behavior. This
keeps the installed application as one deployable integration endpoint without
making incidental console formatting a public API.

The first implementation remains one logical TypeScript application. Module
boundaries do not imply packages, services, deployments, or a distributed
system.

## Machine installation and project bootstrap

Application installation and project bootstrap have independent contracts:

```text
application installation
  -> publish one stable named command
  -> initialize application-owned machine state
  -> install machine-wide provider capture integrations
      -> first integration: Codex hooks invoke the installed command
  -> once MCP exists, make its separate agent-facing integration available

project bootstrap
  -> accept one explicit directory path
  -> validate and canonicalize that exact oversight root
  -> record the canonical Git repository root when present
  -> within one application write transaction
      -> create or return one Project row
      -> sessionMaintenance.lifecycle initializes state for a new project
      -> sessionMaintenance.lifecycle requires state for an existing project
  -> use the immutable SQLite-assigned ProjectIdentity
```

Bootstrap remains provider-neutral. It neither installs hooks nor records a
per-project provider allowlist. Machine-wide hooks may submit activity from any
working directory; workspace resolution admits only activity within an
overseen project root.

The exact application installer, provider-integration installer, and project
bootstrap source owners remain `OPEN`. One user-facing installation command
may orchestrate them, but their state and lifecycles must remain separate. MCP
installation remains separate from provider capture even if the same top-level
installer later makes both available.

## Application composition

```text
process starts under Bun 1.4
  -> await Application.create(runtime configuration)
      -> initialize the packaged SQLite runtime
      -> open one process-scoped SqliteDatabase through:
          -> @sequelize/core 7.0.0-alpha.48
          -> @sequelize/sqlite3 7.0.0-alpha.48
          -> packaged sqlite3 Node-API driver
      -> construct SQLite repositories with that shared database instance
      -> construct the internal Session policy service
      -> inject validated effective Session policy and that service into schedule
      -> compose SessionMaintenance from lifecycle and schedule capabilities
      -> inject only the required Session capability into each workflow owner
      -> read the immutable provider and channel from CaptureInvocationContext
      -> construct the selected capture-provider capability
      -> construct WorkspaceContextService
      -> inject CaptureInvocationContext and that CaptureAdapter directly into EvidenceCaptureService
      -> construct the configured agent-execution provider independently
      -> inject capability dependencies into application services
      -> construct and return Application façade
  -> after the operation, Application.close releases the database connection
```

`Application.create` is the process-scoped factory and composition boundary.
The CLI supplies the provider identity declared by the capture invocation but
does not import or construct a concrete provider adapter itself. Each CLI
invocation receives a new application instance. The selected capture provider
is composed as one adapter rather than as a provider collection.

Runtime configuration is capability-specific rather than application-provider
specific:

```ts
type ProviderIdentity = Readonly<{
  key: string
}>

type RuntimeApplicationConfiguration = {
  captureProvider: CaptureProviderConfiguration
  agentExecution: AgentExecutionProviderConfiguration
  sqlite: SqliteApplicationConfiguration
  maintenance: {
    session: ValidatedEffectiveSessionMaintenancePolicy
  }
  // remaining machine configuration remains independently resolved
}

type SqliteApplicationConfiguration = Readonly<{
  databasePath: absolute application-state file path
  runtime: validated packaged-runtime selection consumed by SqliteRuntime
}>

type CaptureProviderConfiguration = {
  invocationContext: CaptureInvocationContext
  settings: unknown
}

type AgentExecutionProviderConfiguration = {
  provider: ProviderIdentity
  settings: unknown
}
```

`ProviderIdentity.key` is a stable application-owned identity key such as
`"codex"`. It identifies neither a model nor a capture channel and provides no
authentication or authority. Provider-specific `settings` remain opaque until
validated by the corresponding construction branch.

For capture, the command's explicit provider and channel route creates one
`CaptureInvocationContext` before `Application.create` runs. The factory uses
its provider identity to construct one adapter. It injects the immutable
invocation context and adapter into `EvidenceCaptureService`. The route supplies
provider and channel provenance; the adapter supplies normalization only.
`agentExecution` independently selects the provider used for memory curation
and optional query-result aggregation. Core query and manual evidence insertion
invoke neither capability.

No generic application-wide `provider` exists. Capture and agent execution may
use different providers even though the current capture invocation composes only
one capture adapter.

`SessionMaintenance` is a composed instance façade, not a static namespace or
service base class. Application composition can see the complete façade. The
project-bootstrap owner receives only `lifecycle`, and
`EvidenceAcceptanceService` receives only `schedule`. Policy synchronization
is an internal schedule collaborator because no current application operation
administers policy independently. No empty `execution` capability exists before
the execution lifecycle is shaped.

## Application façade

```ts
class Application {
  static create(configuration: RuntimeApplicationConfiguration): Promise<Application>
  bootstrapProject(input: ProjectBootstrapInput): Promise<ProjectBootstrapResult>
  capture(input: CaptureInput): Promise<CaptureResult>
  captureFixture(input: DevelopmentCaptureFixtureRequest): Promise<EvidenceAcceptanceReceipt>
  query(input: QueryInput): Promise<QueryResult>
  proposeMemory(input: TargetedMemoryInsertionInput): Promise<TargetedInsertionResult>
  close(): Promise<void>
}
```

The `Application` instance is the stable provider-neutral API exposed to the
CLI. Its operation methods delegate to private application services without
revealing the service graph or owning provider-specific behavior. Its static
`create` method alone owns asynchronous infrastructure construction and
dependency wiring. `close` releases its process-scoped infrastructure.

## Provider capabilities

Capture and agent execution are independent capabilities.

```ts
interface CaptureAdapter {
  normalize(activity: ProviderNativeActivity): CaptureNormalizationResult
}

interface AgentAdapter {
  provider: ProviderIdentity
  execute(task: AgentTask): Promise<UntrustedAgentResult>
}

type AgentTask = {
  purpose: AgentTaskPurpose
  prompt: string
  responseContract: RuntimeContractReference
  workspaceContext?: WorkspaceContext
  filesystemPolicy: "no-project-access" | "project-read"
  modelProfile?: ModelProfileReference
  cancellation: CancellationSignal
}
```

The capture command carries an explicit provider and channel route. Runtime
configuration resolves that route before composition, and `Application.create`
constructs exactly one matching adapter for direct injection into
`EvidenceCaptureService`. Unsupported routes fail before capture; an invalid payload
never falls back to another adapter. The adapter does not declare another
provider identity.

Codex initially implements capture using Codex hooks and agent execution using
the Codex CLI. Later providers may implement either capability through their
native mechanisms without changing the memory products.

Memory-maintenance workflows and an optional query-result aggregator construct
provider-neutral `AgentTask` values and execute them through the same
`AgentAdapter`. Core query does not construct an agent task. Provider adapters
are organized by capability, not by the Cartesian product of provider and
workflow. A `CodexQueryAggregatorAdapter` or `CodexProjectCuratorAdapter` would
put application-workflow semantics into provider infrastructure and is not part
of this architecture.

## Provider process boundary

```ts
ProcessExecutor.run({
  executable,
  arguments,
  workingDirectory,
  standardInput,
  environment,
  cancellation,
  timeout
}) -> ProcessResult {
  exitStatus
  standardOutput
  standardError
}
```

TypeScript owns argv-safe execution, prompt transport, output capture,
cancellation, timeout, and termination. A provider adapter owns command
construction and provider-response parsing.

```text
preferred: TypeScript -> provider executable
supported: TypeScript -> configured shell wrapper -> provider executable
```

Shell wrappers perform machine-specific preparation only. They do not own
prompts, retries, memory policy, response contracts, or workflow state.

Provider results remain untrusted after successful process execution. Runtime
validation can establish structural conformance; product-specific curators
remain responsible for semantic admission against evidence and context.

## Capture boundary

Provider hooks run on the user's active coding path. Capture therefore performs
only bounded, non-agentic work.

```text
provider hook invokes the absolute installed command with an explicit route
  -> CLI fixes provider = codex and channel = hook from the command route
  -> CLI creates one immutable CaptureInvocationContext
  -> CLI reads exact serialized standard input into ProviderNativeActivity
     without parsing or reserializing it
  -> Application.create selects and injects the matching CaptureAdapter
     from CaptureInvocationContext.route.provider
  -> CLI passes exact native activity to capture
  -> EvidenceCaptureService
      -> injected CaptureAdapter returns exactly one provider-neutral outcome
      -> rejected input fails safely without evidence
      -> ignored input creates no evidence
      -> for one evidence outcome:
          -> WorkspaceContextService consults overseen-project registrations
             using the provider-observed working directory
          -> IF the working directory is invalid, missing, or inaccessible
              -> fail capture with a safe workspace diagnostic
          -> IF no registered root contains the valid working directory
              -> return ignored unmanaged-project outcome
              -> persist neither normalized evidence nor raw provider activity
          -> OTHERWISE attach the registered project and repository context
             plus the active Git branch when available
              -> combine capture route + normalized observation
                 + WorkspaceContext
              -> construct one EvidenceCandidateDto
              -> EvidenceAcceptanceService
                  -> apply reliable source replay identity when supplied
                  -> assign receivedAt and project-local sequence
                  -> persist its EvidenceItem row idempotently
                  -> receive its SQLite-assigned EvidenceItemId
                  -> construct the accepted EvidenceItemDto
                  -> record the count/time Session maintenance obligation in the same
                     recoverable durable acceptance
      -> return
```

Capture never waits for an AI provider or memory curation. Capture failure is
observable but does not fabricate evidence or transfer memory authority into
the hook adapter.

The capture route is deterministic application routing and provenance metadata.
It is not cryptographic proof that the provider invoked the process. A selected
adapter must validate the native activity against that provider's contract.
Validation failure never falls back to another adapter, appends partial
evidence, or records Session maintenance eligibility. The route is the only source of
provider and capture-channel identity; provider-native input cannot override
it.

The first Codex integration registers only `UserPromptSubmit` and `Stop` as
evidence-producing hooks. It does not register `SessionStart`. Every accepted
evidence append evaluates the durable count/time Session maintenance obligation. The
first accepted evidence after the elapsed-time condition becomes true performs
that check, so maintenance does not depend on a provider lifecycle event.

Provider normalization must occur before project matching because the provider
adapter owns extraction of its native working directory. The application
process directory does not select the project. Unmanaged input may be parsed
and validated in memory, but it is not durable evidence and its raw payload is
never persisted.

## Shared evidence acceptance boundary

Provider capture and the development capture fixture converge on the same
provider-neutral [`EvidenceCandidateDto`](./src/evidence/evidence-item.dto.ts.md)
contract after source-specific validation and attribution. Targeted durable
memory proposals do not enter this boundary.

```ts
type EvidenceAcceptanceItem = Readonly<{
  candidate: EvidenceCandidateDto
  sourceReplay?: Readonly<{
    domain: ApplicationOwnedDedupDomainId
    scheme: string
    key: string
  }>
}>

type EvidenceAcceptanceCommand = Readonly<{
  contractVersion: EvidenceAcceptanceContractVersion,
  operationId: ApplicationOperationId,
  items: ReadonlyArray<EvidenceAcceptanceItem>,
  sessionMaintenanceIntent: "policy" | "immediate"
}>

EvidenceAcceptanceService.accept(command) -> EvidenceAcceptanceReceipt
```

This deterministic boundary owns idempotent evidence acceptance and durable
recording of the associated Session maintenance obligation. One command contains
evidence for exactly one project. Different projects may run in parallel, but
no acceptance operation, Session maintenance request, or Session maintenance
attempt combines their state. Acceptance does not interpret provider payloads or corrections,
decide caller authority, curate memory, or publish documentation.

Evidence acceptance and memory ingestion are separate workflows. Acceptance
commits provider-neutral evidence to the Evidence Log. A later Session Memory
ingestion workflow reads accepted evidence and creates memory. Its source owner
and file remain unshaped.

`operationId` makes retries of one application acceptance command idempotent.
Optional `sourceReplay` metadata suppresses repeat delivery across different
commands only when the source exposes reliable coordinates. The Evidence Log
enforces uniqueness on `(domain, scheme, key)`. Reusing that identity for
different canonical evidence is a conflict, not a correction.

Canonical replay equality uses a versioned fingerprint of the complete
`EvidenceCandidateDto`, including origin, content, workspace context, optional
source time, and source material. It excludes the replay lookup identity and
acceptance-owned evidence identity, acceptance time, project sequence, and
maintenance behavior.

Replay metadata is not part of `EvidenceOrigin`. Origin records provenance;
replay metadata controls admission. Content hashes are not replay identities
because separate valid evidence can contain identical strings.

Every evidence candidate carries exact content-bearing source material with its
media type and a SHA-256 digest over the preserved UTF-8 content. Capture
preserves the exact provider payload. Insertion preserves the supplied evidence
string, not the complete CLI or MCP envelope. The digest protects integrity; it
does not provide identity, replay suppression, authentication, or truth.

`EvidenceCaptureService` and `Development Capture Fixture` construct
capture-originated `EvidenceCandidateDto` values after their source-specific
normalization and workspace resolution. Evidence acceptance does not normalize
either source.

Capture origins preserve native event kind plus optional provider session and
interaction coordinates. Insertion origins preserve the insertion source,
ordered batch position, and optional client reference. Codex maps `turn_id` to
the shared interaction coordinate. Claude Code can map `prompt_id` when
present. Direct CLI insertion may omit a client reference and then cannot claim
safe cross-request replay suppression. The future agent-only MCP contract
requires one.

The evidence append, project-local sequence allocation, operation receipt,
source-replay admission, and Session maintenance obligation form one atomic SQLite
acceptance contract. A retry of the same operation and command returns the
stored receipt. Reusing the operation identity for another command or reusing a
source replay identity for different evidence rejects the complete command.
The acceptance-operation record is immutable and exists only after successful
commit. It has a SQLite-assigned internal row identity. Its unique opaque
operation identity is the application lookup key, while a separate project
foreign key records ownership. It stores the fingerprint scheme and version,
non-unique command fingerprint, receipt schema version, complete receipt JSON,
and application-assigned commit timestamp. These records remain for the owning
project’s lifetime.

`EvidenceLogRepository` owns allocation of one contiguous project-local
sequence range through the acceptance service's `IMMEDIATE` transaction. The
service supplies the number of new items and assigns the returned values in
command order. The repository advances the owning Project's monotonic
`last_allocated_evidence_sequence` in the same transaction. Rollback restores
the counter with the evidence inserts, while later forgetting can create gaps
but cannot reuse an earlier sequence. Normal Sequelize `updated_at` behavior
applies to this project-row mutation.

`EvidenceAcceptanceOperationRepository` owns transactional lookup and immutable
insertion for those records. `EvidenceAcceptanceService` retains operation
conflict classification, receipt validation, and transaction ownership.

The Evidence Log row projection is hybrid and append-only. Stable identity,
ordering, filtering, and time fields become relational columns, including
project identity, project-local sequence, and nullable Git branch. Complete
nested origin, workspace context, and source-material detail remains available
as lossless JSON. One mapper derives both forms from the same immutable
candidate plus acceptance-owned metadata. SQLite assigns the row identity, and
acceptance constructs the resulting `EvidenceItemDto`. The acceptance
transaction commits all forms together. `EvidenceLogRepository.append` owns
the mapping and returns only the SQLite-generated identity through the
caller-supplied transaction. The `EvidenceItem` Sequelize model defines the
concrete row, column, constraint, and index shape, including the nullable
all-or-none replay identity and candidate-fingerprint projections.
`EvidenceLogRepository.findByReplayIdentity` supplies the only shaped read
needed for replay classification. Other reads, migration, and future
explicit-forgetting remain `OPEN`.

The full transactional shape is defined in
[`src/evidence/evidence-acceptance.service.ts`](./src/evidence/evidence-acceptance.service.ts.md).

Targeted durable-memory proposals use one selected product Inbox rather than
the captured Evidence Log:

```ts
type TargetedMemoryInsertionRequest = Readonly<{
  projectKey: ProjectKey
  target: "project" | "personal" | "practice"
  items: ReadonlyArray<Readonly<{ content: string }>>
  clientReference?: string
}>
```

```text
TargetedMemoryInsertionService
  -> entry boundary supplies insertion source as CLI or MCP
  -> validate the complete ordered request
  -> require exactly one Project, Personal, or Practice target
  -> require clientReference for MCP; keep it optional for direct CLI use
  -> resolve the supplied public project key
  -> reject an unknown key; never ignore an explicit proposal
  -> for each ordered content item
      -> preserve the exact string as text/plain source material
      -> construct one target-specific Inbox candidate
  -> IF a client reference exists
      -> derive one opaque application operation identity from:
          insertion-source domain
          resolved project identity
          client reference
  -> OTHERWISE create a new application operation identity
  -> atomically commit the replay record, selected-product Inbox batch,
     and immutable receipt
  -> return accepted or replayed without waiting for product curation
```

The selected Project, Personal, or Practice Memory product owns its durable
Inbox candidate lifecycle and later curation. Inbox acceptance does not claim
that canonical memory changed. Session Memory and Session maintenance do not
participate in targeted proposals.

## Eventually consistent maintenance boundary

```ts
type SessionMaintenancePolicyRevision = positive integer

type SessionMaintenancePolicy = {
  project: ProjectIdentity
  revision: SessionMaintenancePolicyRevision
  evidenceCountThreshold: positive integer
  elapsedInterval: positive duration
  configurationDigest: string
}

type SessionMaintenanceState = {
  project: ProjectIdentity
  lastCoveredEvidenceSequence: EvidenceSequence
  lastSuccessfulMaintenanceAt?: Timestamp
}

type SessionMaintenanceRequest = {
  project: ProjectIdentity
  fromSequenceExclusive: EvidenceSequence
  throughSequenceInclusive: EvidenceSequence
  state: Pending | Running | Satisfied
  priority: Normal | Immediate
  sessionMaintenancePolicyRevision: SessionMaintenancePolicyRevision
}

type SessionMaintenanceAttempt = {
  request: SessionMaintenanceRequestIdentity
  state: Running | Succeeded | Failed
  leaseOwner: MaintenanceLeaseOwner
  leaseExpiresAt: Timestamp
  failure?: MaintenanceFailure
}

type SessionMaintenanceFrontier = {
  project: ProjectIdentity
  evidenceThrough: EvidenceSequence
  sourceStateReferences: SourceStateReference[]
  canonicalMemoryRevisions: MemoryRevisionSet
}
```

Validated `maintenance.session` YAML configuration creates immutable,
revisioned `SessionMaintenancePolicy` state in SQLite. The highest project
revision is active; `SessionMaintenancePolicyRevision` is a value, not another
table. `SessionMaintenancePolicyService` compares already validated canonical
effective values through the `IMMEDIATE` acceptance transaction supplied by
`SessionMaintenanceScheduleService`. It appends a revision only when those
values differ and returns the exact revision used for a new eligibility
decision. An existing pending request keeps the revision that caused it when
coalescing extends its frontier or promotes its priority. Count, elapsed-time,
and immediate insertion are three triggers for the same Session request path.
A project can have no policy until its first newly accepted evidence creates
revision one in that transaction; later absence is incompatible durable state.

Session maintenance persistence has four product-specific tables:

```text
session_maintenance_states    successful covered frontier per project
session_maintenance_policies  immutable effective policy revisions per project
session_maintenance_requests  finite maintenance obligations and frozen ranges
session_maintenance_attempts  leased execution and replacement history
```

Other memory products define separate policy and maintenance contracts when
their eligibility inputs and frontiers are designed.

The composed `SessionMaintenance` façade exposes two current capabilities:

```text
lifecycle  joins project bootstrap and initializes or requires Session state
schedule   joins evidence acceptance, applies effective policy, and schedules work
```

`SessionMaintenancePolicyService` is internal to `schedule`. It synchronizes
policy in the same acceptance transaction before eligibility is evaluated.
The façade exposes no repository or model. Consumers receive only the
capability required by their workflow.

`SessionMaintenanceRequestRepository` returns raw pending and running request
facts and applies exact writes supplied by
`SessionMaintenanceScheduleService`. Two partial unique indexes enforce at most
one request in each active state per project. The schedule capability uses the
caller's serialized acceptance transaction to enforce active-range contiguity,
non-overlap, and monotonic pending extension; the indexes do not.

Elapsed-time scheduling uses the raw `received_at` of the first Evidence Log
item after the covered frontier when Session maintenance has never succeeded.
`SessionMaintenanceEvidenceReader` defines this narrow read port, and
`EvidenceLogRepository` implements it. The repository does not classify
eligibility or select the frontier.

Session Memory owns `SessionMaintenanceState` in a separate project-referenced
table. `Project` owns the Evidence Log allocation coordinate but has no
Session-specific cursor columns or reverse Session association. Application
bootstrap creates both required rows atomically and calls the Session lifecycle
capability for the Session-owned row. A guarded Session-state advance verifies
through the caller's `IMMEDIATE` transaction that the supplied frozen request
frontier moves forward without exceeding
`Project.last_allocated_evidence_sequence`.

The covered frontier records successful curation. The scheduled frontier is the
highest sequence already assigned to a pending or running request. Eligibility
counts only evidence after the scheduled frontier, so an in-flight request is
not scheduled twice. A pending request may extend through newly accepted
evidence. A running request remains frozen, and later evidence belongs to one
non-overlapping successor.

Every maintenance run operates against that frozen frontier. Evidence accepted
after it remains pending for later maintenance and does not by itself invalidate
the in-flight run. A failed or expired attempt leaves its request running,
frozen, and eligible for a replacement attempt. It does not return the request
to pending or advance the cursor. Lease-guarded completion prevents a replaced
stale worker from publishing or advancing the cursor.

Publication prevents regression rather than demanding real-time freshness:

```text
proposal frontier is older than already-published memory
  -> do not overwrite newer memory

proposal still matches its expected canonical revisions
  -> publish memory as verified through that frontier

new evidence exists beyond the frontier
  -> retain it as pending maintenance
  -> expose published memory freshness to query
```

Maintenance eligibility is durable. Process failure cannot permanently lose
eligible evidence, and reclaimed work cannot duplicate canonical publication.

## Canonical and derived state

```text
CANONICAL
  exact evidence source material       SQLite during the initial product
  Evidence Log                         durable EvidenceItems in SQLite
  Session Memory                       SQLite
  Project Memory                       Markdown
  Personal Memory                      Markdown
  Practice Memory                      Markdown
  maintenance and publication state    durable machine state

DERIVED
  semantic chunks and embeddings
  SQLite lookup rows over Markdown
  relationship indexes
  cached query material
```

Project, Personal, and Practice Markdown are canonical product content and are
portable across normal Markdown viewers. They use a defined compatibility
profile for Obsidian properties, tags, aliases, backlinks, graph navigation,
and heading links, but Obsidian is not an application dependency. SQLite
supplies semantic traversal and machine state but never replaces those
artifacts as truth.

Derived state may lag canonical publication and is rebuildable from canonical
content and metadata.

Source-material content, normalized evidence, and provenance are retained by
default during the initial product. Derived chunks, indexes, and caches may be
deleted and rebuilt. A later TTL may delete source-material content only through an explicit
retention policy that preserves the durable normalized evidence, integrity
hash, required replay guarantees, and any evidence still needed by active or
historical memory. Superseding one memory does not by itself authorize deletion
because one evidence item may support several memories.

## Memory product interoperability boundary

```text
MEMORY DOMAIN
  -> tagged product-specific canonical reference
      product identity
      stable canonical node identity
      exact canonical version or reference
      provenance
      freshness
      lifecycle visibility
      relationships

  -> Session Memory owns its behavior
  -> Project Memory owns its behavior
  -> Personal Memory owns its behavior
  -> Practice Memory owns its behavior

  DOES NOT DEFINE
    one generic memory payload
    shared save, update, search, or maintain methods
    one scope model, lifecycle transition system, or maintenance policy
```

This is an interoperability contract, not a uniform behavioral interface.
Consumers can exchange and inspect typed canonical references without erasing
which product owns the memory. Each product owns its content schema, authority,
scope and applicability, admission policy, reconciliation granularity,
lifecycle transitions, canonical representation, and maintenance operations.
The exact source representation of this root contract remains `OPEN`.

The canonical node identity exposed through the contract names the
independently reconcilable memory node. For Session Memory, one canonical
SQLite record is one node. For Project, Personal, and Practice Memory, one
canonical Markdown document is one node. Derived sections and chunks support
retrieval only; they do not introduce a claim ontology or a finer canonical
lifecycle.

## Publication boundary

Only the TypeScript publication boundary mutates canonical memory.

```text
curator proposal
  -> runtime-contract validation
  -> product-specific semantic admission
  -> frontier and canonical-revision comparison
  -> journaled canonical publication with a durable target revision
  -> publication receipt with evidence and agent-run attribution
  -> derived semantic-index work
```

The provider may inspect source state and propose memory. It never writes
canonical memory directly.

SQLite state and Markdown files do not share a native transaction. Publication
therefore uses a durable journal and idempotent recovery to make one committed
revision observable; it does not claim a cross-store atomic mutation.

## Canonical Markdown document boundary

Project, Personal, and Practice Memory share one portable canonical document
contract defined in
[`src/memory/markdown/markdown-memory-document.ts.md`](./src/memory/markdown/markdown-memory-document.ts.md).

```text
canonical Markdown document
  -> flat validated YAML properties
      immutable memory-node identity
      memory product
      title, aliases, and tags
      lifecycle and dates
      validated product-specific scalar or list applicability
  -> standard Markdown body
      human-readable memory content
      standard Markdown links for canonical relationships
  -> Markdown AST
      heading-delimited semantic sections
      atomic lists, tables, quotations, and code blocks
      oversized sections split only at complete block boundaries
```

The memory-node identity remains stable across content revisions and path
changes. Path is a locator, not identity. Chunk identity is derived from the
node identity, canonical revision, heading path, chunk ordinal, and chunking
contract version. Derived chunks do not become a second canonical memory model.

Our app is initially the only canonical Markdown writer. Humans and agents
correct memory through evidence insertion rather than direct Markdown edits.

## SQLite retrieval stack

```text
BUN APPLICATION RUNTIME
  Bun 1.4 owns TypeScript execution, packages, tests, and native file APIs
  Sequelize persistence does not use Bun.SQL or bun:sqlite

PACKAGED SQLITE RUNTIME
  packaged sqlite3-compatible Node-API driver with FTS5 enabled
  sqlite-vec 0.1.9 and compatible extension binary
  platform and architecture selected from the application package

DATABASE ACCESS
  @sequelize/core 7.0.0-alpha.48
  @sequelize/sqlite3 7.0.0-alpha.48
  one process-scoped SqliteDatabase opened by Application.create
  managed IMMEDIATE write transactions for evidence acceptance
  parameterized raw SQL remains available for SQLite-specific capabilities

LEXICAL INDEX
  SQLite FTS5 available over Session Memory and canonical-Markdown semantic chunks

VECTOR INDEX
  sqlite-vec available over the same retrievable units
  one complete index generation per embedding contract

PRODUCT QUERY POLICY
  each memory product selects its applicable retrieval signals
  each memory product owns any rank fusion, score, threshold, and filters
  QueryService collects the four typed qualified result sets
```

FTS5 is an SQLite capability included in the packaged runtime, not a separate
host-installed service. `sqlite-vec` remains the selected vector extension and
is pinned to an exact compatible version because its public contract is pre-v1.
Sequelize is the selected ORM and is pinned with its compatible SQLite dialect.
The dialect uses the `sqlite3` Node-API module under Bun rather than a Bun-native
database API. It may use parameterized raw SQL for FTS5, sqlite-vec, PRAGMAs,
and other SQLite-specific behavior instead of hiding those capabilities behind
model APIs. The project does not own a custom Sequelize dialect that adapts
`Bun.SQL` or `bun:sqlite`.

Ordinary installation does not depend on Apple SQLite, Homebrew, or another
host SQLite installation. Every platform and architecture that the application
claims to support must package a compatible SQLite library and `sqlite-vec`
binary, preserve their source and license provenance, and prove that both FTS5
and vector loading work. An explicit development override may select another
runtime, but host discovery is not the product contract.

`SqliteDatabase` is process-scoped through application composition. It is not a
global singleton and does not inherit from a dialect-neutral database base
class. Separate CLI and provider-hook processes coordinate through SQLite
transactions and constraints, not shared TypeScript state.

An embedding provider is tightly coupled to the index generation it creates.
Stored vectors record provider, model, model revision, dimensions,
normalization, purpose, and chunking-contract version. A query uses the exact
matching contract. Changing provider or model builds a new generation and
switches only after that generation is complete; it never mixes query and
document vectors from different contracts.

SQLite executes lexical and vector retrieval. It does not own the meaning of a
combined score. Each memory product decides which available retrieval signals
it uses and owns any inspectable TypeScript rank-fusion policy, score, and
qualification threshold.

## Query architecture

```text
question + caller context
  -> QueryService
      -> resolve working directory, project, workspace context, user, and technologies
      -> managed project: Session, Project, Personal, and Practice are applicable
      -> unmanaged directory: Personal and Practice are applicable
          -> Session and Project are not applicable
          -> no implicit project bootstrap
      -> for each applicable memory product
          -> pass the same question and product-applicable scope
          -> product owns retrieval method and index access
          -> product owns scoring and qualification threshold
          -> product owns lifecycle, freshness, and applicability filters
          -> product returns only its qualified result shape
      -> preserve bounded typed results without a cross-product score
      -> return the core QueryResult without agentic curation
          -> qualified Session Memory records or parsed text
          -> grouped Project, Personal, and Practice Markdown references
          -> product-local relevance, freshness, and product outcomes

core QueryResult
  -> optional Query result aggregator — representation OPEN
      -> AgentAdapter
          -> CodexAgentAdapter
      -> validate the untrusted agent result
      -> curated response plus the unchanged core QueryResult
```

Query is exposed through the installed command. Once introduced, an MCP tool
calls a transport-neutral app client whose initial implementation invokes the
installed command through its versioned machine protocol. Neither the MCP tool
nor the client implements retrieval, ranking, or answer logic.

Semantic similarity contributes to product-local retrieval. Each memory
product decides how it combines retrieval signals, applies its score threshold,
and filters lifecycle, freshness, and applicability. QueryService does not
replace those product policies with one global retrieval policy.

Retrieval scores and qualification thresholds remain local to one product and
one query. They are not answer confidence and are not comparable across memory
products. The core QueryResult does not assign answer confidence.

Federation does not flatten all products into one global score. Query invokes
each applicable product independently and preserves every qualified typed
result. Session returns product-owned records or parsed text. Project,
Personal, and Practice return canonical Markdown references. An optional
aggregator may curate these results later, but the core query neither depends
on an agent nor removes results to fit a synthesized answer.

## Logical runtime surfaces

```text
Command Runtime
  installed named command for project bootstrap, capture, query,
  and manual evidence insertion
  callable by humans and provider hooks

Maintenance Runtime
  autonomous execution of eligible memory work

Agent Runtime
  provider subprocesses launched for bounded memory curation and optional
  query-result aggregation

MCP Runtime
  future agent-facing tool server
  maps MCP methods to a transport-neutral app client
  initially uses a CLI-backed client over the versioned machine protocol
  introduced only after the command application is proven
```

These are logical responsibilities. They share application contracts and
canonical repositories even when operating in different processes.

An MCP method may present a different shape from a CLI command, but one
business operation maps to one application operation and one process request.
The MCP layer does not compose several mutating CLI calls into a transaction.
An in-process client remains a future replacement only if measured process,
payload, or cancellation costs justify another integration path.

## Architectural invariants

```text
provider-specific data stops at provider adapters
memory products share an interoperability contract, not behavior or payload
project bootstrap defines oversight scope without provider knowledge
project bootstrap atomically initializes product-owned Session maintenance state
Project owns the Evidence Log coordinate but not Session Memory progress
SessionMaintenance exposes lifecycle and schedule as composed capabilities
Session policy synchronization is internal to scheduling
each workflow receives only the Session maintenance capability it requires
Session lifecycle joins bootstrap; Session scheduling and policy join acceptance
machine-wide provider capture installation is independent of project registration
activity outside every overseen project root is never persisted as evidence
capture remains non-agentic and bounded
accepted evidence is durable before capture acknowledges it
maintenance runs on a frozen evidence frontier
newer evidence does not make eventual memory publication inherently invalid
older maintenance cannot overwrite memory advanced by newer maintenance
eligible maintenance survives process failure
provider output never owns canonical mutation
failed pre-publication work leaves canonical memory unchanged
Session Memory publishes first and emits destination-specific candidate leads
candidate leads retain original evidence references and are never evidence
Project, Personal, and Practice independently inspect authoritative inputs
destination catch-up scans prevent a Session omission from becoming permanent
no ordinary maintenance workflow waits for user confirmation
canonical Markdown and Session SQLite remain authoritative over derived indexes
Obsidian compatibility never makes Obsidian an application dependency
canonical Markdown uses immutable node identity independent of path and title
Markdown semantic sections derive from a validated AST rather than text windows
SQLite FTS5 owns lexical recall and pinned sqlite-vec owns vector recall
each memory product owns its retrieval, product-local rank fusion, score
threshold, filters, and result representation
QueryService owns four-product invocation and typed result collection
embedding contracts never mix query and document vectors from different models
supported application packages include their required SQLite runtime and extensions
query preserves product identity, scope, freshness, provenance, and every
qualified typed result without resolving contradictions
raw evidence deletion requires retention policy and cannot follow one memory lifecycle alone
caller-supplied attribution never grants memory authority
cross-store publication is journaled and recoverable, not assumed atomic
the CLI machine protocol is versioned independently of human presentation
MCP depends on an app client contract, not argv construction or console output
one MCP business operation does not compose multiple mutating CLI requests
provider adapters implement capabilities rather than individual workflows
core query never depends on AgentAdapter
optional query-result aggregation and memory maintenance may use AgentAdapter
query is read-only and never performs implicit project bootstrap
manual evidence insertion is deterministic even when its caller is an agent
capture and insert share acceptance only after evidence is provider-neutral
EvidenceAcceptanceService records Session maintenance intent but never curates memory
one acceptance command, Session maintenance request, and Session maintenance attempt belongs to one project
Evidence Log acceptance and Session maintenance eligibility commit atomically
pending maintenance may coalesce while running maintenance keeps a frozen frontier
failed or expired Session maintenance attempts leave their requests running and frozen
failed or expired Session maintenance attempts never advance the covered cursor
Application.create owns process-scoped composition of concrete infrastructure
the application runtime and package manager are Bun 1.4
Bun.file and Bun.write own native file reads and writes where their contracts apply
SqliteRuntime initializes packaged SQLite before SqliteDatabase opens Sequelize
SqliteDatabase is process-scoped and is never a global TypeScript singleton
Sequelize and @sequelize/sqlite3 are pinned to 7.0.0-alpha.48
Sequelize SQLite uses its sqlite3 Node-API driver rather than Bun.SQL or bun:sqlite
capture composes one selected adapter and does not require an adapter registry
capture provider identity selects a contract but does not authenticate origin
invalid provider payloads never fall back to another capture adapter
Application exposes behaviors without exposing its internal service graph
capture provider and agent execution are configured as separate capabilities
capture provider is selected before composition for each capture invocation
manual insertion does not require a provider
no generic provider configures the whole Application instance
```
