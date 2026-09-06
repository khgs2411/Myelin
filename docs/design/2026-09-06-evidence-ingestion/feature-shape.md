# Evidence Ingestion — Feature Shape

This unit maps code-owned selection and leasing of captured evidence for Session
curation, followed by validated publication and durable processing completion.

Open design frontier: [Open Design Issues](design-issues.md).

## Feature Map

```text
manual CLI invocation OR threshold trigger
  -> [EvidenceIngestionService]
      -> [Source-specific evidence preparation] : EvidenceAdapterFactory.Create(source)
      <- IEvidenceAdapter, or fail unsupported source before claims
      -> [WorkspaceContextService] : resolve working directory
      <- WorkspaceContext

WorkspaceContext + separate capture-source selection
  -> [EvidenceIngestionService]
      -> [EvidenceManager] -> [EvidenceItemRepository] : count unavailable captured Git evidence
      <- exclusion count before claims
      -> [EvidenceManager] : atomic selection and claim through SqliteDatabase
          [EvidenceItemRepository] : read eligible evidence
          [EvidenceLedgerRepository] : write claims
          evidence_items : eligible rows in Project order, configured batch limit (default 32)
          [Evidence processing ledger] : durable claim, attempt identity, expiry
      <- claimed batch, or null for no eligible evidence
  no eligible batch -> caller result: zero processed, no created IDs

claimed evidence + source identity
  -> [Source-specific evidence preparation] : selected IEvidenceAdapter.Prepare(evidence)
  -> [EvidenceIngestionService]
      -> [Agent execution] : agents.evidenceCurator configuration selects execution adapter
          -> [Evidence curator] : interpret prepared evidence
      <- untrusted ICuratorResult: reported completed outcome + memory drafts

[EvidenceIngestionService] : validate result; delegate claim ownership to EvidenceManager
  -> [SqliteDatabase] : atomic publication and processing completion
      [SessionMemoryManager] -> [SessionMemoryRepository] : entries + evidence links + active lifecycles
      [EvidenceManager] -> [EvidenceLedgerRepository] : complete in the shared transaction
  commit -> [EvidenceIngestionService] -> CLI or maintenance caller
      IEvidenceIngestionResult : processed count, created IDs, skipped unavailable-Git count

failure -> [EvidenceManager] : release still-owned claims
        -> [EvidenceIngestionService] : propagate error after cleanup

[EvidenceCaptureService] -> [EvidenceManager] -> [EvidenceItemRepository] : insert evidence

failure or expired claim -> retry eligibility
replaced attempt -X-> publication
agent execution -X-> held database transaction
[Evidence curator] -X-> evidence selection, leasing, direct canonical writes
```

