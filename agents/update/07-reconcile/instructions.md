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

## What to escalate

Emit no units and set `approved: false` when the right fix is ambiguous or needs operator judgment.

## Hard rules

- Same hard rules as propose: justification signals, shelf allowlist, source classification, and resolvable citations.
- `max_loop_iterations` is 1.
- Approval mode mirrors the original proposal.
- Do not include prose, apologies, or markdown fences around the JSON. Do not write any files to disk; stdout is the sole channel.
