# Project Memory Shape Pseudocode Artifacts

Status: Reference-ready draft for implementation planning. Non-executable; preserve these shapes unless planning records an evidence-backed divergence.

## Draft Shape Summary

These artifacts translate the finalized Project Memory Step 4 design into reviewable, non-executable shape notes. They focus on the contracts and flows that planning must preserve: role-based documentation quality, content-quality versus retrieval-readiness status, section-first maintenance, normalized candidate/handoff producer intake, and markdown-backed Project Memory query returns.

The artifacts intentionally avoid implementation chunks. They describe ownership, inputs, outputs, terminal states, and failure posture so later `$pmp-writing-plans` can split the work without reopening the core boundaries.

## Assumptions Made

- Project Memory canonical truth remains `projects/<key>/wiki/*.md` plus project state JSON.
- SQLite/vector rows for Project Memory remain derived serving state and never become canonical memory.
- The current `ProjectMemoryCuratorService.runProjectLearn` orchestration remains the primary lifecycle owner.
- The current structured-output, validator, markdown applier, apply journal, and retrieval lifecycle mechanics should be extended rather than replaced.
- Exact TypeScript enum names, JSON schema field names, and section marker syntax are implementation details for later planning, as long as they preserve these artifacts' ownership and terminal-state boundaries.

## Artifact Map

| Artifact | Type | Intended Destination | Responsibility |
| --- | --- | --- | --- |
| `QualityContractAndRunStatus.md` | Boundary-shaped | `src/project/project-memory-curator-contracts.ts`, validator/result artifacts, state metadata | Defines documentation quality, content-quality states, retrieval-readiness states, and run-status relationships. |
| `CreationDocumentationFlow.md` | Flow-shaped | `ProjectMemoryCuratorService`, prompt budget, output schema, validator, applier | Shapes create-mode flow from orientation evidence through quality gating and curated-state writes. |
| `MaintenanceSectionTargetingFlow.md` | Flow-shaped | maintenance output contract, packet, validator, markdown applier | Shapes maintain-mode section-first updates while preserving bounded deterministic writes. |
| `ProducerCandidateBoundary.md` | Boundary-shaped | Session ingest output, runtime inbox intake, project packet construction | Defines how producers feed Project Memory as leads without owning durable writes. |
| `ProjectMemoryMarkdownQueryBoundary.md` | Boundary-shaped | future query facade/service over Project Memory retrieval rows | Defines markdown-backed content-or-reference query behavior distinct from Session Memory row retrieval. |

## Cross-Artifact Relationships

- `ProducerCandidateBoundary.md` explains how leads enter the packet; `CreationDocumentationFlow.md` and `MaintenanceSectionTargetingFlow.md` explain how the curator must treat those leads.
- `QualityContractAndRunStatus.md` applies to both creation and maintenance. It is the gate before any Project Memory state can be treated as curated.
- `ProjectMemoryMarkdownQueryBoundary.md` depends on trusted Project Memory content and derived retrieval rows; it must not consume candidate text or shallow review-only markdown as canonical answers.
- Section-first maintenance depends on structural metadata from existing markdown sections, but the applier remains responsible for safe bounded writes.

## Libraries And Conventions To Preserve

- Bun/TypeScript core runtime and existing `src/project/*`, `src/memory/*`, `src/query/*`, and `src/commands/*` boundaries.
- Artifact-reference curator transport with `input-packet.json` and `curator-output-contract.json`.
- Deterministic validation before canonical writes.
- Apply journals and staged promotion for canonical markdown/state writes.
- `stableJson`-style JSON artifacts and existing run artifact naming conventions.
- `rtk` for future agent command execution where transformed output is sufficient.

## Artifact Quality Checks

- Each artifact states ownership and non-ownership.
- Lifecycle-sensitive artifacts name inputs, outputs, terminal states, idempotency posture, and failure posture.
- Boundary artifacts distinguish current implementation from target shape where relevant.
- No artifact defines copy-paste implementation code.
- No artifact writes implementation plans or chunk sequencing.

## Review Points

- Confirm whether the named content-quality states are clear enough for planning, even if exact enum names change.
- Confirm that section-first maintenance can use either deterministic section IDs or explicit markers as long as it preserves bounded writes.
- Confirm that Project Memory query should be a new layer in the query facade rather than mutating Session Memory query semantics in place.
- Confirm that producer normalization should keep using both Memory Candidates and Layer Handoff Instructions as accepted input shapes.
- Treat the six first-create roles in `spec.md` as the default contract unless planning explicitly records a merge/split that preserves coverage.
- Keep Project Memory query work separate from creation/maintenance quality work, or explicitly defer it, so the Session Memory and Project Memory query truth sources do not blur.

## Use Notes

Downstream design, planning, or implementation should preserve the files, flows, boundaries, method grammar, and ownership described here unless new repo evidence forces a visible divergence. Divergence should be recorded in the future plan or implementation report, not hidden inside code changes.

## Open Risks Or Allowed Divergence

- Allowed divergence: exact section-target representation may be section refs, durable heading anchors, generated markers, or a hybrid if deterministic update safety is preserved.
- Allowed divergence: exact query content-size threshold and JSON result names may be chosen during planning.
- Risk: content-quality diagnostics can become subjective unless planning defines concrete role/section/citation checks.
- Risk: adding Project Memory query into the existing `memory query` facade too early could blur Session Memory row retrieval with markdown-backed Project Memory retrieval.

## Non-Executable Rule

Every artifact in this folder is pseudocode reference material, not implementation. Do not copy these artifacts into `src/` as source code.

## Source Artifacts

- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/spec.md`
- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/agenda.md`
- `docs/ROADMAP.md`
- `CONTEXT.md`
- `/Users/liadgoren/.codex/skills/pmp-pseudocode/references/PSEUDOCODE-FORMAT.md`

## Code Context Inspected

- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-apply-contracts.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-packet.ts`
- `src/project/project-memory-markdown-sections.ts`
- `src/memory/project-memory-retrieval-indexer.ts`
- `src/query/memory-query-service.ts`
