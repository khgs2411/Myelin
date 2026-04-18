# Validate Stage - Instructions

The validate stage runs two independent checks after apply completes:

1. Structural (deterministic script). Mechanical rules with hard pass/fail outcomes. No LLM involvement.
2. Semantic (LLM agent). Judgment calls about coverage, redundancy, contradiction, and honesty of gap markers.

Both must return `status: pass` for the overall stage to pass. Any blocker-severity finding from either tier sets the stage status to `fail`.

## Inputs

- The project directory after apply completed
- The run directory containing the applied proposal and ranking snapshot
- `config.json.stage_specific.structural_rules`
- `config.json.stage_specific.shelf_allowlist`
- `config.json.stage_specific.semantic_rules_enabled`

## Structural rules

1. `required_page_sections`
2. `citation_resolvability`
3. `citation_line_range`
4. `no_orphan_pages`
5. `no_dead_cross_refs`
6. `index_routing_resolves`
7. `pages_json_filesystem_agreement`
8. `proposal_justification_signals`
9. `proposal_referenced_ranking_domains`
10. `proposal_max_new_pages`
11. `proposal_source_classification`
12. `shelf_allowlist`

## Semantic sub-task

Skip the semantic LLM sub-task if structural checks emit any blocker findings.

Required output schema:

```json
{
  "findings": [
    {
      "category": "coverage_gap | redundancy | contradiction | index_routing | stale | ungrounded_unit",
      "severity": "blocker | warn",
      "pages": ["wiki/systems/auth.md"],
      "evidence": "one-line concrete reason",
      "suggested_action": "one-line recommendation"
    }
  ]
}
```

## Output

Write `<run-dir>/validation-findings.json` with:

```json
{
  "run_id": "<ts>-update-<key>",
  "status": "pass | fail",
  "pass_count": {"structural": 12, "semantic": 5},
  "structural": [{"page": "...", "issue": "...", "severity": "blocker|warn", "rule_id": "..."}],
  "semantic": [{"category": "...", "severity": "...", "pages": ["..."], "evidence": "...", "suggested_action": "..."}]
}
```

Also update `state/update-state.json.stages.validate` with the latest findings path.
