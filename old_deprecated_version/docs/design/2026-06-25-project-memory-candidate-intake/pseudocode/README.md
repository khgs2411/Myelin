# Runtime Durable Memory Candidate Inbox Pseudocode Artifacts

Status: Draft

## Draft Shape Summary

The next Step 3 slice adds the V2 runtime inbox and intake boundary for explicit durable-memory candidate proposals.

The approved waterfall shape is:

```text
Session Memory pipeline
  -> automated session-derived candidate
  -> memory_candidates
  -> project learn
  -> durable Project Memory

memory inbox create
  -> runtime inbox source item
  -> memory inbox intake
  -> memory_candidates
  -> project learn
  -> durable Project Memory
```

The runtime inbox item is preserved source material, not canonical memory and not the normalized candidate. Candidate intake validates the source proposal and normalizes project-scoped items into root SQLite `memory_candidates`, which `project learn` already knows how to curate into durable Project Memory.

The shape is intentionally split along three boundaries:

- `memory inbox create` writes source material only.
- `memory inbox intake` normalizes source material into `memory_candidates`.
- `project learn` owns ordering, recovery, packet construction, validation, and apply.

## Assumptions Made

- The first implementation slice is project-only at the CLI and intake levels.
- The contract still names `project | practice | personal`, but only `project` is accepted in this slice.
- `memory inbox create` is the operator-facing creation surface and does not expose a lifecycle status option.
- Runtime inbox items are immutable source material. Intake does not rewrite them with lifecycle fields.
- Runtime inbox items are stored as pretty JSON under `projects/<key>/sources/inbox/<id>.json`, with `sources/index.md` and `sources/inbox/index.md` created lazily on first write.
- Runtime inbox candidates always normalize to `status: "needs_review"`.
- Candidate creation is deterministic and idempotent. Repeated intake of the same source item returns the same candidate id or an existing-candidate result.
- The normalized candidate carries the source link through `source_event_refs_json`, `evidence_json`, and `proposed_payload_json`.
- `project learn` remains the authoritative Project Memory command, so candidate intake should run before packet construction.
- Candidate intake should run after source-consumption reconciliation, because reconciliation retires candidates already applied to Project Memory.
- Malformed inbox items should be skipped and reported as degraded, not allowed into the curator packet.

## Artifact Map

| Artifact | Type | Intended Destination | Responsibility |
| --- | --- | --- | --- |
| `MemoryInboxCreateCommandShape.md` | Flow-shaped | `src/commands/memory.ts` or a narrow `src/inbox/*` command module | Owns the `memory inbox create` grammar, source-record validation, and write-only runtime inbox creation flow, including lazy `sources/index.md` and `sources/inbox/index.md` creation. |
| `RuntimeDurableMemoryInboxContract.md` | Boundary-shaped | `src/inbox/*`, `src/commands/*`, future tool surface, or unresolved | Owns the runtime inbox item contract for explicit durable-memory proposals across Project, Practice, and Personal layers. |
| `RuntimeInboxItemJsonFormat.md` | File-shaped | `projects/<key>/sources/inbox/<id>.json` | Owns the preserved runtime inbox source file format, validation shape, and write-time invariants. |
| `ProjectMemoryCandidateIntakeService.ts` | File-shaped | `src/project/project-memory-candidate-intake-service.ts` | Owns validated, idempotent conversion from project-scoped runtime inbox items into `scope="project"` memory candidates. |
| `CandidateIdAndDedupeContract.md` | Boundary-shaped | `src/project/*`, `src/memory/candidates.ts`, tests | Defines deterministic candidate ids, duplicate detection, and source-reference conventions. |
| `ProjectLearnCandidateIntakeFlow.md` | Flow-shaped | `src/project/project-memory-curator-service.ts` and tests | Shows where intake runs relative to recovery, source-consumption reconciliation, packet construction, and curator invocation. |
| `CandidateIntakeReliabilityBoundary.md` | Boundary-shaped | Runtime inbox, Project Memory intake, candidate queue, packet builder | Defines ownership and non-ownership so intake does not become a hidden curator, source mutator, or Session Memory replacement. |

## Cross-Artifact Relationships

