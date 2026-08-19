# Our App Open Design Issues

This file tracks unresolved decisions exposed by design that already exists.
It does not track required artifacts or behavior that has not yet been designed.

Resolved design belongs in the artifact that owns it:

- [product behavior](BRAIN.pseudocode.md)
- [architecture and stack](architecture.pseudocode.md)
- [predicted implementation surface](feature-shape.md)

When an issue is resolved, its design moves into the owning artifact and the
issue is removed from this file.

## Identity and context

### Stable repository identity

**Exposed by:** [workspace context resolution](src/workspace/workspace-context.service.ts.md)
and [the project-scoped memory model](BRAIN.pseudocode.md).

**Established:**

- Project bootstrap creates an immutable application-owned `ProjectIdentity`.
- The exact bootstrapped directory is a replaceable oversight root, not the
  project identity.
- Workspace resolution never discovers or creates projects from hook activity.
- Git observations describe an optional repository relationship without
  expanding the bootstrapped project scope.
- Path, remote URL, root commit, and provider identifiers are observations;
  none alone is durable repository identity.

**Unresolved:** How does our app create and reconcile one `RepositoryIdentity`
across clones, changed remotes, forks, and multiple machines without
merging unrelated repository lineages?

**Time to address:** Before repository identity is used to correlate source
state or memory across distinct checkouts.

### Durable workstream identity

**Exposed by:** [workspace context resolution](src/workspace/workspace-context.service.ts.md)
and [Session Memory scope](BRAIN.pseudocode.md).

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

**Exposed by:** [workspace context resolution](src/workspace/workspace-context.service.ts.md),
[the Evidence Log acceptance boundary](src/evidence/evidence-ingestion.service.ts.md),
and [Session Memory behavior](BRAIN.pseudocode.md).

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

**Exposed by:** [workspace context observations](src/workspace/workspace-context.service.ts.md)
and [Project Memory publication](BRAIN.pseudocode.md).

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

**Exposed by:** [the four-product maintenance lifecycle](BRAIN.pseudocode.md).

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

**Exposed by:** [the asynchronous execution architecture](architecture.pseudocode.md)
and [autonomous maintenance behavior](BRAIN.pseudocode.md).

**Established:**

- Eligible work cannot lose its eligibility after a process exits.
- Maintenance must eventually run without user confirmation or another hook.
- A capture hook cannot wait for an agentic workflow to finish.

**Unresolved:** Which local runtime mechanism wakes, claims, and continues
eligible maintenance work?

**Time to address:** After durable eligibility is shaped and before our app
claims autonomous maintenance liveness.

### Crash recovery and idempotency

**Exposed by:** [the maintenance lifecycle](BRAIN.pseudocode.md) and
[the SQLite and Markdown architecture](architecture.pseudocode.md).

**Established:**

- A crashed worker cannot strand work.
- Reclaimed work cannot duplicate canonical publication.
- A failed pre-publication run leaves canonical memory unchanged.
- Evidence append and its maintenance obligation form one recoverable durable
  acceptance contract.
- One evidence acceptance command carries an application operation identity.
- Reliable cross-delivery suppression uses optional source replay identity
  `(domain, scheme, key)` outside `EvidenceOrigin`.
- Reusing a replay identity for different canonical evidence is a conflict,
  never a correction.
- One acceptance operation belongs to one project and commits new evidence,
  project-local sequence allocation, replay admission, its stored receipt, and
  maintenance eligibility atomically.
- A successful acceptance operation creates one immutable SQLite operation
  record. Its opaque operation identity retrieves the complete versioned
  receipt, and a separate project foreign key records ownership.
- Acceptance-operation records contain no pending or failed state and remain
  for the owning project's lifetime so a late retry cannot lose idempotency.
- Covered and scheduled frontiers prevent overlapping maintenance requests.
- A pending request may extend; a running request keeps its frozen frontier.
- Each execution is a separate leased `MaintenanceAttempt`. Failure or lease
  expiry leaves its request pending and does not advance the covered cursor.
- Completion by a replaced stale worker cannot advance the cursor.

**Unresolved:** What durable claim and fencing mechanism implements attempt
leases, and what idempotency keys coordinate canonical publication, candidate
disposition, and derived indexing across crashes?

**Time to address:** With evidence ingestion, worker claims, and the first
canonical publication owner.

### Retry, quarantine, and terminal failure

