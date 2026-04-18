#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/validate.sh --project <project-key> [--project-dir <project-dir>] [--run-dir <artifact-dir>]
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

project_key=""
project_dir_override=""
run_dir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      shift
      [[ $# -gt 0 ]] || die "--project requires a value"
      project_key="$1"
      shift
      ;;
    --run-dir)
      shift
      [[ $# -gt 0 ]] || die "--run-dir requires a value"
      run_dir="$1"
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
[[ -d "$project_dir" ]] || die "project does not exist: $project_dir"

report_path=""
findings_path=""
if [[ -n "$run_dir" ]]; then
  mkdir -p "$run_dir"
  report_path="$run_dir/validate-report.md"
  findings_path="$run_dir/validate-findings.json"
fi

python3 - "$project_dir" "$report_path" "$findings_path" <<'PY'
import json
import subprocess
import re
import sys
from pathlib import Path

project_dir = Path(sys.argv[1])
report_path = Path(sys.argv[2]) if sys.argv[2] else None
findings_path = Path(sys.argv[3]) if sys.argv[3] else None

required_files = [
    "index.md",
    "changelog.md",
    "state/project.json",
    "state/pages.json",
    "state/sources.json",
    "state/relationships.json",
    "state/freshness.json",
]

placeholder_markers = [
    "Placeholder page.",
    "Bootstrap placeholder.",
    "most pages are placeholders until real ingestion begins",
]

errors = []
warnings = []
notes = []

for rel in required_files:
    path = project_dir / rel
    if not path.exists():
        errors.append(f"Missing required file: {rel}")

json_files = [
    "state/project.json",
    "state/pages.json",
    "state/sources.json",
    "state/relationships.json",
    "state/freshness.json",
]

json_data = {}
for rel in json_files:
    path = project_dir / rel
    if not path.exists():
        continue
    try:
        json_data[rel] = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"Invalid JSON in {rel}: {exc}")

index_md = project_dir / "index.md"
wiki_pages = sorted(
    p for p in (project_dir / "wiki").rglob("*.md")
    if p.name != "README.md" and "sessions" not in p.parts
)

for path in [index_md, *wiki_pages]:
    if path.exists():
        text = path.read_text(encoding="utf-8")
        for marker in placeholder_markers:
            if marker in text:
                errors.append(f"Canonical page still contains placeholder marker '{marker}': {path.relative_to(project_dir)}")

for path in [index_md, *wiki_pages]:
    if not path.exists():
        continue
    text = path.read_text(encoding="utf-8")
    if "## Review Provenance" in text or "<!-- llm-wiki:review-provenance:" in text:
        errors.append(f"Page still contains review-provenance scaffolding: {path.relative_to(project_dir)}")
    if re.search(r"^## Status\s*$", text, flags=re.MULTILINE):
        errors.append(f"Page still contains construction-status narration: {path.relative_to(project_dir)}")

changelog_md = project_dir / "changelog.md"
changelog_text = changelog_md.read_text(encoding="utf-8") if changelog_md.exists() else ""

sessions_dir = project_dir / "wiki/sessions"
session_files = sorted(p for p in sessions_dir.glob("*.md") if p.name != "README.md")

has_bootstrap_entry = "bootstrap" in changelog_text
scaffold_mode = not has_bootstrap_entry and not session_files

pages_json = json_data.get("state/pages.json", {})
pages = pages_json.get("pages", [])
if not pages and not scaffold_mode:
    errors.append("state/pages.json has no page entries")

# New check: every .md under wiki/ (excluding README.md and sessions/) is registered in pages.json
pages_data_for_check = json_data.get("state/pages.json", {}) or {}
registered_paths = {p["path"] for p in pages_data_for_check.get("pages", []) if "path" in p}
registered_wiki_paths = {path for path in registered_paths if path.startswith("wiki/")}

disk_pages = set()
wiki_dir = project_dir / "wiki"
if wiki_dir.exists():
    for md in wiki_dir.rglob("*.md"):
        if md.name == "README.md":
            continue
        if "sessions" in md.parts:
            continue
        disk_pages.add(md.relative_to(project_dir).as_posix())

for page in sorted(disk_pages - registered_wiki_paths):
    errors.append(f"wiki page not registered in pages.json: {page}")

for page in sorted(registered_wiki_paths - disk_pages):
    if page.startswith("wiki/sessions/"):
        continue
    errors.append(f"pages.json entry points to missing file: {page}")

project_json = json_data.get("state/project.json", {})
entry_pages = project_json.get("entry_pages", [])
if not entry_pages:
    warnings.append("state/project.json has no entry_pages")
for rel in entry_pages:
    if not (project_dir / rel).exists():
        errors.append(f"state/project.json entry_pages references missing file: {rel}")

sources_json = json_data.get("state/sources.json", {})
sources = sources_json.get("sources", [])

if not sources and not scaffold_mode:
    warnings.append("state/sources.json has no recorded sources yet")

# New check: every source entry has a preserved file on disk
sources_data_for_check = json_data.get("state/sources.json", {}) or {}
for src in sources_data_for_check.get("sources", []):
    original = src.get("original_path", "")
    preserved = src.get("preserved_path", "")
    source_id = src.get("source_id", "<unknown>")
    candidates = []
    if preserved:
        candidates.append(project_dir / preserved)
    if original:
        candidates.extend([
            project_dir / "sources" / original,
            project_dir.parent.parent / "raw" / "processed" / original,
        ])
    if not any(c.exists() for c in candidates):
        errors.append(f"source entry {source_id} has no preserved file (looked in {', '.join(str(c) for c in candidates)})")

# New check: pages larger than 150 lines must declare oversize_reason
OVERSIZE_THRESHOLD = 150
for entry in pages_data_for_check.get("pages", []):
    rel = entry.get("path")
    if not rel:
        continue
    path = project_dir / rel
    if not path.exists():
        continue
    with path.open() as f:
        line_count = sum(1 for _ in f)
    if line_count > OVERSIZE_THRESHOLD and not entry.get("oversize_reason"):
        errors.append(f"page exceeds {OVERSIZE_THRESHOLD} lines without oversize_reason: {rel} ({line_count} lines)")

repo_paths = project_json.get("repo_paths") or []
repo_dirty = False
dirty_paths = []
repo_path = None
if repo_paths:
    repo_path = Path(repo_paths[0])
    if repo_path.exists():
        try:
            status_output = subprocess.check_output(
                ["git", "-C", str(repo_path), "status", "--short"],
                text=True
            )
            dirty_paths = [line[3:].strip() for line in status_output.splitlines() if line.strip()]
            repo_dirty = bool(dirty_paths)
        except Exception as exc:
            warnings.append(f"Could not inspect git status for repo path {repo_path}: {exc}")

freshness_json = json_data.get("state/freshness.json", {})
if repo_dirty:
    if not freshness_json.get("repo_dirty"):
        errors.append("state/freshness.json does not record repo_dirty=true even though the source repo worktree is dirty")
    if sorted(freshness_json.get("dirty_paths", [])) != sorted(dirty_paths):
        errors.append("state/freshness.json dirty_paths does not match the current source repo worktree")
else:
    if repo_paths and freshness_json.get("repo_dirty"):
        errors.append("state/freshness.json records repo_dirty=true even though the source repo worktree is currently clean")

if scaffold_mode:
    notes.append("Project is still in scaffold state; bootstrap has not run yet.")
else:
    if not has_bootstrap_entry:
        errors.append("changelog.md does not contain a bootstrap entry")
    if not session_files:
        errors.append("No durable session summary exists under wiki/sessions/")
    else:
        notes.append(f"Found {len(session_files)} session summary file(s)")

index_text = index_md.read_text(encoding="utf-8") if index_md.exists() else ""
index_lines = index_text.splitlines()

project_focuses = [item.strip() for item in (project_json.get("bootstrap_focuses") or []) if str(item).strip()]

current_priorities = []
in_current_priorities = False
for line in index_lines:
    if re.match(r"^##\s+Current Priorities\s*$", line):
        in_current_priorities = True
        continue
    if in_current_priorities and re.match(r"^##\s+", line):
        break
    if in_current_priorities:
        match = re.match(r"^\s*-\s+(.*\S)\s*$", line)
        if match:
            current_priorities.append(match.group(1).strip())

normalized_focuses = {item.casefold() for item in project_focuses}
normalized_priorities = {item.casefold() for item in current_priorities}
if project_focuses and current_priorities and normalized_focuses == normalized_priorities:
    errors.append("index.md Current Priorities mirrors bootstrap_focuses exactly; priorities should come from project sources, not workflow labels")

if any("no project priorities are documented yet." in item.casefold() for item in current_priorities):
    warnings.append("index.md still uses the scaffold priority placeholder; replace it with verified priorities or the stricter 'No verified project priorities are documented in source materials yet.' fallback")

for entry in pages:
    rel = entry.get("path", "")
    if rel.startswith("wiki/") and Path(rel).name != "README.md":
      if Path(rel).name not in index_text:
          warnings.append(f"Page may not be linked from index.md: {rel}")

placeholder_index_links = [
    "./wiki/decisions/README.md",
    "./wiki/runbooks/README.md",
]
for link in placeholder_index_links:
    if link in index_text:
        errors.append(f"index.md links to placeholder structural README: {link}")

for entry in pages:
    path = entry.get("path", "")
    baseline_pass = entry.get("baseline_pass")
    freshness_status = entry.get("freshness_status")
    if path.startswith("wiki/sessions/"):
        if freshness_status != "session-record":
            warnings.append(f"Session page metadata freshness_status should be session-record: {path}")
    else:
        allowed_statuses = {"baseline-validated"}
        if scaffold_mode:
            allowed_statuses.add("scaffold")
        if path.startswith("wiki/architecture/") and any(
            str(src).startswith("project-") for src in entry.get("linked_sources", [])
        ):
            allowed_statuses.add("sourced-plan")
        if freshness_status not in allowed_statuses:
            warnings.append(
                f"Page metadata freshness_status should be one of {sorted(allowed_statuses)}: {path}"
            )
    if not baseline_pass and not scaffold_mode:
        warnings.append(f"Page metadata missing baseline_pass: {path}")

for path in wiki_pages:
    text = path.read_text(encoding="utf-8")
    if re.search(r"^## Purpose\s*$", text, flags=re.MULTILINE):
        warnings.append(f"Wiki page still uses the old ## Purpose heading: {path.relative_to(project_dir)}")
    if re.search(r"^## Stale Risk\s*$", text, flags=re.MULTILINE):
        warnings.append(f"Wiki page still uses the old ## Stale Risk heading: {path.relative_to(project_dir)}")

status = "PASS" if not errors else "FAIL"

lines = [f"# Validation Report: {project_dir.name}", "", f"Status: {status}", ""]
if errors:
    lines.append("## Errors")
    lines.extend(f"- {item}" for item in errors)
    lines.append("")
if warnings:
    lines.append("## Warnings")
    lines.extend(f"- {item}" for item in warnings)
    lines.append("")
if notes:
    lines.append("## Notes")
    lines.extend(f"- {item}" for item in notes)
    lines.append("")

report_text = "\n".join(lines).rstrip() + "\n"

if report_path is not None:
    report_path.write_text(report_text, encoding="utf-8")
if findings_path is not None:
    findings = {
        "project": project_dir.name,
        "status": status,
        "errors": errors,
        "warnings": warnings,
        "notes": notes,
        "signals": {
            "scaffold_mode": scaffold_mode,
            "repo_dirty": repo_dirty,
            "dirty_paths": dirty_paths,
        },
    }
    findings_path.write_text(json.dumps(findings, indent=2) + "\n", encoding="utf-8")

print(report_text, end="")

if errors:
    sys.exit(1)
PY
