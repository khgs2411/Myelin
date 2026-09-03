# LLM Wiki Roadmap

This roadmap is the canonical workload sequence for delivering an autonomous,
evidence-based memory system that gives AI agents accurate, relevant, and
traceable continuity across work sessions without manual memory maintenance.

## Status Guide

- `next`: active work; multiple items may be active in parallel.
- `open`: known future work.
- `done`: completed goal slice.
- `retired`: closed because it left active direction.

## Always-On Guardrails

- The product must prove one complete continuity journey: work occurs, useful
  evidence is captured and accepted, memory is maintained, and a later agent
  receives relevant context that helps it continue the work correctly.
- Accepted evidence and its provenance remain authoritative. Derived memory
  must preserve material scope, conflicts, uncertainty, and source lineage.
- Memory maintenance must operate without requiring routine user decisions.
- Session Memory behavior must be proven with controlled development capture
  fixtures before automated provider capture enters the product.
- Before that proof, development uses the existing LLM Wiki Project
  registration and a repository-local Bun CLI. It can match invocation paths
  within that registered root and observe its active branch. General project
  registration, bootstrap, unregistered-project discovery, linked-worktree
  correlation, package `bin` publication, and host installation begin only
  after the fixture-driven Session Memory journey succeeds.
- Deliberate memory insertion must explicitly select Project, Personal, or
  Practice Memory. It must not bypass product-owned curation or enter Session
  Memory.
- Session Memory, Project Memory, Personal Memory, and Practice Memory remain
  distinct products. Each product owns its maintenance, applicability,
  retrieval, and result semantics.
- Federated query preserves each product's qualified results. Optional AI
  aggregation may supplement those results, but it must not replace them.
- The new application does not inherit behavior or boundaries from the
  deprecated product unless the user explicitly reintroduces them.

## Roadmap Step 1: Establish the Product Foundation

Goal: Establish a coherent product architecture and an executable runtime that
can carry the complete memory journey.

- [x] `done` Establish the product and architecture direction
  - Description: Define the application boundary, evidence flow, memory-product
    responsibilities, maintenance model, query model, and provider separation
    for the new product.
  - Progress: The current design artifacts establish the macro application and
    memory-system shape while keeping unresolved product details open.

- [x] `done` Establish the executable runtime foundation
  - Description: Provide the application-owned Bun and SQLite lifecycle needed
    by later persistence, maintenance, and retrieval outcomes.
  - Shape: Sequelize owns ordinary relational access and transactions. SQLite
    retains its FTS5 and vector-search capabilities. The application owns one
    process-scoped database lifecycle without a global singleton.
  - Progress: The application runtime, database initialization, capability
    validation, transaction boundary, and cleanup lifecycle are established.

## Roadmap Step 2: Establish Local Captured-Evidence Intake

Goal: Feed controlled evidence from this repository into the Session pipeline
without first building general project discovery or installation behavior.

- [x] `done` Establish the repository-local CLI shell
  - Description: Give this repository one minimal Bun-run entrypoint that owns
    help, command dispatch, safe diagnostics, and the Application lifecycle
    boundary used by later operations.
  - Progress: The shell is available without operational commands. Each later
    roadmap outcome adds only the command required by its Application operation.

- [x] `done` [Establish local Project seed state](docs/design/2026-09-03-local-project-seed/feature-shape.md)
  - Description: Establish this repository in the permanent multi-project
    SQLite model through one reproducible development-only seed operation.
  - Shape: General registration, bootstrap, discovery, and relocation remain
    outside the local seed boundary.
  - Progress: The local database now contains the durable `llm-wiki` Project
    registration, and repeated seeding preserves that identity.

- [x] `done` [Establish the fixed local project context](docs/design/2026-09-03-fixed-local-project-context/feature-shape.md)
  - Description: Resolve each Application-backed local CLI operation from its
    working directory to the existing LLM Wiki Project registration and
    construct its immutable project, repository, and branch context.
  - Why: Registered-project resolution gives later evidence one deterministic
    scope without introducing automatic project bootstrap.
  - Shape: An unregistered directory fails without creating a Project.
  - Progress: Application composition now resolves descendant directories to
    immutable Project context, observes the active registered-repository
    branch, rejects unmanaged directories, and closes its database lifecycle.

