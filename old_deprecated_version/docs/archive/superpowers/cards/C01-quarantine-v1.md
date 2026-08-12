# C01 — Quarantine V1

- **Wave:** 1 (serial) · **Depends on:** — · **Parallel with:** none
- **Implements:** Task 1 of the Phase-0 plan
- **Contract:** see `README.md` (shared)

## Scope
Move the V1 Python/Bash runtime into a git-tracked `legacy/` reference folder; rewrite happens fresh in `src/`. No V1 behavior is an acceptance target (ADR 0047).

## Files
- Move → `legacy/`: **all of** `agents/` (this includes the stage-instruction `*.md`/`*.json` under `agents/update/*/`), `scripts/`, root `tests/`, the old `Makefile`, `pyproject.toml`.
- Keep in place: `projects/`, `raw/`, `concepts/`, `docs/`, `schema/`, `/mcp`.
- Exclude `legacy/` from the TS build/test.
- Stage-instruction data now lives at `legacy/agents/update/*/`; **C05 migrates it to `stages/`** before C10 needs it. C01 keeps no separate copy.

## Acceptance (gate)
- Repo root is clean for a fresh `src/`; `legacy/` compiles/runs nothing automatically.

## Trello
- **Title:** C01 — Quarantine V1 → legacy/
- **List:** Intake (Wave 1, first).
