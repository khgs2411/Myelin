#!/usr/bin/env bash
# Propose stage - drafts changeset (proposal.json + proposal.md).
#
# Produces: <run-dir>/proposal.json, <run-dir>/proposal.md.
# Under AUTO=1, writes approved=true directly. Otherwise approved=false
# and the operator must edit proposal.json to bless it.

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/03-propose/run.sh --project <project-key> [--project-dir <project-dir>] --run-dir <artifact-dir>
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
[[ -f "$run_dir/impact-report.json" ]] || die "impact-report.json missing in $run_dir"
[[ -f "$run_dir/ranking-snapshot.json" ]] || die "ranking-snapshot.json missing in $run_dir"

auto="${AUTO:-}"

python3 - "$project_key" "$project_dir" "$run_dir" "$ROOT_DIR" "$auto" <<'PY'
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
root_dir = Path(sys.argv[4])
auto = sys.argv[5] == "1"

sys.path.insert(0, str(root_dir))
from agents.update._shared import llm_client  # noqa: E402

impact = json.loads((run_dir / "impact-report.json").read_text())
ranking = json.loads((run_dir / "ranking-snapshot.json").read_text())

prompt = json.dumps({
    "project_key": project_key,
    "impact": impact,
    "ranking": ranking,
})
result = llm_client.invoke(stage_id="03-propose", prompt=prompt)
proposal = result["response"]
proposal["run_id"] = run_dir.name
proposal["approved"] = True if auto else False

now = datetime.now(timezone.utc).isoformat()
sci = proposal.get("state_changes_intent", {})
sci["last_update_at_pending"] = now
sci["last_seen_commit_pending"] = None
project_json = json.loads((project_dir / "state" / "project.json").read_text())
repo_paths = project_json.get("repo_paths", [])
if repo_paths:
    repo = Path(repo_paths[0])
    if not repo.is_absolute():
        repo = root_dir / repo
    if (repo / ".git").is_dir():
        head = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
        )
        if head.returncode == 0:
            sci["last_seen_commit_pending"] = head.stdout.strip()
proposal["state_changes_intent"] = sci

index_changes = proposal.get("index_changes", {})
if index_changes.get("content") and "<stamped-by-apply>" in index_changes["content"]:
    index_changes["content"] = index_changes["content"].replace("<stamped-by-apply>", now)
proposal["index_changes"] = index_changes

(run_dir / "proposal.json").write_text(json.dumps(proposal, indent=2) + "\n")

md_lines = [
    f"# Proposal - {proposal['run_id']}",
    "",
    f"**Project:** {proposal['project']}",
    f"**Approved:** {proposal['approved']}",
    f"**Summary:** {proposal.get('summary', '(none)')}",
    "",
]

destructive_units = [unit for unit in proposal.get("units", []) if unit.get("destructive")]
if destructive_units:
    md_lines.extend([
        "## Destructive units",
        "",
    ])
    for unit in destructive_units:
        md_lines.append(
            f"- `{unit['action']}` **{unit['page_path']}** - {unit.get('justification', '')}"
        )
    md_lines.append("")

md_lines.extend([
    "## Additive units",
    "",
])
for unit in proposal.get("units", []):
    if unit.get("destructive"):
        continue
    md_lines.append(f"- `{unit['action']}` **{unit['page_path']}** - {unit.get('justification', '')}")
md_lines.append("")

deferred_domains = proposal.get("deferred_domains", [])
if deferred_domains:
    md_lines.extend([
        "## Deferred domains",
        "",
    ])
    for domain in deferred_domains:
        md_lines.append(
            f"- rank {domain.get('rank')}: **{domain.get('domain')}** - {domain.get('reason', '')}"
        )
    md_lines.append("")

if not proposal["approved"]:
    md_lines.extend([
        "---",
        "",
        "To approve: edit `proposal.json` and set `\"approved\": true`, then run `make update-v2-continue PROJECT=<key>`.",
    ])

(run_dir / "proposal.md").write_text("\n".join(md_lines) + "\n")

update_state_path = project_dir / "state" / "update-state.json"
if update_state_path.is_file():
    update_state = json.loads(update_state_path.read_text())
    update_state.setdefault("stages", {})
    update_state["stages"]["propose"] = {
        "status": "completed",
        "last_run_dir": str(run_dir),
        "last_completed_at": now,
        "summary_file": str(run_dir / "proposal.json"),
    }
    update_state["last_completed_stage"] = "propose"
    update_state["latest_run_dir"] = str(run_dir)
    update_state_path.write_text(json.dumps(update_state, indent=2) + "\n")

print(f"proposal.json + proposal.md written to {run_dir}")
PY
