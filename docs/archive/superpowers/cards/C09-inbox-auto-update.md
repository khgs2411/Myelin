# C09 — Inbox + auto-update primitives

- **Wave:** 4 · **Depends on:** C05 · **Parallel with:** C07
- **Implements:** Task 9 of the Phase-0 plan · **ADR:** 0052
- **Contract:** see `README.md` (shared)

## Scope
Adapt `mcp/src/inbox.ts` (atomic gap-note write + schema, filename convention) and `auto-update.ts` (lockfile + detached spawn) into core. In V2 the spawn target becomes `myelin project ingest`. Tests encode *why* the lockfile/gap loop matters, not ported pytest assertions.

## Files
- Adapt/create: `src/inbox/items.ts`, `src/inbox/auto-update.ts` + tests.

## Acceptance (gate)
- Tests cover inbox item schema + filename validation, low-confidence gap emission, and lockfile acquire/skip/release.
- Detached update logs land under `projects/<key>/logs/`.

## Trello
- **Title:** C09 — Inbox + auto-update primitives
- **List:** Backlog until C05 Done, then Intake (Wave 4, parallel with C07).
