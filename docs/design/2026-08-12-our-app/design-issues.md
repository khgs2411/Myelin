# Our App Open Design Issues

This file tracks unresolved decisions exposed by design that already exists.
It does not track required artifacts or behavior that has not yet been designed.

Resolved design belongs in the artifact that owns it:

- [product behavior](pseudocode/BRAIN.pseudocode.md)
- [architecture and stack](pseudocode/architecture.pseudocode.md)
- [canonical application shape](../feature-shape.md)

When an issue is resolved, its design moves into the owning artifact and the
issue is removed from this file.

## Identity and context

### Durable workstream identity

**Exposed by:** [workspace context resolution](pseudocode/src/workspace/workspace-context.service.ts.md)
and [Session Memory scope](pseudocode/BRAIN.pseudocode.md).

**Established:**

- Session Memory distinguishes the current workspace context from concurrent
  project activity.
- The active branch is the version-one workspace coordinate.
- Provider session remains a separate evidence coordinate.
- No single coordinate is always the workstream.
- Concurrent work cannot contaminate another Session Memory context.

**Unresolved:** How does our app correlate one recent workstream across
provider sessions, branches, resumed tasks, and commits?

**Time to address:** Before Session Memory storage, curation, and query scope
are shaped.

### Session Memory branch and project scope

**Exposed by:** [workspace context resolution](pseudocode/src/workspace/workspace-context.service.ts.md),
[the Evidence Log acceptance boundary](pseudocode/src/evidence/evidence-acceptance.service.ts.md),
and [Session Memory behavior](pseudocode/BRAIN.pseudocode.md).

**Established:**

- Non-Git projects have no branch scope; their Session Memory is project-wide.
- Git-backed evidence preserves its observed branch and supports indexed branch
  filtering.
- Recall remains branch-aware and can broaden to clearly attributed memory from
  other branches when branch-filtered recall is insufficient.
- An empty current branch must not silently relabel another branch's work as
  current or project-wide.
- Branch is a scope and retrieval coordinate. It is not evidence identity.

**Candidate direction:** Do not create a separate project-wide Session Memory
classification for Git-backed projects. Session Memory is either associated
with its observed branch or has no branch coordinate. Query first searches the
current branch. If that result does not satisfy a future confidence contract,
query searches all Session Memory for the project without branch filtering and
preserves branch attribution on every result. Non-Git and branch-unavailable
memory naturally participates through its absent branch coordinate.

**Unresolved:** What evidence and curation rule makes a Git-backed Session
Memory node branch-specific or unscoped? Should Git-backed Session Memory omit
a project-wide classification entirely? What score or confidence contract can
safely trigger the broader project search, and how does that search avoid
flattening conflicting branch realities into one answer?

**Time to address:** With Session Memory storage and curation, and before the
Session Memory query scope and fallback contract are finalized.

### Exact project source state

**Exposed by:** [workspace context observations](pseudocode/src/workspace/workspace-context.service.ts.md)
and [Project Memory publication](pseudocode/BRAIN.pseudocode.md).

**Established:**

- A Git commit does not describe a dirty checkout.
- Project Memory is eventually consistent and can trail current work.
- An older maintenance run cannot overwrite memory advanced by a newer run.

**Unresolved:** What source-state reference lets a curator prove which dirty or
committed project state it inspected without making capture expensive?

**Time to address:** Before the Project Memory curator and publication
precondition are finalized.

## Autonomous maintenance

### Higher-layer trigger and catch-up policy

**Exposed by:** [the four-product maintenance lifecycle](pseudocode/BRAIN.pseudocode.md).

**Established:**

- Session Memory publishes first and emits destination-specific candidate
  leads.
- A candidate is a trigger and proposition. It is not evidence or authority.
- A destination curator reopens original evidence, relevant source state, and
  existing memory.
- Each higher layer owns a durable eligibility state and processed frontier.
- A catch-up scan must find relevant evidence that Session curation omitted.

**Unresolved:** What count, time, priority, and catch-up rules trigger Project,
Personal, and Practice maintenance?

