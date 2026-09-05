# LLM Wiki

LLM Wiki is a local, provider-neutral memory system for AI-assisted work. It
captures evidence from real work, turns that evidence into maintained memory,
and gives later agents relevant, traceable context.

This README describes the completed product contract. It is the canonical
overview of application behavior and ownership. [ROADMAP.md](ROADMAP.md)
records the current delivery sequence. Detailed design evidence remains under
[`docs/design`](docs/design).

## Product Principles

- Evidence records what entered the application. Evidence is not memory.
- Curation decides what should become memory.
- Capture stays provider-neutral outside provider adapters.
- Session, Project, Personal, and Practice Memory remain separate products.
- Each memory product owns its meaning, authority, lifecycle, curation, and
  retrieval policy.
- Memory maintenance runs autonomously. Ordinary maintenance does not require
  user approval.
- Every memory result preserves its product, scope, freshness, provenance, and
  evidence lineage.
- The application keeps canonical state local and remains usable without
  Obsidian or a hosted database.

## Feature Map

```text
AUTOMATIC PROVIDER CAPTURE

Codex hooks
  -> trusted codex.hook entry + exact Codex-native input
      -> [Application] capture operation
        -> [CaptureAdapterFactory]
          -> [CodexCaptureAdapter] implements ICaptureAdapter
              -> CaptureResult[]

future Claude hooks
  -> trusted claude.hook entry + exact Claude-native input
      -> [Application] capture operation
        -> [CaptureAdapterFactory]
          -> [ClaudeCaptureAdapter] implements ICaptureAdapter
              -> same CaptureResult[] contract

LOCAL DEVELOPMENT CAPTURE

ordered developer input
  -> trusted development.fixture entry
      -> [Application] capture operation
        -> [CaptureAdapterFactory]
          -> [DevelopmentCaptureAdapter] implements ICaptureAdapter
              -> same CaptureResult[] contract

SHARED CAPTURE

trusted capture source + CaptureResult[]
  -> [EvidenceCaptureService]
      -> resolve WorkspaceContext
      -> EvidenceItemDto[]
          -> [EvidenceItemRepository]
              -> [EvidenceItem]
                  -> SQLite evidence_items

CAPTURED-EVIDENCE INGESTION

SQLite evidence_items
  -> Session maintenance threshold and uncovered evidence frontier
      -> [EvidenceIngestionService]
          -> Session Memory curation
              -> Session Memory records in SQLite
              -> destination-specific durable-memory candidates
                  -> Project Memory Inbox
                  -> Personal Memory Inbox
                  -> Practice Memory Inbox

TARGETED DURABLE-MEMORY INSERTION

qualified human or agent proposal
  -> [EvidenceInsertionService]
      -> exactly one selected durable-memory Inbox
          -> Project Memory Inbox
          -> Personal Memory Inbox
          -> Practice Memory Inbox

DURABLE-MEMORY CURATION

product Inbox candidate + original evidence + applicable source state
  -> selected product curator
      -> validate, reconcile, reject, or publish
          -> Project Memory Markdown
          -> Personal Memory Markdown
          -> Practice Memory Markdown

QUERY

question + current context
  -> [QueryService]
      -> Session Memory
      -> Project Memory
      -> Personal Memory
      -> Practice Memory
          -> grouped, qualified, traceable results
              -> optional agent-produced answer
```

The two intake systems never merge:

```text
Provider capture -> evidence_items -> Session Memory
Targeted insertion -> selected durable-memory Inbox
```

Targeted insertion does not enter `evidence_items` or Session Memory. Provider
capture does not write directly to Project, Personal, or Practice Memory.

## Application Operations

The application exposes these logical operations through its TypeScript
facade. The CLI, installed provider integrations, and future MCP tools adapt
these operations for their callers.

```ts
class Application {
  public static Create(configuration): Promise<Application>

  public bootstrapProject(input): Promise<ProjectBootstrapResult>
  public capture(input): Promise<ReadonlyArray<CapturedEvidenceReference>>
  public proposeMemory(input): Promise<TargetedInsertionResult>
  public query(input): Promise<QueryResult>

  public close(): Promise<void>
}
```

