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
- A development capture fixture supplies controlled `UserPromptSubmit` and
  `Stop` payloads through the same Codex adapter and shared captured-evidence
  path as later automatic capture. It does not write Session Memory directly.
  Session maintenance derives Session Memory from accepted evidence.
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

Goal: Make one controlled local completed turn become two inspectable, accepted
Evidence Log items through the provider-neutral path that later automatic
capture will reuse.

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

- [x] `done` [Verify the Codex automatic-capture input contract](docs/design/2026-09-03-codex-automatic-capture-input-contract/feature-shape.md)
  - Description: Research the current Codex hook activities and payload fields
    that can supply useful Session evidence, including event granularity,
    source material, workspace location, source time, and reliable replay
    coordinates.
  - Why: The development fixture must simulate the real future capture input
    without first installing hooks or inventing incompatible source facts.
  - Shape: This unit establishes provider evidence for the later shared seam.
    It does not install hooks or implement a Codex adapter.
  - Progress: The local Codex contract establishes one root
    `UserPromptSubmit` input and one root `Stop` input as the two native shapes
    the development fixture must model for one controlled turn.

- [ ] `next` [Establish the shared captured-activity seam](docs/design/2026-09-03-shared-captured-activity-seam/feature-shape.md)
  - Description: Define the provider-neutral normalized capture observation
    produced by the Codex adapter for both automatic and controlled hook input.
  - Why: The fixture must replace installation and automatic invocation without
    bypassing Codex parsing or creating a second downstream evidence contract.
  - Shape: Automatic capture and the development fixture supply the same Codex
    hook payload shapes to one adapter. The adapter emits the shared captured-
    activity observation.
  - Progress: The shared observation now preserves product meaning, native
    coordinates, replay input, exact source, and working directory. Both entry
    routes use the same Codex adapter while retaining truthful route identity.

- [ ] `open` Establish the provider-neutral evidence value contracts
  - Description: Define the immutable candidate supplied to acceptance and the
    accepted evidence item produced after persistence, including provenance,
    project context, exact source material, source time, acceptance time, and
    durable identity boundaries.
  - Shape: `EvidenceCandidateDto` contains no SQLite identity or acceptance
    result. `EvidenceItemDto` represents accepted evidence without becoming an
    ORM model.

- [ ] `open` [Deliver durable Evidence Log acceptance](docs/design/2026-09-03-durable-evidence-acceptance/feature-shape.md)
  - Description: Validate one project-bound acceptance command and commit new
    evidence to an immutable, project-ordered SQLite Evidence Log with replay
    protection and a recoverable receipt.
  - Shape: Acceptance owns the outer write transaction, ordering, replay
    classification, and durable receipt. It does not construct capture
    candidates or create Session Memory.

- [ ] `open` Deliver shared captured-evidence ingestion
  - Description: Convert one trusted normalized capture observation and its
    resolved local `WorkspaceContext` into the provider-neutral candidate sent
    through durable Evidence Log acceptance.
  - Why: The development fixture and later provider adapters must use one
    candidate-construction and acceptance path.
  - Shape: Shared ingestion owns capture provenance, exact source material,
    candidate construction, and the acceptance call. It does not parse native
    provider payloads or resolve Projects.

- [ ] `open` Deliver the local development capture fixture command
  - Description: Add one repository-local `dev capture-fixture` command that
    reads one controlled completed-turn fixture, sends its ordered
    `UserPromptSubmit` and `Stop` payloads through the Codex adapter and shared
    ingestion, and reports both durable evidence identities and project
    sequences for SQLite inspection.
  - Why: This command lets LLM Wiki exercise captured-evidence intake without
    global installation or automatic provider hooks.
  - Shape: The command uses the existing seeded Project and resolved local
    workspace context. Its trusted route identity is `development.fixture`. It
    does not write the Evidence Log directly or create Session Memory.

## Roadmap Step 3: Create Session Memory From Accepted Evidence

Goal: Consume accepted project evidence through Session-owned services and
produce visible, traceable SQLite Session Memory entries.

- [ ] `open` Establish the Session Memory entry contract
  - Description: Define the independently reconcilable Session Memory entry,
    including its recent-work meaning, project and workspace applicability,
    lifecycle, evidence lineage, uncertainty, and durable identity.
  - Shape: The entry is canonical Session Memory in SQLite. It is not captured
    evidence, a transcript summary, or a durable-memory Markdown document.

- [ ] `open` Deliver durable Session Memory entry storage
  - Description: Persist the established Session Memory entry contract through
    a Session-owned SQLite model and access boundary without exposing mutable
    ORM state to curation or query services.