**Time to address:** After the Session publication and candidate contract, and
before the first higher-layer curator is shaped.

### Worker wake and liveness model

**Exposed by:** [the asynchronous execution architecture](pseudocode/architecture.pseudocode.md)
and [autonomous maintenance behavior](pseudocode/BRAIN.pseudocode.md).

**Established:**

- Eligible work cannot lose its eligibility after a process exits.
- Maintenance must eventually run without user confirmation or another hook.
- A capture hook cannot wait for an agentic workflow to finish.

**Unresolved:** Which local runtime mechanism wakes, claims, and continues
eligible maintenance work?

**Time to address:** After durable eligibility is shaped and before our app
claims autonomous maintenance liveness.

### Crash recovery and idempotency

**Exposed by:** [the maintenance lifecycle](pseudocode/BRAIN.pseudocode.md) and
[the SQLite and Markdown architecture](pseudocode/architecture.pseudocode.md).

**Established:**

- A crashed worker cannot strand work.
- Reclaimed work cannot duplicate canonical publication.
- A failed pre-publication run leaves canonical memory unchanged.
- Evidence append and its Session maintenance obligation form one recoverable
  durable acceptance contract.
- One evidence acceptance command carries an application operation identity.
- Reliable cross-delivery suppression uses optional source replay identity
  `(domain, scheme, key)` outside `EvidenceOrigin`.
- Reusing a replay identity for different canonical evidence is a conflict,
  never a correction.
- Source-replay equality uses a versioned fingerprint of the complete
  `EvidenceCandidateDto` and excludes the replay lookup key and
  acceptance-owned results.
- One optional immutable replay identity and candidate fingerprint are stored
  as nullable all-or-none projections on the accepted `EvidenceItem` row.
- `EvidenceAcceptanceService` owns replay classification;
  `EvidenceLogRepository` owns transactional replay lookup and persistence.
- One acceptance operation belongs to one project and commits new evidence,
  project-local sequence allocation, replay admission, its stored receipt, and
  Session maintenance eligibility atomically.
- A successful acceptance operation creates one immutable SQLite operation
  record. Its opaque operation identity retrieves the complete versioned
  receipt, and a separate project foreign key records ownership.
- Acceptance-operation records contain no pending or failed state and remain
  for the owning project's lifetime so a late retry cannot lose idempotency.
- `SessionMaintenance` is a composed instance façade with lifecycle and
  schedule capabilities. It is not a static namespace, base class, or
  persistence container.
- Consumers receive only the Session maintenance capability they need. The
  façade owns no universal transaction rule.
- `SessionMaintenanceLifecycleService` joins project bootstrap and initializes
  new-project state or requires existing-project state without repair.
- `SessionMaintenancePolicyService` is internal to scheduling. It synchronizes
  already validated effective Session policy values through the caller's
  acceptance transaction and returns the exact revision used by that operation.
  It does not parse YAML or select a project.
- `SessionMaintenanceScheduleService` joins evidence acceptance and owns
  policy application, eligibility, active-chain validation, frontier
  calculation, and coalescing.
- A stored operation replay returns its receipt before policy synchronization.
  A replay-only new operation creates no policy revision.
- A project's first newly accepted evidence can create policy revision one in
  the same transaction as evidence, scheduling, and receipt persistence.
  Policy absence after that first project sequence is incompatible durable
  state.
- `SessionMaintenanceEvidenceReader` supplies the first uncovered Evidence Log
  `received_at` fact. `EvidenceLogRepository` implements this narrow port but
  does not classify Session eligibility.
- No Session `execution` capability exists until claim, attempt replacement,
  publication, and fenced completion are shaped.
- Session maintenance uses separate state, policy, request, and attempt tables.
- `SessionMaintenancePolicyRevision` is a positive integer value on immutable
  policy rows, not a separate table. The highest project revision is active.
- A Session maintenance request records the policy revision that caused its
  eligibility.
