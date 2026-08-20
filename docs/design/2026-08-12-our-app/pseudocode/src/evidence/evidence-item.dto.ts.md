# `src/evidence/evidence-item.dto.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/evidence/evidence-item.dto.ts`

This artifact defines two related immutable provider-neutral contracts.
`EvidenceCaptureService` and `EvidenceInsertionService` construct
`EvidenceCandidateDto` values before durable admission.
`EvidenceAcceptanceService` creates `EvidenceItemDto` values only after it admits
new evidence. Source workflows therefore do not own durable evidence identity
or acceptance time.

```ts
// intentionally illustrative pseudocode

type EvidenceItemId = positive integer assigned by SQLite

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
        batchItemIndex: non-negative integer
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
For new evidence, the Evidence Log insert creates `EvidenceItemId` through its
SQLite auto-increment primary key inside the acceptance transaction.
`EvidenceAcceptanceService` then constructs `EvidenceItemDto` from the
validated candidate, generated identity, and acceptance time. A replayed
candidate reuses the existing accepted evidence identity and does not allocate
another ID. Evidence identity is not a provider event reference, insertion
idempotency key, or deduplication identity.

`origin.kind` identifies which application workflow constructed the DTO.
`origin.source` is a stable application-owned source identity, such as
`codex.hook`, `claude-code.hook`, `our-app.cli`, or `our-app.mcp`.

A capture origin preserves the provider's native lifecycle event plus the
normalized session and interaction coordinates that the provider supplies.
For Codex, `turn_id` becomes `interactionReference`. For Claude Code,
`prompt_id` becomes `interactionReference` when present. Neither provider field
name enters the shared contract.

An insertion origin preserves the insertion channel, ordered batch position,
and optional caller reference. The CLI or future MCP entry boundary establishes
the insertion channel; request content cannot override it. Human or agent
identity, caller authority, and correction authorization never enter
`EvidenceOrigin` without a separately proven contract.

## Content and source material

`content` is one normalized string. A conversation message, manually supplied
statement, URL, documentation reference, file path, or explanation remains
content without receiving a semantic content kind during capture or insertion.
Later curation interprets its meaning.

`sourceMaterial` preserves the exact content-bearing input before
normalization. Capture stores the exact provider payload with its media type.
CLI and MCP insertion store the exact submitted evidence string as
`text/plain`; they do not store the complete command or tool request envelope.
Manual insertion uses the same exact string for normalized `content` and source
material because its input is already a curated evidence statement.

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
An acceptance command may carry a separate optional replay identity:

```ts
type SourceReplayIdentity = Readonly<{
  domain: ApplicationOwnedDedupDomainId
  scheme: string
  key: string
}>
```

The acceptance store enforces uniqueness on `(domain, scheme, key)`. Reusing a
replay identity with different canonical evidence is a conflict, never a
correction. A source without a reliable replay identity remains admissible but
cannot claim cross-delivery replay suppression.

Canonical evidence equality is a versioned fingerprint of the complete
`EvidenceCandidateDto`: origin, content, workspace context, optional source
time, and source material. The comparison excludes the replay lookup identity
and all acceptance-owned results, including evidence identity, acceptance time,
project sequence, and maintenance behavior.

Manual insertion uses its optional request-level client reference to derive a
stable acceptance `operationId` for the complete ordered batch. It does not
create one source-replay identity per item. The stored operation fingerprint
detects any change to batch content, count, or order on retry.

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
time. `receivedAt` is assigned only by `EvidenceAcceptanceService` when the new
evidence commits to the Evidence Log. It is an acceptance result and does not
participate in operation-command equality.

Manual insertion leaves `occurredAt` absent. Its submission time is
`receivedAt`, and the application does not claim that the stated fact occurred
when it was submitted.

## Runtime and persistence boundary

Neither DTO is a SQLite row. `EvidenceCandidateDto` is the pre-acceptance
service contract. `EvidenceItemDto` is the accepted runtime evidence contract.
The Evidence Log persistence projection adds ordered and indexed columns
without changing either DTO.

```text
EvidenceCaptureService | EvidenceInsertionService
  -> EvidenceCandidateDto
      -> EvidenceAcceptanceService
          -> acceptance time + project-local sequence
          -> EvidenceLogRepository.append through supplied transaction
              -> insert EvidenceItem row into evidence_items
              -> SQLite-generated EvidenceItemId
          -> accepted EvidenceItemDto
```

The established Evidence Log projection is hybrid. Stable identity, ordering,
filtering, and time fields become relational columns. This includes project
identity, project-local sequence, nullable Git branch, key origin
discriminators, normalized evidence content, and evidence times. Complete
nested origin, workspace context, and source-material detail remains available
as lossless JSON.

One persistence mapper derives both stored forms from the same immutable
`EvidenceCandidateDto` plus acceptance-owned time and project sequence. SQLite
assigns the row identity. `EvidenceAcceptanceService` uses that identity to
construct `EvidenceItemDto`, which cannot exist for new evidence before its row
exists. The JSON is the lossless evidence snapshot. Relational columns are
immutable query projections, not a second editable source of truth. The
persistence model can later move source-material content to content-addressed
local files while preserving the same DTO, integrity digest, and required
evidence metadata.

The concrete row, column, constraint, and index shape is defined by the
[`EvidenceItem` model](../storage/sqlite/models/evidence-item.model.ts.md).
[`EvidenceLogRepository`](../storage/sqlite/repositories/evidence-log.repository.ts.md)
owns append mapping, optional replay projections, and replay lookup without
changing either DTO. Its other read methods, the migration owner, and the
explicit-forgetting representation remain `OPEN`. Those details do not reopen
the established hybrid projection.

## DTO boundary

The DTOs are plain immutable data. No shared DTO base class, decorator
framework, transformer dependency, or DTO-owned behavior is established.
Serialization uses their plain data shape rather than a DTO `toJSON()` method.

An explicit runtime validation schema validates the complete
`EvidenceCandidateDto` at the acceptance boundary before durable acceptance.
`EvidenceItemDto` is constructed only inside `EvidenceAcceptanceService` from a
validated candidate plus acceptance-owned identity and acceptance time. Its
construction enforces those added invariants; it does not re-interpret source
input.

The concrete validation library and source-file owner remain `OPEN`. No new
validation artifact or base class is justified until that implementation
boundary is shaped.
