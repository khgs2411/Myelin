# ProjectRunInfrastructureBoundary

Pseudocode artifact. Non-executable reference shape for planning.

## Intended Destination

Boundary across:

- `src/runtime/*`
- `src/project/project-service.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-curator-validator.ts`

## Boundary Rule

Project Memory semantics belong under `src/project/`.

`src/pipeline/runner.ts` is not a future Project Memory product boundary. If implementation reuses code from it, reuse should happen by extracting mechanical helpers under `src/runtime/`, not by keeping the old runner in charge.

Mechanical run infrastructure may own:

- run directory creation
- JSON artifact writing
- markdown summary writing
- provider invocation wrappers
- schema context freshness helpers
- shared command result formatting

Mechanical run infrastructure must not own:

- Project Memory Creation Draft fields
- Project Memory Maintenance Proposal fields
- mode-scoped authority rules
- source/inbox intake semantics
- evidence/provenance semantics
- per-item validation outcomes
- trusted versus untrusted Project Memory interpretation
- stopped-before-writes product meaning

## Project Curator Service Owns

- `project learn` semantic flow
- Project Memory source/inbox intake into packet construction
- packet input construction for curator runs
- create/maintain mode choice
- curator prompt selection
- curator-specific artifact names
- validation invocation
- stopped-before-writes semantics

## Validator Owns

- schema shape validation
- packet reference resolution
- target path validation
- evidence/reference minimums
- repo citation expectation enforcement
- per-item outcome classification
- global hard-error detection

## Removed Boundaries

- Do not preserve `project ingest` as a separate Project Memory command.
- Do not add Project Memory proposal validation to `src/pipeline/runner.ts` because it currently hosts `runApplyStage`.
- Do not make `ProjectMemoryPacket` responsible for validating curator output.
- Do not let provider prompts define protected metadata or publication status.
- Do not let generic runtime helper status say "completed" when the product meaning is "stopped before writes with eligible proposal."

## Allowed Divergence

Implementation planning may extract helpers from `src/pipeline/runner.ts` before removing or bypassing it.

Implementation planning may also rewrite the small needed mechanics directly if extraction would preserve too much old runner shape.