- The request table uses a composite project-and-policy-revision foreign key,
  closed state and priority checks, and valid non-empty sequence-range checks.
- Partial unique indexes enforce at most one pending and at most one running
  request per project. They do not enforce range relationships.
- `SessionMaintenanceRequestRepository` returns raw active facts and applies
  exact schedule-service-selected writes. It does not upsert or decide
  coalescing.
- Covered and scheduled frontiers prevent overlapping Session maintenance
  requests.
- A pending request may extend; a running request keeps its frozen frontier.
- Each execution is a separate leased `SessionMaintenanceAttempt`. Failure or
  lease expiry leaves its request running and frozen, eligible for a
  replacement attempt, and does not advance the covered cursor.
- Completion by a replaced stale worker cannot advance the cursor.

**Unresolved:** What durable claim and fencing mechanism implements attempt
leases, and what idempotency keys coordinate canonical publication, candidate
disposition, and derived indexing across crashes?

**Time to address:** With evidence acceptance, worker claims, and the first
canonical publication owner.

### Retry, quarantine, and terminal failure

**Exposed by:** [agent execution and maintenance](pseudocode/architecture.pseudocode.md).

**Established:** Later evidence must continue even when one maintenance item
repeatedly fails, and failed work must remain observable.

**Unresolved:** Which failures retry, which work enters quarantine, and which
conditions produce a terminal maintenance outcome?

**Time to address:** After worker claims and provider failure vocabulary exist,
and before maintenance receipts are finalized.

## Evidence and autonomous authority

### Memory-influence lineage

**Exposed by:** [autonomous evidence-based authority](pseudocode/BRAIN.pseudocode.md) and
[query-guided agent behavior](pseudocode/architecture.pseudocode.md).

**Established:**

- A remembered preference can guide later implementation.
- That implementation proves use. It is not independent proof that the
  original inference was correct.
- Memory-guided work must remain visible as evidence.

**Unresolved:** How does our app record which memory nodes influenced an agent
run, so a curator can distinguish independent support from self-confirmation?

**Time to address:** Before query results can influence captured work and before
Personal or Practice admission is finalized.

### Personal Memory admission policy

**Exposed by:** [Personal Memory authority](pseudocode/BRAIN.pseudocode.md).

**Established:**

- Explicit user preferences and corrections are strong Personal evidence.
- One project constraint does not automatically become a global preference.
- Session curation can propose a Personal candidate after one session.
- The Personal curator can narrow or reject a candidate without user approval.

**Unresolved:** What evidence strength, repetition, scope, contradiction, and
confidence rules publish or revise a Personal Memory node?

**Time to address:** When the Personal Memory curator is shaped.

### Practice Memory admission policy

**Exposed by:** [Practice Memory authority](pseudocode/BRAIN.pseudocode.md).

**Established:**

- Repository use proves that an approach exists. It does not prove success.
- A practice records technology, version, mode, framework, and project
  applicability.
- Failed use can become a gotcha instead of a recommended method.
- Tool preference and the practice for using that tool remain linked but
  distinct memories.

**Unresolved:** What concrete applicability and outcome evidence publishes,
revises, or demotes a Practice Memory node?

**Time to address:** When the Practice Memory curator is shaped.

### MCP targeted-memory submission context and authority

**Exposed by:** [targeted memory insertion](../2026-09-02-ingestion-boundaries/pseudocode/targeted-memory-insertion.md),
[the CLI process boundary](pseudocode/src/cli.ts.md), and
[product-specific correction behavior](pseudocode/BRAIN.pseudocode.md).

**Established:**

- Correction enters autonomous reconciliation. It is not a review gate.
- A correction can state or retract a Personal preference.
- A correction can report stale Project Memory, but it cannot change what the
  repository proves.
- A correction can refine a Practice, while applicability and outcome evidence
  remain relevant.
- Caller-supplied attribution cannot grant authority.
- An AI agent cannot claim human authority through payload metadata.
- The entry boundary establishes insertion source as CLI or MCP; it does not
  prove that a CLI caller is human.
