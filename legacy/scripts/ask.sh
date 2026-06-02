#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

die() { echo "error: $*" >&2; exit 1; }

project_key=""
question=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    --question) question="${2:?}"; shift 2 ;;
    -h|--help)
      echo "Usage: scripts/ask.sh --project <key> --question \"...\""
      exit 0
      ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
[[ -n "$question" ]] || die "--question is required"

raw="$(
  python3 -m agents.query.query_engine \
    --project "$project_key" \
    --question "$question" \
    --projects-root "${UPDATE_PROJECTS_ROOT:-${PROJECTS_ROOT:-$ROOT_DIR/projects}}"
)"

python3 - "$raw" <<'PY'
import json
import sys

data = json.loads(sys.argv[1])
print(f"Answer: {data['answer']}")
print(f"Confidence: {data['confidence']:.2f}")
print("Citations:")
for citation in data.get("citations", []):
    print(f"  - {citation}")
PY
