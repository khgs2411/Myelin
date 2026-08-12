# FirstCreateVisionQualityFlow

Pseudocode artifact. Non-executable reference shape for planning.

## Draft Shape

This flow sits after deterministic validation and the independent usefulness critique. It decides whether first-create Project Memory is merely foundation-valid or actually trustworthy enough to mark curated.

Sequence:

1. Read `curator-validation.json`.
2. Read `project-memory-usefulness-critique.json`.
3. Read `project-memory-evidence-map.json`.
4. Read the rendered markdown artifacts from the first-create run.
5. Load the representative question set from `MY_VISION.md` or a derived manifest.
6. Ask each question against the rendered markdown and citations.
7. Prefer live dogfood evidence when available.
8. Produce one of four outcomes:
   - `pass`: the docs answer the representative questions with precise repo-grounded evidence.
   - `review_only`: the docs are foundation-valid but still not strong enough to trust as living repo documentation.
   - `fail`: the docs cannot answer the core vision questions.
   - `blocked`: the flow cannot run because an artifact is missing, unreadable, or inconsistent.
9. On `pass`, allow curated-state promotion.
10. On any other outcome, keep the project below curated trust and preserve the run artifacts as evidence.

## Ownership And Non-Ownership

Owns:
- the trust decision between foundation validity and product usefulness;
- the sequencing between deterministic validation, critique, and live dogfood;
- the mapping from question coverage into terminal trust state.

Does not own:
- rendering markdown;
- writing canonical wiki files;
- running provider calls;
- retrieval indexing;
- candidate intake;
- applying markdown changes.

## Inputs

- rendered markdown pages
- evidence map artifact
- deterministic validation artifact
- usefulness critique artifact
- live dogfood signal, if present
- representative question set from the repo vision

## Outputs

- gate status
- weak question list
- citation notes
- terminal trust state
- review-only or fail reason text

## Failure Posture

- Missing artifacts should fail closed as `blocked`.
- Generic answers should not pass just because the foundation contract succeeded.
- A passed foundation with weak vision quality should remain below curated trust.

## Review Notes

- The gate should not become a hidden second validator for page shape.
- The gate should not be satisfied by page count or role count.
- The gate should treat `MY_VISION.md` as the product lens, not as a source of implementation detail.
