#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/prune_artifacts.sh [--project <project-key> | --global] [--root-dir <llm-wiki-root>]

Environment:
  ARTIFACT_KEEP   Keep the newest N runs per project/op bucket (default: 10)
EOF
}

scope=""
project_key=""
root_dir_override=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      shift
      [[ $# -gt 0 ]] || { echo "error: --project requires a value" >&2; exit 1; }
      scope="project"
      project_key="$1"
      shift
      ;;
    --global)
      scope="global"
      shift
      ;;
    --root-dir)
      shift
      [[ $# -gt 0 ]] || { echo "error: --root-dir requires a value" >&2; exit 1; }
      root_dir_override="$1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -n "$root_dir_override" ]]; then
  ROOT_DIR="$root_dir_override"
fi

python3 - "$ROOT_DIR" "${ARTIFACT_KEEP:-10}" "$scope" "$project_key" <<'PY'
from __future__ import annotations

import json
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

root_dir = Path(sys.argv[1]).resolve()
keep = int(sys.argv[2])
scope = sys.argv[3]
project_key = sys.argv[4]

if keep < 1:
    raise SystemExit("ARTIFACT_KEEP must be >= 1")

artifacts_root = root_dir / "artifacts"
projects_root = root_dir / "projects"
run_name_re = re.compile(r"^\d{8}-\d{6}-(.+)$")


def iter_scope_dirs() -> list[Path]:
    if scope == "project":
        return [artifacts_root / project_key / "runs"]
    if scope == "global":
        return [artifacts_root / "_global" / "runs"]
    return sorted(path for path in artifacts_root.glob("*/runs") if path.is_dir())


def pinned_run_dirs() -> set[Path]:
    pinned: set[Path] = set()
    for state_path in projects_root.glob("*/state/bootstrap-state.json"):
        try:
            data = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for field in ("latest_validation_findings", "latest_lint_findings", "latest_ingest_findings"):
            value = data.get(field)
            if isinstance(value, dict):
                audit_run_dir = value.get("audit_run_dir")
                if isinstance(audit_run_dir, str) and audit_run_dir:
                    pinned.add(Path(audit_run_dir).resolve())
    return pinned


pinned = pinned_run_dirs()
buckets: dict[tuple[str, str], list[Path]] = defaultdict(list)

for runs_dir in iter_scope_dirs():
    if not runs_dir.exists():
        continue
    project = runs_dir.parent.name
    for run_dir in runs_dir.iterdir():
        if not run_dir.is_dir():
            continue
        match = run_name_re.match(run_dir.name)
        if not match:
            continue
        op = match.group(1)
        buckets[(project, op)].append(run_dir.resolve())

for (_, _), run_dirs in buckets.items():
    run_dirs.sort(key=lambda path: path.name, reverse=True)
    kept = set(run_dirs[:keep])
    for run_dir in run_dirs:
        if run_dir in pinned or run_dir in kept:
            continue
        print(f"deleted {run_dir}")
        shutil.rmtree(run_dir)
PY
