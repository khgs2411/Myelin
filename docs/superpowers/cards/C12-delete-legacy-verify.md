# C12 — Delete legacy + final verification

- **Wave:** 7 (last) · **Depends on:** all (C01–C11) · **Parallel with:** none
- **Implements:** Task 12 of the Phase-0 plan
- **Contract:** see `README.md` (shared)

## Scope
Remove the quarantine and prove the slice end-to-end.

## Files
- Delete: `legacy/`.

## Acceptance (gate)
- `bun test` and `bun run typecheck` PASS.
- Smoke on `trygga`: `myelin status`, `myelin memory query "..."`, `myelin project learn --dry-run`.
- Normal operation needs no Python / `.venv`; `/mcp` remains ignored/detached; `LLM_WIKI_*` contracts intact.
- Report the next slice (SQLite memory foundation).

## Trello
- **Title:** C12 — Delete legacy + final verify
- **List:** Backlog until C01–C11 Done, then Intake (Wave 7).
