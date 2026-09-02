# Our App — Product Pseudocode

> Pseudocode artifact. Non-executable reference shape.
>
> Ingestion supersession: The
> [Ingestion Boundaries design unit](../../2026-09-02-ingestion-boundaries/feature-shape.md)
> controls public project keys, targeted durable-memory insertion, and the
> development capture fixture. Conflicting identity and manual-insertion text
> below remains only as the initial design baseline.

This artifact defines what the product is, what each memory means, and what the
brain observably does. Technical boundaries live in
`architecture.pseudocode.md`; integrated macro owners live in the
[canonical application shape](../../feature-shape.md); active design work lives
in [Open Design Issues](../design-issues.md).

## Product thesis

```pseudocode
SYSTEM OurApp
  PURPOSE
    turn real work performed with any AI provider into:
      recent continuity
      maintained project understanding
      personal guidance
      reusable technology practices

  BEHAVIOR
    capture evidence continuously from projects our app oversees
    bootstrap explicit project directories as governed evidence scopes
    accept attributable evidence inserted directly by humans and agents
    maintain memory autonomously and eventually
    expose human-readable durable knowledge
    answer questions using the applicable parts of the whole brain

  MUST_NOT
    make one AI provider part of the memory model
    treat raw conversation or captured activity as durable truth
    require user approval during ordinary memory maintenance
    make the caller choose a storage layer before asking a question
    flatten competing contexts into one falsely confident answer
```

The brain is self-maintaining but not real-time. New evidence may be newer than
the currently published memory. That delay is expected and remains visible to
query through freshness and scope.

## Overseen projects

```pseudocode
RECORD OverseenProject
  project_identity       immutable SQLite-assigned integer identity
  root_path              replaceable canonical oversight scope
  repository_root_path? canonical Git repository root when Git exists

FUNCTION bootstrapProject(directory_path)
  validate and canonicalize the exact supplied directory
  within one application write transaction:
    IF that canonical root is already registered
      ask sessionMaintenance.lifecycle to require its Session maintenance state
      return the existing project

    prepare a new Project row
    inspect bounded repository facts without changing the governed directory
    persist the exact oversight root and optional repository root
    receive the immutable project identity assigned by SQLite
    ask sessionMaintenance.lifecycle to initialize state for that project
    return the registered project
```

Bootstrap defines which filesystem scope our app governs. It does not install,
select, or configure a provider capture mechanism. The supplied directory is a
replaceable project locator, not the durable project identity. Moving a project
can therefore replace its root path without replacing its memories.

The bootstrap transaction coordinates required product initialization without
putting Session Memory columns or a reverse Session relation on the Project
model. The bootstrap owner receives only the Session lifecycle capability.
Session Memory owns its maintenance state and references project identity only
because its Evidence Log frontier is project-scoped.

Machine-wide capture integrations may invoke our app for activity outside an
overseen root. Such activity is ignored and never enters the Evidence Log or
raw-payload storage.

## Provider independence

```pseudocode
CAPABILITY Capture
  receive a provider's native activity
  normalize it into provider-neutral evidence

CAPABILITY AgentExecution
  run a configured AI provider for bounded memory curation or optional
    query-result aggregation
  return an untrusted result for application validation

CAPABILITY BrainAccess
  expose query and manual evidence insertion to agents and humans
```

A provider integration implements only the capabilities its native product can
support. Codex initially supplies activity through Codex hooks and agentic work
through its CLI. Provider-specific payloads and command syntax stop at those
integration boundaries.

## Evidence is not memory

```pseudocode
RECORD EvidenceItem
  identity
  origin =
    capture
      source
      native_event_kind
      session_reference?
      interaction_reference?
    OR insertion
      source
      client_reference?
  content                  one normalized string
  workspace_context
  occurred_at?
  received_at
  source_material
    media_type
    exact_content
    sha256_digest

STORE EvidenceLog
  append EvidenceItems durably
  preserve provenance needed for later curation
  record what happened without claiming what should be remembered
```

