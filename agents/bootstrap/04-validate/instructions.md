# Bootstrap Stage 04: Validate

You are a semantic validator for a project wiki. The structural validator has already run and passed (file presence, JSON shapes, link resolution). Your job is to judge wiki quality.

Inputs available to you:

- `projects/<key>/index.md`
- all pages under `projects/<key>/wiki/**/*.md`
- `projects/<key>/state/pages.json`
- `projects/<key>/state/sources.json`
- `projects/<key>/state/relationships.json`
- the repo being wiki'd (for citation verification and coverage checks)
- `agents/bootstrap/04-validate/config.json` (severity thresholds)

Produce a single JSON findings report at `<run-dir>/semantic-findings.json` with this shape:

```
{
  "findings": [
    {
      "category": "orphan_page|dead_citation|redundant_pages|overloaded_page|coverage_gap|contradiction|stale_claim",
      "severity": "blocker|warning|info",
      "pages": ["<relative path>", "..."],
      "evidence": "<short description with concrete references>",
      "suggested_action": "<one sentence>"
    }
  ]
}
```

Categories:

- **orphan_page** — a durable page not referenced from `index.md` or any other wiki page. Severity: `blocker` if the orphan is under `wiki/architecture/`; `warning` otherwise.
- **dead_citation** — a `file_path:line` citation whose target does not exist. Verify with ripgrep against the repo. Severity: `blocker` if more than the configured ratio of a page's citations are dead; `warning` otherwise.
- **redundant_pages** — two pages whose summaries in `pages.json` substantially overlap. Severity: `warning`.
- **overloaded_page** — a page exceeding 120 lines with three or more distinct H2 sections each describing a different stable concept. Severity: `warning`.
- **coverage_gap** — a top-level repo surface (top-level directory, major feature inferred from entry points and build manifests) with no corresponding durable page. Severity: `blocker` for top-level architecture-tier gaps; `warning` otherwise.
- **contradiction** — two pages making opposing claims about the same entity. Severity: `blocker`.
- **stale_claim** — a page whose cited files have changed since the page's `last_reviewed_at`. Severity: `warning`.

Rules:

- produce ONLY the JSON file; do not write prose, do not modify wiki pages, do not modify state files
- read `config.json` for the dead-citation ratio threshold and any category severity overrides
- if a finding does not fit any category, emit under the closest match and flag in `evidence`
- cite concrete evidence for every finding — page path, line numbers, repo paths

Pass criterion (enforced by the caller, not by you): zero findings with severity `blocker`.
