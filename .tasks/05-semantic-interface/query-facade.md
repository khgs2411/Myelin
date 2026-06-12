# Query Facade

## Outcome

Agents can ask explanatory questions through a `query` facade.

## Why it matters

The main interface should answer what is known without requiring agents to understand page metadata or storage layout.

## Scope

- Project Memory.
- Session Memory.
- Practice and Personal Memory when available.
- Structured recall and vector recall when available.
- Degraded metadata when a scope is unavailable.

## Done means

- `query` returns answer, confidence, scope, citations, candidate ids, degraded state, and source tools.
- It does not silently fall back when required schema context is missing.
- It can optionally synthesize after deterministic retrieval when configured.

## Notes

- Related: ADR 0005 and ADR 0037.
