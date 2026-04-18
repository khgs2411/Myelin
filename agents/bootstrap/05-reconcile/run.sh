#!/usr/bin/env bash

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/bootstrap/05-reconcile/run.sh --project <project-key> [--model <model>] [--run-dir <artifact-dir>] [--dry-run]
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

discover_latest_run_dir() {
  local project_key="$1"
  local artifacts_dir="$ROOT_DIR/artifacts/runs"
  local latest=""
  latest="$(find "$artifacts_dir" -maxdepth 1 -type d -name "*-bootstrap-$project_key" | sort | tail -n 1)"
  printf '%s' "$latest"
}

project_key=""
model=""
run_dir=""
dry_run="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      shift
      [[ $# -gt 0 ]] || die "--project requires a value"
      project_key="$1"
      shift
      ;;
    --model)
      shift
      [[ $# -gt 0 ]] || die "--model requires a value"
      model="$1"
      shift
      ;;
    --run-dir)
      shift
      [[ $# -gt 0 ]] || die "--run-dir requires a value"
      run_dir="$1"
      shift
      ;;
    --dry-run)
      dry_run="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"

project_dir="$ROOT_DIR/projects/$project_key"
[[ -d "$project_dir" ]] || die "project does not exist: $project_key"

python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" ensure --project-dir "$project_dir" --project "$project_key" >/dev/null

if [[ -z "$run_dir" ]]; then
  run_dir="$(python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" get --project-dir "$project_dir" --project "$project_key" --field latest_run_dir)"
fi
if [[ -z "$run_dir" ]]; then
  run_dir="$(discover_latest_run_dir "$project_key")"
fi
[[ -n "$run_dir" ]] || die "no bootstrap run directory available; run earlier bootstrap stages first"

if [[ "$dry_run" == "true" ]]; then
  "$ROOT_DIR/agents/bootstrap/_shared/stage_runner.sh" --agent-dir "$AGENT_DIR" --project "$project_key" --run-dir "$run_dir" ${model:+--model "$model"} --dry-run
  echo
  echo "Dry run validation command:"
  printf ' %q' "$ROOT_DIR/agents/bootstrap/04-validate/run.sh" --project "$project_key" --run-dir "$run_dir"
  echo
  exit 0
fi

"$ROOT_DIR/agents/bootstrap/_shared/stage_runner.sh" --agent-dir "$AGENT_DIR" --project "$project_key" --run-dir "$run_dir" ${model:+--model "$model"}
"$ROOT_DIR/agents/bootstrap/04-validate/run.sh" --project "$project_key" --run-dir "$run_dir"