- `MemoryInboxCreateCommandShape.md` writes the preserved runtime inbox source record and creates the lazily maintained source indexes.
- `RuntimeDurableMemoryInboxContract.md` defines what operators, runtime agents, and future tools create.
- `RuntimeInboxItemJsonFormat.md` gives the source writer and intake reader a stable JSON envelope to validate.
- `ProjectMemoryCandidateIntakeService.ts` reads validated project-scoped runtime inbox items and normalizes them into candidate drafts.
- `CandidateIdAndDedupeContract.md` defines the stable identity that lets the service avoid duplicate rows.
- `ProjectLearnCandidateIntakeFlow.md` places intake after source-consumption reconciliation and before `buildProjectMemoryPacket`.
- `CandidateIntakeReliabilityBoundary.md` keeps runtime inbox, Project Memory candidate intake, Session Memory, markdown apply, packet building, and future Practice/Personal intake responsibilities separate.

## Libraries And Conventions To Preserve

- Preserve Bun/TypeScript service modules under `src/project/`.
- Use root SQLite memory candidate helpers from `src/memory/candidates.ts`.
- Existing stored candidate statuses remain `pending`, `needs_review`, `processed`, and `rejected`; runtime inbox intake creates `needs_review` candidates only.
- Use candidate scope `project` for this slice.
- Keep markdown Project Memory canonical; candidates are untrusted curator input.
- Keep `project packet` read-only.
- Keep the durable-memory inbox under the broader `memory` namespace.
- Reuse existing inbox write/validation utilities only where they serve the runtime inbox contract; do not let producer-specific enums define the product boundary.

## Settled Design Decisions

- Inbox source items are pretty JSON files at `projects/<key>/sources/inbox/<id>.json`.
- `memory inbox create` owns lazy creation and maintenance of `sources/index.md` and `sources/inbox/index.md`.
- Source refs use `inbox:<id>`.
- Project candidate type is `project.inbox`.
- Runtime inbox candidates always normalize to `needs_review`; review means curator/agent evidence review, not operator/manual approval.
- The first slice rejects Practice and Personal layers with an explicit unsupported-layer result until their consumers exist.
- `memory inbox intake <project-key>` is a deterministic provider-free command and `project learn` composes the same intake service.

## Use Notes

Use these artifacts to discuss and implement the next roadmap item without broadening it into retrieval indexing or full Practice/Personal Memory implementation.

The reliability standard for this slice is: runtime-authored project inbox items can become Project Memory candidates exactly once, repeated `project learn` runs do not create duplicates, malformed proposal material does not reach the curator, and candidates are never represented as canonical Project Memory before curation.

## Open Risks Or Allowed Divergence

- Rewriting inbox files to add lifecycle status may become useful, but this draft avoids that because inbox items are preserved source material and deterministic candidate ids already give idempotency.
- If deterministic candidate ids are too limiting, a small project-level source-to-candidate index could be introduced later; it should remain derived lifecycle state, not trusted Project Memory.
- Some runtime inbox proposals may be too weak for intake. It is acceptable to skip them with diagnostics until source-specific reliability is proven.
- The existing `memory_candidates.source_event_refs_json` name is Experience Log-oriented. This draft uses refs such as `inbox:<id>` for inbox proposals, while keeping source refs non-empty.
- Future Practice and Personal intake may share the same contract, but this slice should not force their producer paths into the CLI yet.

## Non-Executable Rule

Every source-like file in this folder is pseudocode reference material, not implementation.

## Source Artifacts

- `MYELIN.md`
- `CONTEXT.md`
- `docs/README.md`
- `docs/ROADMAP.md`
- `docs/CLI.md`
- `docs/IMPLEMENTATION_ALIGNMENT.md`
- `docs/inbox-item-schema.md` (non-authoritative existing producer-specific context; not the V2 runtime inbox contract)
- `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/spec.md`
- `docs/design/2026-06-18-project-memory-curator/spec.md`
- `docs/design/2026-06-25-project-memory-candidate-intake/spec.md`
- `docs/design/2026-06-25-project-memory-candidate-intake/agenda.md`
- `docs/adr/0061-use-layer-shaped-runtime-inbox-with-implemented-consumers.md`
- `docs/design/2026-06-25-project-memory-source-consumption-reconciliation/pseudocode/README.md`

## Code Context Inspected

- `src/inbox/items.ts` (non-authoritative existing producer-specific context; do not preserve its source enum or top-level path as the V2 runtime inbox boundary)
- `tests/inbox/inbox.test.ts`
- `src/memory/candidates.ts`
- `src/project/project-memory-packet.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-source-consumption-reconciler.ts`
- `src/project/project-service.ts`
- `src/commands/memory.ts`
- `src/commands/project.ts`
- `src/runtime/project-shell.ts`
- `src/runtime/fs.ts`
- `tests/project/project-memory-packet.test.ts`
- `tests/project/project-memory-curator-service.test.ts`
- `tests/project/project-memory-source-consumption-reconciler.test.ts`
