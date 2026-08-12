# Our App — Product Pseudocode

> Pseudocode artifact. Non-executable reference shape.

This artifact defines what the product is, what each memory means, and what the
brain observably does. Technical boundaries live in
`architecture.pseudocode.md`; predicted implementation owners live in
`feature-shape.md`; active design work lives in `design-issues.md`.

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
    capture evidence continuously
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

## Provider independence

```pseudocode
CAPABILITY Capture
  receive a provider's native activity
  normalize it into provider-neutral evidence

CAPABILITY AgentExecution
  run a configured AI provider for bounded curation or query work
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
RECORD Observation
  provider_identity
  provider_event_reference
  provider_session_reference?
  provider_turn_reference?
  native_event_kind
  project_reference
  workspace_context
  captured_at
  provider_occurred_at?
  kind
  payload_reference

STORE EvidenceLog
  append observations durably
  preserve provenance needed for later curation
  record what happened without claiming what should be remembered
```

```pseudocode
TYPE WorkspaceContext
  project_reference
  repository_reference
  repository_location
  checkout_reference?
  worktree_reference?
  branch_reference?
```

Workspace context is composite. Its coordinates allow Session Memory and query to
separate current work from other concurrent activity without treating a branch
name or worktree path as universal identity by itself. Provider-session identity
remains a separate evidence coordinate supplied by the provider adapter.

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

The four products do not share one generic memory payload. They share only the
metadata needed to preserve scope, provenance, freshness, lifecycle, and
relationships.

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
  -> every accepted evidence append updates durable maintenance eligibility
  -> the first accepted evidence after an elapsed-time condition performs the
     next eligibility evaluation
  -> an evidence-count or elapsed-time trigger starts maintenance asynchronously
  -> maintenance freezes an evidence frontier
  -> Session Memory is curated first
  -> Session curation emits destination-specific candidate leads
  -> candidate leads update the destination memory's durable eligibility
  -> Project, Personal, and Practice curators independently inspect the
     original evidence, source state, and existing memory
  -> each destination curator admits, reconciles, or rejects its proposition
  -> canonical memory is published without user confirmation
  -> evidence beyond the frozen frontier remains for the next maintenance run
```

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
  semantically retrieve candidates from SQLite
  hydrate canonical Session records and Markdown artifacts
  exclude inactive or inapplicable memory
  preserve freshness, provenance, and competing scopes

  IF applicable memories conflict
    return an answer that exposes the competing contexts
  ELSE
    return an answer synthesized from compatible memory

  include supporting memory references and freshness in the result
```

Query may combine current-work Session Memory, recent project-wide activity,
Project documentation, Personal defaults, and relevant Practices. The caller
asks a question rather than selecting a physical store.

SQLite supports semantic traversal over the durable Markdown artifacts. It is
derived retrieval state for Project, Personal, and Practice Memory and never
replaces their canonical content.

## Manual evidence insertion and correction

```pseudocode
FUNCTION insertEvidence(statement, context, claimed_attribution?, correction_target?)
  establish the principal and origin from trusted invocation context
  preserve caller-supplied attribution as a claim, not authorization
  validate the evidence and applicable context
  append it to the Evidence Log without treating it as memory
  freeze a maintenance frontier that includes the inserted evidence

  IF correction_target exists AND principal may correct that target
    fence the target from ordinary serving and future publication immediately

  request priority maintenance through the frozen frontier
  coalesce eligible queued work into the active or next run
  return a maintenance receipt after durable acceptance and durable scheduling

OPTION wait_for_maintenance(receipt)
  wait until the inserted evidence reaches a terminal maintenance outcome
  return the outcome without requiring user confirmation

BACKGROUND
  publish Session Memory first
  emit destination-specific candidate leads with original evidence references
  evolve applicable memory and project documentation from independently
    verified evidence
  IF the evidence corrects an existing memory or answer
    revise, narrow, supersede, or retract the affected memory
  refresh semantic retrieval state
```

Manual insertion captures work that an automatic provider source may not have
observed or that a human or agent wants to make explicit. Correction is one
intent carried by inserted evidence; it does not directly mutate canonical
memory or require the user to participate in the maintenance workflow. An
authorized correction target is fenced immediately so the brain does not keep
serving information it already knows is disputed while reconciliation runs.
