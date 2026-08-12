# Project Memory Curator Pseudocode Artifacts

Status: Accepted first-class planning input

## Source Artifacts

- `docs/design/2026-06-18-project-memory-curator/spec.md`
- `docs/design/2026-06-18-project-memory-curator/agenda.md`
- `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`
- `CONTEXT.md`
- Current code references: `src/project/project-service.ts`, `src/project/project-memory-packet.ts`, `src/pipeline/runner.ts`, `src/commands/project.ts`

## Accepted Shape Summary

- `project learn` is authoritative and mode-scoped.
- `create` mode applies until trusted curated Project Memory exists.
- `maintain` mode applies after trusted curated Project Memory exists.
- Creation emits a Project Memory Creation Draft.
- Maintenance emits a Project Memory Maintenance Proposal.
- Creation and maintenance share evidence, path, risk, and validation primitives, but not one generic top-level schema.
- Project Memory Curator domain logic belongs under `src/project/`.
- `project ingest` is obsolete in the target Project Memory model; source/inbox intake is folded into `project learn` packet construction.
- `src/pipeline/runner.ts` is not preserved as a future product abstraction; useful mechanics may be extracted as runtime helpers only.
- Maintenance validation is per item: `eligible`, `rejected`, `quarantined`, or `noop`.
- Packet-resolvable evidence is the schema floor; repo/file citations are practically required whenever available.
- Curator-specific artifacts should replace generic Phase-0 stage artifacts for `project learn`.

## Assumptions Made

- The existing Phase-0 pipeline is scaffolding to replace, not the final Project Memory maintenance design.
- The current `ProjectMemoryPacket` remains the primary input boundary for curator runs.
- Pending Project Memory source/inbox material should become packet input, not a separate command output.
- The first implementation slice should produce validated curator artifacts and stop before writing wiki markdown.
- Project Memory semantic code should live under `src/project/`; generic run helpers should live under `src/runtime/` if extracted.

## Non-Executable Rule

Every source-like file in this folder is pseudocode reference material, not implementation.

## Artifact Map

| Artifact | Type | Intended Destination | Responsibility |
| --- | --- | --- | --- |
| `src/project/project-memory-curator-contracts.ts` | File-shaped | `src/project/project-memory-curator-contracts.ts` | Defines shared primitives plus creation and maintenance contracts. |
| `src/project/project-memory-curator-validator.ts` | File-shaped | `src/project/project-memory-curator-validator.ts` | Owns deterministic validation for curator outputs. |
| `src/project/project-memory-curator-service.ts` | File-shaped | `src/project/project-memory-curator-service.ts` | Owns project-learn curator flow, including source/inbox intake into packet construction. |
| `ProjectLearnCuratorFlow.md` | Flow-shaped | Multiple files | Captures creation/maintenance sequencing, harness checks, agent call, and pre-write gate. |
| `ProjectRunInfrastructureBoundary.md` | Boundary-shaped | `src/runtime/*`, `src/project/*` | Defines what mechanical run infrastructure may own versus Project Memory domain code. |

## Cross-Artifact Relationships

- `project-memory-curator-service.ts` consumes `ProjectMemoryPacket` and calls the provider runner.
- `project-memory-curator-contracts.ts` defines the contracts used by both service and validator.
- `project-memory-curator-validator.ts` validates creation drafts and maintenance proposals using packet context.
- `ProjectLearnCuratorFlow.md` describes the sequence that future implementation plans should preserve.
- `ProjectRunInfrastructureBoundary.md` prevents extracted run helpers from owning Project Memory semantics.

## Libraries And Conventions To Preserve

- Use existing TypeScript/Bun runtime patterns.
- Use existing JSON artifact helpers from `src/runtime/json.ts`.
- Use existing provider abstraction from `src/runtime/llm-client.ts`.
- Extract run helpers under `src/runtime/` only when they remain mechanical.
- Keep MCP detached; do not import MCP code into root `src/`.
- Keep Project Memory markdown canonical; SQLite/vector state remains non-canonical serving state.

## Review Points

- `project-memory-curator-contracts.ts`: confirm the split between `ProjectMemoryCreationDraft` and `ProjectMemoryMaintenanceProposal` is the shape to preserve into planning.
- `project-memory-curator-validator.ts`: confirm per-item outcomes are the right validation surface for maintenance, while creation starts with broader draft-level validation.
- `project-memory-curator-service.ts`: confirm this service should own `project learn` semantics, including source/inbox intake into packet construction.
- `ProjectLearnCuratorFlow.md`: confirm this slice should intentionally stop before markdown writes.
- `ProjectRunInfrastructureBoundary.md`: confirm no extracted runtime helper may own Project Memory semantics.

## Planning Handoff

`$pmp-writing-plans` should preserve the pseudocode-defined domain boundaries, contract split, validator API shape, service ownership, and project-learn flow unless it records an evidence-backed divergence in `plan.md`.

## Open Risks Or Allowed Divergence

- Exact field names may change during implementation if tests show a clearer TypeScript shape.
- The creation draft validator may start with structural checks only, while maintenance validation gets stricter first.
- Implementation planning may either extract mechanical helpers from `src/pipeline/runner.ts` before removing it or rewrite the small needed mechanics directly under the curator service/runtime boundary.
