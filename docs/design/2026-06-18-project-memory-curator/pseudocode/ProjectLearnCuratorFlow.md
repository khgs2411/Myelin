# ProjectLearnCuratorFlow

Pseudocode artifact. Non-executable reference shape for planning.

## Intended Destination

Multiple files:

- `src/commands/project.ts`
- `src/project/project-service.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-packet.ts`
- `src/project/project-memory-curator-validator.ts`
- optional extracted helpers under `src/runtime/`

## Agreed Shape

`project learn` is the authoritative command for Project Memory creation and maintenance.

`project ingest` is not part of the target Project Memory command model. Pending source/inbox material is gathered into the Project Memory packet during `project learn`.

The command determines authority from trusted Project Memory state:

- `create`: no trusted curated Project Memory exists.
- `maintain`: trusted curated Project Memory exists.

Preexisting markdown without `project-memory.json` is untrusted context in `create` mode.

## Flow

1. CLI parses `myelin project learn <key>` using existing project command shape.
2. CLI no longer routes `project learn` through `runProjectPipeline`.
3. `ProjectService` delegates `learn` to `ProjectMemoryCuratorService.runProjectLearn`.
4. Curator service verifies project shell and schema context.
5. Curator service gathers Project Memory source/inbox material for packet inclusion.
6. Curator service builds `ProjectMemoryPacket`.
7. Curator service chooses mode from packet and trusted Project Memory state.
8. Curator service invokes the provider with a mode-specific prompt:
   - creation prompt expects `ProjectMemoryCreationDraft`
   - maintenance prompt expects `ProjectMemoryMaintenanceProposal`
9. Curator service writes curator-specific raw output artifact.
10. Validator parses and validates output against packet.
11. Curator service writes `curator-validation.json`.
12. This slice stops before markdown writes.
13. Result summary says whether the run produced an eligible creation draft or maintenance proposal, and whether writes were intentionally skipped.

## Harness Owns

- project lookup
- bootstrap shell verification
- schema context verification/building
- source/inbox material discovery for Project Memory packet input
- packet building
- mode selection
- artifact writing
- JSON/schema parsing
- deterministic validation
- no-write stop condition

## Agent Owns

- first-brain synthesis in creation mode
- durable-knowledge interpretation in maintenance mode
- proposing itemized changes in maintenance mode
- explaining noops and quarantines

## Failure Posture

- Provider failure: no markdown mutation; write failure artifact if possible.
- Invalid JSON: global validation failure; no markdown mutation.
- Wrong mode output: global validation failure; no markdown mutation.
- Item-level maintenance errors: per-item rejection/quarantine; no item writes in this slice.
- Missing repo evidence for repo-groundable claim: reject or quarantine.

## Review Notes

- Planning should remove `project learn` from `runProjectPipeline` and should not preserve `project ingest` as a separate Project Memory command.
- Planning may extract mechanical helpers from `src/pipeline/runner.ts`, but Project Memory semantics must remain in `ProjectMemoryCuratorService` and related `src/project/` modules.
