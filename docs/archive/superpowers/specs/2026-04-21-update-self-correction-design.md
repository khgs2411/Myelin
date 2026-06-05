# Update Self-Correction Design

`make update` should behave like a bounded self-maintaining maintenance pass, not a machine that keeps raising new work about the work it just did.

## Goal

After draining inbox items, `make update` should get one bounded chance to resolve the semantic warnings it just surfaced by using grounded repo context from the target project and patching the affected wiki pages and nearby related pages.

## Desired operator experience

1. Operator runs `make update PROJECT=<key>`.
2. The inbox-driven maintenance pass runs normally.
3. If validate still leaves non-blocking semantic warnings, the pipeline gets one self-correction pass.
4. That pass may inspect the target repo context and touch related pages when needed.
5. If warnings remain after that one pass, the run stops in a manual-review posture rather than encouraging more ordinary `make update` loops.

## Scope

- Add a new update-only self-correction stage after validate succeeds with semantic warnings.
- Allow the stage to touch related pages when needed.
- Keep the pass bounded to one attempt per `make update`.
- Do not introduce recursive update loops.
- Do not expand the public command surface.

## Flow

For `make update`:

1. `ingest`
2. `apply`
3. `validate`
4. if validate fails: existing `reconcile` path remains unchanged
5. if validate passes and semantic warnings remain: run `self-correct`
6. if `self-correct` returns approved patch units: apply once, validate once more
7. terminal-state
8. apply-commit

The self-correction stage gets exactly one pass. No second self-correction run is allowed inside the same update.

## Repo grounding

The stage should not rely only on warning text. It should receive:

- the surviving semantic warnings
- the current content of affected pages
- related wiki pages
- deterministic repo context harvested from the target repo

The repo context can be bounded and heuristic, but it must be file-backed and local. Good sources include:

- repo citations already present in affected/related pages
- code identifiers referenced in findings or suggested actions
- matching repo files/snippets harvested by deterministic search

## Interaction with `validate-auto`

For update runs, validator-discovered warning emission should not front-run self-correction.

- suppress `validate-auto` emission during update-stage validate calls
- only consider queuing follow-up maintenance after the self-correction pass is exhausted
- if warnings still remain after self-correction, default to manual review instead of auto-queuing more work

## Status behavior

If a warning remains after self-correction, `make status` should treat it as:

- a residual maintenance issue after one bounded self-correction pass
- not normal queued inbox work
- not a default invitation to run `make update` again immediately

The status surface should point the operator to the validation report and the suggested fix.
