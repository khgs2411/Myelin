# Apply Stage - Instructions

Script-only stage. No LLM invocation. Reads an approved `proposal.json` from the run directory and mechanically applies the changes to the wiki, state files, and artifacts.

## Inputs

- `<run-dir>/proposal.json` with `approved: true`
- Current `projects/<key>/wiki/` and `projects/<key>/state/`
- `config.json.stage_specific.destructive_actions`
- `AUTO` env var

## Output

- Wiki pages written, updated, deleted, or renamed per proposal units
- `projects/<key>/index.md` regenerated from `proposal.json.index_changes.content`
- `projects/<key>/state/pages.json` updated to reflect the current page set
- `projects/<key>/state/relationships.json` updated with cross references
- `projects/<key>/state/sources.json` appended with source-citation entries
- `projects/<key>/state/freshness.json` updated with `last_seen_commit_pending` and `last_update_at_pending`
- Under `AUTO=1` with destructive or high-uncertainty content: `projects/<key>/state/pending-approvals/<proposal-id>/proposal-slice.json` and `.md`
- `update-state.json.stages.apply` marked completed

## Pre-flight

1. Proposal must have `approved: true` at top level.
2. Every unit's `justification_signals` must include at least one of `A`, `B`, `C`.
3. Every unit's `referenced_ranking_domains` must appear in `ranking-snapshot.json.ranked_domains` in the same run dir.
4. `new_pages_count` must be less than or equal to `max_new_pages`.
5. Every `source_citation` must resolve.

## Never

- Never write to the wiki if pre-flight fails.
- Never advance `last_seen_commit` directly. That belongs to `apply_commit.sh`.
