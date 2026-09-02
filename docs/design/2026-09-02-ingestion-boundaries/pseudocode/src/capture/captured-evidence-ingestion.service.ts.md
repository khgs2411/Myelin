# `src/capture/captured-evidence-ingestion.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/capture/captured-evidence-ingestion.service.ts`

`CapturedEvidenceIngestionService` is the shared deterministic boundary after
source-specific normalization and project resolution. Provider capture and the
development fixture both delegate to it.

```ts
// intentionally illustrative pseudocode

type CapturedEvidenceObservation = Readonly<{
  nativeEventKind: string
  providerSessionReference?: string
  providerInteractionReference?: string
  sourceReplay?: SourceReplayDraft
  providerOccurredAt?: normalized timestamp
  content: string
  rawSource: ProviderNativeActivity
}>

type CapturedEvidenceIngestionInput = Readonly<{
  sourceIdentity: EvidenceSourceIdentity
  observation: CapturedEvidenceObservation
  workspaceContext: WorkspaceContext
}>

class CapturedEvidenceIngestionService {
  constructor(
    private readonly evidenceAcceptance: EvidenceAcceptanceService
  ) {}

  async ingest(
    input: CapturedEvidenceIngestionInput
  ): Promise<EvidenceAcceptanceReceipt> {
    require input.sourceIdentity was established by a trusted entry route
    require input.workspaceContext was resolved before this call
    validate the normalized observation contract

    sourceMaterial = construct EvidenceSourceMaterial from:
      mediaType: input.observation.rawSource.mediaType
      content: input.observation.rawSource.content
      integrity:
        algorithm: "sha256"
        digest: SHA-256 of exact UTF-8 raw-source content

    candidate = construct EvidenceCandidateDto from:
      origin:
        kind: "capture"
        source: input.sourceIdentity
        event:
          nativeKind: input.observation.nativeEventKind
          sessionReference:
            input.observation.providerSessionReference when supplied
          interactionReference:
            input.observation.providerInteractionReference when supplied
      content: input.observation.content
      workspaceContext: input.workspaceContext
      occurredAt: input.observation.providerOccurredAt when supplied
      sourceMaterial

    sourceReplay =
      IF input.observation.sourceReplay exists
        combine input.sourceIdentity replay domain with the observation draft
      OTHERWISE
        absent

    return evidenceAcceptance.accept({
      contractVersion: current EvidenceAcceptanceContractVersion,
      operationId: new application-owned operation identity,
      items: [{ candidate, sourceReplay }],
      sessionMaintenanceIntent: "policy"
    })
  }
}
```

The service receives resolved `WorkspaceContext`. It never resolves a project
key, project path, or observed working directory. This keeps the different
entry paths responsible for their own project-selection method.

The service owns captured source-material construction, its integrity digest,
`EvidenceCandidateDto` construction, replay-domain completion, and delegation
to durable evidence acceptance. It does not parse provider-native input,
establish source identity, resolve workspace context, execute Session
maintenance, or accept targeted durable-memory proposals.
