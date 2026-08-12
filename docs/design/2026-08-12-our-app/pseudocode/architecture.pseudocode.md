# Our App — Architecture and Stack

> Pseudocode artifact. Non-executable reference shape.

This artifact defines the application's established technical boundaries and
stack direction. Product semantics live in `BRAIN.pseudocode.md`; predicted
files and services live in `feature-shape.md`; active design work lives in
`design-issues.md`.

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
  capture | insert evidence | query
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

## Application composition

```text
process starts
  -> Application.create(runtime configuration)
      -> read the immutable provider and channel from CaptureInvocationContext
      -> construct the selected capture-provider capability
      -> construct WorkspaceContextService
      -> inject CaptureInvocationContext and that CaptureAdapter directly into CaptureService
      -> construct the configured agent-execution provider independently
      -> inject capability dependencies into application services
      -> construct and return Application façade
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
  // storage and machine configuration remain independently resolved
}

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
invocation context and adapter into `CaptureService`. The route supplies
provider and channel provenance; the adapter supplies normalization only.
`agentExecution` independently selects the provider used for query and
maintenance work. Manual evidence insertion invokes neither capability.

No generic application-wide `provider` exists. Capture and agent execution may
use different providers even though the current capture invocation composes only
one capture adapter.

## Application façade

```ts
class Application {
  static create(configuration: RuntimeApplicationConfiguration): Application
  capture(input: CaptureInput): Promise<CaptureResult>
  query(input: QueryInput): Promise<QueryResult>
  insertEvidence(input: EvidenceInsertionInput): Promise<EvidenceInsertionResult>
}
```

The `Application` instance is the stable provider-neutral API exposed to the
CLI. Its operation methods delegate to private application services without
revealing the service graph or owning provider-specific behavior. Its static
`create` method alone owns infrastructure construction and dependency wiring.

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
`CaptureService`. Unsupported routes fail before capture; an invalid payload
never falls back to another adapter. The adapter does not declare another
provider identity.

Codex initially implements capture using Codex hooks and agent execution using
the Codex CLI. Later providers may implement either capability through their
native mechanisms without changing the memory products.

Query and maintenance workflows both construct provider-neutral `AgentTask`
values and execute them through the same `AgentAdapter`. Provider adapters are
organized by capability, not by the Cartesian product of provider and workflow.
A `CodexQueryAdapter` or `CodexProjectCuratorAdapter` would put product workflow
semantics into provider infrastructure and is not part of this architecture.

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
  -> CLI passes native activity, captured timestamp, and observed environment
     to capture
  -> CaptureService
      -> injected CaptureAdapter returns exactly one provider-neutral outcome
      -> rejected input fails safely without evidence
      -> ignored input creates no evidence
      -> for one evidence outcome:
          -> WorkspaceContextService resolves the active workspace once
          -> combine capture route + normalized observation
             + captured timestamp + WorkspaceContext
          -> construct normalized evidence
          -> EvidenceIngestionService
              -> append normalized evidence idempotently
              -> record the count/time maintenance obligation in the same
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
evidence, or records maintenance eligibility. The route is the only source of
provider and capture-channel identity; provider-native input cannot override
it.

The first Codex integration registers only `UserPromptSubmit` and `Stop` as
evidence-producing hooks. It does not register `SessionStart`. Every accepted
evidence append evaluates the durable count/time maintenance obligation. The
first accepted evidence after the elapsed-time condition becomes true performs
that check, so maintenance does not depend on a provider lifecycle event.

## Shared evidence ingestion boundary

Capture and manual insertion converge only after their inputs have become
provider-neutral and any caller authority has been established.

```ts
EvidenceIngestionService.accept({
  evidence: NormalizedEvidence[],
  maintenanceIntent: CountOrTime | PriorityThroughInsertedEvidence,
  authorizedCorrectionFence?: AuthorizedCorrectionFence
}) -> EvidenceAcceptanceReceipt
```

This deterministic boundary owns idempotent evidence acceptance and durable
recording of the associated maintenance obligation. It may apply a correction
fence that `EvidenceInsertionService` has already authorized. It does not
interpret provider payloads, decide caller authority, curate memory, or publish
documentation.

The evidence append and maintenance obligation form one durable acceptance
contract. The exact transactional or recoverable persistence mechanism remains
to be designed.

Manual insertion uses the same durable Evidence Log but a different trigger
contract:

```text
EvidenceInsertionService
  -> trusted invocation context establishes principal and origin
  -> authorize any correction fence
  -> EvidenceIngestionService
      -> append evidence durably
      -> freeze a frontier containing the inserted item
      -> apply an already-authorized correction fence
      -> record priority maintenance through the frontier
  -> coalesce already-eligible work into the active or next run
  -> return a maintenance receipt
  -> optionally wait for the inserted item's terminal maintenance outcome
