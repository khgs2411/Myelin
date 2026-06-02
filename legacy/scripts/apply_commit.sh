#!/usr/bin/env bash
# apply_commit - atomically move last_seen_commit_pending to last_seen_commit.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="${PROJECTS_ROOT:-$ROOT_DIR/projects}"

usage() {
  cat <<'EOF'
Usage:
  scripts/apply_commit.sh --project <project-key>
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
project_dir="$PROJECTS_ROOT/$project_key"
[[ -d "$project_dir" ]] || die "project not found: $project_dir"
freshness_path="$project_dir/state/freshness.json"
[[ -f "$freshness_path" ]] || die "freshness.json not found"

python3 - "$freshness_path" "$project_dir" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

freshness_path = Path(sys.argv[1])
project_dir = Path(sys.argv[2])
data = json.loads(freshness_path.read_text())
pending_commit = data.get("last_seen_commit_pending")
pending_update = data.get("last_update_at_pending")

if pending_commit is None and pending_update is None:
    print("apply_commit: no pending values; no-op")
    sys.exit(0)

if pending_commit is not None:
    data["last_seen_commit"] = pending_commit
if pending_update is not None:
    data["last_update_at"] = pending_update
data["last_seen_commit_pending"] = None
data["last_update_at_pending"] = None

tmp_path = freshness_path.with_suffix(freshness_path.suffix + ".tmp")
tmp_path.write_text(json.dumps(data, indent=2) + "\n")
os.replace(tmp_path, freshness_path)

changelog_path = project_dir / "changelog.md"
if changelog_path.is_file():
    now = datetime.now(timezone.utc).isoformat()
    custom_message = os.environ.get("APPLY_COMMIT_MESSAGE", "").strip()
    if custom_message:
        entry = f"\n## [{now}] {custom_message}\n"
    else:
        entry = f"\n## [{now}] apply-commit - last_seen_commit advanced to {pending_commit}\n"
    changelog_path.write_text(changelog_path.read_text() + entry)

print(f"apply_commit: advanced last_seen_commit -> {pending_commit}")
PY
