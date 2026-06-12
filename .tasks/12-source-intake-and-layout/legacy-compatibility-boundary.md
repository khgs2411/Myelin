# Legacy Compatibility Boundary

## Outcome

Myelin has a clear boundary between useful legacy data and obsolete V1 behavior.

## Why it matters

The docs allow breaking weak V1 behavior, but not casually discarding useful project knowledge, sources, or provenance.

## Scope

- Legacy command names.
- Legacy layouts.
- Migration references.
- Preserved project knowledge.
- Compatibility contracts such as `LLM_WIKI_*`.

## Done means

- New work uses Myelin/V2 vocabulary.
- Legacy data is migrated, referenced, or intentionally rejected.
- External/env contracts are preserved until a deliberate compatibility slice changes them.

## Notes

- Related: ADR 0015 and ADR 0050.