`EvidenceItem` is the accepted product concept. Source workflows construct an
immutable provider-neutral `EvidenceCandidateDto` without durable identity or
acceptance time. Evidence acceptance admits new candidates, persists their
Evidence Log rows with acceptance metadata, receives their SQLite-assigned
identities, and then creates their `EvidenceItemDto` values. Neither DTO is the
SQLite row.

Origin records how evidence entered our app and which source coordinates apply.
It does not assign semantic meaning to content, authenticate a caller, grant
correction authority, or control replay suppression. Reliable replay identity
travels beside the DTO as acceptance metadata; evidence remains admissible when
a source cannot supply one.

Evidence acceptance does not create memory. A later Session Memory ingestion
workflow reads captured EvidenceItems from the Evidence Log.

Capture preserves raw provider activity as evidence before any agentic memory
interpretation. Deliberate durable-memory proposals use a separate target
product Inbox. They do not become captured EvidenceItems or pass through
Session Memory.

Source material preserves the exact content-bearing input before normalization.
Its digest proves stored-content integrity only. It does not identify evidence,
authenticate the source, or prove that the content is true.

Each Project, Personal, or Practice Memory Inbox is durable product-owned
candidate state. Its product owns later validation, reconciliation, admission,
rejection, and canonical publication.

```pseudocode
TYPE WorkspaceContext
  project_reference
  project_root
  working_directory
  repository?
    repository_location
    branch = active branch name | unavailable
```

Workspace context attributes evidence to one bootstrapped project and, for Git
projects, its active branch. Session Memory and query can therefore distinguish
branch-specific recent work from recent project-wide activity. Non-Git projects
remain valid and have project-wide scope. Provider-session identity remains a
separate evidence coordinate supplied by the provider adapter.

Version one matches only the bootstrapped project location and its descendants.
Linked Git worktree discovery and correlation are future product behavior.

## The four memory products

```pseudocode
MEMORY SessionMemory
  ANSWERS "What happened recently here and across this project?"
  SCOPE one project with current-workspace applicability
  CONTENT decisions, findings, progress, blockers, next actions,
          and warnings against repeating completed work
  AUTHORITY curated continuity derived from evidence; not project truth
  CANONICAL_CONTENT SQLite records
  DURABLE_UNIT one SQLite record is one independently reconcilable memory node

MEMORY ProjectMemory
  ANSWERS "How does this project work and why is it shaped this way?"
  SCOPE exactly one project plus applicable source state
  CONTENT evolving human-readable project documentation
  AUTHORITY repository behavior, explicit project decisions,
            and preserved source evidence
  CANONICAL_CONTENT durable Markdown

MEMORY PersonalMemory
  ANSWERS "What does this user prefer, and how should an agent work with them?"
  SCOPE global by default with applicability and project exceptions
  CONTENT cross-cutting defaults, choices, writing styles,
          architectural preferences, and collaboration preferences
  AUTHORITY explicit guidance, corrections, and evidence-backed recurring behavior
  CANONICAL_CONTENT durable Markdown

MEMORY PracticeMemory
  ANSWERS "How does this user employ a concrete technology or technique?"
  SCOPE a concrete subject across projects with versions and constraints
  CONTENT preferred versions and modes, reusable implementation guidance,
          examples, variants, failures, and gotchas
  AUTHORITY explicit guidance and observed concrete use
  CANONICAL_CONTENT durable Markdown
```

The root Memory domain is a federation of these four products. They share an
interoperability contract, not one behavioral interface or generic memory
payload.

```pseudocode
MEMORY INTEROPERABILITY CONTRACT
  every product exposes its product identity
  every durable node exposes a stable canonical identity and exact reference
  every product makes provenance, freshness, lifecycle visibility,
    and relationships available across the Memory boundary
  the contract remains tagged by product

PRODUCT-OWNED BEHAVIOR
  content and authority
  scope and applicability
  canonical representation
  query retrieval, scoring, qualification threshold, and result shape
  admission and reconciliation
  lifecycle transitions
  maintenance policy and operations
```