`Application.Create` opens shared process resources only. Each operation
constructs only its required object graph. A capture operation asks
`CaptureAdapterFactory` to construct only the selected adapter.

### Project bootstrap

Project bootstrap accepts one explicit directory, validates its canonical
location, and creates or returns one registered Project. It does not install a
provider integration.

Each Project has:

- a private SQLite identity for internal relations;
- an immutable public Project key for application requests;
- a replaceable canonical oversight root;
- an optional canonical Git repository root; and
- a project-local evidence sequence frontier.

Moving a Project can replace its paths without replacing its identity or
memory.

### Workspace resolution

`WorkspaceContextService` resolves an invocation working directory against the
most specific registered Project root. It returns an immutable
`WorkspaceContext` containing the registered Project, canonical working directory,
and optional Git context. Git context records the observed branch, HEAD commit,
and configured upstream reference with its locally available commit, or an
unavailable result. Git is not required. Resolution reads local Git state
without fetching. These values describe capture-time observation.

An unmanaged directory does not create a Project. Capture rejects unmanaged
work without persistence. Query can still use Personal and Practice Memory
from an unmanaged directory.

### Provider evidence capture

Each capture entrypoint establishes a trusted source identity. It asks
`CaptureAdapterFactory` for the adapter that owns that native input shape. The
entrypoint normalizes the complete ordered input array before it invokes the
shared capture service.

`EvidenceCaptureService` owns the provider-neutral capture operation:

1. Receive a trusted capture source and an ordered `CaptureResult` array.
2. Resolve each working directory to a registered Project.
3. Construct an `EvidenceItemDto` for each result.
4. Submit the complete DTO array to `EvidenceItemRepository`.
5. Return durable evidence identities and project-local sequence numbers.

Each valid supplied input produces one evidence row. Capture does not decide
whether the input deserves memory. A later curator makes that decision.

`EvidenceItemRepository` computes the SHA-256 integrity digest over each serialized source
content before opening the SQLite write transaction. It stores the digest with
the evidence. It persists the complete batch in
one transaction, allocates project-local evidence sequences, and enforces
idempotency. A failure writes no rows. Exact replay returns the existing rows.
Replay means repeated capture of the same native event and is scoped to its
resolved Project identity. A different Project gets independent evidence;
capture does not move or deduplicate evidence across Projects.
Within one replay identity, both the versioned source format and content bytes
must match. A difference in either fails the operation. Adapters serialize
deterministically: they sort object keys recursively and preserve array order,
all values, and exact string and byte content.
The formats are `json.v1` for deterministic UTF-8 JSON objects, `string.v1`
for UTF-8 JSON string literals, and `bytes.v1` for exact bytes. Adapters reject
unsupported values without silently discarding or converting them.

Capture failures use `ApplicationError`. A shared registry defines typed,
domain-qualified codes and safe messages. The local command prints only the
code and registry-generated message. Causes remain internal. Success returns
the durable receipt; capture failure produces no receipt. Command errors use
the `cli` domain. Output or cleanup failure after capture succeeds can make the
command exit unsuccessfully while evidence remains committed and its receipt
remains valid.

The capture route supplies trusted entry identity such as `codex.hook` or
`development.fixture`. A provider payload cannot claim or replace that
identity.

Capture is bounded and non-agentic. It never waits for memory curation.

### Capture adapters

`CaptureAdapterFactory` is the only capture-adapter selection and concrete
construction owner.
`EvidenceCaptureService` contains no provider or fixture branches.

`ICaptureAdapter` is the source-neutral parsing contract:

```ts
interface ICaptureAdapter {
  normalize(input: unknown): CaptureResult
}
```

Each capture source owns one adapter. The adapter validates native input, extracts
source facts, serializes the complete native value, and returns a `CaptureResult`. It
does not establish trusted route identity, resolve Projects, construct an
`EvidenceItemDto`, persist evidence, or assign memory meaning.

Source material carries the complete native value as adapter-serialized bytes
plus a format identifier. Shared persistence stores the bytes as a SQLite BLOB.

`CodexCaptureAdapter` is the first implementation. It supports Codex
`UserPromptSubmit` and `Stop` hook inputs. It uses their native event fields to
extract content and replay coordinates. It does not interpret those fields as
conversation roles or pair them into a synthetic conversation entity.

