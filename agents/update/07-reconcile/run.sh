#!/usr/bin/env bash
# Reconcile stage - runs only after validate fails.

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/07-reconcile/run.sh --project <key> [--project-dir <path>] --run-dir <path>
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
[[ -f "$run_dir/validation-findings.json" ]] || die "validation-findings.json missing in $run_dir"
[[ -f "$run_dir/proposal.json" ]] || die "proposal.json missing in $run_dir"
[[ -f "$run_dir/ranking-snapshot.json" ]] || die "ranking-snapshot.json missing in $run_dir"

python3 - "$project_key" "$project_dir" "$run_dir" "$ROOT_DIR" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
root_dir = Path(sys.argv[4])

sys.path.insert(0, str(root_dir))
from agents.update._shared import llm_client

findings = json.loads((run_dir / "validation-findings.json").read_text())
if findings.get("status") != "fail":
    print(
        "error: reconcile should only run after validation reports fail; "
        f"current status: {findings.get('status')!r}",
        file=sys.stderr,
    )
    sys.exit(2)

prompt = json.dumps(
    {
        "project_key": project_key,
        "validation_findings": findings,
        "original_proposal": json.loads((run_dir / "proposal.json").read_text()),
        "ranking_snapshot": json.loads((run_dir / "ranking-snapshot.json").read_text()),
    }
)
result = llm_client.invoke(stage_id="07-reconcile", prompt=prompt)
reconcile_proposal = result["response"]
reconcile_proposal["run_id"] = run_dir.name

proposal_path = run_dir / "reconcile-proposal.json"
proposal_path.write_text(json.dumps(reconcile_proposal, indent=2) + "\n")

now = datetime.now(timezone.utc).isoformat()
update_state_path = project_dir / "state" / "update-state.json"
if update_state_path.is_file():
    update_state = json.loads(update_state_path.read_text())
    update_state.setdefault("stages", {})
    update_state["stages"]["reconcile"] = {
        "status": "completed",
        "last_run_dir": str(run_dir),
        "last_completed_at": now,
        "summary_file": str(proposal_path),
    }
    update_state["last_completed_stage"] = "reconcile"
    update_state["latest_run_dir"] = str(run_dir)
    update_state_path.write_text(json.dumps(update_state, indent=2) + "\n")

units = reconcile_proposal.get("units", [])
print(f"reconcile: {len(units)} unit(s) proposed, approved={reconcile_proposal.get('approved', False)}")
PY
