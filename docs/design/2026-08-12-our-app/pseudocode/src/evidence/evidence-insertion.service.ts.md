# `src/evidence/evidence-insertion.service.ts`

> Pseudocode artifact. Non-executable reference shape.
>
> Superseded: Manual insertion now explicitly targets Project, Personal, or
> Practice Memory and does not enter Session Memory. The current boundary is
> [Targeted Memory Insertion](../../../../2026-09-02-ingestion-boundaries/pseudocode/targeted-memory-insertion.md).

Intended destination: `src/evidence/evidence-insertion.service.ts`

`EvidenceInsertionService` is the deterministic application owner for explicit
evidence supplied through the CLI or future MCP integration. It accepts an
ordered batch of already-curated statements for one exact bootstrapped project,
constructs one `EvidenceCandidateDto` per statement, and delegates atomic
acceptance with immediate Session maintenance intent. It does not invoke an
agent,
select a memory product, create memory candidates, or wait for memory curation.

```ts
// intentionally illustrative pseudocode

type EvidenceInsertionSource = Readonly<{
  key: "our-app.cli" | "our-app.mcp"
}>

type EvidenceInsertionInvocationContext = Readonly<{
  source: EvidenceInsertionSource
}>

type EvidenceInsertionItem = Readonly<{
  content: string
}>

type EvidenceInsertionRequest = Readonly<{
  projectRoot: string
  items: ReadonlyArray<EvidenceInsertionItem>
  clientReference?: string
}>

type EvidenceInsertionInput = Readonly<{
  invocationContext: EvidenceInsertionInvocationContext
  request: EvidenceInsertionRequest
}>

class EvidenceInsertionService {
  constructor(
    private readonly workspaceContextService: WorkspaceContextService,
    private readonly evidenceAcceptanceService: EvidenceAcceptanceService
  ) {}

  async insert(
    input: EvidenceInsertionInput
  ): Promise<EvidenceAcceptanceReceipt> {
    validate the complete request before constructing any evidence

    require at least one ordered item
    require every item to contain usable string content

    IF input.invocationContext.source.key == "our-app.mcp"
      require input.request.clientReference

    workspaceResolution = await workspaceContextService.resolveProjectRoot({
      projectRoot: input.request.projectRoot
    })

    IF workspaceResolution is failed
      fail insertion with its safe workspace diagnostic

    IF workspaceResolution is unmanaged
      fail insertion because the exact root is not a bootstrapped overseen project

    acceptanceItems = input.request.items map in supplied order with itemIndex:
      sourceMaterial = {
        mediaType: "text/plain",
        content: item.content,
        integrity: {
          algorithm: "sha256",
          digest: SHA-256 of the exact UTF-8 item.content
        }
      }

      candidate = EvidenceCandidateDto {
        origin: {
          kind: "insertion",
          source: input.invocationContext.source,
          request: {
            clientReference: input.request.clientReference when present,
            batchItemIndex: itemIndex
          }
        },
        content: item.content,
        workspaceContext: workspaceResolution.context,
        occurredAt: absent,
        sourceMaterial
      }

      return { candidate }

    operationId =
      IF input.request.clientReference exists
        derive one opaque application-owned operation identity from:
          input.invocationContext.source application domain
          workspaceResolution.context.projectReference
          "insertion-batch/v1"
          input.request.clientReference
      OTHERWISE
        new application-owned operation identity

    return evidenceAcceptanceService.accept({
      contractVersion: current EvidenceAcceptanceContractVersion,
      operationId,
      items: acceptanceItems,
      sessionMaintenanceIntent: "immediate"
    })
  }
}
```

## Request and channel contract

`projectRoot` must resolve to the exact canonical root of an existing
bootstrapped overseen project. Manual insertion does not use descendant-path
matching, infer a project from the process working directory, or create a new
project registration. An invalid, inaccessible, or unregistered root is an
explicit insertion failure. It is never an ignored outcome.

The CLI keeps `clientReference` optional for simple human use. Agents may use
that interface, but safe cross-request replay becomes caller responsibility
when they omit the reference. The future agent-only MCP contract requires a
client reference. Its client reuses the same value only when retrying one
logical ordered batch.

The client reference is opaque caller correlation, not content-based duplicate
detection. The service combines it with the insertion-source domain and
resolved project identity to derive one opaque application operation identity
for the complete batch. An exact retry therefore reaches the stored acceptance
operation and returns its exact receipt. Reusing the reference with changed
content, item count, or order conflicts with the stored command fingerprint.
Equal content remains valid in separate intentional batches with different
references or without replay protection.

## Evidence construction boundary

Manual insertion content is already curated enough to express the evidence the
caller wants to preserve. The service therefore does not summarize, trim,
rewrite, classify, or interpret it. `content` and
`sourceMaterial.content` intentionally contain the same exact string. The
complete CLI command or MCP envelope is not source material.

Curated evidence is not accepted memory. The request has no Session, Project,
Personal, or Practice Memory target. The later memory workflow decides which
memory candidates the evidence supports. `occurredAt` remains absent because
timing is not part of the manual insertion contract; evidence acceptance owns
the separate `receivedAt` value.

The complete batch is atomic. Invalid request input produces no candidate and
no acceptance call. Once constructed, `EvidenceAcceptanceService` provides the
all-or-nothing durable acceptance, replay, receipt, and maintenance contract.
`insert()` returns that `EvidenceAcceptanceReceipt` directly and does not
introduce a duplicate insertion-result type.

## Inbox view

Inbox is product vocabulary for manually inserted evidence that has not yet
been covered by successful maintenance. It is a logical view over the Evidence
Log, not a second store, queue, item status, or persistence owner:

```text
Inbox
  = accepted EvidenceItems where origin.kind == "insertion"
    and item sequence is after the applicable covered maintenance frontier
```

Maintenance requests, attempts, and the covered cursor own processing state.
An `EvidenceItem` never becomes `processed` only because it entered or left the
Inbox view.