A later provider supplies its own adapter and factory construction branch without
changing `EvidenceCaptureService`, `EvidenceItemRepository`, or any memory
product.

### Development capture fixture

The repository-local development command lets the project develop and verify
memory behavior before global installation and automatic hook delivery exist.

With the local Project already seeded, run:

```sh
bun run cli.ts dev capture-fixture fixtures/development-capture.json
```

The command writes an ordered JSON receipt to stdout. Each entry contains
`evidenceId`, `projectSequence`, and `disposition` (`inserted` or `existing`).
Errors use stderr and a nonzero exit status. Repeating the unchanged fixture
returns the existing evidence. For a new event, change `fixtureReference` or
`itemIndex`; changing content under existing coordinates causes a replay conflict.
The example working directory targets the seeded local LLM Wiki Project.

The fixture:

1. Accepts one ordered array of controlled inputs.
2. Sends the exact fixture-native records through
   `DevelopmentCaptureAdapter`.
3. Produces the same `CaptureResult` contract as a provider adapter.
4. Submits the results through the real `EvidenceCaptureService` and
   `EvidenceItemRepository`.
5. Returns the same durable capture receipt as automatic input.

The fixture does not generate fake Codex JSON. It preserves truthful
fixture-native source material. It replaces provider delivery only. It does
not write SQLite directly, register a Project, or create memory. Stable fixture
replay coordinates make exact repeated input idempotent. The fixture needs no
retry workflow.

The fixture verifies the shared capture and memory pipeline. It does not verify
Codex parsing. `CodexCaptureAdapter` owns that separate provider contract.

### Captured-evidence ingestion

`EvidenceIngestionService` begins after capture has committed
`EvidenceItem` rows. It is not part of the capture transaction.

It owns the processing boundary for uncovered captured evidence:

1. Read one finite project-ordered evidence frontier from `evidence_items`.
2. Preserve the original evidence and existing Session Memory as curator
   input.
3. Invoke Session Memory curation through the provider-neutral agent-execution
   capability.
4. Validate the untrusted curator result.
5. Reconcile and publish Session Memory changes.
6. Persist destination-specific Project, Personal, and Practice candidate
   leads with references to the original evidence.
7. Advance the successful Session evidence frontier.

The service coordinates the flow. It does not define memory meaning. Session
Memory and each durable memory product own their own admission rules.

Session maintenance starts this work when enough uncovered evidence exists or
when the elapsed-time policy makes the work eligible. A maintenance attempt
uses a frozen evidence frontier. Later evidence remains available for the next
attempt. Failed or replaced attempts do not advance successful progress.

### Targeted durable-memory insertion

`EvidenceInsertionService` lets a human or agent propose already-qualified
evidence to one explicit durable memory product:

```text
memory propose <project | personal | practice>
```

The service:

1. Requires one selected Project, Personal, or Practice target.
2. Accepts an ordered batch from text, files, or explicit standard input.
3. Preserves each item exactly with integrity metadata.
4. Establishes source identity from trusted CLI, MCP, or function context.
5. Creates target-specific durable Inbox candidates.
6. Commits the complete candidate batch and its receipt atomically.
7. Returns after durable Inbox acceptance without waiting for curation.

The selected product curator can publish, revise, narrow, supersede, retract,
or reject the proposal. An accepted proposal is not yet canonical memory.

`EvidenceInsertionService` does not use capture adapters, write
`evidence_items`, enter Session Memory, or write canonical Markdown directly.

### Memory maintenance and curation

Memory maintenance is autonomous and eventually consistent. New evidence can
be newer than published memory. Query reports this freshness difference.

The maintenance order is:

1. Curate Session Memory from captured evidence.
2. Emit target-specific durable-memory candidates.
3. Let Project, Personal, and Practice Memory process their own Inboxes.
4. Reopen original evidence, relevant source state, and existing memory.
5. Validate the curator proposal before canonical publication.
6. Publish a new memory revision and refresh derived retrieval state.

Candidate leads are propositions, not evidence or authority. Each destination
product can reject a lead. Lower-frequency catch-up scans inspect relevant
captured evidence so a Session omission cannot permanently hide a durable
signal.

