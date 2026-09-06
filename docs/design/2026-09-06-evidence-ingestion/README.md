# Evidence Ingestion — Design Unit

This is the active design unit for
[Establish Session evidence consumption and progress](../../../ROADMAP.md#roadmap-step-3-create-session-memory-from-accepted-evidence).

## Read And Continue Here

- [Feature Shape](feature-shape.md): accepted responsibilities and relationships.
- [Open Design Issues](design-issues.md): unresolved contracts within this unit.
- [EvidenceIngestionService flow](pseudocode/evidence-ingestion.service.ts.md):
  request-to-result orchestration and transaction boundaries.
- [Ingestion request pseudocode](pseudocode/evidence-ingestion.request.ts.md):
  shared CLI and maintenance input.
- [Ingestion result pseudocode](pseudocode/evidence-ingestion.result.ts.md):
  committed processing counts, created memory IDs, and excluded evidence count.
- [Curator result pseudocode](pseudocode/curator.result.ts.md): explicit reported
  completion, memory drafts, and admission rules.
- [Application configuration pseudocode](pseudocode/application.configuration.ts.md):
  repository-local JSON settings and service configuration.
- [Evidence selection pseudocode](pseudocode/evidence-selection.md): workspace
  matching, unavailable Git context, and selection order.
- [Evidence ledger repository pseudocode](pseudocode/evidence-ledger.repository.ts.md):
  ledger persistence, processing state, and shared publication transaction.
- [Evidence item repository pseudocode](pseudocode/evidence-item.repository.ts.md):
  evidence filters, convenience reads, and repository coordination.
- [Evidence preparation adapter](pseudocode/evidence.adapter.ts.md):
  source-specific preparation input and ownership boundary.
- [EvidenceAdapterFactory](pseudocode/evidence-adapter.factory.ts.md): supported
  source selection before evidence claiming.
- [SessionMemoryManager](pseudocode/session-memory-manager.ts.md) and
  [SessionMemoryRepository](pseudocode/session-memory.repository.ts.md): validated
  drafts and publication within the shared transaction.
- [Evidence processing ledger model](pseudocode/evidence-processing-ledger.model.ts.md):
  row fields, evidence relationship, and database constraints.
- [Project context](../../../CONTEXT.md): shared product language.
- [Closed Session Memory unit](../2026-09-05-session-memory-entry/README.md):
  entry, evidence-link, and lifecycle storage contracts.

- [EvidenceManager pseudocode](pseudocode/evidence-manager.ts.md): shared evidence
  access, repository coordination, and lease lifecycle ownership.

## Accepted Baseline

Authority: explicit user proposals and approval on 2026-09-06 in the design
conversation. The user confirmed `EvidenceIngestionService` and the separation
between source-specific preparation and configured agent execution.

- EvidenceManager coordinates EvidenceItemRepository and EvidenceLedgerRepository
  for evidence access, selection, claims, and processing state. Capture uses the
  same manager for insertion; ingestion delegates lease behavior to it.
- Code selects, claims, and tracks evidence. The agent interprets the selected
  material; it does not select or lease database rows.
- A manual CLI invocation or a threshold trigger invokes the same ingestion
  behavior. Threshold scheduling is later work.
- Selection uses resolved WorkspaceContext and a separate capture-source
  selection. Provider identity is not added to WorkspaceContext.
- Selection matches Project, exact capture source, canonical directory, and the
  approved Git scope rules in the evidence selection pseudocode. Unavailable
  current Git context stops ingestion before claims. Evidence with unavailable
  captured Git context remains unclaimed and is counted within the base scope;
  its recovery is deferred.
- Read eligible evidence in Project sequence order, with a configured positive, even
  batch limit (default 32). Smaller batches are valid. Even size is not proof of question/answer pairing. Preserve available
  session and interaction coordinates.
- A Session-owned evidence processing ledger distinguishes unprocessed,
  retryable, in-progress, and successfully evaluated evidence. Selection and
  claiming commit atomically in SQLite.
- Claims have attempt identity and expiry. Expired work can be reclaimed.
  Replaced attempts cannot publish. Agent execution holds no database transaction.
  Use a long lease. A late result can renew atomically if every original batch
  row remains processing under its attempt ID. Handled failures release owned
  claims; expiry permits recovery when a process cannot release them.
- Application startup loads repository-local `config.json` through
  `APPLICATION_CONFIGURATION_PATH`, validates it before opening SQLite, and
  resolves database paths relative to the configuration file. Installation
  determines the final location later. See the configuration pseudocode for
  defaults and validation.
- The evidence source selects its preparation adapter. Independent configured
  execution settings select the agent adapter through a factory/facade boundary.
  Each role has required provider/model settings under `agents.evidenceCurator`
  and `agents.memoryReviewer`.
- Application code validates the result and commits publication with processing
  completion. A successful evaluation can create no memories. Failure does not
  count as successful processing or remove the original evidence.
  Evaluation covers the whole batch; memory support can use subsets. Successful
  completion processes all claimed evidence. Partial completion is not supported.
- The Evidence curator and Memory reviewer remain separate responsibilities.
  Completed evidence evaluation does not imply completed memory review.
- Ingestion returns the approved caller result after a processed batch commits.
  Empty selection returns zero processed and no created IDs. Failures propagate
  after cleanup; excluded evidence with unavailable captured Git context is counted.

## Scope And Authority

This unit defines the ingestion request, evidence selection, processing records,
claim ownership, preparation and execution boundaries, and successful progress.
Most owners are accepted design responsibilities, not implemented services.
Concrete names other than already established names are selected during design.

The detailed curator task/result contract and agent transport implementation
retain their later roadmap items. This unit defines the contracts it needs at
those boundaries. It does not select headless execution, app-server, a provider
model, or a scheduler. Manual command syntax and threshold policy are not fixed.

The ledger-based selection contract governs this unit. Older descriptions of a
single advancing frontier do not require a global cursor that could skip
retryable evidence. The closed entry unit's query and promotion issues remain
with their later capabilities; ingestion workspace matching is a separate
selection contract that must be designed here.

Keep established macro design in Feature Shape. Record material issues as they
surface and remove them when their accepted resolution is recorded in the
controlling artifact. Add focused pseudocode as contracts become concrete.
Starting this design unit does not authorize runtime implementation.
