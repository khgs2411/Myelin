#!/usr/bin/env bash
# Reverse migration: v2 state -> v1 state. Used for rollback.
#
# Operations:
#   - update-state.json -> bootstrap-state.json (rename only; schema unchanged)
#   - project.json: restore bootstrap_focuses from .migration-hints/ if present,
#     remove acceptance_questions_path and ranking_cutoff
#   - freshness.json: remove v2-only fields (keep best-effort legacy shape)
#
# Usage:
#   PROJECT=<key> scripts/migrate_state_v2_to_v1.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="${PROJECTS_ROOT:-$ROOT_DIR/projects}"
PROJECT="${PROJECT:?PROJECT is required}"

PROJ_DIR="$PROJECTS_ROOT/$PROJECT"
[[ -d "$PROJ_DIR" ]] || { echo "error: project not found: $PROJ_DIR" >&2; exit 1; }

python3 - "$PROJ_DIR" <<'PY'
import json
import sys
import re
from pathlib import Path

proj = Path(sys.argv[1])
state = proj / "state"

us = state / "update-state.json"
bs = state / "bootstrap-state.json"
if us.is_file():
    data = json.loads(us.read_text())
    bs.write_text(json.dumps(data, indent=2) + "\n")
    us.unlink()

pj_path = state / "project.json"
if pj_path.is_file():
    pj = json.loads(pj_path.read_text())
    pj.pop("acceptance_questions_path", None)
    pj.pop("ranking_cutoff", None)
    archive = proj / ".migration-hints" / "bootstrap-focuses-archive.md"
    if archive.is_file():
        focuses = [m.group(1) for m in re.finditer(r"^- (.+)$", archive.read_text(), re.M)]
        if focuses:
            pj["bootstrap_focuses"] = focuses
    pj_path.write_text(json.dumps(pj, indent=2) + "\n")

fp = state / "freshness.json"
if fp.is_file():
    f = json.loads(fp.read_text())
    f.pop("last_seen_commit_pending", None)
    fp.write_text(json.dumps(f, indent=2) + "\n")

print("v2 -> v1 reverse migration complete")
PY
