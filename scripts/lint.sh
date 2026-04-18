#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/lint.sh --project <project-key> [--project-dir <abs-path>] [--model <model>]

--project-dir overrides the default project lookup (ROOT_DIR/projects/<key>).
Used mainly by tests to point at a temp fixture.

MODEL selector (default: codex):
  --model codex              use Codex CLI default model
  --model codex/<id>         use Codex CLI with a specific model id
  --model claude             use Claude CLI default model
  --model claude/<id>        use Claude CLI with a specific model id
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
project_dir_override=""
model=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) shift; [[ $# -gt 0 ]] || die "--project requires a value"; project_key="$1"; shift ;;
    --project-dir) shift; [[ $# -gt 0 ]] || die "--project-dir requires a value"; project_dir_override="$1"; shift ;;
    --model) shift; [[ $# -gt 0 ]] || die "--model requires a value"; model="$1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"

if [[ -n "$project_dir_override" ]]; then
  project_dir="$project_dir_override"
else
  project_dir="$ROOT_DIR/projects/$project_key"
fi
[[ -d "$project_dir" ]] || die "project does not exist: $project_dir"

run_dir="$ROOT_DIR/artifacts/runs/$(date +%Y%m%d-%H%M%S)-lint-$project_key"
mkdir -p "$run_dir"

# Structural
validate_args=(--project "$project_key" --run-dir "$run_dir")
if [[ -n "$project_dir_override" ]]; then
  validate_args+=(--project-dir "$project_dir_override")
fi
if ! "$ROOT_DIR/scripts/validate.sh" "${validate_args[@]}"; then
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-lint \
    --project-dir "$project_dir" --project "$project_key" \
    --status fail --findings-path "$run_dir/validate-findings.json"
  exit 1
fi

# Semantic
semantic_findings="$run_dir/semantic-findings.json"
if [[ "${LLM_WIKI_SEMANTIC_SKIP:-0}" == "1" ]]; then
  echo '{"findings": []}' > "$semantic_findings"
else
  runner_args=(
    --agent-dir "$ROOT_DIR/agents/bootstrap/04-validate"
    --project "$project_key"
    --run-dir "$run_dir"
  )
  if [[ -n "$project_dir_override" ]]; then
    runner_args+=(--project-dir "$project_dir_override")
  fi
  if [[ -n "$model" ]]; then
    runner_args+=(--model "$model")
  fi
  "$ROOT_DIR/agents/bootstrap/_shared/stage_runner.sh" "${runner_args[@]}"
fi

if [[ ! -f "$semantic_findings" ]]; then
  echo "semantic validator did not produce $semantic_findings" >&2
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-lint \
    --project-dir "$project_dir" --project "$project_key" \
    --status fail --findings-path "$semantic_findings"
  exit 1
fi

blocker_count=$(python3 - "$semantic_findings" <<'PY' || echo "PARSE_ERROR"
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except (json.JSONDecodeError, OSError) as exc:
    print(f"parse error: {exc}", file=sys.stderr)
    sys.exit(2)
print(sum(1 for f in data.get("findings", []) if f.get("severity") == "blocker"))
PY
)

if [[ "$blocker_count" == "PARSE_ERROR" ]]; then
  echo "semantic-findings.json is not valid JSON" >&2
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-lint \
    --project-dir "$project_dir" --project "$project_key" \
    --status fail --findings-path "$semantic_findings"
  exit 1
fi

status="pass"
[[ "$blocker_count" -gt 0 ]] && status="fail"

python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-lint \
  --project-dir "$project_dir" --project "$project_key" \
  --status "$status" --findings-path "$semantic_findings"

echo "lint complete: status=$status blockers=$blocker_count findings=$semantic_findings"
[[ "$status" == "pass" ]] || exit 1
