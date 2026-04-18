#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW_INBOX_DIR="$ROOT_DIR/raw/inbox"
ARTIFACTS_DIR="$ROOT_DIR/artifacts/runs"

usage() {
  cat <<'EOF'
Usage:
  scripts/ingest_v2.sh --global [--source <path>] [--model <model>] [--auto]
  scripts/ingest_v2.sh --project <project-key> [--project-dir <abs-path>] [--source <path>] [--model <model>] [--auto]

Options:
  --global                 Process one file from raw/inbox
  --project <project-key>  Process one file from projects/<project-key>/inbox
  --project-dir <abs-path> Override the default project lookup (used mainly by tests)
  --source <path>          Explicit source file to process
  --model <model>          Optional model spec. Formats:
                             codex | codex/<id> | claude | claude/<id> | <id>
                           Anything starting with "claude" routes to the Claude CLI.
                           Unset or anything else uses Codex.
  --auto                   After writing proposal files, immediately invoke ingest_apply.sh
  --dry-run                Print the agent command and prompt, but do not execute it
  -h, --help               Show this help message

Environment:
  CODEX_BIN                Codex executable to use (default: codex)
  CLAUDE_BIN               Claude executable to use (default: claude)
  LLM_WIKI_INGEST_PLAN_STUB=1
                           Emit a deterministic proposal without invoking an LLM
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

validate_artifacts() {
  local run_dir="$1"
  local mode="$2"
  local project_key_arg="$3"
  local errors_file="$run_dir/validation-errors.txt"
  local validator_args=(--run-dir "$run_dir" --mode "$mode")
  if [[ "$mode" == "project" ]]; then
    validator_args+=(--project "$project_key_arg")
  fi
  if python3 "$ROOT_DIR/scripts/ingest_validate_artifacts.py" "${validator_args[@]}" > /dev/null 2>"$errors_file"; then
    rm -f "$errors_file"
    return 0
  fi
  return 1
}

run_generation_prompt() {
  local prompt_path="$1"
  if [[ "$agent_backend" == "claude" ]]; then
    local json_file="$2"
    ( cd "$ROOT_DIR" && "${cmd[@]}" "$(cat "$prompt_path")" ) >"$json_file"
    python3 - "$json_file" "$summary_file" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
result = data.get("result") or data.get("final_message") or ""
with open(sys.argv[2], "w", encoding="utf-8") as f:
    f.write(result)
PY
  else
    "${cmd[@]}" - <"$prompt_path"
  fi
}

list_source_files() {
  local dir="$1"
  find "$dir" -type f \
    ! -name '.gitkeep' \
    ! -name '.DS_Store' \
    ! -name 'AGENTS.md' \
    ! -name 'README.md' | sort
}

slugify() {
  local value="$1"
  value="${value##*/}"
  value="${value%.*}"
  value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  value="$(printf '%s' "$value" | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
  printf '%s' "$value"
}

mode=""
project_key=""
project_dir_override=""
model=""
dry_run="false"
auto_apply="0"
source_path=""

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
    --project-dir)
      shift
      [[ $# -gt 0 ]] || die "--project-dir requires a value"
      project_dir_override="$1"
      shift
      ;;
    --source)
      shift
      [[ $# -gt 0 ]] || die "--source requires a value"
      source_path="$1"
      shift
      ;;
    --model)
      shift
      [[ $# -gt 0 ]] || die "--model requires a value"
      model="$1"
      shift
      ;;
    --auto)
      auto_apply="1"
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
      agent_backend="codex"
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

project_dir=""
target_label=""
inbox_dir=""
if [[ "$mode" == "global" ]]; then
  inbox_dir="$RAW_INBOX_DIR"
  target_label="global"
else
  if [[ -n "$project_dir_override" ]]; then
    project_dir="$project_dir_override"
  else
    project_dir="$ROOT_DIR/projects/$project_key"
  fi
  [[ -d "$project_dir" ]] || die "project does not exist: $project_dir"
  inbox_dir="$project_dir/inbox"
  target_label="$project_key"
fi

[[ -d "$inbox_dir" ]] || die "inbox directory does not exist: $inbox_dir"

resolved_source=""
if [[ -n "$source_path" ]]; then
  if [[ "$source_path" = /* ]]; then
    resolved_source="$source_path"
  elif [[ "$mode" == "global" ]]; then
    resolved_source="$RAW_INBOX_DIR/$source_path"
  else
    resolved_source="$project_dir/$source_path"
    [[ -f "$resolved_source" ]] || resolved_source="$inbox_dir/$source_path"
  fi
  [[ -f "$resolved_source" ]] || die "source file does not exist: $resolved_source"
else
  inbox_files=()
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    inbox_files+=("$line")
  done < <(list_source_files "$inbox_dir")
  if [[ ${#inbox_files[@]} -eq 0 ]]; then
    echo "No files found in $inbox_dir"
    exit 0
  fi
  if [[ ${#inbox_files[@]} -gt 1 ]]; then
    echo "Multiple source files found in $inbox_dir:" >&2
    for path in "${inbox_files[@]}"; do
      echo "- ${path#$inbox_dir/}" >&2
    done
    echo "Pass --source <path> to choose exactly one file." >&2
    exit 1
  fi
  resolved_source="${inbox_files[0]}"
fi

timestamp="$(date '+%Y%m%d-%H%M%S')"
run_dir="$ARTIFACTS_DIR/$timestamp-ingest-$target_label"
mkdir -p "$run_dir"

classification_json="$run_dir/classification.json"
units_json="$run_dir/units.json"
mapping_json="$run_dir/mapping.json"
proposal_json="$run_dir/proposal.json"
proposal_md="$run_dir/proposal.md"
prompt_file="$run_dir/prompt.md"
summary_file="$run_dir/final-message.md"

source_name="$(basename "$resolved_source")"
source_slug="$(slugify "$source_name")"
source_h1="$(python3 - <<'PY' "$resolved_source"
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text(encoding="utf-8")
for line in text.splitlines():
    if line.startswith("# "):
        print(line[2:].strip())
        break
else:
    print(Path(sys.argv[1]).stem)
PY
)"

if [[ "${LLM_WIKI_INGEST_PLAN_STUB:-0}" == "1" ]]; then
  if [[ "$mode" == "global" ]]; then
    source_field="raw/inbox/$source_name"
  else
    source_field="inbox/$source_name"
  fi

  cat >"$classification_json" <<EOF
{
  "source_kind": "session-note",
  "ownership": "${mode/project/project:${project_key}}",
  "destination": "wiki/systems/",
  "update_targets": [],
  "action": "create-new-page-and-update-index"
}
EOF

  cat >"$units_json" <<EOF
{
  "units": [
    {
      "unit_id": "unit-1",
      "title": "${source_h1//\"/\\\"}",
      "summary": "Derived from $source_name"
    }
  ]
}
EOF

  cat >"$mapping_json" <<EOF
{
  "units": [
    {
      "unit_id": "unit-1",
      "action": "create",
      "page_path": "wiki/systems/$source_slug.md",
      "page_type": "system",
      "summary": "Derived from $source_name"
    }
  ]
}
EOF

  cat >"$proposal_json" <<EOF
{
  "source": "$source_field",
  "source_id": "src-$source_slug",
  "source_kind": "session-note",
  "units": [
    {
      "action": "create",
      "page_path": "wiki/systems/$source_slug.md",
      "page_type": "system",
      "summary": "Derived from $source_name",
      "content": "# ${source_h1//\"/\\\"}\n\nImported from $source_name.\n"
    }
  ]
}
EOF

  cat >"$proposal_md" <<EOF
# Ingest Proposal

## Unit 1 - NEW PAGE wiki/systems/$source_slug.md
summary: Derived from $source_name
source: $source_field
EOF
else
  if [[ "$agent_backend" == "claude" ]]; then
    command -v "$CLAUDE_BIN" >/dev/null 2>&1 || die "claude CLI not found on PATH as '$CLAUDE_BIN'. Install via: npm install -g @anthropic-ai/claude-code (or set CLAUDE_BIN)."
  else
    require_command "$CODEX_BIN"
  fi

  if [[ "$mode" == "global" ]]; then
    source_field="raw/inbox/$source_name"
  else
    source_field="inbox/$source_name"
  fi

  cat >"$prompt_file" <<EOF
You are operating inside the llm-wiki workspace at:
$ROOT_DIR

Task:
- Read exactly one source file: $resolved_source
- Do not modify wiki pages, state files, preserved sources, or inbox files
- Produce only proposal artifacts in this run directory:
  - $classification_json
  - $units_json
  - $mapping_json
  - $proposal_json
  - $proposal_md

Required output contracts:
- classification.json must be a JSON object with exactly these fields: source_kind, ownership, destination, update_targets, action
- units.json must be a JSON object with a top-level "units" array; each unit must contain unit_id, title, summary
- mapping.json must be a JSON object with a top-level "units" array; each unit must contain unit_id, action, page_path, page_type, summary
- proposal.json must be apply-ready for scripts/ingest_apply.sh:
  - top-level source must be a single string path like "inbox/<filename>" or "raw/inbox/<filename>", not an object
  - each unit must contain action, page_path, page_type, summary, content
  - action values must be exactly "create" or "update"
  - page_path values must be project-relative like "wiki/runbooks/foo.md", never "projects/$project_key/wiki/..."
- every unit content block must include at least one concrete file_path:line citation such as `server/README.md:40-43`
- proposal.md must be a human-readable summary of the planned changes
- Do not use keys named proposed_action or proposed_page_path anywhere

Context to read before writing:
- AGENTS.md
- V1_SPEC.md
- schemas/source-classification.md
EOF
  if [[ "$mode" == "project" ]]; then
    cat >>"$prompt_file" <<EOF
- $project_dir/state/project.json
- $project_dir/index.md
- $project_dir/changelog.md
EOF
  fi

  cat >>"$prompt_file" <<EOF

Use these source fields in proposal output:
- source path: $source_field
- source filename: $source_name
- suggested source id prefix: src-

Content grounding rules:
- verify workflow details against authoritative repo files, not only the inbox note
- open the repo files named in the inbox note when needed and cite them directly in proposal content
- every created or appended wiki section must include concrete file_path:line citations for the facts it claims

After writing all five files, print one short line confirming proposal artifacts were written.
EOF

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

  if [[ "$dry_run" == "true" ]]; then
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
  else
    json_file=""
  fi

  run_generation_prompt "$prompt_file" "$json_file"

  [[ -f "$proposal_json" ]] || die "proposal generator did not produce $proposal_json"
  [[ -f "$proposal_md" ]] || die "proposal generator did not produce $proposal_md"

  if ! validate_artifacts "$run_dir" "$mode" "$project_key"; then
    repair_prompt="$run_dir/repair.prompt.md"
    cat >"$repair_prompt" <<EOF
You already attempted this ingest proposal, but the generated artifacts are not apply-ready.

Do not read any new source material. Do not modify wiki pages, state files, preserved sources, or inbox files.
Only repair these artifact files in-place:
- $classification_json
- $units_json
- $mapping_json
- $proposal_json
- $proposal_md

Validation errors that must be fixed:
EOF
    sed 's/^/- /' "$run_dir/validation-errors.txt" >>"$repair_prompt"
    cat >>"$repair_prompt" <<EOF

Reminder of the required machine contract:
- proposal.json source must be a string path, not an object
- proposal.json units must contain action, page_path, page_type, summary, content
- mapping.json must contain a top-level "units" array
- page_path values must be project-relative like "wiki/runbooks/foo.md"
- do not use proposed_action or proposed_page_path keys
- every unit content block must include at least one concrete file_path:line citation

After repairing all five artifacts, print one short line confirming the proposal artifacts were repaired.
EOF

    run_generation_prompt "$repair_prompt" "$json_file"

    if ! validate_artifacts "$run_dir" "$mode" "$project_key"; then
      echo "proposal artifacts are invalid after repair attempt:" >&2
      cat "$run_dir/validation-errors.txt" >&2
      exit 1
    fi
  fi
fi

echo "proposal written: $proposal_md"

if [[ "${auto_apply:-0}" == "1" ]]; then
  [[ "$mode" == "project" ]] || die "--auto is currently supported only with --project"
  echo "--auto: applying proposal immediately"
  apply_args=(--project "$project_key" --run-dir "$run_dir")
  if [[ -n "$project_dir_override" ]]; then
    apply_args+=(--project-dir "$project_dir_override")
  fi
  if [[ -n "$model" ]]; then
    apply_args+=(--model "$model")
  fi
  "$ROOT_DIR/scripts/ingest_apply.sh" "${apply_args[@]}"
  python3 - <<PY
import json
data = json.load(open('$run_dir/proposal.json'))
units = data.get('units', [])
created = sum(1 for u in units if u.get('action') == 'create')
updated = sum(1 for u in units if u.get('action') == 'update')
touched = len(units)
print(f'**AUTO INGEST APPLY** run={r"$run_dir"} touched_pages={touched} created_pages={created} updated_pages={updated}')
PY
fi
