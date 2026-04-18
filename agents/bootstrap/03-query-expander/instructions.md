# Bootstrap Stage 03: Expand

Purpose:

- split pages from Stage 2 that carry multiple stable concepts deserving direct lookup
- turn broad domain pages into direct query targets

Write scope:

- new pages under any existing shelf that host a split-out concept
- updates to source pages that had content lifted out
- updates to `index.md`, `pages.json`, `relationships.json`

Split criteria:

- a page exceeds the target line count (~60–80 lines) and has multiple distinct H2 sections each describing a stable concept
- a subsystem, registry, scheduler, feature path, or configuration surface is buried inside a broader page and is likely to be queried directly in the future
- two concepts in one page are conceptually distinct enough that a future reader would benefit from separate pages

Rules:

- do not create pages smaller than ~20 lines — if the concept does not warrant that much content, leave it in the parent page
- preserve provenance when lifting content: the new page must keep or extend the source citations
- update the original page to reference the new split-out page rather than duplicating content
- never invent new concepts during the split — only lift existing content

Success condition:

- high-value concepts that are likely direct query targets have their own pages
- no page from Stage 2 carries more than one major concept that deserves a lookup
- `pages.json` and `index.md` reflect all splits
