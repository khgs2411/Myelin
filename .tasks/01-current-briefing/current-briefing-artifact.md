# Current Briefing Artifact

## Outcome

Each project has a current briefing artifact that summarizes the project state an agent needs at session start.

## Why it matters

Without a compact briefing, agents re-discover context, repeat work, and miss stale or unresolved state.

## Scope

- Project identity and purpose.
- Recent session/task summary.
- Current branch/worktree/run state when available.
- What changed recently.
- What was verified.
- Open blockers, stale warnings, and uncertainties.
- Suggested next useful action.
- Citations to source memory or repo evidence.

## Done means

- A human can read the artifact and understand the current project state.
- `myelin status <project>` can include or point to it.
- The artifact marks uncertainty instead of pretending stale knowledge is fresh.

## Notes

- Related: `MYELIN.md` sections 4, 10, and 11.
- Keep this focused on starting context, not full project documentation.
