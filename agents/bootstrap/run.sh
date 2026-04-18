#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACTS_DIR="$ROOT_DIR/artifacts/runs"

usage() {
  cat <<'EOF'
Usage:
  agents/bootstrap/run.sh --project <project-key> [options]

Options:
  --project <project-key>       Required project key
  --model <model>               Optional model selector
  --dry-run                     Print planned stage commands, do not execute
  -h, --help                    Show this help message
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

project_key=""
model=""
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

timestamp="$(date '+%Y%m%d-%H%M%S')"
run_dir="$ARTIFACTS_DIR/$timestamp-bootstrap-$project_key"

common_args=(--project "$project_key" --run-dir "$run_dir")
if [[ -n "$model" ]]; then
  common_args+=(--model "$model")
fi

echo "Bootstrap target: $project_key"
echo "Run artifacts: $run_dir"

if [[ "$dry_run" == "true" ]]; then
  "$ROOT_DIR/agents/bootstrap/01-orient/run.sh" "${common_args[@]}" --dry-run
  echo
  "$ROOT_DIR/agents/bootstrap/02-domain-compiler/run.sh" "${common_args[@]}" --dry-run
  echo
  "$ROOT_DIR/agents/bootstrap/03-query-expander/run.sh" "${common_args[@]}" --dry-run
  echo
  echo "Dry run validation command:"
  printf ' %q' "$ROOT_DIR/agents/bootstrap/04-validate/run.sh" --project "$project_key" --run-dir "$run_dir"
  echo
  echo
  echo "Dry run reconciliation trigger:"
  echo "  runs only if bootstrap validation fails"
  exit 0
fi

"$ROOT_DIR/agents/bootstrap/01-orient/run.sh" "${common_args[@]}"
echo
"$ROOT_DIR/agents/bootstrap/02-domain-compiler/run.sh" "${common_args[@]}"
echo
"$ROOT_DIR/agents/bootstrap/03-query-expander/run.sh" "${common_args[@]}"
echo
if "$ROOT_DIR/agents/bootstrap/04-validate/run.sh" --project "$project_key" --run-dir "$run_dir"; then
  echo
  echo "Bootstrap orchestration completed successfully."
else
  echo
  echo "Validation reported issues. Running reconciliation..."
  "$ROOT_DIR/agents/bootstrap/05-reconcile/run.sh" "${common_args[@]}"
  echo
  echo "Bootstrap orchestration completed successfully."
fi
