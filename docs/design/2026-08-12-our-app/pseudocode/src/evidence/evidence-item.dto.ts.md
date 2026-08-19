# `src/evidence/evidence-item.dto.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/evidence/evidence-item.dto.ts`

This artifact defines two related immutable provider-neutral contracts.
`EvidenceCaptureService` and `EvidenceInsertionService` construct
`EvidenceCandidateDto` values before durable admission.
`EvidenceIngestionService` creates `EvidenceItemDto` values only after it admits
new evidence. Source workflows therefore do not own durable evidence identity
or acceptance time.

```ts
// intentionally illustrative pseudocode

type EvidenceItemId = application-owned branded string

type EvidenceSourceIdentity = Readonly<{
  key: string
}>

type EvidenceContent = string

type EvidenceSourceMaterial = Readonly<{
  mediaType: string
  content: string
  integrity: Readonly<{
    algorithm: "sha256"
    digest: string
  }>
}>

type EvidenceOrigin =
  | Readonly<{
      kind: "capture"
      source: EvidenceSourceIdentity
      event: Readonly<{
        nativeKind: string
        sessionReference?: string
        interactionReference?: string
      }>
    }>
  | Readonly<{
      kind: "insertion"
      source: EvidenceSourceIdentity
      request: Readonly<{
        clientReference?: string
      }>
    }>

type EvidenceCandidateDto = Readonly<{
  origin: EvidenceOrigin
  content: EvidenceContent
  workspaceContext: WorkspaceContext
  occurredAt?: normalized timestamp
  sourceMaterial: EvidenceSourceMaterial
}>

type EvidenceItemDto = Readonly<
  EvidenceCandidateDto & {
    id: EvidenceItemId
    receivedAt: normalized timestamp
  }
>
```

## Identity and provenance

`EvidenceCandidateDto` has no durable application evidence identity.
`EvidenceItemId` is created by `EvidenceIngestionService` inside the acceptance
transaction after operation and source replay classification. A replayed
candidate reuses the existing accepted evidence identity and does not create a
discarded ID. Evidence identity is not a provider event reference, insertion
idempotency key, or deduplication identity.

`origin.kind` identifies which application workflow constructed the DTO.
`origin.source` is a stable application-owned source identity, such as
`codex.hook`, `claude-code.hook`, `our-app.cli`, or `our-app.mcp`.

A capture origin preserves the provider's native lifecycle event plus the
normalized session and interaction coordinates that the provider supplies.
For Codex, `turn_id` becomes `interactionReference`. For Claude Code,
`prompt_id` becomes `interactionReference` when present. Neither provider field
name enters the shared contract.

An insertion origin preserves the insertion channel and an optional caller
reference. Trusted principal, caller authority, and correction authorization
remain separate invocation context and never enter `EvidenceOrigin`.

## Content and source material

`content` is one normalized string. A conversation message, manually supplied
statement, URL, documentation reference, file path, or explanation remains
content without receiving a semantic content kind during capture or insertion.
Later curation interprets its meaning.

`sourceMaterial` preserves the exact content-bearing input before
normalization. Capture stores the exact provider payload with its media type.
CLI and MCP insertion store the exact submitted evidence string as
`text/plain`; they do not store the complete command or tool request envelope.

The SHA-256 digest is computed over the UTF-8 bytes of the preserved `content`.
It proves the integrity of that stored material. It is not evidence identity,
source replay identity, or proof that the source was truthful.

Provider- or channel-specific fields that are not normalized origin
coordinates remain inside the preserved source content, not at the top level
of either DTO. Normalized fields and source material can contain the same facts
intentionally: normalized fields support application behavior, while source
material supports audit and future re-normalization.

## Replay identity is not origin

`EvidenceOrigin` records provenance. It does not control replay suppression.
An ingestion command may carry a separate optional replay identity:

```ts
type SourceReplayIdentity = Readonly<{
  domain: ApplicationOwnedDedupDomainId
  scheme: string
  key: string
}>
```

The ingestion store enforces uniqueness on `(domain, scheme, key)`. Reusing a
replay identity with different canonical evidence is a conflict, never a
correction. A source without a reliable replay identity remains admissible but
cannot claim cross-delivery replay suppression.

Codex can derive a replay key from its session, turn, and native event kind
under a versioned scheme. Claude Code can use its session, prompt, and native
event kind when `prompt_id` is present. Hashing content is not a safe fallback
because two legitimate events can contain identical content.

This compatibility check is grounded in the current
[Codex UserPromptSubmit schema](https://github.com/openai/codex/blob/main/codex-rs/hooks/schema/generated/user-prompt-submit.command.input.schema.json),
[Codex Stop schema](https://github.com/openai/codex/blob/main/codex-rs/hooks/schema/generated/stop.command.input.schema.json),
and [Claude Code hook fields](https://code.claude.com/docs/en/hooks#common-input-fields).

## Time semantics

`occurredAt` is optional because not every source provides a trustworthy event
time. `receivedAt` is assigned only by `EvidenceIngestionService` when the new
evidence commits to the Evidence Log. It is an acceptance result and does not
participate in operation-command equality.

## Runtime and persistence boundary

Neither DTO is a SQLite row. `EvidenceCandidateDto` is the pre-acceptance
service contract. `EvidenceItemDto` is the accepted runtime evidence contract.
The Evidence Log persistence projection may add ordered and indexed columns
without changing either DTO.

```text
EvidenceCaptureService | EvidenceInsertionService
  -> EvidenceCandidateDto
      -> EvidenceIngestionService
          -> accepted EvidenceItemDto
              -> future persistence mapping
                  -> EvidenceItemRow
                      -> evidence_items table
```

The persistence model can normalize, index, or split DTO fields without
changing this service contract. It can later move source-material content to
content-addressed local files while preserving the same DTO and digest. The
database projection remains `OPEN` until the Evidence Log persistence boundary
is designed.

## DTO boundary

The DTOs are plain immutable data. No shared DTO base class, decorator
framework, transformer dependency, or DTO-owned behavior is established.
Serialization uses their plain data shape rather than a DTO `toJSON()` method.

An explicit runtime validation schema validates the complete
`EvidenceCandidateDto` at the ingestion boundary before durable acceptance.
`EvidenceItemDto` is constructed only inside `EvidenceIngestionService` from a
validated candidate plus ingestion-owned identity and acceptance time. Its
construction enforces those added invariants; it does not re-interpret source
input.

The concrete validation library and source-file owner remain `OPEN`. No new
validation artifact or base class is justified until that implementation
boundary is shaped.
