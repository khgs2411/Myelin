# Durable Evidence Acceptance — Feature Shape

Accept one project-bound command of normalized captured evidence, append new
evidence to an immutable project-ordered ledger, record its Session-maintenance
obligation, and persist an exact retry-safe receipt in one SQLite transaction.
This unit excludes capture normalization, project resolution, targeted durable
memory insertion, Session maintenance execution, and memory interpretation.

Open design frontier: [Open Design Issues](design-issues.md).

## Feature Map

```text
([WorkspaceContext] + normalized captured content and provenance)
  -> [Evidence Contracts] : one project-bound acceptance command
      -> [EvidenceAcceptanceService]
          -> [SqliteDatabase] : one IMMEDIATE transaction
              -> [EvidenceAcceptanceOperationRepository]
                  -> [EvidenceAcceptanceOperation] : retry lookup
              -> [EvidenceLogRepository]
                  -> [Project] : reserve project-local sequence range
                  -> [EvidenceItem] : append new evidence or resolve source replay
              -> [Session Maintenance Obligation] : record accepted frontier
              -> [EvidenceAcceptanceOperationRepository]
                  -> [EvidenceAcceptanceOperation] : store exact receipt
          -> (committed acceptance receipt)

[EvidenceAcceptanceService] -X-> (capture normalization | project resolution)
[EvidenceAcceptanceService] -X-> (Session maintenance execution | memory curation)
[EvidenceLogRepository] -X-> (replay classification | transaction ownership)
[Session Maintenance Obligation] -X-> (agent invocation | Session Memory mutation)
```

## Design Item Catalog

| Design item | Representation |
| --- | --- |
| [EvidenceAcceptanceService](#evidenceacceptanceservice) | exact: `src/evidence/evidence-acceptance.service.ts` |
| [Evidence Contracts](#evidence-contracts) | exact: `src/evidence/evidence-item.dto.ts` |
| [EvidenceLogRepository](#evidencelogrepository) | exact: `src/storage/sqlite/repositories/evidence-log.repository.ts` |
| [EvidenceItem](#evidenceitem) | exact: `src/storage/sqlite/models/evidence-item.model.ts` |
| [EvidenceAcceptanceOperationRepository](#evidenceacceptanceoperationrepository) | exact: `src/storage/sqlite/repositories/evidence-acceptance-operation.repository.ts` |
| [EvidenceAcceptanceOperation](#evidenceacceptanceoperation) | exact: `src/storage/sqlite/models/evidence-acceptance-operation.model.ts` |
| [Session Maintenance Obligation](#session-maintenance-obligation) | semantic: `Session Maintenance Obligation` |
| [WorkspaceContext](#workspacecontext) | exact: `src/workspace/workspace-context.ts` |
| [Project](#project) | exact: `src/storage/sqlite/models/project.model.ts` |
| [SqliteDatabase](#sqlitedatabase) | exact: `src/storage/sqlite/sqlite-database.ts` |

## New Or Revised Files Or Owners

### EvidenceAcceptanceService

**Representation:** exact: `src/evidence/evidence-acceptance.service.ts`

**Evidence:** accepted design and user requirement

Owns deterministic acceptance for one ordered, single-project command. It
validates the complete command, classifies operation retries and source
replays, coordinates sequence allocation and evidence append, records the
Session-maintenance obligation, stores the exact receipt, and owns the outer
SQLite write transaction. Any failure rolls back the complete command.

Detailed design:
[`EvidenceAcceptanceService`](pseudocode/src/evidence/evidence-acceptance.service.ts.md).

### Evidence Contracts

**Representation:** exact: `src/evidence/evidence-item.dto.ts`

**Evidence:** accepted design

Owns the immutable provider-neutral candidate and accepted-item value shapes.
A candidate carries normalized capture provenance, content, resolved
`WorkspaceContext`, optional source time, and lossless source material. An
accepted item adds only its SQLite identity and acceptance time.

### EvidenceLogRepository

**Representation:** exact:
`src/storage/sqlite/repositories/evidence-log.repository.ts`

**Evidence:** accepted design

Owns project-local sequence allocation, append-only evidence mapping, and
source-replay lookup through the caller-supplied transaction. It returns plain
persistence results and does not classify replay or own transaction lifecycle.

### EvidenceItem

**Representation:** exact: `src/storage/sqlite/models/evidence-item.model.ts`

**Evidence:** accepted design

Owns one immutable accepted-evidence row. Relational projections support
project ordering and later retrieval. Lossless JSON preserves complete origin,
workspace, and source-material facts. Optional replay fields form one
all-or-none unique identity group.

### EvidenceAcceptanceOperationRepository

**Representation:** exact:
`src/storage/sqlite/repositories/evidence-acceptance-operation.repository.ts`

**Evidence:** accepted design

Owns transactional lookup and immutable insertion for successful acceptance
operations. It stores the supplied fingerprint and complete versioned receipt
without deciding whether a retry matches or conflicts.

### EvidenceAcceptanceOperation

**Representation:** exact:
`src/storage/sqlite/models/evidence-acceptance-operation.model.ts`

**Evidence:** accepted design

Owns the durable operation identity, project ownership, command fingerprint,
receipt schema version, exact receipt JSON, and commit time. Its unique
operation identity is the final concurrency constraint for request retries.

### Session Maintenance Obligation

**Representation:** semantic: `Session Maintenance Obligation`

**Evidence:** accepted design and user requirement

Owns the durable fact that newly accepted project evidence requires later
Session evaluation. Evidence acceptance records this fact in its transaction.
The obligation does not run maintenance, invoke an agent, or mutate Session
Memory.

## Existing Files Or Owners Relied On

### WorkspaceContext

**Representation:** exact: `src/workspace/workspace-context.ts`

**Evidence:** verified implementation and accepted design

Supplies the registered Project, canonical invocation directory, and optional
observed repository branch preserved with each candidate.

### Project

**Representation:** exact: `src/storage/sqlite/models/project.model.ts`

**Evidence:** verified implementation and accepted design

Owns the registered project identity and its last allocated evidence sequence.
Sequence allocation and evidence insertion change atomically.

### SqliteDatabase

**Representation:** exact: `src/storage/sqlite/sqlite-database.ts`

**Evidence:** verified implementation and accepted design

Owns the process-scoped Sequelize connection and managed `IMMEDIATE`
transaction used for the complete acceptance operation.

## Admission Rule

The shape admits only the contracts and owners needed to convert normalized,
resolved captured evidence into immutable durable evidence with project
ordering, two distinct replay protections, one atomic Session obligation, and
one recoverable receipt. Capture adapters and the development fixture can use
this boundary later without acquiring persistence or Session authority.