Evidence for the design relationships: user-approved
[baseline](README.md#accepted-baseline). Existing SQLite storage and workspace
resolution are verified implementation; the ingestion flow is accepted design.

## Design Item Catalog

| Owner | Representation |
| --- | --- |
| [EvidenceIngestionService](#evidenceingestionservice) | semantic |
| [SessionMemoryManager](#sessionmemorymanager) | semantic |
| [SessionMemoryRepository](#sessionmemoryrepository) | semantic |
| [EvidenceManager](#evidencemanager) | semantic |
| [EvidenceItemRepository](#evidenceitemrepository) | exact |
| [EvidenceCaptureService](#evidencecaptureservice) | exact |
| [EvidenceLedgerRepository](#evidenceledgerrepository) | semantic |
| [Evidence processing ledger](#evidence-processing-ledger) | semantic |
| [Source-specific evidence preparation](#source-specific-evidence-preparation) | semantic |
| [Agent execution](#agent-execution) | semantic |
| [Evidence curator](#evidence-curator) | semantic |
| [WorkspaceContextService](#workspacecontextservice) | exact |
| [SqliteDatabase](#sqlitedatabase) | exact |

## New Or Revised Files Or Owners

### EvidenceIngestionService

**Representation:** semantic orchestration owner with an accepted class name.

**Evidence:** explicit user approval in the [baseline](README.md#accepted-baseline).

Owns ingestion after capture commits: source preparation, agent execution,
result validation, and coordinated memory publication. Delegates evidence
selection, claim ownership, and processing lifecycle to EvidenceManager.
Accepts the [curator response](pseudocode/curator.result.ts.md) only after
successful execution, structural validation, and draft validation against the
original batch. Explicit completed output with no memories is valid; missing
or invalid output is a failure.

Returns the accepted [ingestion result](pseudocode/evidence-ingestion.result.ts.md).
Processed counts and created IDs represent committed publication/completion.
Empty selection returns zero processed and no IDs. Reports excluded evidence
with unavailable captured Git context in the requested base scope. Failures
propagate after cleanup; successful ingestion does not imply completed memory review.

### SessionMemoryManager

**Representation:** semantic publication coordinator with an accepted class name.

**Evidence:** accepted [draft and publication contract](pseudocode/session-memory-manager.ts.md).

Receives validated drafts, trusted Project ID, and the shared transaction.
Coordinates persistence through SessionMemoryRepository without agent invocation
or independent commits. Memory-review decisions remain separate.

### SessionMemoryRepository

**Representation:** semantic persistence owner with an accepted class name.

**Evidence:** accepted [persistence boundary](pseudocode/session-memory.repository.ts.md)
and verified existing Session storage models.

Writes entries, evidence links, and active lifecycle rows within the supplied
transaction. SQLite assigns entry IDs. It does not update evidence processing
state or commit independently.

### EvidenceManager

**Representation:** semantic coordination owner with an accepted class name.

**Evidence:** user-approved [responsibility map](pseudocode/evidence-manager.ts.md).

Coordinates both evidence repositories. Owns selection-and-claim transactions,
lease lifecycle, status updates, and evidence insertion delegation for capture.
Delegates the unavailable captured Git count to EvidenceItemRepository before
claiming; count scope is Project, source, and directory without status or limit.
Uses the accepted workspace matching rules. Supports the ingestion service's
shared publication transaction without owning memory publication or curation.

### EvidenceLedgerRepository

**Representation:** semantic repository owner with an accepted class name.

**Evidence:** user-approved [repository contract](pseudocode/evidence-ledger.repository.ts.md).

Reads and writes ledger records behind EvidenceManager. Provides claim,
ownership, expiry, and status persistence within the manager's transaction.
EvidenceItemRepository owns evidence reads; this repository does not coordinate
selection across the two tables or publish memories.

### Evidence processing ledger

**Representation:** semantic Session processing-state owner in SQLite.

**Evidence:** user-proposed ledger and approved atomic claim behavior in the
[baseline](README.md#accepted-baseline).

Records processing eligibility and successful evaluation for evidence items,
with durable attempt ownership and expiry for claimed work. Failed processing
does not establish successful coverage. The ledger does not mutate captured
evidence or become Project-owned progress.

The accepted [ledger model](pseudocode/evidence-processing-ledger.model.ts.md)
has one optional row per EvidenceItem, identified by the evidence foreign key.
It stores current status, attempt identity, and lease expiry. It retains no
attempt history; SQLite enforces the approved state/expiry constraints.

### Source-specific evidence preparation

**Representation:** semantic preparation adapter and factory boundary.

**Evidence:** explicit user approval of independent preparation and execution
selection in the [baseline](README.md#accepted-baseline).

Uses source identity to select an adapter that understands the claimed
evidence's native format. Supplies prepared source material for curation while
preserving source attribution. It does not select the executing agent provider.
The accepted [IEvidenceAdapter](pseudocode/evidence.adapter.ts.md)
receives the claimed batch's ordered EvidenceItem models without lease data.
EvidenceAdapterFactory selects it from captureSourceKey before ingestion requests
claims. Unsupported sources fail explicitly. CodexEvidenceAdapter is the accepted
intended Codex implementation. See the [factory contract](pseudocode/evidence-adapter.factory.ts.md).

### Agent execution

**Representation:** semantic facade, factory, and execution-adapter boundary.

**Evidence:** approved configurable execution selection in the
[baseline](README.md#accepted-baseline) and provider separation in the
[product overview](../../../README.md#runtime-shape).

Executes the Evidence curator task through the configured provider. Returns
untrusted results for application validation. Source provider identity does not
force the execution provider. Execution occurs outside SQLite transactions.

### Evidence curator

**Representation:** semantic agent responsibility.

**Evidence:** accepted responsibility in [project context](../../../CONTEXT.md)
and the [baseline](README.md#accepted-baseline).

Interprets prepared evidence and proposes useful immutable Session entries.
An evaluation may legitimately yield no new memory. It does not claim evidence,
assign canonical identities, write SQLite, or perform the Memory reviewer's job.
The task requires evaluation of the full prepared batch. Its completed outcome
reports completion; the response field does not prove evaluation quality.

## Existing Files Or Owners Relied On

### EvidenceItemRepository

**Representation:** exact [repository](../../../src/evidence/evidence-item.repository.ts).

**Evidence:** existing transactional insertion; user-approved extension for reads.

Preserves evidence insertion and gains filtered evidence reads. EvidenceManager
coordinates its operations with ledger persistence. Retains its existing name.
Its selection query can join or reference ledger records to apply eligibility
before ordering and limiting. It returns evidence models; ledger record
operations remain with EvidenceLedgerRepository.

### EvidenceCaptureService

**Representation:** exact [service](../../../src/capture/evidence-capture.service.ts).

**Evidence:** existing capture owner; approved future manager delegation.

Retains normalization/capture preparation responsibility. The accepted design
routes insertion through EvidenceManager; this routing is not implemented yet.

### WorkspaceContextService

**Representation:** exact [service](../../../src/workspace/workspace-context.service.ts).

**Evidence:** verified implementation.

Resolves a working directory to registered Project context and an optional
local Git observation. Its managed result supplies workspace context for
ingestion selection. Capture-source selection remains a separate input.

### SqliteDatabase

**Representation:** exact [database owner](../../../src/storage/sqlite/sqlite-database.ts),
using the existing [schema and models](../../../src/storage/sqlite/sqlite-schema.ts).

**Evidence:** verified process-scoped connection and immediate write-transaction
boundary; verified relational evidence and Session storage.

Provides transaction ownership for atomic selection/claiming and later
publication/completion. Existing records preserve immutable source evidence,
Project sequence, Session evidence membership, and mutable lifecycle state.

## Admission Rule

Each semantic owner follows an explicitly accepted responsibility. Existing
owners are admitted only for the contracts this flow uses. Values, triggers,
and table annotations identify inputs and effects without adding new service
owners. Implementation evidence is stated separately from intended behavior.
