# `src/capture/capture.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/capture/capture.service.ts`

`CaptureService` is the provider-neutral application orchestrator for one
capture invocation. It coordinates normalization, workspace resolution,
evidence construction, and durable ingestion without owning any specialized
behavior.

```ts
// intentionally illustrative pseudocode

type ProviderIdentity = Readonly<{
  key: string
}>

type CaptureChannelIdentity = Readonly<{
  key: string
}>

type CaptureInvocationContext = Readonly<{
  route: Readonly<{
    provider: ProviderIdentity
    channel: CaptureChannelIdentity
  }>
}>

type ObservedEnvironment = Readonly<{
  currentWorkingDirectory: string
  // OPEN: additional admitted process observations are not yet shaped
}>

type CaptureInput = Readonly<{
  nativeActivity: ProviderNativeActivity
  capturedAt: normalized timestamp
  observedEnvironment: ObservedEnvironment
}>

type NormalizedEvidence = Readonly<{
  captureRoute: CaptureInvocationContext["route"]
  sourceEventReference: string
  providerSessionReference?: string
  providerTurnReference?: string
  nativeEventKind: string
  capturedAt: normalized timestamp
  providerOccurredAt?: normalized timestamp
  content: ProviderMessageContent
  rawSource: ProviderNativeActivity
  workspaceContext: WorkspaceContext
}>

type CaptureResult =
  | Readonly<{
      kind: "accepted"
      acceptance: EvidenceAcceptanceReceipt
    }>
  | Readonly<{
      kind: "ignored"
      reason: CaptureIgnoreReason
    }>

class CaptureService {
  constructor(
    private readonly invocationContext: CaptureInvocationContext,
    private readonly adapter: CaptureAdapter,
    private readonly workspaceContextService: WorkspaceContextService,
    private readonly evidenceIngestion: EvidenceIngestionService
  ) {}

  async capture(input: CaptureInput): Promise<CaptureResult> {
    normalization = adapter.normalize(input.nativeActivity)

    IF normalization.kind == "rejected"
      fail capture with normalization.failure

    IF normalization.kind == "ignored"
      return {
        kind: "ignored",
        reason: normalization.reason
      }

    observation = normalization.observation

    workspaceContext = await workspaceContextService.resolve({
      providerContextHints: observation.contextHints,
      observedEnvironment: input.observedEnvironment
    })

    evidence = construct NormalizedEvidence from:
      captureRoute: invocationContext.route
      observation
      capturedAt: input.capturedAt
      workspaceContext

    acceptance = await evidenceIngestion.accept({
      evidence: [evidence],
      maintenanceIntent: "count-or-time eligibility"
    })

    return {
      kind: "accepted",
      acceptance
    }
  }
}
```

## Capture-route authority

`CaptureInvocationContext.route` is created before application composition from
the selected capture command route. For the first integration it records:

```text
provider.key = "codex"
channel.key = "hook"
```

The route is the only source of provider and capture-channel identity used in
normalized evidence. The adapter does not declare another provider identity,
and the provider-native payload cannot override the route.

The route proves which application entry path was selected. It does not
cryptographically authenticate the external process that invoked the command
and grants no correction authority.

## Workspace-context dependency

`WorkspaceContextService` resolves deterministic coordinates for the workspace
that produced the captured activity:

```text
provider context hints + observed machine environment
  -> WorkspaceContextService
  -> WorkspaceContext
```

`CaptureService` resolves workspace context exactly once for each evidence
outcome. Each provider hook event starts a separate capture invocation, so two
evidence items can record different workspaces. Provider-session identity stays
in the normalized observation and does not become a `WorkspaceContextService`
responsibility.

## Evidence-ingestion handoff

The handoff contains one provider-neutral evidence item as a one-item
collection. `CaptureService` selects the capture maintenance-intent category;
it does not choose count or elapsed-time thresholds.

Durable acceptance appends evidence and records the corresponding count- and
time-based maintenance obligation as one recoverable operation. The first
accepted evidence after an elapsed-time condition becomes true performs the
next eligibility evaluation. No provider lifecycle signal is required.

Ignored input does not reach evidence ingestion. Rejected input fails capture.
The CLI presents both outcomes through the provider-compatible safe process
contract.

## Ownership boundary

`CaptureService` owns the order and coordination of the capture use case. It
does not interpret Codex payloads, persist evidence directly, decide maintenance
thresholds, invoke an AI provider, or curate Session, Project, Personal, or
Practice Memory.
