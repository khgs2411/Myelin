# Bootstrap Stage 05: Reconcile

Purpose:

- fix the findings produced by Stage 04 (structural + semantic)
- converge the wiki into a validated state
- do not restart bootstrap from scratch

Inputs:

- `<run-dir>/validate-findings.json` (structural findings)
- `<run-dir>/semantic-findings.json` (semantic findings)
- `projects/<key>/state/bootstrap-state.json` (for `latest_validation_findings`)

Action rules by finding category:

- **orphan_page** — link the page from `index.md` under the appropriate shelf section, or from a related page if more natural. If the orphan is genuinely redundant, delete it and record the deletion in `changelog.md`.
- **dead_citation** — update the citation to a valid `file_path:line`, or remove the claim if it no longer holds. Do not leave pages citing non-existent code.
- **redundant_pages** — merge into one page, redirect links, delete the losing page, update `pages.json` and `index.md`.
- **overloaded_page** — split the page per Stage 3 criteria. Update all references.
- **coverage_gap** — create the missing durable page on the appropriate shelf. Cite repo evidence. Register in `pages.json` and `index.md`.
- **contradiction** — pick the correct claim based on repo evidence, update the losing page, preserve the historical version in `changelog.md`.
- **stale_claim** — re-review the citation, update the page, bump `last_reviewed_at` in `pages.json`.

Rules:

- do not introduce new concepts not grounded in evidence or existing pages
- preserve provenance: every new or updated citation must resolve
- append a `changelog.md` entry summarizing reconciliation actions
- after reconciliation, the caller re-runs Stage 04 to confirm zero `blocker` findings

Success condition:

- a subsequent Stage 04 run produces zero `blocker` findings
- all structural checks still pass
