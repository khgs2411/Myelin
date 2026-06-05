# Reconcile Stage - Instructions

You are the reconcile stage, invoked only when the validate stage reported `status: fail`.

## Inputs

- `validation-findings.json` from the current run
- The current wiki state after apply
- The current `ranking-snapshot.json`
- The original `proposal.json`

## Output

Return ONLY the reconcile proposal JSON object on stdout, using the same schema as `proposal.json`. Do not write any files yourself; the pipeline's `run.sh` writes `<run-dir>/reconcile-proposal.json` from your stdout.

## Required output schema

Return ONLY this JSON object. Do not include prose, apologies, markdown fences, or status messages around it.

```json
{
  "project": "<project-key>",
  "run_id": "<current run id>",
  "summary": "reconcile: <short>",
  "ranking_snapshot_path": "projects/<key>/state/latest/ranking-snapshot.json",
  "max_new_pages": 25,
  "new_pages_count": 0,
  "deferred_domains": [],
  "approved": true,
  "units": [],
  "index_changes": null,
  "state_changes_intent": {
    "last_seen_commit_pending": null,
    "last_update_at_pending": null
  }
}
```

## What to fix autonomously

- Broken relative links when the target is unambiguous
- Missing required sections on existing pages
- Pages under unprescribed shelves such as `wiki/runtime/`
- Dishonest stale or gap markers
- Coverage gaps flagged by the semantic validator - **always address these by adding or splitting pages cleanly, never by stuffing multiple ranked domains into one umbrella page**

## What to escalate

Emit no units and set `approved: false` when the right fix is ambiguous or needs operator judgment.

## Hard rules

You inherit every rule enforced by validate. `max_loop_iterations` is 1, so a reconcile proposal that introduces a NEW validator violation cannot be retried - the pipeline dead-ends and the commit pointer will not advance. Verify every unit against every rule below before emitting.

- `justification_signals` must include at least one of `A`, `B`, `C`.
- `referenced_ranking_domains` must all appear in the `ranking_snapshot.json` you are given.
- `new_pages_count <= max_new_pages`. Excess domains go to `deferred_domains` with a reason.
- Every unit must include `source_classification` with the five required fields: `source_kind`, `ownership`, `destination`, `update_targets`, `action`.
- `destructive: true` on any unit or `index_changes.destructive: true` forces operator approval even under `AUTO=1`; flag honestly rather than downgrading.
- `uncertainty: high` triggers the same gate - use it when you genuinely cannot justify the change confidently.
- `source_citations` must be real file paths with valid line ranges. The apply stage re-validates.
- `page_path` and `rename_from` must begin with one of these allowed shelves: `wiki/architecture/`, `wiki/systems/`, `wiki/modules/`, `wiki/integrations/`, `wiki/decisions/`, `wiki/runbooks/`, `wiki/sessions/`, `wiki/glossary/`, `wiki/open-questions/`. Do not invent new shelf names.
- `action: "delete"` requires `content: null`.
- **Every ranked domain must have a home.** Either a dedicated unit where that domain is the primary subject (in `referenced_ranking_domains`), OR an entry in `deferred_domains` with a concrete reason. Silent-dropping a ranked domain is blocked by validate's `ranked_domain_coverage` rule.
- **Do not collapse 3+ ranked domains into one destination page.** Two related domains per page is the limit. When a semantic finding reports coverage gaps across multiple ranked domains (e.g., "community, notifications, and potw-templates are under-covered"), emit SEPARATE units per domain (or defer extras with reasons). Do NOT expand an existing umbrella page to absorb them. Validate's `domain_collapse_check` is a blocker: a reconcile patch that triggers it will dead-end the pipeline since reconcile only gets one iteration.
- **`index.md` must describe the project, not the wiki.** First non-heading line must describe the project; `## Current Priorities` must hold real priorities or be omitted. References to "this wiki", "bootstrap", "baseline pass", "entry point for the maintained..." are blocked by `index_not_wiki_meta`.

### Required page structure (validator contract)

Every unit's `content` string must conform to the structural validator enforced by the validate stage:

- Do NOT open the page with a heading line. The first non-empty line must be a single-sentence prose summary.
- The page MUST contain a `## Repo pointers` section with concrete `` `path:line-line` `` citations.
- The page MUST contain a `## Related` section linking to sibling wiki pages (omit only when no real cross-links exist).
- Ground all factual claims with inline backtick citations. Do not use `Verified:` / `Inferred:` / `Stale risk:` as structural decorators.

### Emission contract

- Approval mode mirrors the original proposal.
- Do not include prose, apologies, or markdown fences around the JSON.
- Do not write any files to disk; stdout is the sole channel.