The interoperability contract gives consumers a safe common exchange shape.
It does not require every product to implement shared `save`, `update`,
`search`, or `maintain` behavior. Each product accepts a question through its
own query capability and owns its retrieval method, product-local score,
qualification threshold, filters, and output representation. Qualified
references are product outputs rather than inputs to a root hydration service.

One Session Memory record and one Project, Personal, or Practice Markdown file
each represent one durable memory node. Headings, semantic sections, and search
chunks are derived retrieval units rather than independently reconcilable
claims. If part of a node needs its own lifecycle, contradiction relationship,
or reconciliation, curation publishes it as another memory node.

## Personal and Practice are connected

```pseudocode
NODE PersonalMemory."Frontend defaults"
  prefers Tailwind
  prefers shadcn/ui
  prefers small components

NODE PracticeMemory.Vue
  current_version = Vue 3
  project_bootstrap = Vite
  component_style = Composition API

NODE PracticeMemory.Tailwind
  describes how Tailwind is configured and used

NODE PracticeMemory."shadcn/ui"
  describes how shadcn/ui components are introduced, adapted, and maintained

RELATE PersonalMemory."Frontend defaults" -> PracticeMemory.Tailwind
RELATE PersonalMemory."Frontend defaults" -> PracticeMemory."shadcn/ui"
RELATE ProjectMemory.SomeProject -> memories it applies, overrides,
                                   contradicts, or supports
```

Personal Memory owns cross-cutting defaults and choices even when a choice names
a concrete tool. Practice Memory owns how a specific subject is used, including
the preferred version or mode within that subject.

## Eventually consistent self-maintenance

```pseudocode
Evidence accumulates for a project
  -> every acceptance operation belongs to exactly one project
  -> new evidence receives a project-local sequence in the Evidence Log
  -> evidence acceptance and Session maintenance eligibility commit atomically
  -> the first accepted evidence after an elapsed-time condition performs the
     next eligibility evaluation
  -> evidence-count, elapsed-time, or immediate insertion creates or promotes
     one pending Session maintenance request
  -> pending Session requests may coalesce; a running request keeps a frozen frontier
  -> one leased Session maintenance attempt executes the request asynchronously
  -> a failed or expired attempt is replaced without returning the frozen
     request to pending
  -> only successful current attempts advance the covered frontier
  -> Session Memory is curated first
  -> Session curation emits destination-specific candidate leads
  -> candidate leads update the destination memory's durable eligibility
  -> Project, Personal, and Practice curators independently inspect the
     original evidence, source state, and existing memory
  -> each destination curator admits, reconciles, or rejects its proposition
  -> canonical memory is published without user confirmation
  -> evidence beyond the frozen frontier remains for the next maintenance run
```

This loop is Session Memory's maintenance contract. Its effective
`maintenance.session` configuration becomes immutable
`SessionMaintenancePolicy` revisions. `SessionMaintenanceState`,
`SessionMaintenanceRequest`, and `SessionMaintenanceAttempt` own successful
progress, finite work, and execution history respectively. Higher memory
products define separate maintenance policy and state contracts.

The composed `SessionMaintenance` domain façade exposes the current lifecycle
and schedule capabilities. Policy synchronization is internal to scheduling and
shares the evidence-acceptance transaction. Each workflow receives only the
public capability it needs. Execution does not enter the façade until attempt
claim, replacement, publication, and fenced completion have a complete design.

Session Memory publishes first because it is the most recent and alive
representation of work. It maintains immediate continuity and discovers leads
that may deserve slower, more durable treatment. It is not the evidentiary
authority for the other memory products.

One signal may create candidate leads for several products. Each lead expresses
a proposition in its destination's language and retains references to the
original evidence. A destination curator treats the lead as a reason to
investigate, not as evidence or authority. Shared provenance does not make the
resulting memories duplicates.

Project, Personal, and Practice maintenance normally begins from candidate
leads. A lower-frequency catch-up scan compares each destination's processed
evidence frontier with the Evidence Log so that a Session omission cannot hide
a durable signal forever.

