#!/usr/bin/env bash
# Apply a pending-approval slice: execute deferred units + clean up.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="${PROJECTS_ROOT:-$ROOT_DIR/projects}"

usage() {
  cat <<'EOF'
Usage:
  scripts/apply_pending.sh --project <key> --proposal <proposal-id>
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
proposal_id=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    --proposal) proposal_id="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
[[ -n "$proposal_id" ]] || die "--proposal is required"

project_dir="$PROJECTS_ROOT/$project_key"
pending_dir="$project_dir/state/pending-approvals/$proposal_id"
[[ -d "$pending_dir" ]] || die "pending slice not found: $pending_dir"
[[ -f "$pending_dir/proposal-slice.json" ]] || die "proposal-slice.json missing in $pending_dir"

python3 - "$project_key" "$project_dir" "$pending_dir" <<'PY'
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
pending_dir = Path(sys.argv[3])
root_dir = project_dir.parent.parent
slice_data = json.loads((pending_dir / "proposal-slice.json").read_text())
units = slice_data.get("units", [])
now = datetime.now(timezone.utc).isoformat()


def die(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


project_json = json.loads((project_dir / "state" / "project.json").read_text())
repo_paths = project_json.get("repo_paths", [])
repo = None
if repo_paths:
    repo = Path(repo_paths[0])
    if not repo.is_absolute():
        repo = root_dir / repo

for unit in units:
    for citation in unit.get("source_citations", []) or []:
        if repo is None:
            continue
        path_part = citation.split(":", 1)[0] if ":" in citation else citation
        resolved = repo / path_part
        if not resolved.is_file():
            die(f"slice unit {unit.get('id')} cites non-existent file: {path_part}")

applied = []
for unit in units:
    action = unit.get("action")
    path = project_dir / unit["page_path"]
    if action == "delete":
        if path.is_file():
            path.unlink()
            applied.append(unit["page_path"])
    elif action == "rename":
        rename_from = unit.get("rename_from", "")
        source_path = project_dir / rename_from
        if source_path.is_file():
            path.parent.mkdir(parents=True, exist_ok=True)
            source_path.rename(path)
            applied.append(f"{rename_from} -> {unit['page_path']}")

index_change_path = pending_dir / "index-changes.json"
if index_change_path.is_file():
    index_changes = json.loads(index_change_path.read_text())
    if index_changes.get("action") == "update" and index_changes.get("content"):
        (project_dir / "index.md").write_text(index_changes["content"])
        applied.append("index.md (deferred index_changes)")

pages_path = project_dir / "state" / "pages.json"
if pages_path.is_file():
    pages = json.loads(pages_path.read_text()).get("pages", [])
    deleted = {unit["page_path"] for unit in units if unit.get("action") == "delete"}
    pages = [page for page in pages if page["path"] not in deleted]
    pages_path.write_text(json.dumps({"pages": pages}, indent=2) + "\n")

changelog_path = project_dir / "changelog.md"
if changelog_path.is_file():
    entry = f"\n## [{now}] apply-pending - {len(applied)} unit(s), slice {slice_data['origin_run_id']}\n"
    changelog_path.write_text(changelog_path.read_text() + entry)

shutil.rmtree(pending_dir)

print(f"applied {len(applied)} deferred unit(s); slice cleaned up")
PY
