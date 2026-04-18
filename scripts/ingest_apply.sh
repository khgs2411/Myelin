#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/ingest_apply.sh --project <project-key> --run-dir <run-dir> [--project-dir <abs-path>] [--model <model>]

--project-dir overrides the default project lookup (ROOT_DIR/projects/<key>).
Used mainly by tests to point at a temp fixture.

--model preserves the Codex/Claude selector used elsewhere (codex | codex/<id> | claude | claude/<id>).
It is forwarded to the post-ingest lint so the semantic validator uses the same backend.
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
run_dir=""
project_dir_override=""
model=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) shift; [[ $# -gt 0 ]] || die "--project requires a value"; project_key="$1"; shift ;;
    --run-dir) shift; [[ $# -gt 0 ]] || die "--run-dir requires a value"; run_dir="$1"; shift ;;
    --project-dir) shift; [[ $# -gt 0 ]] || die "--project-dir requires a value"; project_dir_override="$1"; shift ;;
    --model) shift; [[ $# -gt 0 ]] || die "--model requires a value"; model="$1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
[[ -n "$run_dir" && -d "$run_dir" ]] || die "--run-dir must point to an existing directory"

if [[ -n "$project_dir_override" ]]; then
  project_dir="$project_dir_override"
else
  project_dir="$ROOT_DIR/projects/$project_key"
fi
[[ -d "$project_dir" ]] || die "project does not exist: $project_dir"

proposal_json="$run_dir/proposal.json"
[[ -f "$proposal_json" ]] || die "missing proposal.json in run-dir"

python3 - "$project_dir" "$proposal_json" <<'PY'
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

project_dir = Path(sys.argv[1])
proposal = json.loads(Path(sys.argv[2]).read_text())

pages_file = project_dir / "state" / "pages.json"
sources_file = project_dir / "state" / "sources.json"
relationships_file = project_dir / "state" / "relationships.json"
changelog_file = project_dir / "changelog.md"

pages_data = json.loads(pages_file.read_text())
sources_data = json.loads(sources_file.read_text())
relationships_data = json.loads(relationships_file.read_text())

source_rel = proposal["source"]
source_id = proposal["source_id"]
source_kind = proposal["source_kind"]

def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

existing_page_paths = {entry.get("path") for entry in pages_data["pages"]}
if any(src.get("source_id") == source_id for src in sources_data["sources"]):
    raise SystemExit(f"source_id already exists: {source_id}")

for unit in proposal["units"]:
    action = unit["action"]
    page_rel = unit["page_path"]
    page_abs = project_dir / page_rel
    page_exists = page_abs.exists()
    page_registered = page_rel in existing_page_paths

    if action == "create":
        if page_exists or page_registered:
            raise SystemExit(f"create target already exists or is registered: {page_rel}")
    elif action == "update":
        if not page_exists or not page_registered:
            raise SystemExit(f"update target must already exist and be registered: {page_rel}")
    else:
        raise SystemExit(f"unknown unit action: {action}")

# Preserve the source
source_src = project_dir / source_rel
assert source_src.exists(), f"source missing on disk: {source_src}"
preserved_dir = project_dir / "sources"
preserved_dir.mkdir(exist_ok=True)
preserved_name = f"{source_id}-{Path(source_rel).name}"
preserved_path = preserved_dir / preserved_name
if preserved_path.exists():
    raise SystemExit(f"preserved source path already exists: {preserved_path}")
shutil.copy2(source_src, preserved_path)

touched_pages: list[str] = []
created_count = 0
updated_count = 0

for unit in proposal["units"]:
    page_rel = unit["page_path"]
    page_abs = project_dir / page_rel
    if unit["action"] == "create":
        page_abs.parent.mkdir(parents=True, exist_ok=True)
        page_abs.write_text(unit["content"], encoding="utf-8")
        pages_data["pages"].append({
            "path": page_rel,
            "type": unit.get("page_type", "unknown"),
            "summary": unit.get("summary", ""),
            "linked_sources": [source_id],
            "linked_topics": [],
            "last_reviewed_at": now_iso(),
            "freshness_status": "baseline-validated",
            "baseline_pass": True,
        })
        created_count += 1
    elif unit["action"] == "update":
        existing = page_abs.read_text(encoding="utf-8") if page_abs.exists() else ""
        page_abs.write_text(existing.rstrip() + "\n\n" + unit.get("content", ""), encoding="utf-8")
        for entry in pages_data["pages"]:
            if entry["path"] == page_rel:
                if source_id not in entry["linked_sources"]:
                    entry["linked_sources"].append(source_id)
                entry["last_reviewed_at"] = now_iso()
                entry["freshness_status"] = "baseline-validated"
                entry["baseline_pass"] = True
                break
        updated_count += 1
    else:
        raise SystemExit(f"unknown unit action: {unit['action']}")
    touched_pages.append(page_rel)

sources_data["sources"].append({
    "source_id": source_id,
    "original_path": source_rel,
    "preserved_path": f"sources/{preserved_name}",
    "source_kind": source_kind,
    "project_key": project_dir.name,
    "status": "processed",
    "derived_pages": touched_pages,
    "ingested_at": now_iso(),
})

existing_relationships = {
    (
        rel.get("from"),
        rel.get("to"),
        rel.get("relationship_type"),
    )
    for rel in relationships_data.get("relationships", [])
}
for page_rel in touched_pages:
    relationship = (page_rel, f"source:{source_id}", "derived-from")
    if relationship not in existing_relationships:
        relationships_data.setdefault("relationships", []).append({
            "from": page_rel,
            "to": f"source:{source_id}",
            "relationship_type": "derived-from",
            "confidence": 1.0,
        })
        existing_relationships.add(relationship)

pages_file.write_text(json.dumps(pages_data, indent=2), encoding="utf-8")
sources_file.write_text(json.dumps(sources_data, indent=2), encoding="utf-8")
relationships_file.write_text(json.dumps(relationships_data, indent=2), encoding="utf-8")

with changelog_file.open("a", encoding="utf-8") as f:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for page_rel in touched_pages:
        f.write(f"\n## [{day}] ingest | {source_rel} -> {page_rel}\n")
        f.write(f"- source_id: {source_id}\n")
        f.write("- outcome: applied approved ingest proposal unit\n")

# Remove the source from the inbox (it is now preserved)
source_src.unlink()

print(
    f"applied {len(touched_pages)} unit(s) "
    f"(created={created_count}, updated={updated_count}), source preserved at {preserved_path}"
)
PY

# Post-ingest lint (advisory). This invokes the semantic validator unless
# LLM_WIKI_SEMANTIC_SKIP=1 is set in the calling environment. Announce the
# side effect so the user knows an LLM call may happen here.
if [[ "${LLM_WIKI_SEMANTIC_SKIP:-0}" != "1" ]]; then
  echo "running post-ingest lint (invokes semantic validator; set LLM_WIKI_SEMANTIC_SKIP=1 to skip)"
fi
lint_args=(--project "$project_key")
if [[ -n "$project_dir_override" ]]; then
  lint_args+=(--project-dir "$project_dir_override")
fi
if [[ -n "$model" ]]; then
  lint_args+=(--model "$model")
fi
lint_status="pass"
if ! "$ROOT_DIR/scripts/lint.sh" "${lint_args[@]}"; then
  lint_status="fail"
fi

latest_lint_findings_path="$(python3 - "$project_dir" <<'PY'
import json
import sys
from pathlib import Path

state_path = Path(sys.argv[1]) / "state" / "bootstrap-state.json"
if not state_path.exists():
    print("")
    raise SystemExit(0)

data = json.loads(state_path.read_text(encoding="utf-8"))
latest = data.get("latest_lint_findings") or {}
print(latest.get("findings_path") or "")
PY
)"

python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-ingest \
  --project-dir "$project_dir" \
  --project "$project_key" \
  --status "$lint_status" \
  --findings-path "$latest_lint_findings_path"

echo "post-ingest lint status=$lint_status findings=${latest_lint_findings_path:-<none>}"
