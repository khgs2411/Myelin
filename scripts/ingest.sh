#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW_INBOX_DIR="$ROOT_DIR/raw/inbox"
ARTIFACTS_DIR="$ROOT_DIR/artifacts/runs"

usage() {
  cat <<'EOF'
Usage:
  scripts/ingest.sh --global
  scripts/ingest.sh --project <project-key>

Options:
  --global                 Process files in raw/inbox
  --project <project-key>  Process files in projects/<project-key>/inbox
  --model <model>          Optional model spec. Formats:
                             codex | codex/<id> | claude | claude/<id> | <id>
                           Anything starting with "claude" routes to the Claude
                           CLI. Unset or anything else uses Codex.
  --dry-run                Print the agent command and prompt, but do not execute it
  -h, --help               Show this help message

Environment:
  CODEX_BIN                Codex executable to use (default: codex)
  CLAUDE_BIN               Claude executable to use (default: claude)
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

count_inbox_files() {
  local dir="$1"
  find "$dir" -type f \
    ! -name '.DS_Store' \
    ! -name 'AGENTS.md' \
    ! -name 'README.md' | wc -l | tr -d ' '
}

require_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "required command not found: $cmd"
}

mode=""
project_key=""
model=""
dry_run="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --global)
      [[ -n "$mode" ]] && die "choose either --global or --project"
      mode="global"
      shift
      ;;
    --project)
      [[ -n "$mode" ]] && die "choose either --global or --project"
      mode="project"
      shift
      [[ $# -gt 0 ]] || die "--project requires a project key"
      project_key="$1"
      shift
      ;;
    --model)
      shift
      [[ $# -gt 0 ]] || die "--model requires a value"
      model="$1"
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

[[ -n "$mode" ]] || die "expected --global or --project <project-key>"

CODEX_BIN="${CODEX_BIN:-codex}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

# Resolve backend and model from the --model spec.
agent_backend="codex"
agent_model=""
if [[ -n "$model" ]]; then
  case "$model" in
    claude)
      agent_backend="claude"
      agent_model=""
      ;;
    claude/*)
      agent_backend="claude"
      agent_model="${model#claude/}"
      ;;
    codex)
      agent_backend="codex"
      agent_model=""
      ;;
    codex/*)
      agent_backend="codex"
      agent_model="${model#codex/}"
      ;;
    *)
      agent_backend="codex"
      agent_model="$model"
      ;;
  esac
fi

if [[ "$agent_backend" == "claude" ]]; then
  command -v "$CLAUDE_BIN" >/dev/null 2>&1 || die "claude CLI not found on PATH as '$CLAUDE_BIN'. Install via: npm install -g @anthropic-ai/claude-code (or set CLAUDE_BIN)."
  require_command python3
else
  require_command "$CODEX_BIN"
fi

target_label=""
inbox_dir=""

if [[ "$mode" == "global" ]]; then
  inbox_dir="$RAW_INBOX_DIR"
  target_label="global-inbox"
else
  inbox_dir="$ROOT_DIR/projects/$project_key/inbox"
  [[ -d "$ROOT_DIR/projects/$project_key" ]] || die "project does not exist: $project_key"
  target_label="project-$project_key"
fi

[[ -d "$inbox_dir" ]] || die "inbox directory does not exist: $inbox_dir"

file_count="$(count_inbox_files "$inbox_dir")"
if [[ "$file_count" == "0" ]]; then
  echo "No files found in $inbox_dir"
  exit 0
fi

timestamp="$(date '+%Y%m%d-%H%M%S')"
run_dir="$ARTIFACTS_DIR/$timestamp-$target_label"
mkdir -p "$run_dir"

prompt_file="$run_dir/prompt.md"
summary_file="$run_dir/final-message.md"

if [[ "$mode" == "global" ]]; then
  cat >"$prompt_file" <<EOF
You are operating inside the llm-wiki workspace at:
$ROOT_DIR

Primary instructions:
- Follow AGENTS.md exactly.
- Use V1_SPEC.md and schemas/source-classification.md as supporting contracts.
- Process every file currently present in raw/inbox.
- Do not skip files silently.
- Preserve original sources and leave each file in exactly one terminal state: processed, rejected, or pending-review.
- Update the correct wiki pages, state files, and log files.
- Prefer updating canonical pages over creating redundant new ones.
- If a file is ambiguous, route it to review-required or pending-review instead of guessing.
- Keep all changes inside this llm-wiki repository.

Before writing, inspect:
- AGENTS.md
- V1_SPEC.md
- raw/README.md
- schemas/source-classification.md

Then perform a full ingestion pass for raw/inbox.

Writing style for wiki pages:
- do not include a '## Review Provenance' block or HTML comment markers of that shape
- do not include a '## Status' section narrating the wiki's own construction (no 'broad bootstrap', 'focused follow-up pass', 'baseline established', 'baseline pass')
- do not describe llm-wiki, the ingestion process, or the agent's own work; write as if the reader has never heard of this wiki
- do not use 'Verified:', 'Inferred:', or 'Stale risk:' as structural section decorators or default sentence prefixes; use them only inline where a sentence is genuinely about source ambiguity
- ground claims through concrete file_path:line_number citations
- do not add YAML frontmatter to wiki page bodies; metadata belongs in state/ JSON files only
- do not add sentences whose sole content is meta-description (e.g., 'This page holds the maintained knowledge layer for X')
- target around 60 lines per page; up to ~80 lines is acceptable when needed; do not split pages purely to hit a line count
- open with a single-sentence intro answering 'what is this'; do not lead with a '## Purpose' heading
- include 'Open Questions' or 'Related' sections only when real items exist
When in doubt, prefer short, factual, strongly cited pages over broad narrative summaries.

In your final message, include:
1. files processed
2. how each file was classified
3. which pages and metadata files were updated
4. any files left for manual review
EOF
else
  cat >"$prompt_file" <<EOF
You are operating inside the llm-wiki workspace at:
$ROOT_DIR

Primary instructions:
- Follow AGENTS.md exactly.
- Use V1_SPEC.md and schemas/source-classification.md as supporting contracts.
- Process every file currently present in projects/$project_key/inbox.
- Assume project ownership is $project_key unless a file clearly does not belong there.
- Preserve original sources under the project after processing.
- Update the correct wiki pages, state files, and log files.
- Prefer updating canonical pages over creating redundant new ones.
- If a file clearly does not belong to $project_key, do not guess silently. Mark it for review or route it appropriately.
- Keep all changes inside this llm-wiki repository.
- Do not rely on \`git status\` for the \`llm-wiki\` workspace itself; post-run normalization and validation handle repo provenance separately.

Before writing, inspect:
- AGENTS.md
- V1_SPEC.md
- projects/$project_key/state/project.json
- projects/$project_key/index.md
- projects/$project_key/changelog.md
- schemas/source-classification.md

Then perform a full ingestion pass for projects/$project_key/inbox.

Writing style for wiki pages:
- do not include a '## Review Provenance' block or HTML comment markers of that shape
- do not include a '## Status' section narrating the wiki's own construction (no 'broad bootstrap', 'focused follow-up pass', 'baseline established', 'baseline pass')
- do not describe llm-wiki, the ingestion process, or the agent's own work; write as if the reader has never heard of this wiki
- do not use 'Verified:', 'Inferred:', or 'Stale risk:' as structural section decorators or default sentence prefixes; use them only inline where a sentence is genuinely about source ambiguity
- ground claims through concrete file_path:line_number citations
- do not add YAML frontmatter to wiki page bodies; metadata belongs in state/ JSON files only
- do not add sentences whose sole content is meta-description (e.g., 'This page holds the maintained knowledge layer for X')
- target around 60 lines per page; up to ~80 lines is acceptable when needed; do not split pages purely to hit a line count
- open with a single-sentence intro answering 'what is this'; do not lead with a '## Purpose' heading
- include 'Open Questions' or 'Related' sections only when real items exist
When in doubt, prefer short, factual, strongly cited pages over broad narrative summaries.

In your final message, include:
1. files processed
2. how each file was classified
3. which pages and metadata files were updated
4. any files left for manual review
EOF
fi

if [[ "$agent_backend" == "claude" ]]; then
  cmd=(
    "$CLAUDE_BIN" -p
    --permission-mode acceptEdits
    --allowed-tools "Read,Write,Edit,Glob,Grep,Bash"
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
    -o "$summary_file"
  )
  if [[ -n "$agent_model" ]]; then
    cmd+=(--model "$agent_model")
  fi
fi

echo "Ingestion target: $target_label"
echo "Inbox: $inbox_dir"
echo "Files detected: $file_count"
echo "Run artifacts: $run_dir"
echo "Backend: $agent_backend${agent_model:+ (model: $agent_model)}"

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
  json_file="$run_dir/claude.json"
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

if [[ "$mode" == "project" ]]; then
  echo
  echo "Running normalization..."
  "$ROOT_DIR/agents/bootstrap/_shared/normalize.sh" --project "$project_key"
  echo
  echo "Running validation..."
  "$ROOT_DIR/scripts/validate.sh" --project "$project_key" --run-dir "$run_dir"
fi

echo
echo "Final message written to: $summary_file"
