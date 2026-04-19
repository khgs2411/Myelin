# Propose Stage - Instructions

You are the `propose` stage of the unified update pipeline. You draft a full changeset plus `index.md` edits, with every unit justified against the ranking produced by the impact stage.

## Inputs

- `impact-report.json` - affected pages, new domains, stale pages
- `ranking-snapshot.json` - authoritative ranked domain list (Signal A+B+C)
- Current wiki state under `projects/<key>/wiki/`
- Current repo files under `project.json.repo_paths`
- `config.json.stage_specific.max_new_pages` (cap on new-page count)

## Output

Return ONLY the `proposal.json` JSON object on stdout, per spec Section 5.3. Do not write any files to disk; the stage's `run.sh` writes `<run-dir>/proposal.json` from your stdout and renders `<run-dir>/proposal.md` deterministically from that JSON. The `## Required output schema` section below is your sole output contract.

## Rules

1. Every unit must have `justification_signals` containing at least one of `A`, `B`, `C`.
2. Every `referenced_ranking_domains` entry must appear in `ranking-snapshot.json.ranked_domains`.
3. `new_pages_count` must not exceed `max_new_pages`. Excess domains go to `deferred_domains` with a reason.
4. Every unit must include `source_classification` with the five required fields: `source_kind`, `ownership`, `destination`, `update_targets`, `action`.
5. Every `source_citations` entry must resolve to a real file and line range in the repo.
6. `destructive: true` on any unit or `index_changes.destructive: true` forces approval even under `AUTO=1`.
7. `uncertainty: high` on any unit forces approval even under `AUTO=1`.
8. **Every ranked domain in `ranking-snapshot.json.ranked_domains` must have a home.** Either (a) a dedicated page unit where that domain is the primary subject and appears in `referenced_ranking_domains`, OR (b) an entry in `deferred_domains` with a concrete reason (e.g., "insufficient source material", "naturally folds into X page", "covered by existing Y page"). Do NOT silently drop ranked domains. Validate enforces this via `ranked_domain_coverage`.
9. **Do not collapse 3+ ranked domains into one destination page.** Two related domains on one page is fine; three or more is a blocker unless the extras are also listed in `deferred_domains` with a reason. Prefer a dedicated page per domain - the ranking cutoff already scales with project size. Validate enforces this via `domain_collapse_check`.

## Approval Gate

- In gated mode, write `proposal.json` with top-level `"approved": false`.
- Under `AUTO=1`, write `"approved": true` directly. The apply stage still splits destructive or high-uncertainty units to `pending-approvals/`.

## Budget

Token budget: 80000 input / 20000 output. Over budget = clean failure with no artifacts written.

## Required output schema

Return ONLY this JSON object:

```json
{
  "project": "<project-key>",
  "summary": "one-paragraph plain-text summary",
  "ranking_snapshot_path": "projects/<project-key>/state/latest/ranking-snapshot.json",
  "max_new_pages": 25,
  "max_new_pages_config_source": "agents/update/03-propose/config.json:stage_specific.max_new_pages",
  "new_pages_count": 3,
  "deferred_domains": [
    {"rank": 21, "domain": "logging", "reason": "below cutoff"}
  ],
  "units": [
    {
      "id": "u1",
      "action": "create | update | delete | rename",
      "page_path": "wiki/systems/auth.md",
      "rename_from": null,
      "destructive": false,
      "uncertainty": "low | medium | high",
      "justification": "Why this unit belongs in the wiki; must cite at least one of A, B, C.",
      "justification_signals": ["A", "B", "C"],
      "referenced_ranking_domains": ["authentication"],
      "source_classification": {
        "source_kind": "implementation-note",
        "ownership": "project:<project-key>",
        "destination": "wiki/systems/auth.md",
        "update_targets": ["wiki/systems/auth.md"],
        "action": "create-new-page-and-update-index"
      },
      "content": "Full new page content as a single string (null only for action=delete).",
      "affected_cross_refs": ["wiki/systems/data-store.md"],
      "source_citations": ["src/auth.py:1-23"]
    }
  ],
  "index_changes": {
    "action": "update",
    "destructive": false,
    "content": "Full new index.md content as a single string.",
    "categories_reshuffled": 0
  },
  "state_changes_intent": {
    "last_seen_commit_pending": "<stamped-by-apply>",
    "last_update_at_pending": "<stamped-by-apply>"
  }
}
```

### Hard rules

- `justification_signals` must include at least one of `A`, `B`, `C`.
- `referenced_ranking_domains` must all appear in the `ranking_snapshot.json` you are given.
- `new_pages_count <= max_new_pages`. Excess domains go to `deferred_domains` with a reason.
- `destructive: true` on any unit requires explicit operator approval even under `AUTO=1` - flag them honestly; do not downgrade them to avoid the gate.
- `uncertainty: high` triggers the same gate - use it when you genuinely can't justify the change confidently.
- `source_citations` must be real file paths with valid line ranges. The apply stage re-validates; citations that don't resolve will reject the whole proposal.
- `page_path` and `rename_from` must begin with one of these allowed shelves: `wiki/architecture/`, `wiki/systems/`, `wiki/modules/`, `wiki/integrations/`, `wiki/decisions/`, `wiki/runbooks/`, `wiki/sessions/`, `wiki/glossary/`, `wiki/open-questions/`. Do not invent new shelf names such as `wiki/runtime/`, `wiki/core/`, or `wiki/utils/`; apply rejects them and validate reports them as `shelf_allowlist` blockers.
- `action: "delete"` requires `content: null`.
- Do not include prose, apologies, or markdown fences around the JSON.

### Required page structure (validator contract)

Every unit's `content` string must conform to the structural validator in `agents/update/06-validate/structural.py`. Failing this guarantees validate will fail and reconcile will be invoked.

- Do NOT open the page with a heading line. The first non-empty line must be a single-sentence prose summary that answers "what is this." Do not emit a leading `# Title` H1; the page's title is carried by its filename and by `index.md`.
- The page MUST contain a `## Repo pointers` section listing the concrete `path:line-range` citations that ground the page. Use the format `` - `path/to/file.ext:LINE_START-LINE_END` - short label ``.
- The page MUST contain a `## Related` section linking to sibling wiki pages; omit the section only if no real cross-links exist (but prefer to include at least one real link).
- Ground all factual claims with inline citations in backticks, e.g. `` (`server/README.md:39-43`) ``. Do not use `Verified:` / `Inferred:` / `Stale risk:` as structural section decorators.

### Index.md contract (separate from wiki pages)

`index_changes.content` is the project's landing page. It is the first thing a cold future session reads. Treat it as **project-facing**, never wiki-facing.

- The first non-heading line MUST describe the project itself: what it is, what it does, what its major surfaces are. It must NOT describe this wiki, the llm-wiki system, the ingestion pipeline, or the agent's own work.
- Banned opening phrases (validate will block these): "entry point for the maintained...", "is the entry point for...", "project wiki", "this wiki", "maintained knowledge layer", "has not been bootstrapped", "baseline pass", "broad bootstrap", "focused follow-up pass".
- `## Current Priorities` must contain real project priorities derived from sources, or be omitted / honestly marked as unknown. It must NOT contain wiki-construction narration like "Establish the canonical...", "Keep system pages grounded...", "No verified project priorities are documented...", "first canonical bootstrap", "bootstrap against the mapped repo".
- `index.md` MAY include a final `## Status` block pointing at machine-readable state files (freshness.json, ranking-snapshot.md, etc.) - this is the one place where pointing at wiki infrastructure is allowed.
