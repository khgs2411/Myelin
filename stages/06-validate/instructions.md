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

## Semantic sub-task (LLM output contract)

Skip the semantic LLM sub-task if structural checks emit any blocker findings.

Return ONLY this JSON object on stdout. Do not write any files to disk; the stage's `run.sh` composes and writes `validation-findings.json` from your stdout plus the deterministic structural findings. Do not include prose, apologies, markdown fences, or status messages around the JSON.

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

## Pipeline-side output (not your responsibility)

For context only - `run.sh` merges your `findings` with the deterministic structural findings and writes the combined report to `<run-dir>/validation-findings.json`, then updates `state/update-state.json.stages.validate`. You do not write either of these files.