**Exposed by:** [agent execution and maintenance](architecture.pseudocode.md).

**Established:** Later evidence must continue even when one maintenance item
repeatedly fails, and failed work must remain observable.

**Unresolved:** Which failures retry, which work enters quarantine, and which
conditions produce a terminal maintenance outcome?

**Time to address:** After worker claims and provider failure vocabulary exist,
and before maintenance receipts are finalized.

## Evidence and autonomous authority

### Memory-influence lineage

**Exposed by:** [autonomous evidence-based authority](BRAIN.pseudocode.md) and
[query-guided agent behavior](architecture.pseudocode.md).

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

**Exposed by:** [Personal Memory authority](BRAIN.pseudocode.md).

**Established:**

- Explicit user preferences and corrections are strong Personal evidence.
- One project constraint does not automatically become a global preference.
- Session curation can propose a Personal candidate after one session.
- The Personal curator can narrow or reject a candidate without user approval.

**Unresolved:** What evidence strength, repetition, scope, contradiction, and
confidence rules publish or revise a Personal Memory node?

**Time to address:** When the Personal Memory curator is shaped.

### Practice Memory admission policy

**Exposed by:** [Practice Memory authority](BRAIN.pseudocode.md).

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

### Trusted principal derivation for inserted evidence

**Exposed by:** [manual evidence insertion](src/cli.ts.md) and
[product-specific correction behavior](BRAIN.pseudocode.md).

**Established:**

- Correction enters autonomous reconciliation. It is not a review gate.
- A correction can state or retract a Personal preference.
- A correction can report stale Project Memory, but it cannot change what the
  repository proves.
- A correction can refine a Practice, while applicability and outcome evidence
  remain relevant.
- Caller-supplied attribution cannot grant authority.
- An AI agent cannot claim human authority through payload metadata.
- Evidence insertion never directly mutates or fences memory.
- Immediate intent schedules the same autonomous curation path used by other
  accepted evidence.

**Unresolved:** Which trusted invocation facts derive principals for humans,
provider hooks, and the future MCP transport, and how do product curators weigh
that attributable evidence without treating payload claims as authority?

**Time to address:** Before the insert command and attributable insertion
contract are finalized.

## Project Memory

### Branch divergence

**Exposed by:** [Project Memory behavior](BRAIN.pseudocode.md) and
[workspace context](src/workspace/workspace-context.service.ts.md).

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

**Exposed by:** [Project Memory curation](BRAIN.pseudocode.md) and
[provider filesystem policy](architecture.pseudocode.md).

**Established:** Curation must preserve source-state attribution and the
provider's read-only project boundary.

**Unresolved:** Does the curator inspect the live project directory, an
immutable snapshot, or an application-managed checkout?

**Time to address:** Before the first Project Memory curator invokes an agent.

### Overhaul and broad invalidation

**Exposed by:** [Project Memory revision behavior](BRAIN.pseudocode.md).

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

**Exposed by:** [federated query behavior](BRAIN.pseudocode.md) and
[the query architecture](architecture.pseudocode.md).

**Established:**

- Query returns an evidence-backed answer with memory references and freshness.
- Retrieval federates the four products without flattening their authority.
- Canonical memory and derived indexes can advance at different times.
- Maintenance intentionally trails recent evidence.

**Unresolved:** How does a query result represent stale maintenance, a stale
index, an unavailable memory product, and an unresolved contradiction?

**Time to address:** When the Query result and workflow-specific response
schema are shaped.

## Storage and retrieval

### Durable location and layout

**Exposed by:** [the storage architecture](architecture.pseudocode.md),
[the predicted file surface](feature-shape.md), and
[canonical Markdown nodes](src/memory/markdown/markdown-memory-document.ts.md).

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

**Exposed by:** [hybrid retrieval architecture](architecture.pseudocode.md) and
[semantic Markdown sections](src/memory/markdown/markdown-memory-document.ts.md).

**Established:**

- SQLite FTS5 owns lexical retrieval.
- A pinned `sqlite-vec` build owns vector storage and retrieval.
- TypeScript performs product-local reciprocal-rank fusion.
- Markdown becomes typed, heading-delimited semantic sections.
- Oversized sections split only at complete block boundaries.
- One index generation is coupled to its embedding provider, model revision,
  dimensions, normalization, purpose, and chunking-contract version.
- Vectors from different embedding contracts are never mixed.
- A model change builds a complete generation before activation.

