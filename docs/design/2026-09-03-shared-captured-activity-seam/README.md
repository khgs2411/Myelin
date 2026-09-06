# LLM Wiki — Current Design Unit

> Design location changed on 2026-09-05. The active entry-contract unit is
> [Session Memory entry](../2026-09-05-session-memory-entry/README.md).
> It takes precedence for Session entry design. This unit remains a capture
> reference and historical source for later questions. References below to this
> unit as the single current frontier describe the earlier consolidation.

This directory is the single entry point for ongoing design. Its date and
directory name remain unchanged so existing references continue to work.
Capture is the current detailed slice. Accepted product boundaries and
relevant later questions are consolidated here without moving their roadmap
steps.

## Read And Continue Here

- [Feature Shape](feature-shape.md): accepted owners and relationships.
- [Open Design Issues](design-issues.md): the single current unresolved frontier.
- [Pseudocode](pseudocode/README.md): current detailed contracts and flows.
- [Product README](../../../README.md): canonical whole-product overview.
- [Roadmap](../../../ROADMAP.md): delivery sequence and implementation status.

Step 2 designs and delivers captured evidence. Step 3 defines valid Session
memory, what the curator reads, qualification, reconciliation, and candidate
production. Step 5 proves the complete loop. Raw input remains unqualified
until the appropriate curator evaluates it. This consolidation changes no
roadmap order or completion status.

## Authority And Working Method

Current user decisions and verified code govern their respective boundaries.
The root README describes product intent; executable source establishes what
is implemented. This unit owns ongoing detailed design. Pseudocode is design
reference, not proof of implementation or automatic execution approval.

Known macro design belongs in Feature Shape. Detailed accepted contracts
belong in pseudocode. Material unresolved decisions belong in Design Issues,
with the dependency that makes them relevant. An unset library or calibration
value does not become a design issue unless it changes a material contract.

Continue one selected owner or issue at a time. When a decision is accepted,
update its affected current artifacts together and remove the resolved issue.
Do not copy speculative owners or policy machinery from a historical file.

Historical design units are retired from active design, not erased. Their
bodies retain source history. Existing roadmap links to completed units
identify historical milestones; they do not reactivate those units. Use this
unit for further design changes. A source-only historical detail must be
reconciled against the current contract before it is adopted.

## Prior Unit Assessment

| Historical unit | Current treatment |
| --- | --- |
| 2026-08-12-our-app | Product intent is in the root README and current Feature Shape. All 27 former issue sections are assessed below. Old acceptance and Session scheduling structures are not inherited. |
| 2026-09-02-fixed-local-project-context | Superseded fixed-branch/bootstrap design. Current context consumes an existing registration and observes Git. |
| 2026-09-02-ingestion-boundaries | Targeted Inbox separation and replay survive in current pseudocode. Pre-persistence ingestion and the old fixture are retired. Public keys follow the newer user-assigned key contract. |
| 2026-09-02-ingestion-implementation-foundation | Local CLI/lifetime intent survives. Fixed master branch, startup seeding, and capture-time Session composition are retired. |
| 2026-09-03-codex-automatic-capture-input-contract | Historical provider research and accepted event granularity. Current adapters own native inputs; fixtures own their own format. This consolidation does not re-verify external provider schemas. |
| 2026-09-03-durable-evidence-acceptance | Separate acceptance service, operation ledger, and capture-owned Session obligation are retired. Relevant validation, replay, and failure questions transfer below. |
| 2026-09-03-fixed-local-project-context | Implemented registration, resolution, and immutable values remain current source facts. Application creation-time context binding is superseded by operation-specific composition. |
| 2026-09-03-local-project-seed | Implemented Project, schema, and seed remain current source facts. No duplicate implementation or schema is introduced. |
| 2026-09-03-workspace-context | Superseded value layout. Approved WorkspaceContext contains ProjectRegistration, workingDirectory, and optional git. The implementation now uses the approved optional git snapshot. |

## Original Open-Issue Assessment

Source: the former `2026-08-12-our-app/design-issues.md` list. Each former
section has a disposition here. Moving an issue does not resolve it or make it
a capture prerequisite.

