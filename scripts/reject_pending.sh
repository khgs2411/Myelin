#!/usr/bin/env bash
# Reject a pending-approval slice: archive without applying.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="${PROJECTS_ROOT:-$ROOT_DIR/projects}"
ARTIFACTS_ROOT="${UPDATE_ARTIFACTS_ROOT:-$ROOT_DIR/artifacts}"

usage() {
  cat <<'EOF'
Usage:
  scripts/reject_pending.sh --project <key> --proposal <proposal-id>
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

archive_dir="$ARTIFACTS_ROOT/$project_key/rejected/$proposal_id"
mkdir -p "$(dirname "$archive_dir")"
mv "$pending_dir" "$archive_dir"

python3 - "$project_dir" "$proposal_id" <<'PY'
import sys
from datetime import datetime, timezone
from pathlib import Path

project_dir = Path(sys.argv[1])
proposal_id = sys.argv[2]
now = datetime.now(timezone.utc).isoformat()

changelog_path = project_dir / "changelog.md"
if changelog_path.is_file():
    entry = f"\n## [{now}] reject-pending - slice {proposal_id} archived without applying\n"
    changelog_path.write_text(changelog_path.read_text() + entry)
PY

echo "rejected slice $proposal_id; archived to $archive_dir"
