#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ARTIFACTS_DIR="$ROOT_DIR/artifacts/runs"

usage() {
  cat <<'EOF'
Usage:
  agents/bootstrap/_shared/stage_runner.sh --agent-dir <agent-folder> --project <project-key> [--project-dir <project-dir>] [options]

Options:
  --agent-dir <agent-folder>    Required stage agent folder
  --project <project-key>       Required project key
  --model <model>               Optional model selector
  --run-dir <artifact-dir>      Optional run directory; defaults to latest run for non-orient stages
  --dry-run                     Print planned command and prompt, do not execute
  -h, --help                    Show this help message
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

require_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "required command not found: $cmd"
}

read_project_field() {
  local file="$1"
  local field="$2"
  python3 - "$file" "$field" <<'PY'
import json
import sys

path, field = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
value = data.get(field)
if isinstance(value, list):
    for item in value:
        print(item)
elif isinstance(value, str):
    print(value)
PY
}

bootstrap_state_get() {
  local project_dir="$1"
  local project_key="$2"
  local field="$3"
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" get --project-dir "$project_dir" --project "$project_key" --field "$field"
}

discover_latest_run_dir() {
  local project_key="$1"
  local latest=""
  latest="$(find "$ARTIFACTS_DIR" -maxdepth 1 -type d -name "*-bootstrap-$project_key" | sort | tail -n 1)"
  printf '%s' "$latest"
}

restore_project_contract() {
  local snapshot_path="$1"
  local live_path="$2"
  python3 - "$snapshot_path" "$live_path" <<'PY'
import json
import sys

snapshot_path, live_path = sys.argv[1], sys.argv[2]
with open(snapshot_path, "r", encoding="utf-8") as f:
    snapshot = json.load(f)
with open(live_path, "r", encoding="utf-8") as f:
    live = json.load(f)

locked_fields = [
    "key",
    "name",
    "repo_paths",
    "tags",
    "entry_pages",
    "bootstrap_focuses",
    "related_concepts",
    "ignored_paths",
]

for field in locked_fields:
    if field in snapshot:
        live[field] = snapshot[field]

with open(live_path, "w", encoding="utf-8") as f:
    json.dump(live, f, indent=2)
    f.write("\n")
PY
}

