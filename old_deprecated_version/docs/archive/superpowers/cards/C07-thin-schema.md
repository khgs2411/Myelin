# C07 — Thin global-only schema (check/build)

- **Wave:** 4 · **Depends on:** C05 · **Parallel with:** C09
- **Implements:** Task 7 of the Phase-0 plan · **ADR:** 0049
- **Contract:** see `README.md` (shared)

## Scope
Implement `schema check` (read-only validation) and `schema build` (compile `projects/<key>/state/schema-context.json`, `--dry-run` previews). Consume the authored global `schema/` (`global.md` + `rules/*.json`); validate with Zod; build to the shape in `schema/schema-context.md`. Global-only — no project-local/override/candidate machinery (deferred).

## Files
- Create: `src/schema/*`, `src/commands/schema-check.ts`, `src/commands/schema-build.ts` + tests.

## Acceptance (gate)
- Valid schema compiles; invalid schema fails `build`; `check` mutates nothing.
- `schema build` yields a valid context for a project with no project-local schema (bootstrap).

## Trello
- **Title:** C07 — Thin schema check/build
- **List:** Backlog until C05 Done, then Intake (Wave 4, parallel with C09).
