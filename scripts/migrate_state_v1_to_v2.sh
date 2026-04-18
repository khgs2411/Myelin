#!/usr/bin/env bash
# Forward migration: v1 state -> v2 state.
#
# Operations:
#   - bootstrap-state.json -> update-state.json (rename + schema update)
#   - project.json: remove bootstrap_focuses, add acceptance_questions_path + ranking_cutoff
#   - freshness.json: add last_seen_commit, last_seen_commit_pending, last_update_at fields
#   - bootstrap_focuses values archived to .migration-hints/bootstrap-focuses-archive.md
#
# Usage:
#   PROJECT=<key> scripts/migrate_state_v1_to_v2.sh
#   (optional) PROJECTS_ROOT=<path>  defaults to $ROOT_DIR/projects

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
from pathlib import Path
from datetime import datetime, timezone

proj = Path(sys.argv[1])
state = proj / "state"

# --- bootstrap-state.json -> update-state.json ---
bs = state / "bootstrap-state.json"
us = state / "update-state.json"
if bs.is_file():
    data = json.loads(bs.read_text())
    required_stages = ["sense", "impact", "propose", "apply", "validate", "reconcile"]
    stages = {}
    for s in required_stages:
        stages[s] = {
            "status": "pending",
            "last_run_dir": None,
            "last_completed_at": None,
            "summary_file": None,
        }
    data["stages"] = stages
    data.setdefault("latest_run_dir", None)
    data.setdefault("last_completed_stage", None)
    data.setdefault("latest_validation_findings", None)
    data.setdefault("latest_lint_findings", None)
    data.setdefault("latest_ingest_findings", None)
    us.write_text(json.dumps(data, indent=2) + "\n")
    bs.unlink()
    print(f"migrated: {bs.name} -> {us.name}", file=sys.stderr)

# --- project.json: drop bootstrap_focuses, add new fields ---
pj_path = state / "project.json"
if pj_path.is_file():
    pj = json.loads(pj_path.read_text())
    focuses = pj.pop("bootstrap_focuses", None)
    pj.setdefault("acceptance_questions_path", "acceptance-questions.md")
    pj.setdefault("ranking_cutoff", 20)
    pj_path.write_text(json.dumps(pj, indent=2) + "\n")

    if focuses:
        hints_dir = proj / ".migration-hints"
        hints_dir.mkdir(exist_ok=True)
        archive = hints_dir / "bootstrap-focuses-archive.md"
        archive.write_text(
            "# Archived bootstrap_focuses\n\n"
            "These values were present in the v1 project.json and were archived\n"
            "when the project migrated to v2 state. Consider re-expressing any that\n"
            "still matter as entries in `acceptance-questions.md`.\n\n"
            + "\n".join(f"- {f}" for f in focuses) + "\n"
        )
        print(
            f"warning: {len(focuses)} bootstrap_focuses entries archived; "
            f"review {archive.relative_to(proj)} and port to acceptance-questions.md as needed.",
            file=sys.stderr,
        )

# --- freshness.json: ensure new fields ---
fp = state / "freshness.json"
if fp.is_file():
    f = json.loads(fp.read_text())
    f.setdefault("last_seen_commit", None)
    f.setdefault("last_seen_commit_pending", None)
    f.setdefault("last_update_at", None)
    f.setdefault("changed_paths", [])
    f.setdefault("impacted_pages", [])
    fp.write_text(json.dumps(f, indent=2) + "\n")

print("v1 -> v2 migration complete")
PY
