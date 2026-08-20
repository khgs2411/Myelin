# `src/capture/evidence-capture.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/capture/evidence-capture.service.ts`

`EvidenceCaptureService` is the provider-neutral application orchestrator for
one capture invocation. It coordinates normalization, workspace resolution,
`EvidenceCandidateDto` construction, and durable acceptance without owning any
provider-specific behavior.

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

type CaptureInput = Readonly<{
  nativeActivity: ProviderNativeActivity
}>

type CaptureResult =
  | Readonly<{
      kind: "accepted"
      acceptance: EvidenceAcceptanceReceipt
    }>
  | Readonly<{
      kind: "ignored"
      reason: CaptureIgnoreReason | WorkspaceContextIgnoreReason
    }>

class EvidenceCaptureService {
  constructor(
    private readonly invocationContext: CaptureInvocationContext,
    private readonly adapter: CaptureAdapter,
    private readonly workspaceContextService: WorkspaceContextService,
    private readonly evidenceAcceptance: EvidenceAcceptanceService
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

    workspaceResolution = await workspaceContextService.resolve({
      workingDirectory: observation.workingDirectory
    })

    IF workspaceResolution.kind == "failed"
      fail capture with workspaceResolution.failure

    IF workspaceResolution.kind == "unmanaged"
      return {
        kind: "ignored",
        reason: workspaceResolution.reason
      }

    workspaceContext = workspaceResolution.context

    sourceIdentity = resolve application-owned EvidenceSourceIdentity from:
      invocationContext.route

    sourceMaterial = construct EvidenceSourceMaterial from:
      mediaType: observation.rawSource.mediaType
      content: observation.rawSource.content
      integrity:
        algorithm: "sha256"
        digest: SHA-256 of UTF-8 bytes of observation.rawSource.content

    evidenceCandidate = construct EvidenceCandidateDto from:
      origin:
        kind: "capture"
        source: sourceIdentity
        event:
          nativeKind: observation.nativeEventKind
          sessionReference: observation.providerSessionReference when supplied
          interactionReference:
            observation.providerInteractionReference when supplied
      content: observation.content
      workspaceContext
      occurredAt: observation.providerOccurredAt when supplied
      sourceMaterial

    acceptanceItem = {
      candidate: evidenceCandidate,
      sourceReplay: IF observation.sourceReplay exists THEN {
        domain: application-owned replay domain for sourceIdentity,
        scheme: observation.sourceReplay.scheme,
        key: observation.sourceReplay.key
      }
    }

    operationId = new application-owned operation identity for this acceptance

    acceptance = await evidenceAcceptance.accept({
      contractVersion: current EvidenceAcceptanceContractVersion,
      operationId,
      items: [acceptanceItem],
      maintenanceIntent: "policy"
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

`WorkspaceContextService` determines whether the activity belongs to an
overseen project and attaches the registered project context plus current
branch information for managed activity:

```text
provider-observed working directory
  -> WorkspaceContextService
  -> managed WorkspaceContext | unmanaged | failed
```

`EvidenceCaptureService` resolves workspace context exactly once for each evidence
outcome. Each provider hook event starts a separate capture invocation, so two
evidence items can record different workspaces. Provider-session identity stays
in the normalized observation and does not become a `WorkspaceContextService`
responsibility.

An unmanaged result means no registered oversight root contains the observed
working directory. `EvidenceCaptureService` returns an ignored outcome and never sends
the normalized observation or raw provider activity to evidence acceptance.
An invalid, missing, or inaccessible working directory fails capture with a
safe diagnostic.

## Evidence-acceptance handoff

The handoff contains one provider-neutral evidence candidate as a one-item
collection. `EvidenceCaptureService` selects the capture maintenance-intent
category; it does not choose count or elapsed-time thresholds.

Origin and replay metadata remain separate. The capture origin records the
source event, session, and interaction coordinates. When the adapter supplies a
reliable versioned replay key, the service adds the application-owned source
domain and passes that replay identity beside the DTO. It never invents replay
identity from content.

The exact provider activity becomes source material without parsing or
reserializing its content. Integrity hashing protects the preserved content;
it does not participate in event identity or replay suppression.

The application operation identity is created once for this acceptance call
and reused by any internal retry of that call. A later delivery is a new
operation; only reliable source replay metadata can suppress it across
deliveries.

Durable acceptance appends evidence and records the corresponding count- and
time-based maintenance obligation as one recoverable operation. The first
accepted evidence after an elapsed-time condition becomes true performs the
next eligibility evaluation. No provider lifecycle signal is required.

Adapter-ignored and unmanaged input do not reach evidence acceptance. Rejected
input fails capture. The CLI presents these outcomes through the
provider-compatible safe process contract.

## Ownership boundary

`EvidenceCaptureService` owns the order and coordination of the capture use
case. It does not interpret Codex payloads, persist evidence directly, decide
maintenance thresholds, invoke an AI provider, or curate Session, Project,
Personal, or Practice Memory.