- [ ] `next` Deliver durable evidence acceptance
  - Description: Accept normalized evidence with provenance, idempotency, and a
    durable receipt while coordinating all required state changes atomically.
  - Shape: Evidence acceptance owns the outer write transaction and preserves
    source facts without turning provider payloads into application authority.

- [ ] `open` Deliver the development capture fixture
  - Description: Give development work one canonical internal tool for feeding
    an exact transcript file into the captured-evidence and Session Memory path.
  - Why: Controlled fixtures make Session behavior diagnosable before raw hook
    payloads and provider lifecycle volume enter the product.
  - Shape: The tool uses development provenance and the shared captured-evidence
    path. It is not distributed as a production command and does not claim to
    prove provider-hook compatibility.

## Roadmap Step 3: Deliver Maintained Session Memory

Goal: Turn captured project evidence into reliable recent-work continuity that
the system maintains autonomously.

- [ ] `open` Establish the Session Memory lifecycle
  - Description: Give the fixed local project a coherent Session Memory state
    that tracks its accepted-evidence frontier and maintenance lifecycle.

- [ ] `open` Deliver autonomous Session Memory evolution
  - Description: Detect when Session Memory requires maintenance, process the
    relevant accepted evidence, and advance its canonical state without routine
    user intervention.
  - Shape: Session Memory remains a database-backed recent-work product. Its
    behavior does not establish a shared implementation for durable memories.

## Roadmap Step 4: Retrieve Session Continuity

Goal: Let a later agent ask a real question and receive qualified Session
Memory context for the fixed local project.

- [ ] `open` Deliver Session Memory query
  - Description: Search and rank recent-work memory using Session-specific
    freshness and relevance rules while preserving provenance, uncertainty,
    contradictions, and degraded outcomes.

## Roadmap Step 5: Prove Session Memory Through Capture Fixtures

Goal: Prove the complete Session Memory behavior with controlled development
capture fixtures before provider automation introduces raw activity and volume.

- [ ] `open` Complete the fixture-driven Session Memory journey
  - Description: Submit a controlled LLM Wiki conversation fixture, maintain
    Session Memory, and retrieve useful context during a later application
    invocation.
  - Why: Controlled capture input keeps Session Memory behavior deterministic
    while its maintenance and retrieval boundaries are completed.
  - Shape: The captured evidence remains authoritative input. Session Memory
    owns how that evidence becomes recent-work continuity.

## Roadmap Step 6: Generalize and Install the Proven Session Prototype

Goal: Replace fixed local assumptions with reusable project context and promote
the proven prototype into the first stable host-installed command.

- [ ] `open` Establish reusable project and workspace identity
  - Description: Introduce explicit project registration, public project keys,
    project bootstrap, current-working-directory resolution, and Git repository
    and branch observation for projects beyond this repository.
  - Why: General discovery behavior follows the local memory proof so it cannot
    delay or obscure Session Memory development.

- [ ] `open` Deliver the first host-installed command
  - Description: Refine the proven local operations into an installable command,
    establish its stable distribution contract, and install the first prototype
    on the development host.
  - Why: Installation begins only after Session Memory behavior is useful enough
    to justify host-level integration and upgrade churn.
  - Shape: The installed command reuses the proven `Application` operations and
    persistence contracts. Distribution does not duplicate product workflows.

## Roadmap Step 7: Capture Real Agent Work Automatically

Goal: Add automatic provider capture as a thin ingress layer over the proven
evidence-acceptance and Session Memory behavior.