- The CLI keeps client correlation optional and makes safe retries caller
  responsibility when omitted.
- The future agent-only MCP contract requires a client reference and the full
  context required by that transport.
- Targeted insertion explicitly selects Project, Personal, or Practice Memory.
- The selected product's Inbox and curator own admission; insertion never
  directly mutates or fences canonical memory.
- Targeted insertion does not enter Session Memory.

**Unresolved:** Which agent and invocation facts the future MCP integration can
establish independently of tool payload claims, and how product curators weigh
that provenance without treating it as automatic human authority.

**Time to address:** When the MCP integration or a durable-memory curator first
consumes agent-specific insertion provenance. This does not block the direct
CLI insertion contract.

## Project Memory

### Branch divergence

**Exposed by:** [Project Memory behavior](pseudocode/BRAIN.pseudocode.md) and
[workspace context](pseudocode/src/workspace/workspace-context.service.ts.md).

**Established:**

- Project Memory is canonical human-readable Markdown.
- Unmerged work can be newer than the broadly published project state.
- Query distinguishes scoped divergence from factual contradiction.
- Last-write-wins is not an acceptable resolution rule.

**Unresolved:** How does canonical Project Memory represent and reconcile two
simultaneously valid branch realities?

**Time to address:** Before Project Memory publication and query scope are
finalized.

### Project-grounded curation workspace

**Exposed by:** [Project Memory curation](pseudocode/BRAIN.pseudocode.md) and
[provider filesystem policy](pseudocode/architecture.pseudocode.md).

**Established:** Curation must preserve source-state attribution and the
provider's read-only project boundary.

**Unresolved:** Does the curator inspect the live project directory, an
immutable snapshot, or an application-managed checkout?

**Time to address:** Before the first Project Memory curator invokes an agent.

### Overhaul and broad invalidation

**Exposed by:** [Project Memory revision behavior](pseudocode/BRAIN.pseudocode.md).

**Established:**

- Session curation can emit a broad revalidation candidate.
- A candidate cannot void all Project Memory by itself.
- The Project curator inspects current project state before it changes durable
  documentation.

**Unresolved:** How does a project-wide rewrite revalidate, mark stale,
supersede, retain, or retract existing Project Memory nodes?

**Time to address:** With Project Memory curation and lifecycle vocabulary.

## Query layer

### Query freshness and degraded results

**Exposed by:** [federated query behavior](pseudocode/BRAIN.pseudocode.md) and
[the query architecture](pseudocode/architecture.pseudocode.md).

**Established:**

- The core query returns qualified typed memory results and freshness without
  agentic curation.
- Query invokes each applicable memory product with the same question and
  preserves their results without flattening their authority.
- Each product owns its retrieval method, product-local scoring, qualification
  threshold, lifecycle and applicability filters, and output representation.
- Session Memory returns qualified database records or parsed text. Project,
  Personal, and Practice Memory return qualified canonical Markdown references.
- Retrieval scores and thresholds are not comparable across products.
- Canonical memory and derived indexes can advance at different times.
- Maintenance intentionally trails recent evidence.
- Managed project queries admit all four memory products. Unmanaged directory
  queries admit Personal and Practice while Session and Project are
  `not-applicable`; unmanaged context is not degradation.
- An optional later aggregator may curate one response from the complete core
  result through `AgentAdapter`. It is separate from `QueryService.query` and
  retains the unchanged core result beside any curated response.
- A human or agent may consume and curate the core result directly without the
  optional aggregator.
- Query remains read-only. An unmanaged result may let a caller offer the
  separate explicit project-bootstrap operation, but it cannot select or
  register an oversight root.

**Unresolved:** What query capability, retrieval method, score threshold,
freshness policy, and exact qualified result shape does each memory product
own? Which product failures permit a partial core result, and which fail the
query? Does Session Memory return records, parsed text, or another typed
projection? The optional result aggregator's owner and curated-response
vocabulary remain open and do not block the core query.

