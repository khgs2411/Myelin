#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/bootstrap/_shared/normalize.sh --project <project-key> [--project-dir <project-dir>]
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

project_key=""
project_dir_override=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      shift
      [[ $# -gt 0 ]] || die "--project requires a value"
      project_key="$1"
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

python3 - "$ROOT_DIR" "$project_dir" <<'PY'
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

root_dir = Path(sys.argv[1])
project_dir = Path(sys.argv[2])

project_state_path = project_dir / "state" / "project.json"
pages_path = project_dir / "state" / "pages.json"
freshness_path = project_dir / "state" / "freshness.json"
index_md_path = project_dir / "index.md"
sessions_dir = project_dir / "wiki" / "sessions"

project_state = json.loads(project_state_path.read_text(encoding="utf-8"))
pages_state = json.loads(pages_path.read_text(encoding="utf-8"))
freshness_state = json.loads(freshness_path.read_text(encoding="utf-8"))

repo_paths = project_state.get("repo_paths") or []
repo_path = Path(repo_paths[0]) if repo_paths else None

head_commit = None
dirty_paths = []
if repo_path and repo_path.exists():
    head_commit = subprocess.check_output(
        ["git", "-C", str(repo_path), "rev-parse", "HEAD"],
        text=True
    ).strip()
    status_output = subprocess.check_output(
        ["git", "-C", str(repo_path), "status", "--short"],
        text=True
    )
    for line in status_output.splitlines():
        if line.strip():
            dirty_paths.append(line[3:].strip())

today = str(date.today())
repo_dirty = bool(dirty_paths)

session_files = sorted(
    p for p in sessions_dir.glob("*.md")
    if p.name != "README.md"
)
latest_session_stem = (
    max(session_files, key=lambda p: p.stat().st_mtime).stem
    if session_files else "bootstrap-baseline"
)

for entry in pages_state.get("pages", []):
    path = entry.get("path", "")
    entry["baseline_pass"] = latest_session_stem
    if path.startswith("wiki/sessions/"):
        entry["freshness_status"] = "session-record"
    elif (
        path.startswith("wiki/architecture/")
        and entry.get("linked_sources")
        and all(str(src).startswith("project-") for src in entry.get("linked_sources", []))
    ):
        entry["freshness_status"] = "sourced-plan"
    else:
        entry["freshness_status"] = "baseline-validated"
    entry["last_reviewed_at"] = today

freshness_state["last_seen_commit"] = head_commit
freshness_state["repo_dirty"] = repo_dirty
freshness_state["dirty_paths"] = dirty_paths
freshness_state["changed_paths"] = dirty_paths
freshness_state["impacted_pages"] = []
freshness_state["status"] = "baseline-established-dirty" if repo_dirty else "baseline-established-clean"
freshness_state["updated_at"] = today
freshness_state["baseline_pass"] = latest_session_stem

def replace_section(text: str, heading: str, replacement_lines):
    marker = f"## {heading}\n"
    idx = text.find(marker)
    if idx == -1:
        return text
    section_start = idx + len(marker)
    next_idx = text.find("\n## ", section_start)
    if next_idx == -1:
        next_idx = len(text)
    while section_start < len(text) and text[section_start] == "\n":
        section_start += 1
    replacement = "\n".join(replacement_lines).rstrip() + "\n"
    return text[:section_start] + replacement + text[next_idx:]

def ensure_index_section_text(path: Path, folder_name: str, heading: str, empty_text: str) -> None:
    folder = project_dir / "wiki" / folder_name
    real_pages = sorted(
        p for p in folder.glob("*.md")
        if p.name != "README.md"
    )
    text = path.read_text(encoding="utf-8")
    if real_pages:
        return
    text = replace_section(text, heading, [f"- {empty_text}", ""])
    path.write_text(text, encoding="utf-8")

ensure_index_section_text(index_md_path, "decisions", "Decisions", "No durable decision pages have been compiled yet.")
ensure_index_section_text(index_md_path, "runbooks", "Runbooks", "No project-specific runbooks have been compiled yet.")

pages_path.write_text(json.dumps(pages_state, indent=2) + "\n", encoding="utf-8")
freshness_path.write_text(json.dumps(freshness_state, indent=2) + "\n", encoding="utf-8")
PY
