# Update Convergence Review Checkpoint Design

`make update` should not feel like an indefinite maintenance lever when the system is still narrowing the same unresolved page-level warning.

## Goal

Detect when an update pass leaves the same semantic warning category on the same target page, and turn that into an explicit manual review checkpoint instead of encouraging more ordinary inbox-driven update loops.

## Problem

The current incremental maintenance loop can improve a page while still leaving a narrower residual warning on that same page. From the operator side, this feels like:

- status reports a warning
- an agent writes inbox items to address it
- `make update` runs successfully
- status reports what looks like "the same warning again"

Even when the evidence has narrowed, the user experience still feels like a loop because the system does not distinguish between:

1. new queued maintenance work
2. residual convergence on the same unresolved page/category boundary

## Design

### Convergence identity

For operator UX, define a convergence checkpoint key as:

- semantic warning `category`
- first affected page in `pages[]`

If an update run starts with a queued maintenance item that targets a page, and the end-of-run validation still reports the same warning category on that same page, treat it as a convergence checkpoint rather than ordinary follow-up work.

This intentionally ignores finer evidence text changes. A warning that narrows from "player lookup and stats/analytics missing" to "stats/analytics still missing" is still the same unresolved `coverage_gap` frontier on the same page from the operator's perspective.

### Operator behavior

When a convergence checkpoint is detected:

- do not encourage another default `make update` loop for that warning
- do not auto-seed more maintenance items for that page/category pair
- mark the update result as requiring manual review before further queued maintenance is generated for that pair

### Status behavior

`make status` should explain this as:

- the update improved the page, but the same page still has the same kind of unresolved warning
- this is now a manual review checkpoint, not a normal queued maintenance step
- next action: review the validation report and decide whether to:
  - narrow the page scope/claims, or
  - add more grounded coverage

It should avoid suggesting `make update` or `make compile` as the default next step for this checkpoint state.

## Non-goals

- do not change validate’s semantic rules
- do not suppress legitimate new warnings on different pages
- do not introduce automatic recursive update loops
- do not expand the public command surface

## Likely implementation shape

- capture the page/category pairs targeted by the just-consumed inbox items in the update run
- compare them with the surviving semantic warnings after validate/reconcile
- if a pair survives, record a review-required marker in stable state for status to read
- prevent `validate-auto` emission for that same page/category while the review-required marker is active

## Open question

The review-required marker should probably clear automatically once either:

- the warning disappears, or
- a later run leaves a different category or a different primary page

That keeps the checkpoint narrow and avoids permanently pinning a page after the frontier actually moves.