**Time to address:** Product-specific retrieval decisions are addressed when
each memory product's query capability is shaped. The optional aggregator is
addressed only when a curated query-response workflow is selected.

## Storage and retrieval

### Durable location and layout

**Exposed by:** [the storage architecture](pseudocode/architecture.pseudocode.md),
[the canonical application shape](../feature-shape.md), and
[canonical Markdown nodes](pseudocode/src/memory/markdown/markdown-memory-document.ts.md).

**Established:**

- Session Memory canonical content lives in SQLite.
- Project, Personal, and Practice canonical content lives in Markdown.
- SQLite indexes canonical Markdown for retrieval. It does not replace it.
- Markdown follows a portable Obsidian-compatible profile.
- Obsidian is an optional viewer, not a dependency.
- Our app is initially the only canonical Markdown writer.

**Unresolved:** Where do global and project Markdown, SQLite state, raw evidence,
agent-run artifacts, and rebuildable indexes live on disk?

**Time to address:** Before the SQLite runtime and Markdown publication owners
open canonical paths.

### Embedding contract and index-generation lifecycle

**Exposed by:** [hybrid retrieval architecture](pseudocode/architecture.pseudocode.md) and
[semantic Markdown sections](pseudocode/src/memory/markdown/markdown-memory-document.ts.md).

**Established:**

- SQLite FTS5 provides lexical retrieval infrastructure.
- A pinned `sqlite-vec` build provides vector storage and retrieval.
- Each memory product owns which retrieval signals it uses and any
  product-local fusion, score, qualification threshold, and filters.
- Markdown becomes typed, heading-delimited semantic sections.
- Oversized sections split only at complete block boundaries.
- One index generation is coupled to its embedding provider, model revision,
  dimensions, normalization, purpose, and chunking-contract version.
- Vectors from different embedding contracts are never mixed.
- A model change builds a complete generation before activation.

**Unresolved:** Which memory products use which lexical and vector signals?
Which local embedding contracts are supported, and how does our app build,
validate, activate, degrade, migrate, and remove index generations?

**Time to address:** When the retrieval-index owner is shaped and before query
depends on vector results.

### Markdown publication revision and journal

**Exposed by:** [canonical Markdown structure](pseudocode/src/memory/markdown/markdown-memory-document.ts.md)
and [the SQLite and Markdown ownership split](pseudocode/architecture.pseudocode.md).

**Established:**

- Canonical Markdown is human-readable product content.
- SQLite and the filesystem do not share one native transaction.
- Publication exposes one committed revision and recovers idempotently.
- A receipt records the evidence frontier, expected prior revision, resulting
  revision, and agent-run attribution.
- Derived indexes can lag and remain rebuildable.

**Unresolved:** What journal and state sequence coordinates target revision,
atomic file replacement, SQLite metadata, recovery, and index scheduling?

**Time to address:** Before the first canonical Markdown publication owner is
finalized.

### Evidence retention, privacy, and forgetting

**Exposed by:** [append-only evidence and memory lifecycle](pseudocode/BRAIN.pseudocode.md)
and [local storage architecture](pseudocode/architecture.pseudocode.md).

**Established:**

- `EvidenceItem` records and their provenance remain durable unless an
  explicit forgetting operation applies.
- The first product version retains exact source-material content with an
  integrity hash.
- Replay identity remains separate admission metadata and is retained when a
  source supplies reliable replay coordinates.
- Corrections append evidence and express supersession.
- Derived chunks, FTS rows, vectors, and caches can be rebuilt.
- A future TTL can delete raw bytes while preserving required `EvidenceItem`
  fields and integrity metadata.
- One memory's removal cannot automatically delete evidence that supports
  another memory or historical provenance.

**Unresolved:** What TTL, privacy exclusions, secret handling, explicit
forgetting guarantees, and backup behavior apply to each stored product?

**Time to address:** After the Evidence Log persistence schema exists and before
automated cleanup or forgetting is introduced. TTL defaults require measured
storage and privacy evidence.

## Provider execution and security

