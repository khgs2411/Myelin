#!/usr/bin/env bash

set -euo pipefail

project=""
task=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      project="$2"
      shift 2
      ;;
    --task)
      task="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$project" ]]; then
  echo "error: --project is required" >&2
  exit 2
fi

if [[ -z "$task" ]]; then
  echo "error: --task is required" >&2
  exit 2
fi

python3 scripts/measure_query_route.py --project "$project" --task "$task"
