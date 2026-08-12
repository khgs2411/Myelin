# C05 — V2 data layout migration (trygga)

- **Wave:** 3 · **Depends on:** C04 · **Parallel with:** C06
- **Implements:** Task 5 of the Phase-0 plan · **ADR:** 0046
- **Contract:** see `README.md` (shared)

## Scope
Adopt `projects/<key>/{sources,wiki,schema,state,log,runs}/` and migrate the `trygga` project into it with a reusable adapter. Preserve knowledge, raw sources, and provenance (see the design's Migration Preservation Contract).

## Files
- Create: migration adapter (e.g. `src/commands/migrate.ts` or `src/runtime/migrate.ts`).
- **Migrate stage-instruction data** from `legacy/agents/update/*/{instructions.md,config.json}` → `stages/<stage-id>/` (global pipeline data; C10 reads it from there).
- Update C04's `status` readers for the new layout.

## Acceptance (gate)
- `trygga` is migrated; `myelin status` still passes on it.
- Migration is re-runnable / documented for the other projects.

## Trello
- **Title:** C05 — V2 layout migration (trygga)
- **List:** Backlog until C04 Done, then Intake (Wave 3, parallel with C06).