### Application installation and machine integrations

**Exposed by:** [the CLI boundary](pseudocode/src/cli.ts.md) and
[the application distribution architecture](pseudocode/architecture.pseudocode.md).

**Established:**

- Our app is intentionally nameless.
- `myelin` is a historical name, not the current command name.
- Humans and provider hooks invoke one installed command.
- Application installation owns machine-wide provider capture mechanics.
- Codex hooks are installed once per machine rather than once per project.
- Project bootstrap registers oversight scope and remains provider-neutral.
- A future MCP server uses a formal client contract whose first implementation
  invokes that command through a versioned machine protocol.
- One top-level installer may expose command publication, provider capture, and
  MCP setup while preserving their separate state and lifecycles.

**Unresolved:** What command name, installation location, package metadata,
upgrade and backup behavior, executable discovery, hook installation, repair,
removal, and later MCP-registration model does our app use?

**Time to address:** When the application package and first Codex hook
installation are shaped.

### CLI process contracts

**Exposed by:** [the CLI entry point](pseudocode/src/cli.ts.md),
[application composition](pseudocode/src/application.ts.md), and the future CLI-backed MCP
client in [the architecture](pseudocode/architecture.pseudocode.md).

**Established:**

- Native provider activity stays opaque to the CLI.
- Failure diagnostics cannot echo captured evidence or proposed content.
- The repository-local manual interface exposes
  `memory propose <project | personal | practice>` and the internal
  `dev capture-fixture` command family.
- Direct CLI proposals accept exact ordered text, file, or explicit standard
  input and keep the caller's replay reference optional.
- Bootstrap success means an immutable project identity and its exact canonical
  oversight root are durably registered.
- Capture success means durable evidence acceptance, not completed maintenance.
- Memory-proposal success means durable acceptance by exactly one selected
  product Inbox, not completed curation or changed canonical memory.
- Query success returns the typed core Session results, grouped documentation
  references, product-local relevance, freshness, and product outcomes.
- Machine responses are stable protocol envelopes, not console text.
- One MCP business operation maps to one application operation and one process
  request.

**Unresolved:** What framing, encoding, protocol version, environment fields,
detailed exit-code classes, structured diagnostics, receipt representation,
cancellation, and compatibility rules does the future installed machine
protocol expose?

**Time to address:** As each command's application operation is shaped and
before the CLI-backed MCP client is designed.

### Agent filesystem enforcement

**Exposed by:** [the agent execution architecture](pseudocode/architecture.pseudocode.md).

**Established:**

- TypeScript owns argument-safe process execution and cancellation.
- Provider output cannot write canonical memory.
- Canonical publication does not require provider filesystem write access.
- Shell wrappers are optional edge configuration, not the provider boundary.

**Unresolved:** How does our app enforce `project-read` access across provider
sandbox arguments, environment filtering, subprocesses, and prompt-injection
content from the repository?

**Time to address:** Before the first autonomous agent run receives project
filesystem access.

### Workflow-specific response schemas and validation failures

**Exposed by:** [shared agent execution](pseudocode/architecture.pseudocode.md), memory
maintenance, and the optional query-result aggregation boundary in
[product behavior](pseudocode/BRAIN.pseudocode.md).

**Established:**

- A provider adapter owns process interaction and structural parsing.
- Memory-maintenance workflows and an optional query-result aggregator own
  their prompts, response schemas, validation, and semantic decisions.
- Core query is deterministic and does not invoke the shared agent adapter.
- Runtime schema validation proves structure. It does not prove truth.

**Unresolved:** What response schema, repair policy, structural failure, and
semantic rejection contract applies to each agentic memory-maintenance or
optional query-result aggregation workflow?

**Time to address:** After each deterministic workflow task packet is shaped
and before that workflow invokes the shared agent adapter.

## TypeScript stack

### Packaged SQLite runtime and platform support

**Exposed by:** [the self-contained SQLite architecture](pseudocode/architecture.pseudocode.md).

**Established:**

