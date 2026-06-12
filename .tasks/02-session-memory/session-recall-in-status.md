# Session Recall In Status

## Outcome

Status reads recent SQLite session memory instead of relying only on wiki session file mtimes.

## Why it matters

Operational continuity should be immediate and cheap, while curated session markdown can come later.

## Scope

- Recent sessions.
- Latest open/closed session.
- Recent events and next actions.
- Degraded state when SQLite memory is unavailable.

## Done means

- `myelin session recent/show` and `myelin status` agree on latest session state.
- Status can explain missing session memory.

## Notes

- Related: ADR 0002 and `docs/TODO.md`.