```pseudocode
Candidate lead dispositions
  investigated and produced a published memory revision
  investigated and reconciled with existing memory
  rejected as unsupported
  superseded by newer work
  retryable after provider or environment failure
```

A candidate is autonomous internal work, not a review request.

## Autonomous authority

```pseudocode
RULES MemoryAuthority
  explicit user statements are strong evidence of Personal preferences
  user corrections enter the appropriate memory product's reconciliation rules
  repository state remains authoritative for what a project currently does
  observed implementation proves concrete use, not automatic success
  project-local constraints do not automatically become global preferences
  copied or causally related implementations do not become independent evidence
  conflicts narrow applicability or remain explicit contradictions
  unsupported inference is rejected automatically
  new evidence may revise, supersede, retract, or restore memory automatically
```

When a project undergoes a broad overhaul, Session curation may create a Project
Memory revalidation candidate. The Project curator inspects the new source state
and determines which documentation remains applicable; the candidate does not
void the documentation by itself.

## Querying the brain

The Query Layer is the ordinary read interface across all four memories.

```pseudocode
FUNCTION query(question, current_context)
  resolve the project, workspace context, user, and involved technologies

  IF the working directory is invalid, missing, or inaccessible
    fail the query safely

  IF the working directory belongs to an overseen project
    make Session, Project, Personal, and Practice Memory applicable
  ELSE
    make Personal and Practice Memory applicable
    mark Session and Project Memory not applicable

  ask each applicable memory product to query the same question independently

  EACH product owns:
    its lexical, semantic, vector, or other retrieval method
    its index and canonical source access
    its product-local scoring and qualification threshold
    its lifecycle, freshness, and applicability filters
    its product-specific result representation

  return every qualified product result without agentic curation:
    Session Memory records or parsed text
    separately grouped Project, Personal, and Practice Markdown references
    product-local relevance and freshness
    per-product outcomes
```

Query may combine current-work Session Memory, recent project-wide activity,
Project documentation, Personal defaults, and relevant Practices. The caller
asks a question rather than selecting a physical store.

SQLite supports semantic traversal over the durable Markdown artifacts. It is
derived retrieval state for Project, Personal, and Practice Memory and never
replaces their canonical content.

The core query operation is deterministic and non-agentic. An optional later
aggregator may use `AgentExecution` to curate one response from the complete
`QueryResult`. That response retains the core Session results and documentation
references beside it. A human or another agent may instead consume the core
results directly. The aggregator is not required by `query` and its exact
owner remains `OPEN`.

An unmanaged directory remains a valid Personal and Practice query scope. It
does not cause implicit project registration. The caller may offer the separate
project-bootstrap operation, which still requires an explicit exact oversight
root.

## Targeted memory proposals and correction

```pseudocode
FUNCTION proposeMemory(invocation_context, request)
  establish CLI, MCP, or function source from invocation context
  require request.target to be Project, Personal, or Practice Memory
  validate one ordered batch of exact proposal-content strings
  require client reference for MCP and keep it optional for direct CLI use
  resolve request.project_key to one registered project context
  reject an unknown key; never silently ignore an explicit proposal

  FOR EACH content item in supplied order
    preserve the exact string as text/plain source material
    construct one target-specific Inbox candidate

  atomically commit the replay record, complete candidate batch, and receipt
  return accepted or replayed after durable Inbox acceptance
  do not wait for product curation

PRODUCT CURATION
  evaluate the proposal against product-specific evidence and authority rules
  IF the proposal corrects an existing memory or answer
    revise, narrow, supersede, or retract the affected memory
  refresh semantic retrieval state
```

A targeted proposal lets a human or agent state content that one explicit
durable memory product should consider. Acceptance does not directly mutate or
fence canonical memory. The selected product curator decides whether the
proposal publishes, revises, narrows, supersedes, retracts, or rejects memory.

Session Memory is not a valid proposal target or intermediate destination.
Captured evidence remains its only input path.
