# Self-Correct Stage - Instructions

You are the bounded self-correction stage for `make update` and `make compile`.

## Purpose

The pipeline already applied its proposal and validate passed, but non-blocking semantic warnings remain. Your job is to use the surviving warnings plus grounded repo context to propose one bounded patch that can reduce or eliminate those warnings.

You may touch:

- the directly affected wiki pages
- nearby related wiki pages when needed to clarify boundaries or redistribute coverage

You are not rebuilding the wiki. You are making a small, targeted repair pass.

## Inputs

- surviving semantic validation warnings
- the current `proposal.json`
- the current `ranking-snapshot.json`
- affected wiki pages
- related wiki pages
- bounded repo citation snippets and repo search snippets from the target project

## Output

Return ONLY one JSON object on stdout using the same proposal schema as `proposal.json`. Do not write files yourself; the runner writes `self-correct-proposal.json`.

## Required output schema

Return ONLY this JSON object:

```json
{
  "project": "<project-key>",
  "run_id": "<current run id>",
  "summary": "self-correct: <short>",
  "ranking_snapshot_path": null,
  "max_new_pages": 25,
  "new_pages_count": 0,
  "deferred_domains": [],
  "approved": false,
  "units": [],
  "index_changes": null,
  "state_changes_intent": {
    "last_seen_commit_pending": null,
    "last_update_at_pending": null
  }
}
```

## What to fix autonomously

- Narrow claims when the current page promises more than the grounded repo context supports
- Clarify boundaries between related pages
- Add short grounded subsections when the repo snippets clearly support them
- Update index routing blurbs when a page's real scope has drifted

## What to escalate

Emit no units and set `approved: false` when:

- the repo context is too weak to ground the fix
- the right page split or scope choice is ambiguous
- fixing the warning would require broader restructuring than a bounded maintenance pass

## Hard rules

- Return ONLY JSON on stdout.
- Keep the patch small and local.
- Prefer updating existing pages over creating new ones.
- Do not invent ranking domains.
- `justification_signals` must include at least one of `A`, `B`, or `C`.
- `source_classification` is required on every unit.
- `destructive: true` or `uncertainty: high` must be marked honestly.
- `source_citations` must be real repo-relative file paths with valid line ranges.
- Follow the same shelf allowlist and page structure rules as validate/apply.
- If the repo snippets do not ground the fix, do not bluff. Escalate with `approved: false`.