- [ ] `open` Deliver automatic evidence capture from one provider
  - Description: Observe one real provider workflow, translate useful activity
    through the provider boundary, and submit it to the existing evidence
    intake path without interrupting normal agent work.
  - Why: Session Memory is proven first with controlled capture fixtures so raw
    provider conversations do not obscure memory-behavior defects.
  - Shape: Automated capture does not create a second acceptance or maintenance
    path. Additional providers remain outside this outcome until the first
    integration is proven.

## Roadmap Step 8: Complete the First Agent Continuity Journey

Goal: Make the installed Session Memory loop usable as part of normal agent
work through a later-session query.

- [ ] `open` Deliver the supported agent-memory workflow
  - Description: Give a user one coherent way to configure, bootstrap, capture,
    maintain, query, and remove the installed application within a supported
    agent environment.

- [ ] `open` Complete one cross-session continuity journey
  - Description: Prove that one agent can work normally and that a later agent
    can retrieve useful, traceable context and continue that work without the
    user manually maintaining memory.

## Roadmap Step 9: Deliver Project Memory End to End

Goal: Maintain and retrieve durable repository-scoped knowledge that remains
useful beyond recent Session Memory.

- [ ] `open` Deliver the Project Memory product
  - Description: Derive, publish, maintain, and retrieve durable project
    knowledge from repository behavior, explicit decisions, and accepted
    evidence.
  - Shape: Project Memory owns its document model, admission rules,
    applicability, maintenance lifecycle, retrieval method, and result type.

## Roadmap Step 10: Deliver Personal Memory End to End

Goal: Maintain and retrieve user-owned context that applies across projects
without overriding project-specific facts or exceptions.

- [ ] `open` Deliver the Personal Memory product
  - Description: Derive, publish, maintain, and retrieve durable user defaults,
    preferences, and cross-project context with explicit applicability and
    exception boundaries.
  - Shape: Personal Memory owns its identity scope, admission rules,
    maintenance lifecycle, retrieval method, and result type.

## Roadmap Step 11: Deliver Practice Memory End to End

Goal: Maintain and retrieve reusable technical practices without converting
one local success into unsupported general guidance.

- [ ] `open` Deliver the Practice Memory product
  - Description: Derive, publish, maintain, and retrieve evidence-supported
    guidance for concrete technologies and techniques across applicable work.
  - Shape: Practice Memory owns its generalization rules, version and context
    applicability, maintenance lifecycle, retrieval method, and result type.

## Roadmap Step 12: Deliver Targeted Manual Memory Insertion

Goal: Let humans and agents deliberately propose durable memory to one explicit
memory product without routing it through Session Memory.

- [ ] `open` Deliver the shared targeted insertion experience
  - Description: Accept ordered content for one explicit Project, Personal, or
    Practice Memory target and return a durable target-Inbox receipt.
  - Why: Each durable product must exist before one interface can route
    proposals without inventing unsupported product behavior.
  - Shape: The CLI activates one proposal family with an explicit Project,
    Personal, or Practice target and exact ordered content inputs. CLI, MCP, and
    function adapters reuse one application contract, establish trusted source
    provenance, and require the selected memory product to curate the proposal
    before canonical publication.

## Roadmap Step 13: Complete the Federated Memory Experience

Goal: Give an agent one coherent query experience across all available memory
products without flattening their different meanings or authority.

- [ ] `open` Deliver federated memory query
  - Description: Send the question to each applicable memory product and return
    its qualified results in one traceable response that preserves product
    identity, canonical references, and product-specific ranking.
  - Shape: Products do not compare private scores across boundaries. Any later
    synthesized answer remains downstream from the complete grouped results.

## Roadmap Step 14: Prove Autonomous Reliability

Goal: Establish that the complete memory system remains useful, explainable,
and recoverable during sustained real work.

- [ ] `open` Prove sustained autonomous continuity
  - Description: Use the complete system across real projects and repeated
    agent sessions until capture, maintenance, retrieval, correction, and
    memory evolution form one dependable product loop.

- [ ] `open` Deliver a stable and recoverable product
  - Description: Make installation, upgrades, operational visibility, failure
    recovery, and safe data continuity coherent enough for routine use without
    developer supervision.