- Normal installation cannot depend on Apple SQLite, Homebrew, or another host
  SQLite installation.
- Each supported package includes SQLite with FTS5 and the pinned `sqlite-vec`
  extension.
- Runtime selection occurs before the first database connection.
- Host discovery can be a development override. It is not the product contract.
- Bun 1.4 executes Sequelize and the packaged `sqlite3` Node-API driver.
- `@sequelize/sqlite3` does not use `Bun.SQL` or `bun:sqlite`.
- Sequelize does not select or prove the packaged SQLite build. `SqliteRuntime`
  must supply a compatible driver, sqlite-vec binary, and per-connection
  initialization before `SqliteDatabase` opens the ORM connection.

**Unresolved:** What platform and architecture matrix, binary build, update,
provenance, license, integrity check, development override, and unsupported-host
behavior does our app support?

**Time to address:** Before the database boundary or distribution package is
implemented.

### Runtime, package manager, and SQLite access

**Exposed by:** [the TypeScript stack](pseudocode/architecture.pseudocode.md).

**Established:**

- TypeScript, strict mode, and ESM are selected.
- Bun 1.4 is the runtime, package manager, test runner, and native file API.
- `bun.lock` is the committed dependency-resolution source.
- Sequelize is the selected ORM and pins `@sequelize/core` and
  `@sequelize/sqlite3` to `7.0.0-alpha.48`.
- The Sequelize dialect uses its packaged `sqlite3` Node-API driver under Bun.
  It does not use `Bun.SQL` or `bun:sqlite`.
- `sqlite-vec` is pinned to `0.1.9`.
- One `SqliteDatabase` instance is process-scoped through `Application.create`;
  it is not a global singleton.
- The project does not introduce a generic `Database` base class, static
  connection registry, or custom Sequelize dialect for a Bun database API.

The runtime, package manager, and ORM direction are resolved. Distribution
packaging and the supported native platform matrix remain under
[Packaged SQLite runtime and platform support](#packaged-sqlite-runtime-and-platform-support).

### Runtime application configuration

**Exposed by:** [application composition](pseudocode/src/application.ts.md) and
[the provider-neutral architecture](pseudocode/architecture.pseudocode.md).

**Established:**

- `Application.create` is the process-scoped factory and composition boundary.
- Each CLI invocation creates one application instance.
- Storage configuration supplies the application database path and validated
  packaged-runtime selection.
- `Application.create` opens one process-scoped `SqliteDatabase`, and
  `Application.close` releases it during process cleanup.
- Capture resolves one provider configuration before construction and injects
  one capture adapter directly.
- Agent execution is independent from capture and is shared by query and
  maintenance.
- Manual insertion does not require a provider.
- Maintenance configuration has a product-specific `maintenance.session`
  section. Its effective threshold, interval, and canonical digest are validated
  before application composition injects them into Session scheduling.
- Session scheduling passes those values to its internal policy service after
  evidence acceptance resolves the project and supplies its transaction.
- No generic provider configures the whole application.

**Unresolved:** Which provider availability, executable discovery, environment
policy, storage locations, and machine overrides can `Application.create`
admit, and how are invalid combinations rejected?

**Time to address:** Before `Application.create` is finalized with storage and
agent-execution dependencies.

### Validation and Markdown libraries

**Exposed by:** [runtime boundary validation](pseudocode/architecture.pseudocode.md) and
[the Markdown node contract](pseudocode/src/memory/markdown/markdown-memory-document.ts.md).

**Established:**

- Markdown uses a typed AST with source positions.
- The admitted syntax is CommonMark plus the required GitHub-Flavored Markdown
  subset and flat YAML frontmatter.
- Parsing and serialization cannot infer sections with regular expressions.
- Relationships use standard Markdown links.
- Output is Obsidian-compatible without an Obsidian runtime dependency.

**Unresolved:** Which exact runtime validation and Markdown packages implement
these contracts without introducing competing representations?

**Time to address:** After the remaining input and document contracts are
known and before implementation planning locks dependencies.
