# Staleness And Corrections

## Outcome

Agents can flag stale or wrong memory and route the correction into the repair flow.

## Why it matters

The product must fail loud when remembered knowledge is wrong.

## Scope

- Stale answer flags.
- Correction evidence.
- Inbox or candidate creation.
- Clear degraded state until repaired.

## Done means

- A wrong answer can produce a traceable repair item.
- The repair item points at affected memory and source evidence.

## Notes

- `answer.correction` is continuity evidence; it does not repair Project Memory by itself.