- [ ] `open` Establish Session evidence consumption and progress
  - Description: Define how Session maintenance reads accepted evidence in
    project order, selects one finite evaluation frontier, records pending
    work, and advances successful progress without losing later evidence.
  - Shape: Evidence remains authoritative and immutable. Session-owned progress
    does not move into the Project or Evidence Log models.

- [ ] `open` Establish the Session curator contract
  - Description: Define the evidence and existing-memory input supplied for one
    Session curation pass and the structured, untrusted proposal returned by an
    agent for application validation.
  - Shape: The curator interprets recent work but cannot write SQLite or assign
    durable memory identity.

- [ ] `open` Deliver local agent execution for Session curation
  - Description: Run the Session curator through the provider-neutral agent
    execution boundary in the local development environment and return its
    untrusted structured result for application validation.
  - Shape: Agent execution is independent from evidence capture. It does not
    require Codex hook installation.

- [ ] `open` Deliver Session Memory reconciliation and publication
  - Description: Validate one curator proposal against its evidence frontier
    and current Session Memory, then atomically create, revise, supersede, or
    retain Session entries and advance successful Session progress.

- [ ] `open` Connect the development fixture to Session curation
  - Description: Extend the local fixture workflow so accepted evidence enters
    the real Session consumption and curation path and the command reports the
    resulting SQLite Session Memory entry without writing it directly.
  - Why: This completes the first local fixture-to-memory journey before
    autonomous scheduling exists.

- [ ] `open` Deliver autonomous Session Memory activation
  - Description: Detect durable pending Session work and invoke the same
    consumption, curation, and publication path without requiring the
    development fixture command or routine user action.

## Roadmap Step 4: Retrieve Local Session Continuity

Goal: Let a later agent ask a real question and receive qualified Session
Memory context for the fixed local project.

- [ ] `open` Establish the Session Memory query contract
  - Description: Define the local question and project-context input, qualified
    Session result shape, bounded result behavior, and explicit no-result,
    unavailable, and degraded outcomes.

- [ ] `open` Establish the retrievable Session Memory projection
  - Description: Define which entry content, scope, lifecycle, evidence lineage,
    and freshness facts become searchable or returnable without replacing the
    canonical SQLite Session entry.

- [ ] `open` Establish Session retrieval and qualification policy
  - Description: Select the Session-owned retrieval signals, applicability and
    lifecycle filters, freshness treatment, ranking behavior, and qualification
    threshold used to answer one question.
  - Shape: Scores and thresholds belong to Session Memory and do not become a
    cross-product confidence scale.

- [ ] `open` Deliver the Session Memory query capability
  - Description: Search the fixed local project's Session Memory, apply the
    established qualification policy, and return traceable qualified results
    with provenance, uncertainty, contradictions, and freshness.

- [ ] `open` Deliver the local Session query command
  - Description: Add one repository-local command that accepts a question,
    delegates to the Session query capability, and presents its typed results
    and product outcome without exposing persistence or ranking internals.

## Roadmap Step 5: Prove the Local Dogfood Journey

Goal: Prove that LLM Wiki can preserve and later retrieve useful continuity
about its own development before installation or automatic capture exists.

- [ ] `open` Establish the controlled LLM Wiki dogfood scenario
  - Description: Define a repeatable set of LLM Wiki development transcripts
    and later questions that exercise recent decisions, progress, blockers,
    next actions, and evidence attribution without provider-hook variability.

- [ ] `open` Prove fixture replay and incremental Session evolution
  - Description: Use repeated and later controlled capture fixtures to show
    that exact replay does not duplicate accepted work and that new evidence can
    evolve Session Memory without losing prior lineage or later pending work.

- [ ] `open` Prove inspectable evidence-to-memory lineage
  - Description: Make one captured transcript, its accepted Evidence Log item,
    the resulting Session Memory entry, and the entry's evidence references
    traceable through the local SQLite state.

- [ ] `open` Complete the local cross-invocation continuity journey
  - Description: Capture and curate LLM Wiki development work in one local
    invocation, then retrieve useful Session context in a later invocation and
    use it to continue the work correctly.
  - Why: This proves the local Session prototype before project generalization,
    installation, and automatic provider capture add operational complexity.

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
  - Installation relation: This outcome installs and configures the Codex
    capture integration after the reusable host command exists.
  - Reliability hint: Codex lifecycle hooks and `notify` are best-effort
    signals. This unit must design missed-delivery recovery, idempotent replay,
    and visible failure handling. It must not treat callback invocation or
    process spawn as proof that evidence reached SQLite.

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
