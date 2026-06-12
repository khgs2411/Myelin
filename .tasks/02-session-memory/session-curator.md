# Session Curator

## Outcome

A bounded curator can summarize a meaningful session into continuity state.

## Why it matters

The product needs "what happened last session?" without turning every raw event into curated wiki prose.

## Scope

- Summarize what changed.
- Record what was verified.
- Capture next actions and blockers.
- Preserve source evidence.

## Done means

- A session stop can produce a useful summary candidate.
- The summary does not mutate Project Memory directly.
- The output can feed the current briefing.

## Notes

- Hooks should not call models directly.