Provider agents can inspect allowed context and propose changes. They never
write canonical memory directly.

### Query

`QueryService` is the provider-neutral read interface across the four memory
products.

For a managed Project, all four products are applicable. For an unmanaged
directory, only Personal and Practice Memory are applicable.

`QueryService` sends the same question and applicable context to each product.
Each product owns:

- its retrieval method;
- lifecycle and applicability filters;
- freshness rules;
- product-local scoring and qualification threshold; and
- its result representation.

The service returns grouped, typed results. It does not compare scores between
products or use an agent to remove results. An optional later aggregator can
produce one grounded answer while retaining the unchanged core result.

Query is read-only. It never registers a Project or changes memory.

### Installation and integrations

Application installation and Project bootstrap are separate operations.

Installation publishes one stable command, initializes machine state, and
installs provider integrations. Codex hooks are installed once per machine.
They submit native activity from any working directory; Project resolution
admits only registered scopes.

Codex hook delivery is a best-effort transport signal. The installed capture
integration must provide visible failure handling, idempotent replay, and
missed-delivery recovery. A hook callback or spawned process is not proof that
evidence reached SQLite.

Future MCP tools call the same application operations through a versioned
client contract. MCP handlers do not construct CLI argument arrays or parse
human-formatted console output.

## Behavior Owner Catalog

| Owner | Kind | Responsibility |
| --- | --- | --- |
| `Application` | class | Composes one process-scoped application and exposes its operations |
| `WorkspaceContextService` | class | Resolves a working directory to registered Project context |
| `CaptureAdapterFactory` | class | Constructs the adapter for one trusted capture entry |
| `ICaptureAdapter` | interface | Defines provider-native normalization |
| `CodexCaptureAdapter` | class | Converts Codex-native input into `CaptureResult` |
| `DevelopmentCaptureAdapter` | class | Converts fixture-native input into `CaptureResult` |
| `EvidenceCaptureService` | class | Adds trusted Project context and constructs `EvidenceItemDto` batches |
| `EvidenceItemRepository` | class | Atomically and idempotently persists captured evidence batches |
| `EvidenceIngestionService` | class | Reads captured evidence and coordinates Session-first processing |
| Session Memory curator | product owner | Proposes Session changes and durable-memory candidate leads |
| `EvidenceInsertionService` | class | Submits qualified proposals to one durable-memory Inbox |
| `IDurableMemoryInbox` | interface | Accepts candidates for one selected durable memory product |
| Project Memory | product owner | Curates project-scoped knowledge and documentation |
| Personal Memory | product owner | Curates user preferences and cross-project guidance |
| Practice Memory | product owner | Curates reusable technology and technique guidance |
| `IAgentAdapter` | interface | Executes bounded curation work through a configured AI provider |
| `QueryService` | class | Federates read-only queries across applicable memory products |
| `SqliteRuntime` | class | Initializes the packaged SQLite driver and extensions |
| `SqliteDatabase` | class | Owns the process-scoped connection and write transactions |
| `SqliteSchema` | class | Registers models and applies ordered schema migrations |

## Core Data Entities

| Entity | Durable form | Role |
| --- | --- | --- |
| `Project` | SQLite row | Owns registered identity, roots, and evidence sequence |
| `WorkspaceContext` | immutable value | Describes one resolved Project invocation and optional Git snapshot |
| Native capture input | unknown input value | Remains provider-specific until the selected adapter validates it |
| `CaptureResult` | immutable value | Carries normalized source facts from any capture adapter |
| `EvidenceItemDto` | immutable value | Adds trusted source and resolved workspace context before persistence |
| `EvidenceItem` | `evidence_items` row | Preserves immutable captured evidence and provenance |
| Session Memory node | SQLite row | Preserves one independently reconcilable recent-work memory |
| Durable-memory candidate | product-owned SQLite Inbox row | Proposes work for one durable memory product |
| Markdown memory node | canonical Markdown document | Preserves one Project, Personal, or Practice memory |
| Maintenance policy | immutable SQLite revision | Defines count and elapsed-time eligibility |
| Maintenance request | SQLite row | Freezes one finite evidence frontier for processing |
| Maintenance attempt | leased SQLite row | Fences one execution attempt and its completion |
| Publication receipt | durable state | Links a canonical revision to evidence and agent execution |
| Semantic chunk | rebuildable SQLite index row | Supports lexical and vector retrieval |

