# LLM Wiki — Open Design Issues

Established design: [Feature Shape](feature-shape.md). Navigation and migration assessment: [Design Unit](README.md).

This is the single current issue list. Capture is the current detailed design
slice. Later-product issues remain here with their evidence dependencies; they
are not all prerequisites for Step 2. Step 3 defines valid Session memory and
curation. Step 5 proves the complete continuity loop. No roadmap order changes.

Each issue below has status `OPEN`. Prior issue text was assessed against the
current product contract, current code where relevant, and the user's
consolidation request. Historical representations are not implementation
requirements.

## Issue Index

| Area | Issue |
| --- | --- |
| Session Memory — Step 3 | [Durable Git Context For Later Memory Lifecycle](#durable-git-context-for-later-memory-lifecycle) |
| Session Memory — Step 3 | [Session Memory validity and reconciliation](#session-memory-validity-and-reconciliation) |
| Session Memory — Step 3 | [Curator evidence qualification](#curator-evidence-qualification) |
| Session Memory — Step 3 | [Durable workstream identity](#durable-workstream-identity) |
| Session Memory — Steps 3–4 | [Session Memory branch and project scope](#session-memory-branch-and-project-scope) |
| Session maintenance — Step 3 | [Worker wake and liveness model](#worker-wake-and-liveness-model) |
| Session maintenance — Step 3 | [Crash recovery and idempotency](#crash-recovery-and-idempotency) |
| Session maintenance — Step 3 | [Retry, quarantine, and terminal failure](#retry-quarantine-and-terminal-failure) |
| Durable memory — Steps 9–11 | [Higher-layer trigger and catch-up policy](#higher-layer-trigger-and-catch-up-policy) |
| Cross-product authority | [Memory-influence lineage](#memory-influence-lineage) |
| Personal Memory — Step 10 | [Personal Memory admission policy](#personal-memory-admission-policy) |
| Practice Memory — Step 11 | [Practice Memory admission policy](#practice-memory-admission-policy) |
| Project Memory — Step 9 | [Exact project source state](#exact-project-source-state) |
| Project Memory — Step 9 | [Branch divergence](#branch-divergence) |
| Project Memory — Step 9 | [Project-grounded curation workspace](#project-grounded-curation-workspace) |
| Project Memory — Step 9 | [Overhaul and broad invalidation](#overhaul-and-broad-invalidation) |
| Query — Steps 4 and 9–13 | [Product query qualification](#product-query-qualification) |
| Query — Steps 4 and 9–13 | [Query freshness and degraded results](#query-freshness-and-degraded-results) |
| Query — optional later aggregation | [Optional query-result aggregation](#optional-query-result-aggregation) |
| Storage | [Durable location and layout](#durable-location-and-layout) |
| Storage and retrieval | [Embedding contract and index-generation lifecycle](#embedding-contract-and-index-generation-lifecycle) |
| Storage — durable memory | [Markdown publication revision and journal](#markdown-publication-revision-and-journal) |
| Storage — retention | [Evidence retention, privacy, and forgetting](#evidence-retention-privacy-and-forgetting) |
| Integrations | [MCP targeted-memory submission context and authority](#mcp-targeted-memory-submission-context-and-authority) |
| Installation — Steps 6–7 | [Application installation and machine integrations](#application-installation-and-machine-integrations) |
| Integrations — installed CLI | [CLI process contracts](#cli-process-contracts) |
| Agent execution | [Agent filesystem enforcement](#agent-filesystem-enforcement) |
| Agent execution | [Workflow-specific response schemas and validation failures](#workflow-specific-response-schemas-and-validation-failures) |
| Distribution — Step 6 | [Packaged SQLite runtime and platform support](#packaged-sqlite-runtime-and-platform-support) |
| Application configuration | [Runtime application configuration](#runtime-application-configuration) |

## Durable Git Context For Later Memory Lifecycle

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md). Verified current values: [WorkspaceContext](../../../src/workspace/workspace-context.ts) and [ProjectRegistration](../../../src/project/project-registration.ts).

**Exposed by:** Capture resolves a working directory while later Session behavior must distinguish branches and their lifecycle.

**Established:** WorkspaceContext remains an immutable passive snapshot produced by WorkspaceContextService. Capture stores that snapshot. A later resolution produces a separate current snapshot. The implemented context records optional Git observation with branch, HEAD commit, and configured upstream, or an unavailable result.

Captured Git context describes the state observed during capture, not the
state at the native event time. A delayed event from branch A can therefore
have a capture-time observation of branch B. Any branch supplied by the source
remains separate source data; it does not replace the observed workspace
context. Exact replay returns the existing evidence and preserves its original
workspace snapshot.

The capture value is approved: optional GitContext records branch, HEAD commit,
and configured upstream reference with its locally available commit, or an
unavailable result. It reads local state without fetching. Null meanings and
no-Git behavior are defined in [WorkspaceContext](pseudocode/src/workspace/workspace-context.ts.md).

**Unresolved:** Define how missing historical context, detached state, branch reuse, merge, and deletion affect later memory attribution without inventing unavailable facts. The capture fields are settled.

**Time to address:** Session interpretation in Step 3. Installed delivery recovery remains Step 7.

## Session Memory validity and reconciliation

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Raw evidence must become independently reconcilable recent-work memory that a later invocation can use.

**Established:** Step 3 owns the Session entry, curator, and reconciliation contracts. Step 5 proves the complete loop. Capture accepts raw, unqualified source facts and does not select useful memory. Session memory concerns decisions, findings, progress, blockers, next actions, and repeated-work warnings.

**Unresolved:** Define what qualifies as a valid Session entry, its scope, and when later evidence retains, revises, supersedes, or removes its applicability. Use those decisions to define the expected outcomes of Step 5; do not move complete-loop proof into capture.

**Time to address:** During Step 3 design, before Session curation and publication implementation.

## Curator evidence qualification

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** The curator receives captured input and existing memory; source statements can describe plans, claims, observations, and corrections.

**Established:** Inputs remain raw and unqualified. The Session curator owns what it reads and how it qualifies evidence. A completion claim alone does not prove completion. Session can suggest destination-specific candidates, but higher products reopen original evidence and own their admission.

**Unresolved:** Define what source data and context the curator reads, how it distinguishes claims from verified outcomes and quoted content, and how it preserves uncertainty and contradictory evidence. Establish what support a Session entry and a higher-layer candidate must retain.

**Time to address:** With the Step 3 curator contract. Higher-layer admission remains with each later product.

## Durable workstream identity

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Session continuity must distinguish concurrent work across provider sessions and workspace changes.

**Established:** Project identity, provider session, interaction, and branch are separate coordinates. No coordinate is automatically a semantic workstream.

**Unresolved:** Define how recent work is correlated across resumed tasks, provider sessions, branches, and commits without joining unrelated concurrent work.

**Time to address:** Before Session storage and curation scope are fixed.

## Session Memory branch and project scope

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Branch-attributed evidence can support recent memory beyond the current branch.

**Established:** Non-Git work is Project-scoped. Broader recall must preserve origin and applicability. Missing branch information is not proof of project-wide applicability. Branch is a scope coordinate, not evidence identity.

**Unresolved:** Define branch-specific versus unscoped Session memory and the conditions for broader Project recall. Preserve conflicting branch realities when broadening results.

**Candidates:** PROVISIONAL — Git-backed Session nodes retain their observed branch or no branch coordinate; query starts with current-branch memory, then broadens under an evidence-backed retrieval rule while retaining attribution.

**Time to address:** Scope is Step 3; retrieval fallback is Step 4.

## Worker wake and liveness model

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Application invocations close their database, while accepted evidence must eventually receive Session evaluation.

**Established:** Capture ends at durable evidence. Session owns consumption, eligibility, and successful progress. Maintenance must run after the last event and after restart without requiring another hook. A notification can accelerate work but cannot be its only durable basis.

**Unresolved:** Define the local driver that detects, wakes, and claims eligible work, including time eligibility during inactivity and recovery after process exit. Durable evidence and a consumption frontier may expose pending work without a capture-owned obligation row. Do not restore the retired acceptance-and-scheduling transaction as an assumption.

**Time to address:** With Step 3 autonomous activation, before claiming maintenance liveness.

## Crash recovery and idempotency

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** A frozen evidence frontier can outlive the worker processing it.

**Established:** Later evidence stays available. Failed or replaced attempts do not advance successful progress. Older work cannot overwrite a newer canonical revision. Session publication and successful progress must form one recoverable result.

**Unresolved:** Define claim ownership, replacement, publication preconditions, and completion fencing. Select the necessary request and attempt representation within Session maintenance. Historical policy tables, operation receipts, and capture-time scheduling are not inherited requirements.

**Time to address:** With Step 3 consumption, reconciliation, and autonomous execution.

## Retry, quarantine, and terminal failure

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** One failing curation input or provider run must not make later evidence permanently unusable.

**Established:** Failure remains observable and cannot silently count as successful coverage. Canonical state changes only through validated publication.

**Unresolved:** Define retryable failures, terminal outcomes, and how isolated failing work permits later progress without losing or falsely marking evidence as evaluated.

**Time to address:** After curation failure and claim contracts are shaped, before autonomous execution.

## Higher-layer trigger and catch-up policy

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Session emits leads while higher products also need to find relevant evidence omitted by Session.

**Established:** Leads are propositions, not evidence or authority. Each product owns eligibility, progress, and curation. Catch-up scans reopen original evidence.

**Unresolved:** Define destination-specific trigger and catch-up behavior that avoids permanent omissions and unnecessary repeated processing. Determine numeric policy values from the resulting behavior and evidence.

**Time to address:** When each higher product is shaped after Session candidate production.

## Memory-influence lineage

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Query results can guide work that later returns as captured evidence.

**Established:** Memory-guided work remains evidence. Repeated use caused by an earlier memory is not independent support for that memory.

**Unresolved:** Define how memory influence is recorded or otherwise accounted for so later curators do not treat self-confirmation as independent evidence.

**Time to address:** When query first guides the continuity journey; before Personal and Practice admission relies on recurring behavior.

## Personal Memory admission policy

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Session and explicit proposals can suggest preferences with different scope and evidence strength.

**Established:** Explicit user statements and corrections are strong evidence. One Project constraint does not automatically become a global preference. Autonomous curation may narrow or reject a lead.

**Unresolved:** Define the support, scope, repetition, contradiction, and revision rules for Personal memory.

**Time to address:** When the Personal curator is shaped.

## Practice Memory admission policy

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Concrete technology use can yield reusable guidance or a record of failure.

**Established:** Observed implementation proves use, not success. Applicability includes relevant versions, modes, frameworks, and constraints. Tool preference and its usage practice remain distinct.

**Unresolved:** Define outcome and applicability evidence sufficient to publish, revise, or demote a Practice node, including failed use recorded as a gotcha.

**Time to address:** When the Practice curator is shaped.

## Exact project source state

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Project curation must attribute its findings to the source state it inspected.

**Established:** A commit does not describe dirty changes. New evidence does not by itself invalidate a frozen curation pass. Publication cannot overwrite a newer accepted revision.

**Unresolved:** Define a source-state reference that describes the inspected committed or dirty state without making capture responsible for expensive source inspection.

**Time to address:** Before Project curator inputs and publication preconditions are fixed.

## Branch divergence

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Two branches can support different valid descriptions of the same Project.

**Established:** Project memory is canonical Markdown. Query must retain scoped divergence. Last-write-wins cannot establish which branch reality applies.

**Unresolved:** Define how canonical Project memory represents and reconciles concurrent branch realities.

**Time to address:** Before Project publication and query applicability are fixed.

## Project-grounded curation workspace

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** A curator may need repository access to check Project claims.

**Established:** The source state inspected must remain attributable. Provider access is read-only and cannot publish canonical memory.

**Unresolved:** Select whether the curator inspects the live directory, an immutable snapshot, or an application-managed checkout, and establish how that choice binds the inspected state.

**Time to address:** Before the first Project curator receives filesystem access.

## Overhaul and broad invalidation

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** A repository rewrite can invalidate many existing memory nodes.

**Established:** Session may emit a broad revalidation lead. That lead cannot invalidate Project memory by itself. The Project curator inspects relevant source state.

**Unresolved:** Define how broad changes cause revalidation and retain, stale, supersede, or retract affected nodes without removing still-supported memory.

**Time to address:** With Project curation and lifecycle design.

## Product query qualification

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** QueryService collects independently qualified results from applicable products.

**Established:** Each product owns retrieval signals, scoring, filtering, threshold, and result form. Scores are not truth confidence and are not comparable across products. Session returns its own projection; durable products return canonical references.

**Unresolved:** Define each product's qualified result, retrieval policy, and bounded response. Select the Session projection in Step 4 without imposing a uniform memory payload.

**Time to address:** As each product query is shaped; Session first in Step 4.

## Query freshness and degraded results

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Published memory and indexes can lag evidence or become unavailable independently.

**Established:** Query is read-only. Unmanaged context makes Session and Project not applicable; this is not degradation. Results retain product, scope, provenance, and freshness.

**Unresolved:** Define freshness meaning and which product or index failures permit partial results versus failing the query.

**Time to address:** With each product query and later federation.

## Optional query-result aggregation

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** An optional agent may summarize the complete qualified core result.

**Established:** Core QueryService is non-agentic. Aggregation preserves the unchanged core result beside its answer and uses the separate agent-execution capability.

**Unresolved:** Define the optional aggregation owner and grounded answer contract if that workflow is selected.

**Time to address:** Only when optional aggregation is designed; it does not block core query.

## Durable location and layout

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** The product has canonical SQLite state, canonical Markdown, and rebuildable indexes and run artifacts.

**Established:** The current development database path and SQLite source storage are established. Session is canonical in SQLite; higher products are canonical in Markdown. Obsidian is optional.

**Unresolved:** Define installed and higher-product storage layout and ownership. Do not reopen the existing local development path.

**Time to address:** Before host installation or the first Markdown publication owner needs those paths.

## Embedding contract and index-generation lifecycle

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Derived vector indexes must remain compatible with the contract used for queries.

**Established:** FTS5 and sqlite-vec are selected infrastructure. Products own retrieval policy. Embedding contracts separate provider, model revision, dimensions, normalization, purpose, and chunking version. Incompatible vectors never mix.

**Unresolved:** Define supported embedding contracts and how complete generations build, activate, degrade, migrate, and retire. Choose signals in each product's retrieval design.

**Time to address:** Before a product query depends on vector results.

## Markdown publication revision and journal

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Canonical Markdown and SQLite publication metadata cannot share one native transaction.

**Established:** Only application publication writes canonical memory. Recovery is idempotent. Receipts preserve evidence frontier, expected and resulting revisions, and agent attribution. Indexes can lag and be rebuilt.

**Unresolved:** Define the journal, file-replacement sequence, committed-revision visibility, and recovery contract.

**Time to address:** Before the first canonical Markdown publication implementation.

## Evidence retention, privacy, and forgetting

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Exact source and derived memories can share provenance across multiple products.

**Established:** Evidence is retained by default. Superseding or removing one memory does not authorize deletion of shared evidence. Forgetting and retention are explicit operations; derived indexes are rebuildable.

**Unresolved:** Define retention eligibility, exclusions, and forgetting guarantees across source, normalized evidence, dependent memory, indexes, and backups. Separate storage-policy deletion from ordinary memory reconciliation.

**Time to address:** Source exclusions must be considered before automatic capture; deletion guarantees before retention or forgetting is introduced. No arbitrary TTL is selected.

## MCP targeted-memory submission context and authority

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Agents can submit proposals through CLI, function, or future MCP entrypoints.

**Established:** Entry routing establishes source metadata, not human authorship. Payload attribution cannot grant authority. Targeted proposals select a durable product and do not enter Session memory. MCP requires client correlation under the accepted insertion contract.

**Unresolved:** Define which invocation facts MCP can establish independently and how the destination curator uses them without granting automatic human authority.

**Time to address:** Before an MCP integration or curator relies on agent-specific provenance.

## Application installation and machine integrations

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** One host command and provider hooks must have recoverable installation lifecycles.

**Established:** Project bootstrap is independent from installation. Machine-wide hooks admit only registered scopes. MCP setup has a separate lifecycle. The local development command precedes installation.

**Unresolved:** Define installation, upgrade, repair, removal, and recovery ownership for the command and integrations. Command spelling is a later naming choice, not a separate design blocker.

**Time to address:** With Steps 6–7 installation design.

## CLI process contracts

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Human commands and future machine clients use the same Application operations.

**Established:** Capture success proves durable evidence; proposal success proves Inbox acceptance. Neither proves curation. Machine responses are versioned separately from human output. One MCP business operation maps to one application request.

**Unresolved:** Define machine framing, encoding, version compatibility, cancellation, and structured outcomes. Preserve the separation between provider-compatible hook process behavior and actual capture success.

**Time to address:** As installed operations are shaped, before the CLI-backed MCP client.

## Agent filesystem enforcement

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Autonomous curators may inspect untrusted source content through provider processes.

**Established:** TypeScript owns safe process arguments and cancellation. Agents propose changes but never write canonical memory. A read policy must apply beyond prompt wording.

**Unresolved:** Define enforceable filesystem and environment access through provider sandbox settings and subprocess behavior, including repository prompt-injection input.

**Time to address:** Before the first autonomous agent receives project filesystem access.

## Workflow-specific response schemas and validation failures

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Memory workflows receive structurally and semantically untrusted provider output.

**Established:** Provider adapters own process interaction and structural parsing. Each workflow owns its task, response schema, and admission decisions. Schema validity does not prove truth. Core query uses no agent.

**Unresolved:** Define response and failure contracts for each reached workflow, including repair versus rejection and the semantic publication checks. Session is first; optional aggregation is separate.

**Time to address:** After each workflow's task packet is shaped and before it invokes an agent.

## Packaged SQLite runtime and platform support

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md). Current source: [SqliteRuntime](../../../src/storage/sqlite/sqlite-runtime.ts) and [package manifest](../../../package.json).

**Exposed by:** The implemented local runtime loads packaged sqlite3 and sqlite-vec, while installation promises independence from host SQLite.

**Established:** The selected Bun, Sequelize, sqlite3, and sqlite-vec dependencies and local initialization are established. This consolidation does not re-verify a distribution platform matrix.

**Unresolved:** Define supported platform packages, binary provenance and integrity, updates, and unsupported-host behavior. Retain this as distribution design, not a reason to redesign the working local database boundary.

**Time to address:** Before the first supported host package is published.

## Runtime application configuration

**Evidence:** accepted design in [README](../../../README.md), user requirement,
and the consolidation assessment in [this unit](README.md).

**Exposed by:** Capture, curation, and installed storage need independently configured capabilities.

**Established:** Application creation opens shared resources. Each operation composes only its required graph. Capture uses the trusted source factory. Agent execution is selected independently. The database path is explicit; there is no application-wide provider.

**Unresolved:** Define admitted provider settings, availability checks, executable discovery, environment policy, and machine overrides when those operations are reached. Do not restore eager capture or Session-policy composition.

**Time to address:** Before the first configured agent operation and later installed runtime need these inputs.
