#!/usr/bin/env bash
# Ingest stage - batch inbox items into an incremental proposal.

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/08-ingest/run.sh --project <project-key> [--project-dir <project-dir>] --run-dir <artifact-dir>
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

auto="${AUTO:-}"

python3 - "$project_key" "$project_dir" "$run_dir" "$ROOT_DIR" "$AGENT_DIR" "$auto" <<'PY'
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
root_dir = Path(sys.argv[4])
agent_dir = Path(sys.argv[5])
auto = sys.argv[6] == "1"

sys.path.insert(0, str(root_dir))

from agents.update._shared import ingest, llm_client, proposal_citations  # noqa: E402


config = json.loads((agent_dir / "config.json").read_text(encoding="utf-8"))
max_items = int(config["stage_specific"]["max_items_per_run"])
scan = ingest.scan_inbox(project_dir, max_items_per_run=max_items)
selected = scan["selected"]
batches = ingest.batch_items(selected)

if not selected:
    snapshot = {"project": project_key, "consumed_items": [], "remaining_count": scan["remaining_count"]}
    (run_dir / "inbox-snapshot.json").write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    (run_dir / "ranking-snapshot.json").write_text(json.dumps({"ranked_domains": []}, indent=2) + "\n", encoding="utf-8")
    print("ingest: no valid inbox items after schema validation")
    sys.exit(0)

prompt = json.dumps(ingest.build_prompt_payload(project_key, project_dir, batches), separators=(",", ":"))
result = llm_client.invoke(stage_id="08-ingest", prompt=prompt)
proposal = result["response"]
proposal["run_id"] = run_dir.name
proposal["approved"] = True if auto else False
proposal["source"] = f"projects/{project_key}/inbox"
proposal["source_id"] = ",".join(record["item"]["id"] for record in selected)
proposal["source_kind"] = "gap-note"

now = datetime.now(timezone.utc).isoformat()
sci = proposal.get("state_changes_intent", {})
sci["last_update_at_pending"] = now
sci["last_seen_commit_pending"] = None
project_json = json.loads((project_dir / "state" / "project.json").read_text(encoding="utf-8"))
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
proposal = proposal_citations.normalize_proposal_citations(proposal, repo)

proposal_path = run_dir / "proposal.json"
proposal_path.write_text(json.dumps(proposal, indent=2) + "\n", encoding="utf-8")

snapshot = {
    "project": project_key,
    "consumed_items": [
        {
            "id": record["item"]["id"],
            "path": record["path"],
            "target_hint": record["item"]["target_hint"],
            "source": record["item"]["source"],
            "emitted_at": record["item"]["emitted_at"],
        }
        for record in selected
    ],
    "remaining_count": scan["remaining_count"],
}
(run_dir / "inbox-snapshot.json").write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
(run_dir / "ranking-snapshot.json").write_text(json.dumps({"ranked_domains": []}, indent=2) + "\n", encoding="utf-8")

md_lines = [
    f"# Ingest Proposal - {proposal['run_id']}",
    "",
    f"**Project:** {proposal.get('project', project_key)}",
    f"**Approved:** {proposal['approved']}",
    f"**Summary:** {proposal.get('summary', '(none)')}",
    f"**Consumed inbox items:** {len(snapshot['consumed_items'])}",
    "",
    "## Units",
    "",
]
for unit in proposal.get("units", []):
    md_lines.append(
        f"- `{unit.get('action')}` **{unit.get('page_path')}** - {unit.get('justification', '')}"
    )
md_lines.append("")
if not proposal["approved"]:
    md_lines.extend(
        [
            "---",
            "",
            "To approve: edit `proposal.json` and set `\"approved\": true`, then run `make update-continue PROJECT=<key>`.",
        ]
    )
(run_dir / "proposal.md").write_text("\n".join(md_lines) + "\n", encoding="utf-8")

update_state_path = project_dir / "state" / "update-state.json"
if update_state_path.is_file():
    update_state = json.loads(update_state_path.read_text(encoding="utf-8"))
    update_state.setdefault("stages", {})
    update_state["stages"]["ingest"] = {
        "status": "completed",
        "last_run_dir": str(run_dir),
        "last_completed_at": now,
        "summary_file": str(proposal_path),
        "consumed_item_count": len(snapshot["consumed_items"]),
        "remaining_item_count": scan["remaining_count"],
    }
    update_state["last_completed_stage"] = "ingest"
    update_state["latest_run_dir"] = str(run_dir)
    update_state_path.write_text(json.dumps(update_state, indent=2) + "\n", encoding="utf-8")

print(
    f"ingest: proposal.json + proposal.md written to {run_dir} "
    f"({len(snapshot['consumed_items'])} item(s), remaining={scan['remaining_count']})"
)
PY