```

Caller-provided attribution is evidence metadata, not authorization. An agent
cannot obtain human correction authority by claiming a human identity in its
payload.

## Eventually consistent maintenance boundary

```ts
type MaintenanceFrontier = {
  project: ProjectIdentity
  evidenceThrough: EvidenceSequence
  sourceStateReferences: SourceStateReference[]
  canonicalMemoryRevisions: MemoryRevisionSet
}
```

Every maintenance run operates against a frozen frontier. Evidence accepted
after that frontier remains pending for later maintenance and does not by itself
invalidate the in-flight run.

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
  raw provider source payloads         SQLite during the initial product
  Evidence Log                         durable normalized observations in SQLite
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

Raw payload bytes, normalized evidence, and provenance are retained by default
during the initial product. Derived chunks, indexes, and caches may be deleted
and rebuilt. A later TTL may delete raw payload bytes only through an explicit
retention policy that preserves the durable normalized evidence, integrity
hash, required replay guarantees, and any evidence still needed by active or
historical memory. Superseding one memory does not by itself authorize deletion
because one evidence item may support several memories.

## Shared memory infrastructure

```ts
type SharedMemoryEnvelope = {
  identity: MemoryRecordIdentity
  product: "session" | "project" | "personal" | "practice"
  schemaVersion: SchemaVersion
  scopeReferences: ScopeReference[]
  provenance: Provenance
  freshness: Freshness
  lifecycle: Active | Stale | Superseded | Retracted
  relations: MemoryRelations
}
```

The shared envelope is infrastructure, not a universal memory ontology. Each
memory product owns its content schema, admission policy, reconciliation
granularity, and canonical repository.

The envelope identity names the independently reconcilable memory node. For
Session Memory, one canonical SQLite record is one node. For Project, Personal,
and Practice Memory, one canonical Markdown document is one node. Derived
sections and chunks support retrieval only; they do not introduce a claim
ontology or a finer canonical lifecycle.

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
PACKAGED SQLITE RUNTIME
  application-owned SQLite library with FTS5 enabled
  exact pinned sqlite-vec package and compatible extension binary
  platform and architecture selected from the application package

LEXICAL INDEX
  SQLite FTS5 over Session Memory and canonical-Markdown semantic chunks

VECTOR INDEX
  sqlite-vec over the same retrievable units
  one complete index generation per embedding contract

APPLICATION POLICY
  TypeScript performs reciprocal-rank fusion inside each memory product
  TypeScript federates the four typed product result sets
```

FTS5 is an SQLite capability included in the packaged runtime, not a separate
host-installed service. `sqlite-vec` remains the selected vector extension and
is pinned to an exact compatible version because its public contract is pre-v1.

Ordinary installation does not depend on Apple SQLite, Homebrew, or another
host SQLite installation. Every platform and architecture that the application
claims to support must package a compatible SQLite library and `sqlite-vec`
binary, preserve their source and license provenance, and prove that both FTS5
and vector loading work. An explicit development override may select another
runtime, but host discovery is not the product contract.

An embedding provider is tightly coupled to the index generation it creates.
Stored vectors record provider, model, model revision, dimensions,
normalization, purpose, and chunking-contract version. A query uses the exact
matching contract. Changing provider or model builds a new generation and
switches only after that generation is complete; it never mixes query and
document vectors from different contracts.

SQLite executes lexical and vector retrieval. It does not own the meaning of a
combined score. TypeScript runs the two searches, retains their independent
signals, and applies inspectable rank-fusion policy separately for each memory
product.

## Query architecture

```text
question + caller context
  -> QueryService
      -> resolve project, workspace context, user, and technologies
      -> for each applicable memory product
          -> filter by product, project, applicability, lifecycle, and freshness
          -> run FTS5 lexical retrieval
          -> run sqlite-vec retrieval with that product's embedding contract
          -> fuse lexical and vector ranks in TypeScript
          -> hydrate canonical Session records or Markdown artifacts
          -> verify the canonical revision or content hash
      -> federate bounded typed result sets across all four products
      -> preserve product, scope, freshness, provenance, and contradictions
      -> construct provider-neutral query AgentTask
      -> AgentAdapter
          -> CodexAgentAdapter
      -> validate the untrusted agent result
      -> return answer, supporting memory references, and freshness
```

Query is exposed through the installed command. Once introduced, an MCP tool
calls a transport-neutral app client whose initial implementation invokes the
installed command through its versioned machine protocol. Neither the MCP tool
nor the client implements retrieval, ranking, or answer logic.

Semantic similarity selects candidates; it does not decide truth,
applicability, or conflict resolution.

Federation does not flatten all products into one global score. Query embeds the
question once per distinct active embedding contract, retrieves and ranks each
product independently, removes duplicate references, preserves contradictory
candidates, and allocates answer context across the typed result sets. The
query agent receives a federated packet that still identifies Session,
Project, Personal, and Practice sources separately.

## Logical runtime surfaces

```text
Command Runtime
  installed named command for capture, query, and manual evidence insertion
  callable by humans and provider hooks

Maintenance Runtime
  autonomous execution of eligible memory work

Agent Runtime
  provider subprocesses launched for bounded curation and query tasks

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
TypeScript owns per-product rank fusion and four-product federation
embedding contracts never mix query and document vectors from different models
supported application packages include their required SQLite runtime and extensions
query preserves scope, freshness, provenance, and contradiction
raw evidence deletion requires retention policy and cannot follow one memory lifecycle alone
caller-supplied attribution never grants correction authority
authorized correction targets are fenced while reconciliation is pending
cross-store publication is journaled and recoverable, not assumed atomic
the CLI machine protocol is versioned independently of human presentation
MCP depends on an app client contract, not argv construction or console output
one MCP business operation does not compose multiple mutating CLI requests
provider adapters implement capabilities rather than individual workflows
query and maintenance share AgentAdapter for bounded agent execution
manual evidence insertion is deterministic even when its caller is an agent
capture and insert share ingestion only after evidence is provider-neutral
EvidenceIngestionService records maintenance intent but never curates memory
Application.create owns process-scoped composition of concrete infrastructure
capture composes one selected adapter and does not require an adapter registry
capture provider identity selects a contract but does not authenticate origin
invalid provider payloads never fall back to another capture adapter
Application exposes behaviors without exposing its internal service graph
capture provider and agent execution are configured as separate capabilities
capture provider is selected before composition for each capture invocation
manual insertion does not require a provider
no generic provider configures the whole Application instance
```
