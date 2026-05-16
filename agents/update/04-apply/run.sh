#!/usr/bin/env bash
# Apply stage - script-only. Reads approved proposal, writes wiki + state.
#
# Preserves these invariants:
#   - Never writes to wiki if pre-flight fails
#   - Never advances last_seen_commit (apply_commit.sh does that)
#   - Under AUTO=1, destructive/high-uncertainty units go to pending-approvals

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/04-apply/run.sh --project <project-key> [--project-dir <project-dir>] --run-dir <artifact-dir>
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
[[ -f "$run_dir/proposal.json" ]] || die "proposal.json missing in $run_dir"
[[ -f "$run_dir/ranking-snapshot.json" ]] || die "ranking-snapshot.json missing in $run_dir"

auto="${AUTO:-}"

python3 - "$project_key" "$project_dir" "$run_dir" "$AGENT_DIR" "$ROOT_DIR" "$auto" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
agent_dir = Path(sys.argv[4])
root_dir = Path(sys.argv[5])
sys.path.insert(0, str(root_dir))
auto = sys.argv[6] == "1"

from agents.update._shared import brain_metadata

proposal = json.loads((run_dir / "proposal.json").read_text())
ranking = json.loads((run_dir / "ranking-snapshot.json").read_text())
config = json.loads((agent_dir / "config.json").read_text())
destructive_actions = set(config["stage_specific"]["destructive_actions"])
high_uncertainty_value = config["stage_specific"]["high_uncertainty_value"]
ALLOWED_SOURCE_KINDS = {
    "spec",
    "design",
    "plan",
    "implementation-note",
    "api-doc",
    "reference",
    "session-note",
    "decision-candidate",
    "troubleshooting",
}
ALLOWED_SHELVES = {
    "architecture",
    "systems",
    "modules",
    "integrations",
    "decisions",
    "runbooks",
    "sessions",
    "glossary",
    "open-questions",
}
project_json = json.loads((project_dir / "state" / "project.json").read_text())