| Former section | Relevance assessment | Current destination |
| --- | --- | --- |
| Durable workstream identity | Retained under the current product contract; address at the stated dependency. | [Durable workstream identity](design-issues.md#durable-workstream-identity) |
| Session Memory branch and project scope | Retained under the current product contract; address at the stated dependency. | [Session Memory branch and project scope](design-issues.md#session-memory-branch-and-project-scope) |
| Exact project source state | Retained under the current product contract; address at the stated dependency. | [Exact project source state](design-issues.md#exact-project-source-state) |
| Higher-layer trigger and catch-up policy | Retained under the current product contract; address at the stated dependency. | [Higher-layer trigger and catch-up policy](design-issues.md#higher-layer-trigger-and-catch-up-policy) |
| Worker wake and liveness model | Retained; added inactive-project and restart behavior under the current capture boundary. | [Worker wake and liveness model](design-issues.md#worker-wake-and-liveness-model) |
| Crash recovery and idempotency | Narrowed to Session claim, publication, and progress. Retired capture-operation records and capture-time scheduling assumptions. | [Crash recovery and idempotency](design-issues.md#crash-recovery-and-idempotency) |
| Retry, quarantine, and terminal failure | Retained under the current product contract; address at the stated dependency. | [Retry, quarantine, and terminal failure](design-issues.md#retry-quarantine-and-terminal-failure) |
| Memory-influence lineage | Retained under the current product contract; address at the stated dependency. | [Memory-influence lineage](design-issues.md#memory-influence-lineage) |
| Personal Memory admission policy | Retained under the current product contract; address at the stated dependency. | [Personal Memory admission policy](design-issues.md#personal-memory-admission-policy) |
| Practice Memory admission policy | Retained under the current product contract; address at the stated dependency. | [Practice Memory admission policy](design-issues.md#practice-memory-admission-policy) |
| MCP targeted-memory submission context and authority | Retained under the current product contract; address at the stated dependency. | [MCP targeted-memory submission context and authority](design-issues.md#mcp-targeted-memory-submission-context-and-authority) |
| Branch divergence | Retained under the current product contract; address at the stated dependency. | [Branch divergence](design-issues.md#branch-divergence) |
| Project-grounded curation workspace | Retained under the current product contract; address at the stated dependency. | [Project-grounded curation workspace](design-issues.md#project-grounded-curation-workspace) |
| Overhaul and broad invalidation | Retained under the current product contract; address at the stated dependency. | [Overhaul and broad invalidation](design-issues.md#overhaul-and-broad-invalidation) |
| Query freshness and degraded results | Split into qualification, freshness/failure, and optional aggregation. | [Product query qualification](design-issues.md#product-query-qualification); [Query freshness and degraded results](design-issues.md#query-freshness-and-degraded-results); [Optional query-result aggregation](design-issues.md#optional-query-result-aggregation) |
| Durable location and layout | Narrowed to installation and higher-product storage. The local database path is established. | [Durable location and layout](design-issues.md#durable-location-and-layout) |
| Embedding contract and index-generation lifecycle | Retained under the current product contract; address at the stated dependency. | [Embedding contract and index-generation lifecycle](design-issues.md#embedding-contract-and-index-generation-lifecycle) |
| Markdown publication revision and journal | Retained under the current product contract; address at the stated dependency. | [Markdown publication revision and journal](design-issues.md#markdown-publication-revision-and-journal) |
| Evidence retention, privacy, and forgetting | Retained under the current product contract; address at the stated dependency. | [Evidence retention, privacy, and forgetting](design-issues.md#evidence-retention-privacy-and-forgetting) |
| Application installation and machine integrations | Retained under the current product contract; address at the stated dependency. | [Application installation and machine integrations](design-issues.md#application-installation-and-machine-integrations) |
| CLI process contracts | Retained under the current product contract; address at the stated dependency. | [CLI process contracts](design-issues.md#cli-process-contracts) |
| Agent filesystem enforcement | Retained under the current product contract; address at the stated dependency. | [Agent filesystem enforcement](design-issues.md#agent-filesystem-enforcement) |
| Workflow-specific response schemas and validation failures | Retained under the current product contract; address at the stated dependency. | [Workflow-specific response schemas and validation failures](design-issues.md#workflow-specific-response-schemas-and-validation-failures) |
| Packaged SQLite runtime and platform support | Retained for distribution. Local runtime initialization is already implemented. | [Packaged SQLite runtime and platform support](design-issues.md#packaged-sqlite-runtime-and-platform-support) |
| Runtime, package manager, and SQLite access | No open design decision. Existing runtime and package choices remain established; distribution support stays separate. | Established stack or later library selection; no standalone issue. |
| Runtime application configuration | Narrowed to operation-specific settings. Removed eager graph and generic provider assumptions. | [Runtime application configuration](design-issues.md#runtime-application-configuration) |
| Validation and Markdown libraries | Library selection is implementation evidence after owning contracts are shaped. Native/shared evidence and workflow validation boundaries remain explicit issues; no generic validation framework is introduced. | Established stack or later library selection; no standalone issue. |

## Retired Acceptance-Unit Frontier

| Former issue | Current treatment |
| --- | --- |
| Session obligation persistence contract | Retired as a capture prerequisite. Session consumption and liveness own later pending-work discovery. No capture-owned obligation row is required. |
| Evidence candidate runtime validation | Resolved: [validation ownership](feature-shape.md#evidencecaptureservice); uses EvidenceItemDto. |
| Deterministic fingerprint contract | Resolved: [Project-scoped replay](feature-shape.md#evidenceitemrepository); no separate capture-operation fingerprint is required. |
| Acceptance failure contract | Resolved: [capture failures](feature-shape.md#application) and [ApplicationError](feature-shape.md#applicationerror). |

## Consolidation Corrections

- The fixture calls Application.capture. Application owns adapter construction
  and the service graph.
- Workspace resolution takes an object and returns a discriminated result.
  The evidence service extracts the managed context.
- ProjectRegistration.identity is the application identity field; Project.id
  remains a model field.
- Capture returns the existing ordered CapturedEvidenceReference array.
- WorkspaceContext remains passive and immutable. Its historical snapshot is
  distinct from a later resolution. Git context means state observed during
  capture, not proven event-time state. Exact replay preserves the original
  snapshot; source-supplied branch information remains separate.
- NativeSourceMaterial carries serialized bytes plus a format identifier.
  The adapter owns serialization; SQLite stores the bytes as a BLOB.
  EvidenceItemRepository computes the SHA-256 integrity digest before the write transaction
  and stores it with the evidence. Serialization sorts object keys recursively
  and preserves array order. The format identifies the encoding version.
  Replay requires matching format and bytes within one replay identity.
  Accepted formats are `json.v1`, `string.v1`, and `bytes.v1`; their encoding
  contracts are recorded in the Feature Shape and capture-adapter pseudocode.

## Established Implementation Choices

The existing source and package manifest own local runtime versions, SQLite
initialization, schema history, the seeded registration, and current workspace
values. Package selection for later validation and Markdown parsing follows
the relevant contract; it is not a separate architectural decision by default.
