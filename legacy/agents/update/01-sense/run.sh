#!/usr/bin/env bash
# Sense stage — mechanical enumeration + classification.
#
# Produces: <run-dir>/sense-report.json per spec Section 5.4.

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/01-sense/run.sh --project <project-key> [--project-dir <project-dir>] --run-dir <artifact-dir>
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
mkdir -p "$run_dir"

python3 - "$project_key" "$project_dir" "$run_dir" "$AGENT_DIR" "$ROOT_DIR" <<'PY'
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
agent_dir = Path(sys.argv[4])
root_dir = Path(sys.argv[5])

config = json.loads((agent_dir / "config.json").read_text())
patterns = config["stage_specific"]["inbox_filename_patterns"]

project_json = json.loads((project_dir / "state" / "project.json").read_text())
repo_paths = [str(root_dir / p) if not Path(p).is_absolute() else p for p in project_json.get("repo_paths", [])]
repo = Path(repo_paths[0]) if repo_paths else None

freshness = project_dir / "state" / "freshness.json"
last_seen = None
if freshness.is_file():
    last_seen = json.loads(freshness.read_text()).get("last_seen_commit")

# If repo dir has no .git but has a .bundle file, initialize from bundle.
if repo and not (repo / ".git").is_dir():
    bundle = repo / "sample_repo.bundle"
    if bundle.is_file():
        subprocess.run(
            ["git", "clone", str(bundle), str(repo)],
            capture_output=True, check=False,
        )
        if not (repo / ".git").is_dir():
            # clone would put files in a subdir; use unbundle approach instead
            subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True)
            subprocess.run(
                ["git", "-C", str(repo), "fetch", str(bundle), "HEAD:main"],
                capture_output=True, check=True,
            )
            subprocess.run(
                ["git", "-C", str(repo), "checkout", "-q", "main"],
                capture_output=True, check=True,
            )

mode = "no-git"
current_head = None
changed_paths = []
if repo and (repo / ".git").is_dir():
    head = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    )
    current_head = head.stdout.strip()
    if last_seen:
        mode = "incremental"
        diff = subprocess.run(
            ["git", "-C", str(repo), "diff", "--name-status", f"{last_seen}..HEAD"],
            capture_output=True, text=True, check=True,
        )
        for line in diff.stdout.splitlines():
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            code = parts[0]
            path = parts[1]
            change_type = {"A": "added", "M": "modified", "D": "deleted", "R": "renamed"}.get(code[0], "modified")
            changed_paths.append({"path": path, "change_type": change_type})
    else:
        mode = "first-run"
        ls = subprocess.run(
            ["git", "-C", str(repo), "ls-files"],
            capture_output=True, text=True, check=True,
        )
        for path in ls.stdout.splitlines():
            if path.strip():
                changed_paths.append({"path": path, "change_type": "added"})

inbox_dir = project_dir / "inbox"
inbox_sources = []
if inbox_dir.is_dir():
    for source in sorted(inbox_dir.iterdir()):
        if not source.is_file() or source.name == ".gitkeep":
            continue
        matched = None
        for pattern, kind in sorted(patterns.items(), key=lambda kv: -len(kv[0])):
            if re.search(pattern, source.name):
                matched = (pattern, kind)
                break
        if matched is None:
            kind_hint = "unknown"
            confidence = "low"
            reasoning = "no pattern matched"
        else:
            pattern, kind_hint = matched
            if "-" in pattern:
                confidence = "high"
                reasoning = f"matched domain-suffix pattern {pattern}"
            else:
                confidence = "medium"
                reasoning = f"matched extension-only pattern {pattern}"
        # Spec §5.4: inbox path is "projects/<key>/inbox/<filename>" regardless
        # of where project_dir actually lives on disk (may be a tmp path in tests).
        inbox_sources.append({
            "path": f"projects/{project_key}/inbox/{source.name}",
            "source_kind_hint": kind_hint,
            "classification_confidence": confidence,
            "classification_reasoning": reasoning,
        })

run_id = run_dir.name

report = {
    "project": project_key,
    "run_id": run_id,
    "mode": mode,
    "last_seen_commit": last_seen,
    "current_head": current_head,
    "inbox_sources": inbox_sources,
    "changed_paths": changed_paths,
    "commit_messages_read": [],
}

(run_dir / "sense-report.json").write_text(json.dumps(report, indent=2) + "\n")

# Stage completion marker in update-state.json (spec §6.4)
us_path = project_dir / "state" / "update-state.json"
if us_path.is_file():
    us = json.loads(us_path.read_text())
    us.setdefault("stages", {})
    us["stages"]["sense"] = {
        "status": "completed",
        "last_run_dir": str(run_dir),
        "last_completed_at": datetime.now(timezone.utc).isoformat(),
        "summary_file": str(run_dir / "sense-report.json"),
    }
    us["last_completed_stage"] = "sense"
    us["latest_run_dir"] = str(run_dir)
    us_path.write_text(json.dumps(us, indent=2) + "\n")

print(f"sense report written: {run_dir / 'sense-report.json'}")
PY