def die(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def render_index_status_block(commit: str | None, updated_at: str | None) -> str:
    lines = [
        "## Status",
        "- Freshness: `state/freshness.json`",
        "- Ranking snapshot: `state/latest/ranking-snapshot.json`",
    ]
    if updated_at:
        lines.append(f"- Last update: `{updated_at}`")
    if commit:
        lines.append(f"- Last seen commit: `{commit}`")
    lines.append("- Update state: `state/update-state.json`")
    return "\n".join(lines)


def canonicalize_index_status(content: str, commit: str | None, updated_at: str | None) -> str:
    if not commit and not updated_at:
        return content
    status_block = render_index_status_block(commit, updated_at)
    marker = "\n## Status\n"
    if marker in content:
        prefix = content.split(marker, 1)[0].rstrip()
        return f"{prefix}\n\n{status_block}\n"
    stripped = content.rstrip()
    return f"{stripped}\n\n{status_block}\n"


if not proposal.get("approved"):
    die("proposal is not approved (set top-level approved=true)")

ranked_domain_names = {domain["domain"] for domain in ranking.get("ranked_domains", [])}
max_new_pages = proposal.get("max_new_pages", 25)
new_pages_count = proposal.get("new_pages_count", 0)
if new_pages_count > max_new_pages:
    die(f"new_pages_count {new_pages_count} exceeds max_new_pages {max_new_pages}")

repo = None
repo_paths = project_json.get("repo_paths", [])
if repo_paths:
    repo = Path(repo_paths[0])
    if not repo.is_absolute():
        repo = root_dir / repo

units = proposal.get("units", [])
for unit in units:
    signals = unit.get("justification_signals", [])
    if not any(signal in ("A", "B", "C") for signal in signals):
        die(f"unit {unit.get('id')} missing justification_signals")
    source_classification = unit.get("source_classification")
    if not isinstance(source_classification, dict):
        die(f"unit {unit.get('id')} missing source_classification dict")
    source_kind = source_classification.get("source_kind")
    if source_kind not in ALLOWED_SOURCE_KINDS:
        die(f"unit {unit.get('id')} has unknown source_kind: {source_kind!r}")
    for required in ("ownership", "destination", "update_targets", "action"):
        if required not in source_classification:
            die(f"unit {unit.get('id')} source_classification missing {required!r}")
    for referenced in unit.get("referenced_ranking_domains", []):
        if referenced not in ranked_domain_names:
            die(f"unit {unit.get('id')} references domain '{referenced}' not in ranking-snapshot.json")
    for key in ("page_path", "rename_from"):
        path = unit.get(key)
        if not path or not isinstance(path, str) or not path.startswith("wiki/"):
            continue
        remainder = path[len("wiki/"):]
        shelf = remainder.split("/", 1)[0] if "/" in remainder else ""
        if shelf not in ALLOWED_SHELVES:
            die(
                f"unit {unit.get('id')} {key}={path!r} uses shelf {shelf!r} "
                f"not in allowlist {sorted(ALLOWED_SHELVES)}"
            )
    for citation in unit.get("source_citations", []):
        if repo is None:
            continue
        if ":" in citation:
            path_part, line_part = citation.split(":", 1)
        else:
            path_part, line_part = citation, None
        resolved = repo / path_part
        if not resolved.is_file():
            die(f"unit {unit.get('id')} cites non-existent file: {path_part}")
        if line_part and "-" in line_part:
            try:
                start_text, end_text = line_part.split("-", 1)
                start = int(start_text)
                end = int(end_text)
            except ValueError:
                die(f"unit {unit.get('id')} has malformed line range: {citation}")
            line_count = sum(1 for _ in resolved.open())
            if start < 1 or end < start or end > line_count:
                die(
                    f"unit {unit.get('id')} cites out-of-bounds line range "
                    f"{line_part} (file has {line_count} lines): {citation}"
                )

additive_units = []
destructive_units = []
for unit in units:
    is_destructive = (
        unit.get("action") in destructive_actions
        or unit.get("destructive") is True
        or unit.get("uncertainty") == high_uncertainty_value
    )
    if is_destructive:
        destructive_units.append(unit)
    else:
        additive_units.append(unit)

now = datetime.now(timezone.utc).isoformat()
if auto and destructive_units:
    pending_dir = project_dir / "state" / "pending-approvals" / proposal["run_id"]
    pending_dir.mkdir(parents=True, exist_ok=True)
    destructive_present = any(unit.get("action") in destructive_actions for unit in destructive_units)
    uncertainty_present = any(unit.get("uncertainty") == high_uncertainty_value for unit in destructive_units)
    if destructive_present and uncertainty_present:
        slice_reason = "mixed"
    elif destructive_present:
        slice_reason = "destructive"
    else:
        slice_reason = "high-uncertainty"
    slice_data = {
        "origin_run_id": proposal["run_id"],
        "origin_proposal_path": str(run_dir / "proposal.json"),
        "project": project_key,
        "summary": proposal.get("summary", ""),
        "ranking_snapshot_path": proposal.get("ranking_snapshot_path"),
        "max_new_pages": proposal.get("max_new_pages", 25),
        "created_at": now,
        "slice_reason": slice_reason,
        "units": destructive_units,
        "index_changes": None,
        "state_changes_intent": {
            "last_seen_commit_pending": None,
            "last_update_at_pending": None,
            "note": "Commit pointer advancement was handled by the origin run's applied portion. Applying this slice does not advance the pointer. A fresh make compile run is required.",
        },
    }
    (pending_dir / "proposal-slice.json").write_text(json.dumps(slice_data, indent=2) + "\n")
    lines = [f"# Pending approval slice - {proposal['run_id']}", "", f"Reason: {slice_reason}", ""]
    for unit in destructive_units:
        lines.append(f"- `{unit['action']}` **{unit['page_path']}** - {unit.get('justification', '')}")
    (pending_dir / "proposal-slice.md").write_text("\n".join(lines) + "\n")

for unit in additive_units:
    page_path = project_dir / unit["page_path"]
    action = unit["action"]
    if action in ("create", "update"):
        page_path.parent.mkdir(parents=True, exist_ok=True)
        page_path.write_text(unit.get("content") or "")

index_changes = proposal.get("index_changes") or {}
if index_changes.get("action") == "update" and index_changes.get("content"):
    # index_changes shelf policy is enforced in validate via on-disk shelf checks
    # plus index link resolution, so apply keeps this path simple.
    if auto and index_changes.get("destructive"):
        pending_dir = project_dir / "state" / "pending-approvals" / proposal["run_id"]
        pending_dir.mkdir(parents=True, exist_ok=True)
        (pending_dir / "index-changes.json").write_text(json.dumps(index_changes, indent=2) + "\n")
        print(
            f"apply: deferred destructive index change to {pending_dir}/index-changes.json",
            file=sys.stderr,
        )
    else:
        (project_dir / "index.md").write_text(index_changes["content"])

pages_path = project_dir / "state" / "pages.json"
existing_pages = json.loads(pages_path.read_text()).get("pages", [])
pages_by_path = {page["path"]: page for page in existing_pages}
for unit in additive_units:
    path = unit["page_path"]
    page_type = path.split("/")[1] if "/" in path else "other"
    pages_by_path[path] = {
        "path": path,
        "type": page_type,
        "summary": (unit.get("content") or "").split("\n", 1)[0][:200],
        "linked_sources": unit.get("source_citations", []),
        "linked_topics": unit.get("affected_cross_refs", []),
        "last_reviewed_at": now,
        "freshness_status": "fresh",
    }

# Also refresh the index.md entry when index_changes rewrote it. Without this,
# pages.json carries the scaffold-era summary forever and impact-stage stale
# reasoning drifts on every incremental run.
if index_changes.get("action") == "update" and index_changes.get("content"):
    new_index_content = index_changes["content"]
    # Summary: first non-empty, non-heading line of the new index.md body.
    summary = ""
    for line in new_index_content.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            summary = stripped[:200]
            break
    pages_by_path["index.md"] = {
        "path": "index.md",
        "type": "index",
        "summary": summary,
        "linked_sources": [],
        "linked_topics": [],
        "last_reviewed_at": now,
        "freshness_status": "fresh",
    }

pages_path.write_text(json.dumps({"pages": list(pages_by_path.values())}, indent=2) + "\n")

relationships_path = project_dir / "state" / "relationships.json"
existing_relationships = json.loads(relationships_path.read_text()).get("relationships", [])
normalized_existing_relationships = brain_metadata.normalize_relationships(
    existing_relationships,
    list(pages_by_path.values()),
)
existing_relationships = normalized_existing_relationships["relationships"]
relationship_keys = {
    (relationship["from"], relationship["to"], relationship["relationship_type"])
    for relationship in existing_relationships
}
for unit in additive_units:
    source_path = unit["page_path"]
    for destination in unit.get("affected_cross_refs", []):
        key = (source_path, destination, "references")
        if key in relationship_keys:
            continue
        existing_relationships.append({
            "from": source_path,
            "to": destination,
            "relationship_type": "references",
            "confidence": "high",
        })
        relationship_keys.add(key)
normalized_relationships = brain_metadata.normalize_relationships(
    existing_relationships,
    list(pages_by_path.values()),
)
relationships_path.write_text(
    json.dumps({"relationships": normalized_relationships["relationships"]}, indent=2) + "\n"
)

sources_path = project_dir / "state" / "sources.json"
existing_sources = json.loads(sources_path.read_text()).get("sources", [])
source_ids = {source.get("source_id") for source in existing_sources}
for unit in additive_units:
    source_classification = unit.get("source_classification", {})
    source_id = f"{unit['page_path']}:{unit['id']}"
    if source_id in source_ids:
        continue
    existing_sources.append({
        "source_id": source_id,
        "original_path": ";".join(unit.get("source_citations", [])),
        "source_kind": source_classification.get("source_kind", "unknown"),
        "project_key": project_key,
        "status": "integrated",
        "derived_pages": [unit["page_path"]],
        "ingested_at": now,
    })
    source_ids.add(source_id)
sources_path.write_text(json.dumps({"sources": existing_sources}, indent=2) + "\n")

freshness_path = project_dir / "state" / "freshness.json"
freshness = json.loads(freshness_path.read_text())
state_changes_intent = proposal.get("state_changes_intent", {})
freshness["last_seen_commit_pending"] = state_changes_intent.get("last_seen_commit_pending")
freshness["last_update_at_pending"] = state_changes_intent.get("last_update_at_pending")
freshness_path.write_text(json.dumps(freshness, indent=2) + "\n")

project_state = json.loads((project_dir / "state" / "project.json").read_text())
pages_payload = json.loads((project_dir / "state" / "pages.json").read_text())
freshness_payload = json.loads((project_dir / "state" / "freshness.json").read_text())
products = brain_metadata.build_metadata_products(
    project_key=project_key,
    project_state=project_state,
    pages=pages_payload.get("pages", []),
    freshness=freshness_payload,
    generated_at=now,
)
(project_dir / "state" / "page-metadata.json").write_text(
    json.dumps(products["page_metadata"], indent=2) + "\n"
)
(project_dir / "state" / "tag-index.json").write_text(
    json.dumps(products["tag_index"], indent=2) + "\n"
)
(project_dir / "state" / "alias-index.json").write_text(
    json.dumps(products["alias_index"], indent=2) + "\n"
)

if any(unit.get("page_path") == "index.md" for unit in additive_units) or (
    index_changes.get("action") == "update" and index_changes.get("content")
):
    index_path = project_dir / "index.md"
    if index_path.is_file():
        index_path.write_text(
            canonicalize_index_status(
                index_path.read_text(),
                freshness["last_seen_commit_pending"],
                freshness["last_update_at_pending"],
            )
        )

changelog_path = project_dir / "changelog.md"
if changelog_path.is_file():
    entry = f"\n## [{now}] apply - {len(additive_units)} unit(s), run {proposal['run_id']}\n"
    if destructive_units and auto:
        entry += f"- Deferred {len(destructive_units)} destructive/high-uncertainty unit(s) to pending-approvals/\n"
    changelog_path.write_text(changelog_path.read_text() + entry)

update_state_path = project_dir / "state" / "update-state.json"
update_state = json.loads(update_state_path.read_text())
update_state.setdefault("stages", {})
update_state["stages"]["apply"] = {
    "status": "completed",
    "last_run_dir": str(run_dir),
    "last_completed_at": now,
    "summary_file": str(run_dir / "proposal.json"),
}
update_state["last_completed_stage"] = "apply"
update_state["latest_run_dir"] = str(run_dir)
update_state_path.write_text(json.dumps(update_state, indent=2) + "\n")

message = f"apply: wrote {len(additive_units)} additive unit(s)"
if auto and destructive_units:
    message += f"; deferred {len(destructive_units)} to pending-approvals"
print(message)
PY