## Memory Products

| Product | Answers | Scope | Canonical storage |
| --- | --- | --- | --- |
| Session Memory | What happened recently here and across this Project? | One Project with workspace and branch applicability | SQLite |
| Project Memory | How does this Project work, and why? | One Project and applicable source state | Markdown |
| Personal Memory | What does this user prefer? | User-wide with applicability and Project exceptions | Markdown |
| Practice Memory | How does this user apply a technology or technique? | Concrete subject, versions, modes, and constraints | Markdown |

Session Memory contains decisions, findings, progress, blockers, next actions,
and warnings against repeated work. It is recent continuity, not repository
truth.

Project Memory gives repository behavior and explicit Project decisions the
highest authority. Personal Memory keeps global defaults separate from
Project-specific constraints. Practice Memory records concrete use, versions,
examples, failures, and gotchas without treating use as proof of success.

## Canonical and Derived Storage

```text
CANONICAL
  Project registrations                         SQLite
  captured EvidenceItem rows                    SQLite
  Session Memory                                SQLite
  Project, Personal, and Practice Memory         Markdown
  Inbox, maintenance, and publication state     SQLite

DERIVED
  semantic sections and chunks                  SQLite
  FTS5 lexical indexes                          SQLite
  sqlite-vec vector indexes                     SQLite
  relationship indexes and query caches         SQLite
```

Canonical Markdown uses CommonMark, an admitted GitHub-Flavored Markdown
subset, flat YAML properties, and standard Markdown links. It is compatible
with Obsidian, but Obsidian is not a dependency or source of truth.

One Markdown document is one durable Project, Personal, or Practice memory
node. Headings and chunks are retrieval units, not independent canonical
memories. One Session Memory row is one durable Session node.

Derived indexes can lag canonical publication and can be rebuilt. Embedding
generations never mix vectors from different provider, model, dimension,
normalization, purpose, or chunking contracts.

## Authority and Safety Rules

- All external input starts as untrusted data and receives runtime validation.
- Capture source identity and entry route come from application composition, not
  payload claims.
- Explicit user statements are strong Personal Memory evidence.
- Repository state remains authoritative for current Project behavior.
- Observed implementation proves use, not success.
- One Project constraint does not automatically become a global preference.
- Conflicts narrow applicability or remain explicit contradictions.
- Corrections append proposals and preserve history. They do not silently
  rewrite evidence.
- Older maintenance cannot overwrite a newer canonical revision.
- Failed work leaves canonical memory unchanged and remains observable.
- Raw evidence remains durable until an explicit retention or forgetting
  policy permits removal.
- Removing one memory does not automatically remove evidence used by another
  memory.

## Runtime Shape

LLM Wiki is a TypeScript modular monolith running on Bun. It uses Sequelize
with SQLite for relational state, FTS5 for lexical retrieval, and `sqlite-vec`
for vector retrieval.

Capture adapters and agent-execution adapters are independent capabilities.
The application can capture through one provider and curate through another.

Each invocation creates one `Application`, opens one process-scoped
`SqliteDatabase`, composes the required services, performs the requested
operation, and closes the database. Separate processes coordinate through
SQLite transactions and constraints rather than shared TypeScript state.

## Design Authority

Continue detailed design in the
[current consolidated unit](docs/design/2026-09-03-shared-captured-activity-seam/README.md):

- [Feature Shape](docs/design/2026-09-03-shared-captured-activity-seam/feature-shape.md)
- [Open Design Issues](docs/design/2026-09-03-shared-captured-activity-seam/design-issues.md)
- [Current pseudocode](docs/design/2026-09-03-shared-captured-activity-seam/pseudocode/README.md)

This README remains the product overview. ROADMAP.md retains delivery order
and status. Existing code establishes implemented behavior; pseudocode does
not prove implementation. The current unit owns ongoing detailed design and
the single unresolved frontier. Other dated units are historical sources.
Their issue dispositions and surviving boundaries are recorded in the current
unit, rather than inferred from older overlapping pseudocode.