**Unresolved:** Which local embedding contracts are supported, and how does our
app build, validate, activate, degrade, migrate, and remove index generations?

**Time to address:** When the retrieval-index owner is shaped and before query
depends on vector results.

### Markdown publication revision and journal

**Exposed by:** [canonical Markdown structure](src/memory/markdown/markdown-memory-document.ts.md)
and [the SQLite and Markdown ownership split](architecture.pseudocode.md).

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

**Exposed by:** [append-only evidence and memory lifecycle](BRAIN.pseudocode.md)
and [local storage architecture](architecture.pseudocode.md).

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

**Exposed by:** [the CLI boundary](src/cli.ts.md) and
[the application distribution architecture](architecture.pseudocode.md).

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

**Exposed by:** [the CLI entry point](src/cli.ts.md),
[application composition](src/application.ts.md), and the future CLI-backed MCP
client in [the architecture](architecture.pseudocode.md).

**Established:**

- Native provider activity stays opaque to the CLI.
- Failure diagnostics cannot echo captured or inserted evidence.
- Bootstrap success means an immutable project identity and its exact canonical
  oversight root are durably registered.
- Capture success means durable evidence acceptance, not completed maintenance.
- Insert success means durable evidence acceptance and durable immediate
  maintenance eligibility, not completed maintenance.
- Query success returns an answer, supporting references, and freshness.
- Machine responses are stable protocol envelopes, not console text.
- One MCP business operation maps to one application operation and one process
  request.

**Unresolved:** What framing, encoding, protocol version, environment fields,
diagnostics, exit codes, receipts, cancellation, and compatibility rules does
each command expose?

**Time to address:** As each command's application operation is shaped and
before the CLI-backed MCP client is designed.

### Agent filesystem enforcement

**Exposed by:** [the agent execution architecture](architecture.pseudocode.md).

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

**Exposed by:** [shared agent execution](architecture.pseudocode.md) and
[query and maintenance behavior](BRAIN.pseudocode.md).

**Established:**

- A provider adapter owns process interaction and structural parsing.
- Query and maintenance workflows own their prompts, response schemas,
  validation, and semantic decisions.
- Runtime schema validation proves structure. It does not prove truth.

**Unresolved:** What response schema, repair policy, structural failure, and
semantic rejection contract applies to each query and maintenance workflow?

**Time to address:** After each deterministic workflow task packet is shaped
and before that workflow invokes the shared agent adapter.

## TypeScript stack

### Packaged SQLite runtime and platform support

**Exposed by:** [the self-contained SQLite architecture](architecture.pseudocode.md).

**Established:**

- Normal installation cannot depend on Apple SQLite, Homebrew, or another host
  SQLite installation.
- Each supported package includes SQLite with FTS5 and the pinned `sqlite-vec`
  extension.
- Runtime selection occurs before the first database connection.
- Host discovery can be a development override. It is not the product contract.

**Unresolved:** What platform and architecture matrix, binary build, update,
provenance, license, integrity check, development override, and unsupported-host
behavior does our app support?

**Time to address:** Before the database boundary or distribution package is
implemented.

### Runtime and package manager

**Exposed by:** [the TypeScript stack](architecture.pseudocode.md).

**Established:** TypeScript, strict mode, and ESM are selected. The runtime and
package manager are separate decisions.

**Unresolved:** Which runtime and package manager best support the packaged
SQLite requirement, process execution, distribution, and development workflow?

**Time to address:** Before dependencies, scripts, and distribution packaging
are fixed.

### Runtime application configuration

**Exposed by:** [application composition](src/application.ts.md) and
[the provider-neutral architecture](architecture.pseudocode.md).

**Established:**

- `Application.create` is the process-scoped factory and composition boundary.
- Each CLI invocation creates one application instance.
- Capture resolves one provider configuration before construction and injects
  one capture adapter directly.
- Agent execution is independent from capture and is shared by query and
  maintenance.
- Manual insertion does not require a provider.
- No generic provider configures the whole application.

**Unresolved:** Which provider availability, executable discovery, environment
policy, storage locations, and machine overrides can `Application.create`
admit, and how are invalid combinations rejected?

**Time to address:** Before `Application.create` is finalized with storage and
agent-execution dependencies.

### Validation and Markdown libraries

**Exposed by:** [runtime boundary validation](architecture.pseudocode.md) and
[the Markdown node contract](src/memory/markdown/markdown-memory-document.ts.md).

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
