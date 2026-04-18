#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/status.sh --project <project-key> [--project-dir <abs-path>]
  scripts/status.sh --all
EOF
}

mode=""
project_key=""
project_dir_override=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      shift
      [[ $# -gt 0 ]] || { echo "error: --project requires a value" >&2; exit 1; }
      mode="project"
      project_key="$1"
      shift
      ;;
    --project-dir)
      shift
      [[ $# -gt 0 ]] || { echo "error: --project-dir requires a value" >&2; exit 1; }
      project_dir_override="$1"
      shift
      ;;
    --all)
      mode="all"
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

[[ -n "$mode" ]] || { usage >&2; exit 1; }

python3 - "$ROOT_DIR" "$mode" "$project_key" "$project_dir_override" <<'PY'
from __future__ import annotations

import json
import sys
from pathlib import Path

root_dir = Path(sys.argv[1]).resolve()
mode = sys.argv[2]
project_key = sys.argv[3]
project_dir_override = sys.argv[4]


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def load_pipeline_state(project_dir: Path) -> dict:
    v2_path = project_dir / "state" / "update-state.json"
    if v2_path.is_file():
        return load_json(v2_path)
    v1_path = project_dir / "state" / "bootstrap-state.json"
    if v1_path.is_file():
        print(f"warning: {project_dir.name} not yet migrated to v2 state", file=sys.stderr)
        return load_json(v1_path)
    return {}


def status_view(project_dir: Path) -> dict:
    project = load_json(project_dir / "state" / "project.json")
    bootstrap = load_pipeline_state(project_dir)
    freshness = load_json(project_dir / "state" / "freshness.json")
    lint = load_json(project_dir / "state" / "latest" / "lint-findings.json")
    validation = load_json(project_dir / "state" / "latest" / "validation-findings.json")
    ingest = load_json(project_dir / "state" / "latest" / "ingest-findings.json")
    last_stage = bootstrap.get("last_completed_stage")
    last_stage_data = (bootstrap.get("stages") or {}).get(last_stage or "", {}) if last_stage else {}
    return {
        "project": project,
        "bootstrap": bootstrap,
        "freshness": freshness,
        "lint": lint,
        "validation": validation,
        "ingest": ingest,
        "last_stage_timestamp": last_stage_data.get("last_completed_at"),
        "project_dir": project_dir,
    }


def scalar(value: object, fallback: str = "none") -> str:
    if value is None:
        return fallback
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value)
    return text if text else fallback


def full_output(view: dict) -> str:
    project = view["project"]
    bootstrap = view["bootstrap"]
    freshness = view["freshness"]
    lint = view["lint"]
    validation = view["validation"]
    ingest = view["ingest"]
    project_dir = view["project_dir"]
    repo_paths = project.get("repo_paths") or []
    lines = [
        f"Project: {scalar(project.get('key'))} ({scalar(project.get('name'))})",
        "Repo paths:",
    ]
    if repo_paths:
        lines.extend(f"- {path}" for path in repo_paths)
    else:
        lines.append("- none")
    lines.extend(
        [
            (
                "Bootstrap: "
                f"last_completed_stage={scalar(bootstrap.get('last_completed_stage'))} "
                f"reconciliation_required={scalar(bootstrap.get('reconciliation_required'))} "
                f"timestamp={scalar(view.get('last_stage_timestamp'))}"
            ),
            (
                "Latest lint: "
                f"status={scalar(lint.get('status'))} "
                f"findings={scalar(lint.get('finding_count'), '0')} "
                f"path={project_dir / 'state' / 'latest' / 'lint-findings.md'}"
            ),
            (
                "Latest validation: "
                f"status={scalar(validation.get('status'))} "
                f"findings={scalar(validation.get('finding_count'), '0')} "
                f"path={project_dir / 'state' / 'latest' / 'validation-report.md'}"
            ),
            (
                "Latest ingest: "
                f"timestamp={scalar(ingest.get('updated_at'))} "
                f"source={scalar(ingest.get('source'))} "
                f"path={project_dir / 'state' / 'latest' / 'ingest-report.md'}"
            ),
            (
                "Freshness: "
                f"last_seen_commit={scalar(freshness.get('last_seen_commit'))} "
                f"impacted_pages={len(freshness.get('impacted_pages') or [])}"
            ),
        ]
    )
    return "\n".join(lines)


def one_line_output(view: dict) -> str:
    project = view["project"]
    bootstrap = view["bootstrap"]
    freshness = view["freshness"]
    lint = view["lint"]
    validation = view["validation"]
    ingest = view["ingest"]
    return (
        f"{scalar(project.get('key'))} | "
        f"bootstrap={scalar(bootstrap.get('last_completed_stage'))}@{scalar(view.get('last_stage_timestamp'))} | "
        f"lint={scalar(lint.get('status'))}/{scalar(lint.get('finding_count'), '0')} | "
        f"validation={scalar(validation.get('status'))}/{scalar(validation.get('finding_count'), '0')} | "
        f"ingest={scalar(ingest.get('source'))}@{scalar(ingest.get('updated_at'))} | "
        f"freshness={scalar(freshness.get('last_seen_commit'))}/{len(freshness.get('impacted_pages') or [])}"
    )


if mode == "project":
    project_dir = Path(project_dir_override) if project_dir_override else root_dir / "projects" / project_key
    print(full_output(status_view(project_dir)))
    raise SystemExit(0)

project_dirs = sorted(path.parent.parent for path in (root_dir / "projects").glob("*/state/project.json"))
for project_dir in project_dirs:
    print(one_line_output(status_view(project_dir)))
PY
