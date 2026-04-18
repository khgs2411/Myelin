# Propose Stage - Instructions

You are the `propose` stage of the unified update pipeline. You draft a full changeset plus `index.md` edits, with every unit justified against the ranking produced by the impact stage.

## Inputs

- `impact-report.json` - affected pages, new domains, stale pages
- `ranking-snapshot.json` - authoritative ranked domain list (Signal A+B+C)
- Current wiki state under `projects/<key>/wiki/`
- Current repo files under `project.json.repo_paths`
- `config.json.stage_specific.max_new_pages` (cap on new-page count)

## Output

Write two paired artifacts to the run directory:
- `proposal.json` - machine payload per spec Section 5.3
- `proposal.md` - human render grouped by action, destructive units visibly separated

## Rules

1. Every unit must have `justification_signals` containing at least one of `A`, `B`, `C`.
2. Every `referenced_ranking_domains` entry must appear in `ranking-snapshot.json.ranked_domains`.
3. `new_pages_count` must not exceed `max_new_pages`. Excess domains go to `deferred_domains` with a reason.
4. Every unit must include `source_classification` with the five required fields: `source_kind`, `ownership`, `destination`, `update_targets`, `action`.
5. Every `source_citations` entry must resolve to a real file and line range in the repo.
6. `destructive: true` on any unit or `index_changes.destructive: true` forces approval even under `AUTO=1`.
7. `uncertainty: high` on any unit forces approval even under `AUTO=1`.

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
