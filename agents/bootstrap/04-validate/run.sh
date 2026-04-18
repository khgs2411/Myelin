#!/usr/bin/env bash

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/bootstrap/04-validate/run.sh --project <project-key> [--project-dir <project-dir>] [--run-dir <artifact-dir>]
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
run_dir=""
project_dir_override=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      shift
      [[ $# -gt 0 ]] || die "--project requires a value"
      project_key="$1"
      shift
      ;;
    --run-dir)
      shift
      [[ $# -gt 0 ]] || die "--run-dir requires a value"
      run_dir="$1"
      shift
      ;;
    --project-dir)
      shift
      [[ $# -gt 0 ]] || die "--project-dir requires a value"
      project_dir_override="$1"
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
if [[ -n "$project_dir_override" ]]; then
  project_dir="$project_dir_override"
fi
[[ -d "$project_dir" ]] || die "project does not exist: $project_key"

python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" ensure --project-dir "$project_dir" --project "$project_key" >/dev/null

if [[ -z "$run_dir" ]]; then
  run_dir="$(python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" get --project-dir "$project_dir" --project "$project_key" --field latest_run_dir)"
fi
if [[ -z "$run_dir" ]]; then
  run_dir="$(discover_latest_run_dir "$project_key")"
fi
[[ -n "$run_dir" ]] || die "no bootstrap run directory available; run orient first or pass --run-dir"

mkdir -p "$run_dir"
report_path="$run_dir/validate-report.md"
findings_path="$run_dir/validate-findings.json"

# Stage 4a: structural validator
validate_args=(--project "$project_key" --run-dir "$run_dir")
if [[ -n "$project_dir_override" ]]; then
  validate_args+=(--project-dir "$project_dir_override")
fi
if ! "$ROOT_DIR/scripts/validate.sh" "${validate_args[@]}"; then
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-validation \
    --project-dir "$project_dir" \
    --project "$project_key" \
    --status fail \
    --run-dir "$run_dir" \
    --report-path "$report_path" \
    --findings-path "$findings_path" >/dev/null
  echo "structural validation failed" >&2
  exit 1
fi

# Stage 4b: semantic validator (LLM-driven, via stage_runner.sh)
semantic_findings="$run_dir/semantic-findings.json"

if [[ "${LLM_WIKI_SEMANTIC_SKIP:-0}" == "1" ]]; then
  echo '{"findings": []}' > "$semantic_findings"
else
  "$ROOT_DIR/agents/bootstrap/_shared/stage_runner.sh" \
    --agent-dir "$AGENT_DIR" \
    --project "$project_key" \
    ${project_dir_override:+--project-dir "$project_dir_override"} \
    --run-dir "$run_dir"
fi

# The semantic validator writes semantic-findings.json per its instructions.
# Verify the file exists and is valid JSON before counting.
if [[ ! -f "$semantic_findings" ]]; then
  echo "semantic validator did not produce $semantic_findings" >&2
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-validation \
    --project-dir "$project_dir" --project "$project_key" \
    --status fail --run-dir "$run_dir" \
    --report-path "$report_path" --findings-path "$findings_path" >/dev/null
  exit 1
fi

blocker_count=$(python3 - "$semantic_findings" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except (json.JSONDecodeError, OSError) as exc:
    print(f"__PARSE_ERROR__:{exc}", file=sys.stderr)
    sys.exit(2)
print(sum(1 for f in data.get("findings", []) if f.get("severity") == "blocker"))
PY
) || {
  echo "semantic-findings.json is not valid JSON" >&2
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-validation \
    --project-dir "$project_dir" --project "$project_key" \
    --status fail --run-dir "$run_dir" \
    --report-path "$report_path" --findings-path "$findings_path" >/dev/null
  exit 1
}

if [[ "$blocker_count" -gt 0 ]]; then
  echo "semantic validation failed: $blocker_count blocker findings" >&2
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-validation \
    --project-dir "$project_dir" --project "$project_key" \
    --status fail --run-dir "$run_dir" \
    --report-path "$report_path" --findings-path "$findings_path" >/dev/null
  exit 1
fi

python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-validation \
  --project-dir "$project_dir" --project "$project_key" \
  --status pass --run-dir "$run_dir" \
  --report-path "$report_path" --findings-path "$findings_path" >/dev/null
exit 0
