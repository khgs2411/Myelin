# Impact Stage — Instructions

You are the **impact** stage of the unified update pipeline. You have two sub-tasks:

1. **Ranking (Sub-task 1)** — compute the access-pattern ranking (Signals A+B+C) and emit `ranking-snapshot.json`.
2. **Delta (Sub-task 2)** — given sense-report + ranking, emit `impact-report.json` identifying affected/new/stale content.

Both sub-tasks run in the same stage invocation but produce two distinct artifacts.

## Inputs

- `sense-report.json` from the sense stage
- Current `projects/<key>/state/pages.json` (may be empty on first run)
- Repo files accessible under `project.json.repo_paths`
- `config.json.stage_specific.ranking_cutoff` and `entry_point_patterns`

## Sub-task 1: Ranking

Return the ranking JSON (schema in `## Required output schema` below) on stdout per spec Section 4.3. Do not write any files to disk; `run.sh` writes `<run-dir>/ranking-snapshot.json` from your stdout.

Steps:
1. Signal A — collect meta-docs matching `meta_doc_patterns`. Record paths.
2. Signal B — collect entry-point candidates matching `entry_point_patterns`. Record paths.
3. Signal C — rank the domains. For each candidate domain, produce:
   - `rank` (1-indexed position)
   - `domain` (short identifier, e.g. "authentication")
   - `score` (float 0-1; your subjective ranking)
   - `signals` (subset of ["A","B","C"] that contribute)
   - `signal_a_evidence`, `signal_b_evidence` (arrays of `path:line-line` or just `path` when no line range applies)
   - `signal_c_reasoning` (one sentence explaining why this is load-bearing; or "no A/B signal; promoted on structural fan-in" when no hard evidence)

Emit exactly `cutoff` entries unless fewer domains exist. Entries beyond cutoff are NOT included here — propose stage reads `ranking-snapshot.json.ranked_domains` only.

Output must be strict JSON (no prose outside schema).

## Sub-task 2: Delta

Return the delta JSON (schema in `## Required output schema` below) on stdout per spec Section 5.4. Do not write any files to disk; `run.sh` writes `<run-dir>/impact-report.json` from your stdout.

Steps:
1. For each `changed_paths` entry in sense-report: map to affected wiki pages via `pages.json`. Emit `affected_pages[]` with reason + source.
2. For each ranked domain not already covered by a wiki page: emit `new_domains[]` with `ranking_inclusion: "top-20"` or `"below-cutoff"`.
3. For each existing page whose repo citations no longer resolve or whose domain has disappeared: emit `stale_pages[]`.
4. Include `ranking_snapshot_ref` pointing at the stable path `projects/<key>/state/latest/ranking-snapshot.json`.

## Budget

Token budget is enforced at 60000 input / 8000 output. On exceed: stage fails clean, no artifacts written.

## Required output schema

This stage produces TWO distinct JSON outputs - one for each sub-task. The runner invokes you twice: once with a "ranking" stage_id and once with a "delta" stage_id.

### Sub-task 1: Ranking (`stage_id: 02-impact.ranking`)

Return ONLY this JSON object:

```json
{
  "cutoff": 20,
  "ranked_domains": [
    {
      "rank": 1,
      "domain": "authentication",
      "score": 0.85,
      "signals": ["A", "B", "C"],
      "signal_a_evidence": ["README.md:6-14"],
      "signal_b_evidence": ["src/auth.py"],
      "signal_c_reasoning": "Owns session lifecycle; referenced from entry point."
    }
  ]
}
```

Emit exactly `cutoff` entries unless fewer domains exist. `signal_c_reasoning` must either cite concrete A/B evidence or explicitly state `"no A/B signal; promoted on structural fan-in"`.

### Sub-task 2: Delta (`stage_id: 02-impact.delta`)

Return ONLY this JSON object:

```json
{
  "affected_pages": [
    {"path": "wiki/systems/auth.md", "reason": "src/auth.py modified", "source": "git diff"}
  ],
  "new_domains": [
    {
      "name": "authentication",
      "evidence": ["src/auth.py"],
      "signal_sources": ["A", "B"],
      "ranking_inclusion": "top-20 | below-cutoff"
    }
  ],
  "stale_pages": [
    {"path": "wiki/modules/legacy.md", "reason": "feature removed per diff"}
  ]
}
```

All three arrays may be empty on a clean first run. `ranking_inclusion` must be `"top-20"` for domains within the ranking cutoff and `"below-cutoff"` otherwise.
