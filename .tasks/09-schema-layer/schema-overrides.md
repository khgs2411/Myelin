# Schema Overrides

## Outcome

Projects can explicitly weaken or replace a global schema rule with a reason.

## Why it matters

Silent schema drift makes agent behavior unpredictable.

## Scope

- Typed override record.
- Required reason.
- Validation.
- Compiled schema-context effect.

## Done means

- Weakening a global rule without an override fails validation.
- Overrides are visible to agents.

## Notes

- Related: ADR 0030.
