# ProjectMemoryVisionGateBoundary

Pseudocode artifact. Non-executable reference shape for planning.

## Boundary Summary

This boundary separates three distinct responsibilities:

- deterministic validation decides whether the create payload is structurally safe and repo-grounded enough to consider;
- independent usefulness critique decides whether the rendered docs look practically useful;
- the vision-quality gate decides whether the output is good enough to trust as living Project Memory.

The boundary exists so that no single helper silently turns "parseable" into "trusted".

## Ownership

The gate owns:
- the final first-create trust decision;
- representative question coverage;
- the distinction between `review_only` and `pass` for first-create docs;
- the mapping from live dogfood evidence into trust strength.

The gate does not own:
- markdown rendering;
- evidence-map building;
- apply journaling;
- wiki promotion;
- retrieval indexing;
- candidate or handoff reconciliation.

## Non-Ownership Rules

- Do not let page count substitute for answerability.
- Do not let role labels substitute for repo-grounded content.
- Do not let `content_quality: trusted` alone become a curated-state shortcut.
- Do not let the vision gate rewrite canonical files directly.

## Allowed Later Extensions

- The question set may be curated or generated, but the provenance must remain explicit.
- The gate may add more question families for future repos, but the current `llm-wiki` vision questions must stay visible.
- The gate may gain weighted scoring, but the final trust decision must still be explicit and reviewable.

## Review Questions

- Should the question source be literal `MY_VISION.md` text or a curated question manifest derived from it?
- Should `review_only` be a terminal state in project state or only a run-local gate result?
- Should live dogfood be required for `pass`, or only for the strongest trust tier?
