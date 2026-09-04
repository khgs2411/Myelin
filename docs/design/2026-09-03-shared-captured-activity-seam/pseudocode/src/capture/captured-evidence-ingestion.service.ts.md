# `src/capture/captured-evidence-ingestion.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/capture/captured-evidence-ingestion.service.ts`

This artifact records only the input seam reached by the current unit. The
next evidence-value-contract unit owns the exact candidate representation.

```ts
type CapturedEvidenceIngestionInput = Readonly<{
  sourceIdentity: EvidenceSourceIdentity
  observation: CapturedActivityObservation
  workspaceContext: WorkspaceContext
}>

class CapturedEvidenceIngestionService {
  async ingest(
    input: CapturedEvidenceIngestionInput
  ): Promise<EvidenceAcceptanceReceipt> {
    require input.sourceIdentity came from trusted Application composition
    require input.workspaceContext was resolved before this call
    validate CapturedActivityObservation

    preserve for EvidenceCandidateDto construction:
      product activity meaning from input.observation.kind
      normalized content from input.observation.content
      native event, session, and interaction coordinates
      provider occurrence time when present
      exact raw source and its media type
      resolved workspace context

    combine input.sourceIdentity replay domain with observation.sourceReplay
      when sourceReplay is present

    // The next design unit defines the exact candidate field placement.
    construct one EvidenceCandidateDto
    delegate one item to durable evidence acceptance
    return its durable receipt
  }
}
```

Shared ingestion does not parse Codex JSON, infer product meaning from native
event names, resolve Projects, or assign durable evidence identity.
