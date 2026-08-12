# C03 — Runtime primitives

- **Wave:** 1 (serial) · **Depends on:** C02 · **Parallel with:** none
- **Implements:** Task 3 of the Phase-0 plan
- **Contract:** see `README.md` (shared)

## Scope
Lean reimplementation of the core runtime helpers (adapt `mcp/src/fs.ts` where it fits, per ADR 0052). Read `legacy/` only to recall specifics; tests written fresh against V2 intent.

## Files
- Create: `src/runtime/{fs,json,config,projects,state,artifacts,process}.ts` + tests.
- Cover: safe path resolution, deterministic JSON IO, config load (incl. `myelin.config` model profiles), project discovery/registry, state read/write, artifact paths, subprocess helpers.

## Acceptance (gate)
- `bun test && bun run typecheck` PASS, with tests for missing files, safe-path rejection, project discovery, config precedence, deterministic JSON.

## Trello
- **Title:** C03 — Runtime primitives (src/runtime/*)
- **List:** Backlog until C02 Done, then Intake.
