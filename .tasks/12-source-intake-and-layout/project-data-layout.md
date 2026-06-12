# Project Data Layout

## Outcome

Project-owned memory uses a coherent layout under `projects/<key>/`.

## Why it matters

The layout is part of the product contract agents rely on for maintenance and retrieval.

## Scope

- `sources/`
- `wiki/`
- `schema/`
- `state/`
- `log/`
- `runs/`

## Done means

- Project onboarding creates the canonical layout.
- Commands read and write the target layout consistently.
- Legacy/global artifacts are treated as migration references, not target structure.

## Notes

- Related: `MYELIN.md` section 12.
- Related: ADR 0046.
