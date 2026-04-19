#!/usr/bin/env bash
# Validate stage - deterministic structural checks plus semantic LLM pass.

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/06-validate/run.sh --project <key> [--project-dir <path>] --run-dir <path>
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
[[ -f "$run_dir/ranking-snapshot.json" ]] || die "ranking-snapshot.json missing in $run_dir"
[[ -f "$run_dir/proposal.json" ]] || die "proposal.json missing in $run_dir"

python3 - "$project_key" "$project_dir" "$run_dir" "$AGENT_DIR" "$ROOT_DIR" <<'PY'
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
sys.path.insert(0, str(agent_dir))

import structural
from agents.update._shared import llm_client

config = json.loads((agent_dir / "config.json").read_text())
project_json = json.loads((project_dir / "state" / "project.json").read_text())
ranking = json.loads((run_dir / "ranking-snapshot.json").read_text())
proposal = json.loads((run_dir / "proposal.json").read_text())

allowed_shelves = config["stage_specific"]["shelf_allowlist"]
repo_paths = project_json.get("repo_paths", [])
repo_root = Path(repo_paths[0]) if repo_paths else project_dir
if not repo_root.is_absolute():
    repo_root = root_dir / repo_root

structural_findings: list[dict] = []
structural_findings.extend(structural.required_page_sections(project_dir))
structural_findings.extend(structural.shelf_allowlist(project_dir, allowed_shelves))
structural_findings.extend(structural.citation_resolvability(project_dir, repo_root))
structural_findings.extend(structural.citation_line_range(project_dir, repo_root))
structural_findings.extend(structural.no_dead_cross_refs(project_dir))
structural_findings.extend(structural.no_orphan_pages(project_dir))
structural_findings.extend(structural.index_routing_resolves(project_dir))
structural_findings.extend(structural.pages_json_filesystem_agreement(project_dir))
structural_findings.extend(structural.index_not_wiki_meta(project_dir))
structural_findings.extend(structural.ranked_domain_coverage(run_dir, ranking))
structural_findings.extend(structural.domain_collapse_check(run_dir))
structural_findings.extend(structural.validate_proposal(run_dir, ranking, allowed_shelves))

structural_blockers = [finding for finding in structural_findings if finding.get("severity") == "blocker"]
semantic_findings: list[dict] = []

if not structural_blockers:
    wiki_dump: list[dict[str, str]] = []
    for page in sorted((project_dir / "wiki").rglob("*.md")) if (project_dir / "wiki").is_dir() else []:
        wiki_dump.append(
            {
                "path": str(page.relative_to(project_dir)),
                "content": page.read_text(),
            }
        )
    prompt = json.dumps(
        {
            "project_key": project_key,
            "ranking_snapshot": ranking,
            "proposal": proposal,
            "index_md": (project_dir / "index.md").read_text() if (project_dir / "index.md").is_file() else "",
            "wiki_pages": wiki_dump,
            "enabled_rules": config["stage_specific"]["semantic_rules_enabled"],
        }
    )
    result = llm_client.invoke(stage_id="06-validate.semantic", prompt=prompt)
    semantic_findings = result["response"].get("findings", [])

semantic_blockers = [finding for finding in semantic_findings if finding.get("severity") == "blocker"]
status = "fail" if structural_blockers or semantic_blockers else "pass"

structural_rule_ids = {
    finding["rule_id"].split(".", 1)[0]
    for finding in structural_findings
    if finding.get("severity") == "blocker"
}
semantic_categories = {
    finding.get("category")
    for finding in semantic_findings
    if finding.get("severity") == "blocker"
}
report = {
    "run_id": run_dir.name,
    "status": status,
    "pass_count": {
        "structural": len(config["stage_specific"]["structural_rules"]) - len(structural_rule_ids),
        "semantic": len(config["stage_specific"]["semantic_rules_enabled"]) - len(semantic_categories),
    },
    "structural": structural_findings,
    "semantic": semantic_findings,
}
report_path = run_dir / "validation-findings.json"
report_path.write_text(json.dumps(report, indent=2) + "\n")

now = datetime.now(timezone.utc).isoformat()
update_state_path = project_dir / "state" / "update-state.json"
if update_state_path.is_file():
    update_state = json.loads(update_state_path.read_text())
    update_state.setdefault("stages", {})
    update_state["stages"]["validate"] = {
        "status": "completed",
        "last_run_dir": str(run_dir),
        "last_completed_at": now,
        "summary_file": str(report_path),
    }
    update_state["last_completed_stage"] = "validate"
    update_state["latest_run_dir"] = str(run_dir)
    update_state["latest_validation_findings"] = {
        "findings_path": str(project_dir / "state" / "latest" / "validation-findings.json"),
        "audit_run_dir": str(run_dir),
        "status": status,
        "updated_at": now,
    }
    update_state_path.write_text(json.dumps(update_state, indent=2) + "\n")

print(
    f"validate: status={status} structural_findings={len(structural_findings)} "
    f"semantic_findings={len(semantic_findings)}"
)
sys.exit(0 if status == "pass" else 1)
PY
