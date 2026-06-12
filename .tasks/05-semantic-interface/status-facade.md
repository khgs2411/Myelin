# Status Facade

## Outcome

Agents can ask for structured current state through a `status` facade.

## Why it matters

State and inventory questions should be cheap, structured, and dependable.

## Scope

- Project identity.
- Freshness.
- Latest session.
- Current briefing.
- Inventory of available memory scopes.
- Stale or missing memory state.

## Done means

- Status returns structured data first.
- Prose is a convenience, not the only output.

## Notes

- Related: ADR 0005.