project_key=""
agent_dir=""
model=""
run_dir=""
project_dir_override=""
dry_run="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      shift
      [[ $# -gt 0 ]] || die "--project requires a value"
      project_key="$1"
      shift
      ;;
    --agent-dir)
      shift
      [[ $# -gt 0 ]] || die "--agent-dir requires a value"
      agent_dir="$1"
      shift
      ;;
    --project-dir)
      shift
      [[ $# -gt 0 ]] || die "--project-dir requires a value"
      project_dir_override="$1"
      shift
      ;;
    --model)
      shift
      [[ $# -gt 0 ]] || die "--model requires a value"
      model="$1"
      shift
      ;;
    --run-dir)
      shift
      [[ $# -gt 0 ]] || die "--run-dir requires a value"
      run_dir="$1"
      shift
      ;;
    --dry-run)
      dry_run="true"
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
[[ -n "$agent_dir" ]] || die "--agent-dir is required"
[[ -d "$agent_dir" ]] || die "agent folder does not exist: $agent_dir"

agent_dir="$(cd "$agent_dir" && pwd)"
instructions_file="$agent_dir/instructions.md"
agent_meta="$agent_dir/agent.json"
[[ -f "$instructions_file" ]] || die "missing stage instruction file: $instructions_file"
[[ -f "$agent_meta" ]] || die "missing stage metadata file: $agent_meta"

eval "$(
  python3 - "$agent_meta" <<'PY'
import json
import shlex
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

for key in ["stage", "stage_num", "stage_label", "pass_kind", "summary_file"]:
    value = data.get(key, "")
    print(f"{key.upper()}={shlex.quote(str(value))}")
PY
)"

stage="$STAGE"
stage_num="$STAGE_NUM"
stage_label="$STAGE_LABEL"
pass_kind="$PASS_KIND"
pass_slug="${SUMMARY_FILE%.final-message.md}"

project_dir="$ROOT_DIR/projects/$project_key"
if [[ -n "$project_dir_override" ]]; then
  project_dir="$project_dir_override"
fi
project_state="$project_dir/state/project.json"

[[ -d "$project_dir" ]] || die "project does not exist: $project_key"
[[ -f "$project_state" ]] || die "missing project state file: $project_state"

require_command python3
python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" ensure --project-dir "$project_dir" --project "$project_key" >/dev/null

repo_paths=()
while IFS= read -r line; do
  [[ -n "$line" ]] && repo_paths+=("$line")
done < <(read_project_field "$project_state" "repo_paths")
[[ ${#repo_paths[@]} -gt 0 ]] || die "no repo path found in $project_state"
repo_path="${repo_paths[0]}"
[[ -d "$repo_path" ]] || die "mapped repo path does not exist: $repo_path"

if [[ -z "$run_dir" ]]; then
  if [[ "$stage" == "orient" ]]; then
    timestamp="$(date '+%Y%m%d-%H%M%S')"
    run_dir="$ARTIFACTS_DIR/$timestamp-bootstrap-$project_key"
  else
    run_dir="$(bootstrap_state_get "$project_dir" "$project_key" "latest_run_dir" || true)"
    if [[ -z "$run_dir" ]]; then
      run_dir="$(discover_latest_run_dir "$project_key")"
    fi
    [[ -n "$run_dir" ]] || die "no prior bootstrap run recorded; run stage 'orient' first or pass --run-dir"
  fi
fi

mkdir -p "$run_dir"

CODEX_BIN="${CODEX_BIN:-codex}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
agent_backend="codex"
agent_model=""

if [[ -n "$model" ]]; then
  case "$model" in
    claude)
      agent_backend="claude"
      ;;
    claude/*)
      agent_backend="claude"
      agent_model="${model#claude/}"
      ;;
    codex)
      ;;
    codex/*)
      agent_model="${model#codex/}"
      ;;
    *)
      agent_model="$model"
      ;;
  esac
fi

if [[ "$agent_backend" == "claude" ]]; then
  command -v "$CLAUDE_BIN" >/dev/null 2>&1 || die "claude CLI not found on PATH as '$CLAUDE_BIN'"
else
  require_command "$CODEX_BIN"
fi

project_state_snapshot="$run_dir/project-state.snapshot.json"
cp "$project_state" "$project_state_snapshot"

prompt_file="$run_dir/${pass_slug}.prompt.md"
summary_file="$run_dir/$SUMMARY_FILE"

{
  cat <<EOF
You are operating inside the llm-wiki workspace at:
$ROOT_DIR

The mapped source repo for this bootstrap is:
$repo_path

Bootstrap stage:
$stage_num - $stage_label

Pass kind:
$pass_kind

Primary instructions:
- Follow AGENTS.md exactly.
- Use V1_SPEC.md as the hard contract.
- Use the stage-specific instructions below as a thin overlay, not a replacement for AGENTS.md.
- Do not modify the source repo at $repo_path.
- Keep all writes inside this llm-wiki repository.
- Preserve grounded understanding and mark uncertainty instead of faking certainty.
- Prefer updating existing canonical pages over creating redundant new pages.
- Do not spawn subagents, explorers, workers, or forked-agent contexts for this bootstrap run.
- Complete this stage in a single agent context. Do not delegate discovery or writing.
- Do not rely on \`git status\` for the \`llm-wiki\` workspace itself; this folder may not be a git repo, and post-run normalization and validation handle source-repo provenance separately.
- Do not modify operator-owned fields in projects/$project_key/state/project.json such as key, name, repo_paths, tags, entry_pages, bootstrap_focuses, related_concepts, or ignored_paths.

Stage-specific instructions:
EOF
  cat "$instructions_file"

  cat <<EOF

Read these before writing:
- AGENTS.md
- V1_SPEC.md
- $instructions_file
- $project_state
- $project_dir/index.md
- $project_dir/changelog.md
- $project_dir/state/freshness.json
EOF

  if [[ -f "$run_dir/orient.final-message.md" && "$stage" != "orient" ]]; then
    echo "- $run_dir/orient.final-message.md"
  fi
  if [[ -f "$run_dir/domains.final-message.md" && ( "$stage" == "expand" || "$stage" == "reconcile" ) ]]; then
    echo "- $run_dir/domains.final-message.md"
  fi
  if [[ -f "$run_dir/expand.final-message.md" && "$stage" == "reconcile" ]]; then
    echo "- $run_dir/expand.final-message.md"
  fi
  if [[ -f "$run_dir/validate-report.md" && "$stage" == "reconcile" ]]; then
    echo "- $run_dir/validate-report.md"
  fi
  if [[ -f "$run_dir/validate-findings.json" && "$stage" == "reconcile" ]]; then
    echo "- $run_dir/validate-findings.json"
  fi

  cat <<EOF

Discovery rules:
- start with high-signal files and directories only
- prefer README files, docs directories, spec/design folders, config/manifests, and obvious architecture notes
- use a bounded file tree scan to identify likely subsystems and integrations
- do not brute-force the entire repo if a smaller representative set is enough
- when you infer architecture from code structure, label it as inferred unless directly documented

Writing style for wiki pages:
- do not include a '## Review Provenance' block or HTML comment markers of that shape
- do not include a '## Status' section narrating the wiki's own construction
- do not describe llm-wiki, the ingestion process, or the agent's own work
- do not use 'Verified:', 'Inferred:', or 'Stale risk:' as structural section decorators or default sentence prefixes
- ground claims through concrete file_path:line_number citations
- do not add YAML frontmatter to wiki page bodies
- do not add sentences whose sole content is meta-description
- target around 60 lines per page; up to ~80 lines is acceptable when needed
- open with a single-sentence intro answering 'what is this'
- include 'Open Questions' or 'Related' only when real items exist
- when in doubt, prefer short, factual, strongly cited pages over broad narrative summaries

Required outputs:
- keep $project_dir/index.md coherent with the current wiki shape
- update affected pages under $project_dir/wiki/
- update state files under $project_dir/state/
- append a meaningful changelog entry to $project_dir/changelog.md
- maintain durable session memory under $project_dir/wiki/sessions/

In your final message, include:
1. which repo areas you inspected
2. which wiki pages you updated or created
3. what remains uncertain or missing
4. whether this stage is complete enough to hand off to the next stage
EOF
} >"$prompt_file"

if [[ "$agent_backend" == "claude" ]]; then
  cmd=(
    "$CLAUDE_BIN" -p
    --permission-mode acceptEdits
    --allowed-tools "Read,Write,Edit,Glob,Grep,Bash"
    --add-dir "$repo_path"
    --output-format json
  )
  if [[ -n "$agent_model" ]]; then
    cmd+=(--model "$agent_model")
  fi
else
  cmd=(
    "$CODEX_BIN" exec
    --sandbox workspace-write
    --skip-git-repo-check
    -C "$ROOT_DIR"
    --add-dir "$repo_path"
    -o "$summary_file"
  )
  if [[ -n "$agent_model" ]]; then
    cmd+=(--model "$agent_model")
  fi
fi

echo "Bootstrap stage: $stage"
echo "Mapped repo: $repo_path"
echo "Run artifacts: $run_dir"

if [[ "$dry_run" == "true" ]]; then
  echo
  echo "Dry run command:"
  printf ' %q' "${cmd[@]}"
  echo
  echo
  echo "Prompt:"
  cat "$prompt_file"
  exit 0
fi

if [[ "$agent_backend" == "claude" ]]; then
  json_file="$run_dir/${pass_slug}.claude.json"
  ( cd "$ROOT_DIR" && "${cmd[@]}" "$(cat "$prompt_file")" ) >"$json_file"
  python3 - "$json_file" "$summary_file" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
result = data.get("result") or data.get("final_message") or ""
with open(sys.argv[2], "w", encoding="utf-8") as f:
    f.write(result)
PY
else
  "${cmd[@]}" - <"$prompt_file"
fi

restore_project_contract "$project_state_snapshot" "$project_state"
"$ROOT_DIR/agents/bootstrap/_shared/normalize.sh" --project "$project_key" ${project_dir_override:+--project-dir "$project_dir_override"}
python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-stage \
  --project-dir "$project_dir" \
  --project "$project_key" \
  --stage "$stage" \
  --status completed \
  --run-dir "$run_dir" \
  --summary-file "$summary_file" >/dev/null

echo "Pass summary written to: $summary_file"
