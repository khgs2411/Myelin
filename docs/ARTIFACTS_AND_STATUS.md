# Artifacts And Status

`llm-wiki` now separates pipeline output into two layers:

1. Stable products for humans/tools under `projects/<key>/state/latest/`
2. Timestamped audit runs under `artifacts/<key>/runs/` (and `artifacts/_global/runs/`)

## Stable Products (Canonical Read Path)

Pipeline steps overwrite these per-project files on each run:

- `state/latest/ranking-snapshot.json`
- `state/latest/ranking-snapshot.md`
- `state/latest/validation-findings.json`
- `state/latest/validation-report.md`
- `state/latest/measurement-report.json`
- `state/latest/measurement-report.md`

The markdown files are direct renders of the corresponding JSON products.

`make update PROJECT=<key>` refreshes the ranking and validation products. `make measure PROJECT=<key>` refreshes the measurement products. `make lint PROJECT=<key>` re-runs validate against the latest recorded run.

## Audit Trail (Debug/Repro Path)

Timestamped run outputs stay in artifact buckets:

- Project runs: `artifacts/<project-key>/runs/<timestamp>-<op>/`
- Global runs: `artifacts/_global/runs/<timestamp>-<op>/`

Examples of `<op>`: `update`, `measure`.

## State Pointers

`projects/<key>/state/update-state.json` keeps canonical pointers in `latest_*_findings.findings_path` to stable files under `state/latest/`.

For debugging provenance, each latest findings object also stores:

- `audit_run_dir`: the timestamped artifact directory that produced the latest stable product

## Retention

Use `scripts/prune_artifacts.sh` (or `make prune`) to prune old run directories.

Rules:

- Keep the newest `N` runs per `(project, op)` (default `N=10`)
- Override via `ARTIFACT_KEEP=<N>`
- Never delete a run referenced by any `audit_run_dir` in project update state
- Print every deleted path

Pruning is also triggered opportunistically after successful pipeline entry points.

## Read-Side Status Commands

Use `make status PROJECT=<key>` for a full project summary in one screen:

- project identity and repo paths
- update state snapshot
- latest validation summary and stable markdown path
- latest measurement summary and stable markdown path
- freshness snapshot

Use `make status-all` for one-line summaries for all registered projects.
