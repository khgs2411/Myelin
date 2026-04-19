#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECTS_DIR="${PROJECTS_DIR:-$ROOT_DIR/projects}"

usage() {
  cat <<'EOF'
Usage:
  scripts/init_project.sh --project <project-key> [options]

Options:
  --project <project-key>       Required project key, for example: my_project
  --name <display-name>         Optional display name, default derived from project key
  --path <path>                 Optional external project path to register
  --repo-path <path>            Legacy alias for --path
  --tag <tag>                   Repeatable tag value
  --tags <a|b|c>                Pipe-delimited tag values
  --related-concept <concept>   Repeatable related concept value
  --related-concepts <a|b|c>    Pipe-delimited related concept values
  --focus <focus>               Repeatable bootstrap focus value
  --focuses <a|b|c>             Pipe-delimited bootstrap focus values
  --ignore-path <path>          Repeatable ignored repo path
  --dry-run                     Print what would be created, but do not write files
  -h, --help                    Show this help message
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

json_array() {
  if [[ $# -eq 0 ]]; then
    printf "[]"
    return
  fi

  local first="true"
  printf "["
  for item in "$@"; do
    if [[ "$first" == "true" ]]; then
      first="false"
    else
      printf ", "
    fi
    printf "\"%s\"" "$item"
  done
  printf "]"
}

titleize() {
  local input="$1"
  local spaced="${input//_/ }"
  spaced="${spaced//-/ }"
  local word=""
  local lower=""
  local first=""
  local rest=""
  local out=()
  for word in $spaced; do
    lower="$(printf '%s' "$word" | tr '[:upper:]' '[:lower:]')"
    case "$lower" in
      rpg|mmo|llm|api|sdk|cli|ecs|ui|ux|db|sql|http|https|tcp|udp|rpc|red)
        out+=("$(printf '%s' "$lower" | tr '[:lower:]' '[:upper:]')")
        ;;
      *)
        first="$(printf '%s' "$lower" | cut -c1 | tr '[:lower:]' '[:upper:]')"
        rest="$(printf '%s' "$lower" | cut -c2-)"
        out+=("${first}${rest}")
        ;;
    esac
  done
  printf '%s\n' "${out[*]}"
}

append_pipe_delimited() {
  local raw="$1"
  local target_name="$2"
  local item=""
  IFS='|' read -r -a parts <<<"$raw"
  for item in "${parts[@]}"; do
    [[ -n "$item" ]] || continue
    eval "$target_name+=(\"\$item\")"
  done
}

json_string_or_null() {
  local value="$1"
  if [[ -z "$value" ]]; then
    printf "null"
  else
    printf "\"%s\"" "$value"
  fi
}

load_archive_defaults() {
  local projects_dir="$1"
  local key="$2"
  python3 - "$projects_dir" "$key" <<'PY'
import json
import pathlib
import shlex
import sys

projects_dir = pathlib.Path(sys.argv[1])
key = sys.argv[2]

def score(data):
    return (
        len(data.get("tags", []))
        + len(data.get("bootstrap_focuses", []))
        + len(data.get("related_concepts", []))
        + (1 if data.get("name") else 0)
    )

best = None
best_score = -1
best_mtime = -1

for path in projects_dir.glob(f"{key}*_archive/state/project.json"):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        continue
    if data.get("key") != key:
        continue
    path_score = score(data)
    path_mtime = path.stat().st_mtime
    if path_score > best_score or (path_score == best_score and path_mtime > best_mtime):
        best = data
        best_score = path_score
        best_mtime = path_mtime

def q(value):
    return shlex.quote(value)

if best is None:
    print("ARCHIVE_NAME=''")
    print("ARCHIVE_PATH=''")
    print("ARCHIVE_TAGS=''")
    print("ARCHIVE_FOCUSES=''")
    print("ARCHIVE_RELATED_CONCEPTS=''")
else:
    repo_paths = best.get("repo_paths", []) or []
    print(f"ARCHIVE_NAME={q(best.get('name', '') or '')}")
    print(f"ARCHIVE_PATH={q(repo_paths[0] if repo_paths else '')}")
    print(f"ARCHIVE_TAGS={q('|'.join(best.get('tags', []) or []))}")
    print(f"ARCHIVE_FOCUSES={q('|'.join(best.get('bootstrap_focuses', []) or []))}")
    print(f"ARCHIVE_RELATED_CONCEPTS={q('|'.join(best.get('related_concepts', []) or []))}")
PY
}

project_key=""
project_name=""
repo_path=""
dry_run="false"
tags=()
related_concepts=()
bootstrap_focuses=()
ignored_paths=("Library" "Temp" "Logs" "obj" "node_modules")

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      shift
      [[ $# -gt 0 ]] || die "--project requires a value"
      project_key="$1"
      shift
      ;;
    --name)
      shift
      [[ $# -gt 0 ]] || die "--name requires a value"
      project_name="$1"
      shift
      ;;
    --path|--repo-path)
      option_name="$1"
      shift
      [[ $# -gt 0 ]] || die "$option_name requires a value"
      repo_path="$1"
      shift
      ;;
    --tag)
      shift
      [[ $# -gt 0 ]] || die "--tag requires a value"
      tags+=("$1")
      shift
      ;;
    --tags)
      shift
      [[ $# -gt 0 ]] || die "--tags requires a value"
      append_pipe_delimited "$1" tags
      shift
      ;;
    --related-concept)
      shift
      [[ $# -gt 0 ]] || die "--related-concept requires a value"
      related_concepts+=("$1")
      shift
      ;;
    --related-concepts)
      shift
      [[ $# -gt 0 ]] || die "--related-concepts requires a value"
      append_pipe_delimited "$1" related_concepts
      shift
      ;;
    --focus)
      shift
      [[ $# -gt 0 ]] || die "--focus requires a value"
      bootstrap_focuses+=("$1")
      shift
      ;;
    --focuses)
      shift
      [[ $# -gt 0 ]] || die "--focuses requires a value"
      append_pipe_delimited "$1" bootstrap_focuses
      shift
      ;;
    --ignore-path)
      shift
      [[ $# -gt 0 ]] || die "--ignore-path requires a value"
      ignored_paths+=("$1")
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

project_dir="$PROJECTS_DIR/$project_key"

if [[ -e "$project_dir" ]]; then
  die "project already exists: $project_key"
fi

eval "$(load_archive_defaults "$PROJECTS_DIR" "$project_key")"

if [[ -z "$repo_path" && -n "${ARCHIVE_PATH:-}" ]]; then
  repo_path="$ARCHIVE_PATH"
fi
if [[ ${#tags[@]} -eq 0 && -n "${ARCHIVE_TAGS:-}" ]]; then
  append_pipe_delimited "$ARCHIVE_TAGS" tags
fi
if [[ ${#bootstrap_focuses[@]} -eq 0 && -n "${ARCHIVE_FOCUSES:-}" ]]; then
  append_pipe_delimited "$ARCHIVE_FOCUSES" bootstrap_focuses
fi
if [[ ${#related_concepts[@]} -eq 0 && -n "${ARCHIVE_RELATED_CONCEPTS:-}" ]]; then
  append_pipe_delimited "$ARCHIVE_RELATED_CONCEPTS" related_concepts
fi

if [[ -z "$project_name" ]]; then
  default_project_name="$(titleize "$project_key")"
  normalized_default_name="$(printf '%s' "$default_project_name" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
  normalized_archive_name="$(printf '%s' "${ARCHIVE_NAME:-}" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
  if [[ -n "${ARCHIVE_NAME:-}" && "$normalized_archive_name" != "$normalized_default_name" ]]; then
    project_name="$ARCHIVE_NAME"
  else
    project_name="$default_project_name"
  fi
fi

if [[ "$dry_run" == "true" ]]; then
  echo "Would create project scaffold:"
  echo "  key: $project_key"
  echo "  name: $project_name"
  echo "  dir: $project_dir"
  if [[ -n "$repo_path" ]]; then
    echo "  repo path: $repo_path"
  fi
  exit 0
fi

mkdir -p \
  "$project_dir/inbox" \
  "$project_dir/.migration-hints" \
  "$project_dir/sources" \
  "$project_dir/wiki/architecture" \
  "$project_dir/wiki/systems" \
  "$project_dir/wiki/modules" \
  "$project_dir/wiki/integrations" \
  "$project_dir/wiki/decisions" \
  "$project_dir/wiki/runbooks" \
  "$project_dir/wiki/sessions" \
  "$project_dir/wiki/glossary" \
  "$project_dir/wiki/open-questions" \
  "$project_dir/state"

touch \
  "$project_dir/inbox/.gitkeep" \
  "$project_dir/sources/.gitkeep" \
  "$project_dir/wiki/systems/.gitkeep" \
  "$project_dir/wiki/modules/.gitkeep" \
  "$project_dir/wiki/integrations/.gitkeep" \
  "$project_dir/wiki/decisions/.gitkeep" \
  "$project_dir/wiki/runbooks/.gitkeep" \
  "$project_dir/wiki/sessions/.gitkeep" \
  "$project_dir/wiki/glossary/.gitkeep" \
  "$project_dir/wiki/open-questions/.gitkeep"

today="$(date '+%Y-%m-%d')"
last_seen_commit=""
repo_dirty="false"
dirty_paths=()
if [[ -n "$repo_path" && -d "$repo_path" ]]; then
  if git -C "$repo_path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    last_seen_commit="$(git -C "$repo_path" rev-parse HEAD 2>/dev/null || true)"
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      dirty_paths+=("${line:3}")
    done < <(git -C "$repo_path" status --short 2>/dev/null || true)
    if [[ ${#dirty_paths[@]} -gt 0 ]]; then
      repo_dirty="true"
    fi
  fi
fi

cat >"$project_dir/index.md" <<EOF
# $project_name

$project_name landing page (scaffold - will be rewritten by the first \`make update\` run).

## Start Here

- (populated after first update run)

## Architecture

- (populated after first update run)

## Systems And Modules

- (populated after first update run)

## Integrations

- (populated after first update run)

## Decisions

- (populated after first update run)

## Runbooks

- (populated after first update run)

## Recent Sessions

- (populated after first update run)
EOF

cat >"$project_dir/changelog.md" <<EOF
# $project_name Changelog

## [$today] scaffold | $project_key

Created the initial \`$project_key\` project scaffold in \`llm-wiki\`.
EOF

cat >"$project_dir/state/project.json" <<EOF
{
  "key": "$project_key",
  "name": "$project_name",
  "repo_paths": $(if [[ -n "$repo_path" ]]; then json_array "$repo_path"; else json_array; fi),
  "tags": $(if [[ ${#tags[@]} -gt 0 ]]; then json_array "${tags[@]}"; else json_array; fi),
  "entry_pages": [
    "index.md"
  ],
  "related_concepts": $(if [[ ${#related_concepts[@]} -gt 0 ]]; then json_array "${related_concepts[@]}"; else json_array; fi),
  "ignored_paths": $(json_array "${ignored_paths[@]}"),
  "acceptance_questions_path": "acceptance-questions.md",
  "ranking_cutoff": 20
}
EOF

cat >"$project_dir/state/pages.json" <<EOF
{
  "pages": [
    {
      "path": "index.md",
      "type": "index",
      "summary": "Primary entry point for the $project_key knowledge space.",
      "linked_sources": [],
      "linked_topics": [],
      "last_reviewed_at": "$today",
      "freshness_status": "scaffold"
    }
  ]
}
EOF

cat >"$project_dir/state/sources.json" <<'EOF'
{
  "sources": []
}
EOF

cat >"$project_dir/state/relationships.json" <<'EOF'
{
  "relationships": []
}
EOF

cat >"$project_dir/state/freshness.json" <<EOF
{
  "last_seen_commit": $(json_string_or_null "$last_seen_commit"),
  "last_seen_commit_pending": null,
  "last_update_at": "$today",
  "last_update_at_pending": null,
  "changed_paths": [],
  "impacted_pages": [],
  "status": "scaffold",
  "updated_at": "$today",
  "repo_dirty": $repo_dirty,
  "dirty_paths": $(if [[ ${#dirty_paths[@]} -gt 0 ]]; then json_array "${dirty_paths[@]}"; else json_array; fi)
}
EOF

cat >"$project_dir/acceptance-questions.md" <<EOF
# Acceptance Questions - $project_name

<!-- version: 0.1 -->

Questions a cold LLM session should be able to answer from the wiki alone.

1. [discipline] What is this project and what are its major surfaces?

## Scoring

- 2: full answer with citations from wiki alone
- 1: directional but incomplete or uncited
- 0: can't answer; wrong; wiki contradicts itself

## Acceptance bar

- Total >= 16/20
- No zero on [discipline]-tagged questions
EOF

if [[ ${#bootstrap_focuses[@]} -gt 0 ]]; then
  cat >"$project_dir/.migration-hints/bootstrap-focuses-archive.md" <<EOF
# Archived Bootstrap Focuses

The deprecated \`--focus\` / \`--focuses\` inputs were provided during init and archived here for manual porting into \`acceptance-questions.md\`.

$(for focus in "${bootstrap_focuses[@]}"; do printf -- "- %s\n" "$focus"; done)
EOF
  echo "deprecated: --focus archived to .migration-hints/; port to acceptance-questions.md" >&2
fi

python3 "$ROOT_DIR/agents/update/_shared/state.py" ensure --project-dir "$project_dir" --project "$project_key"

echo "Created project scaffold at: $project_dir"
