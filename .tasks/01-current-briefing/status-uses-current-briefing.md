# Status Uses Current Briefing

## Outcome

`myelin status <project>` surfaces the current briefing as the primary session-start answer.

## Why it matters

The `status` command should become the practical "what should I know before working?" entrypoint.

## Scope

- Read the current briefing if it exists.
- Report when it is missing, stale, or degraded.
- Keep structured output available for `--json`.

## Done means

- Status output includes project identity, freshness, recent continuity, and next-action state.
- Missing briefing state is explicit and actionable.

## Notes

- Related: `TODO.md` Session Memory & Recall.
