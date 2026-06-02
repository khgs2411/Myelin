#!/usr/bin/env bash
# Impact stage — ranking (Sub-task 1) + delta (Sub-task 2).
#
# Produces:
#   <run-dir>/ranking-snapshot.json
#   <run-dir>/impact-report.json
#
# In Plan A we use LLM_STUB_RESPONSES_DIR for both sub-tasks. Plan B/C wires real LLM calls.

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/02-impact/run.sh --project <project-key> [--project-dir <project-dir>] --run-dir <artifact-dir>
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
project_dir=""
run_dir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    --project-dir) project_dir="${2:?}"; shift 2 ;;
    --run-dir) run_dir="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
[[ -n "$run_dir" ]] || die "--run-dir is required"
if [[ -z "$project_dir" ]]; then
  project_dir="$ROOT_DIR/projects/$project_key"
fi
[[ -d "$project_dir" ]] || die "project dir not found: $project_dir"
[[ -f "$run_dir/sense-report.json" ]] || die "sense-report.json missing in $run_dir"

python3 - "$project_key" "$project_dir" "$run_dir" "$AGENT_DIR" "$ROOT_DIR" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
agent_dir = Path(sys.argv[4])
root_dir = Path(sys.argv[5])

sys.path.insert(0, str(root_dir))
from agents.update._shared import llm_client  # noqa: E402

config = json.loads((agent_dir / "config.json").read_text())
cutoff = config["stage_specific"]["ranking_cutoff"]

pj = json.loads((project_dir / "state" / "project.json").read_text())
if pj.get("ranking_cutoff") is not None:
    cutoff = pj["ranking_cutoff"]

# --- Sub-task 1: Ranking ---
sense_report = json.loads((run_dir / "sense-report.json").read_text())
ranking_prompt = json.dumps({
    "sense_report": sense_report,
    "cutoff": cutoff,
    "project_key": project_key,
})
print("impact: ranking sub-task ...", file=sys.stderr, flush=True)
ranking_result = llm_client.invoke(stage_id="02-impact.ranking", prompt=ranking_prompt)
ranking = ranking_result["response"]
ranking["run_id"] = run_dir.name
ranking["cutoff"] = cutoff
ranking["cutoff_config_source"] = "agents/update/02-impact/config.json:stage_specific.ranking_cutoff"
ranking.setdefault("signal_a_sources", [])
ranking.setdefault("signal_b_entry_points", [])
(run_dir / "ranking-snapshot.json").write_text(json.dumps(ranking, indent=2) + "\n")

# --- Sub-task 2: Delta ---
delta_prompt = json.dumps({
    "sense_report": sense_report,
    "ranking": ranking,
    "project_key": project_key,
})
print("impact: delta sub-task ...", file=sys.stderr, flush=True)
delta_result = llm_client.invoke(stage_id="02-impact.delta", prompt=delta_prompt)
delta = delta_result["response"]
delta["run_id"] = run_dir.name
delta["ranking_snapshot_ref"] = f"projects/{project_key}/state/latest/ranking-snapshot.json"
(run_dir / "impact-report.json").write_text(json.dumps(delta, indent=2) + "\n")

# Stage completion marker in update-state.json (spec §6.4)
us_path = project_dir / "state" / "update-state.json"
if us_path.is_file():
    us = json.loads(us_path.read_text())
    us.setdefault("stages", {})
    us["stages"]["impact"] = {
        "status": "completed",
        "last_run_dir": str(run_dir),
        "last_completed_at": datetime.now(timezone.utc).isoformat(),
        "summary_file": str(run_dir / "impact-report.json"),
    }
    us["last_completed_stage"] = "impact"
    us["latest_run_dir"] = str(run_dir)
    us_path.write_text(json.dumps(us, indent=2) + "\n")

print(f"ranking-snapshot.json + impact-report.json written to {run_dir}")
PY
