# C04 — Status walking-skeleton (GATE)

- **Wave:** 2 (gate) · **Depends on:** C03 · **Parallel with:** none — gate; Waves 3+ stay in Backlog until this is Done
- **Implements:** Task 4 of the Phase-0 plan · **ADR:** 0052
- **Contract:** see `README.md` (shared)

## Scope
`myelin status` answers "what project am I in / latest session / what's stale" deterministically from existing project state. No schema, no LLM. Adapt `mcp/src/wiki-state.ts` (`projectMap`, `listWikiProjects`) into core.

## Files
- Adapt: `mcp/src/wiki-state.ts` → `src/query/wiki-state.ts` (or `src/runtime/`).
- Create: `src/commands/status.ts`.

## Acceptance (gate — go/no-go for the whole slice)
- `myelin status` runs end-to-end against `trygga` (current layout) and prints a real status.
- `--json` emits the Facade Response Contract fields.
- Runtime + data access proven on real data before any breadth is built.

## Trello
- **Title:** C04 — Status walking-skeleton (gate)
- **List:** Backlog until C03 Done, then Intake (Wave 2). Hold Waves 3+ until this is Done.
