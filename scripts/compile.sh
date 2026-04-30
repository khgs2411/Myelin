#!/usr/bin/env bash
# Unified update pipeline entry. Plan A scope: sense + impact only.
# Plans B/C add propose, apply, validate, reconcile.
#
# Usage:
#   scripts/compile.sh --project <project-key>
#   scripts/compile.sh                            # iterate all registered projects
#
# Env:
#   LLM_STUB_RESPONSES_DIR  if set, agents use canned stub responses
#   UPDATE_STAGES_ROOT       override stages root (for testing)
#   UPDATE_PROJECTS_ROOT     override projects root (for testing)
#   UPDATE_ARTIFACTS_ROOT    override artifacts root (for testing)
#   AUTO                     1 = write approved=true in proposal, split destructive to pending-approvals
#   CONTINUE                 1 = resume from latest existing run's proposal (post-approval)
#   RANKING_CUTOFF           override ranking cutoff

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STAGES_ROOT="${UPDATE_STAGES_ROOT:-$ROOT_DIR/agents/update}"
PROJECTS_ROOT="${UPDATE_PROJECTS_ROOT:-$ROOT_DIR/projects}"
ARTIFACTS_ROOT="${UPDATE_ARTIFACTS_ROOT:-$ROOT_DIR/artifacts}"

usage() {
  cat <<'EOF'
Usage:
  scripts/compile.sh --project <project-key>
  scripts/compile.sh                           # iterate all registered projects
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

# Validate all stage configs FIRST (pipeline-entry check)
python3 "$ROOT_DIR/scripts/validate_stage_configs.py" --stages-root "$STAGES_ROOT" \
  || die "stage config validation failed; fix config.json files before running"

# Determine project list
projects=()
if [[ -n "$project_key" ]]; then
  projects+=("$project_key")
else
  while IFS= read -r dir; do
    [[ -f "$dir/state/project.json" ]] && projects+=("$(basename "$dir")")
  done < <(find "$PROJECTS_ROOT" -maxdepth 1 -mindepth 1 -type d)
fi

run_project() {
  local key="$1"
  local project_dir="$PROJECTS_ROOT/$key"
  [[ -d "$project_dir" ]] || { echo "warn: project not found: $key" >&2; return 1; }

  local pipeline_total=8
  local pipeline_start
  pipeline_start=$(date +%s)

  progress_bar() {
    local completed="$1"
    local total="$2"
    local filled=""
    local empty=""
    local i
    for ((i = 0; i < completed; i++)); do
      filled+="#"
    done
    for ((i = completed; i < total; i++)); do
      empty+="-"
    done
    printf '[%s%s]' "$filled" "$empty"
  }

  emit_stage_line() {
    local num="$1"
    local name="$2"
    local status="$3"
    local completed="$4"
    printf '[%s] [%s/%s] %s ... %s %s\n' \
      "$key" "$num" "$pipeline_total" "$name" "$(progress_bar "$completed" "$pipeline_total")" "$status" >&2
  }

  profile_event() {
    [[ -n "${run_dir:-}" ]] || return 0
    python3 "$ROOT_DIR/scripts/run_profile.py" "$@" \
      --profile "$run_dir/run-profile.json" \
      --project-dir "$project_dir" \
      --project-key "$key" \
      --run-id "$run_id" \
      --pipeline "compile" \
      || echo "warn: [$key] run profile update failed for event $1" >&2
  }

  run_stage() {
    local num="$1"
    local name="$2"
    shift 2
    local start end elapsed rc start_progress
    start_progress=$((num > 1 ? num - 1 : 0))
    emit_stage_line "$num" "$name" "(running)" "$start_progress"
    profile_event stage-started --stage-name "$name"
    start=$(date +%s)
    set +e
    "$@"
    rc=$?
    set -e
    end=$(date +%s)
    elapsed=$((end - start))
    if [[ "$rc" -eq 0 ]]; then
      emit_stage_line "$num" "$name" "${elapsed}s" "$num"
      profile_event stage-finished --stage-name "$name" --status completed --exit-code "$rc"
    else
      emit_stage_line "$num" "$name" "${elapsed}s FAILED (rc=$rc)" "$num"
      profile_event stage-finished --stage-name "$name" --status failed --exit-code "$rc"
    fi
    return "$rc"
  }

  skip_stage() {
    local num="$1"
    local name="$2"
    emit_stage_line "$num" "$name" "skipped" "$num"
    profile_event stage-skipped --stage-name "$name"
  }

  local run_id
  local run_dir

  if [[ "${CONTINUE:-}" == "1" ]]; then
    local latest
    latest="$(find "$ARTIFACTS_ROOT/$key/runs" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort | tail -n 1)"
    [[ -n "$latest" ]] || die "CONTINUE=1 set but no prior run found under $ARTIFACTS_ROOT/$key/runs"
    [[ -f "$latest/proposal.json" ]] || die "CONTINUE=1 set but $latest has no proposal.json"
    run_dir="$latest"
    run_id="$(basename "$run_dir")"
    export LLM_WIKI_LLM_RESULTS_DIR="$run_dir/llm-results"
    profile_event run-started
    echo "[$key] CONTINUE=1; resuming at apply (run_dir: $run_dir)" >&2
  else
    run_id="$(date -u +%Y%m%d-%H%M%S)-update"
    run_dir="$ARTIFACTS_ROOT/$key/runs/$run_id"
    mkdir -p "$run_dir"
    export LLM_WIKI_LLM_RESULTS_DIR="$run_dir/llm-results"
    profile_event run-started
    echo "[$key] run_dir: $run_dir" >&2

    run_stage 1 "sense" bash "$STAGES_ROOT/01-sense/run.sh" \
      --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" || return 1

    run_stage 2 "impact" bash "$STAGES_ROOT/02-impact/run.sh" \
      --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" || return 1

    python3 "$ROOT_DIR/scripts/stable_products.py" render-ranking \
      --input "$run_dir/ranking-snapshot.json" \
      --project-dir "$project_dir" || return 1

    run_stage 3 "propose" bash "$STAGES_ROOT/03-propose/run.sh" \
      --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" || return 1
  fi

  local proposal_path="$run_dir/proposal.json"
  [[ -f "$proposal_path" ]] || die "proposal.json missing at $proposal_path"

  local approved
  approved="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('approved', False))" "$proposal_path")"

  if [[ "$approved" != "True" ]]; then
    cat >&2 <<EOM
[$key] Proposal awaits approval.
  Review: $run_dir/proposal.md
  Edit:   $proposal_path (set "approved": true)
  Apply:  make compile-continue PROJECT=$key
EOM
    profile_event run-finished --status awaiting-approval
    return 0
  fi

  run_stage 4 "apply" bash "$STAGES_ROOT/04-apply/run.sh" \
    --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" || return 1

  local validate_exit=0
  run_stage 5 "validate" bash "$STAGES_ROOT/06-validate/run.sh" \
    --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" \
    || validate_exit=$?

  if [[ -f "$run_dir/validation-findings.json" ]]; then
    python3 "$ROOT_DIR/scripts/stable_products.py" render-validation \
      --input "$run_dir/validation-findings.json" \
      --project-dir "$project_dir" || return 1
  fi

  if [[ "$validate_exit" -ne 0 ]]; then
    run_stage 6 "reconcile" bash "$STAGES_ROOT/07-reconcile/run.sh" \
      --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" || return 1

    local reconcile_approved
    reconcile_approved="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("approved", False))' "$run_dir/reconcile-proposal.json")"

    if [[ "$reconcile_approved" == "True" ]]; then
      local original_proposal_path="$run_dir/proposal.original.json"
      [[ -f "$original_proposal_path" ]] || cp "$run_dir/proposal.json" "$original_proposal_path"
      python3 "$ROOT_DIR/scripts/merge_reconcile.py" \
        "$original_proposal_path" \
        "$run_dir/reconcile-proposal.json" \
        "$run_dir/proposal.json" || return 1
      run_stage 4 "apply (retry)" bash "$STAGES_ROOT/04-apply/run.sh" \
        --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" || return 1
      validate_exit=0
      run_stage 5 "validate (retry)" bash "$STAGES_ROOT/06-validate/run.sh" \
        --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" \
        || validate_exit=$?
      if [[ -f "$run_dir/validation-findings.json" ]]; then
        python3 "$ROOT_DIR/scripts/stable_products.py" render-validation \
          --input "$run_dir/validation-findings.json" \
          --project-dir "$project_dir" || return 1
      fi
    fi

    if [[ "$validate_exit" -ne 0 ]]; then
      echo "[$key] validate failed after reconcile; commit pointer NOT advanced" >&2
      return 1
    fi
  else
    skip_stage 6 "reconcile"
  fi

  python3 "$ROOT_DIR/scripts/stable_products.py" render-metadata \
    --project-dir "$project_dir" || return 1

  # Auto-generate acceptance questions by dogfooding the fresh wiki. Non-fatal:
  # failures here don't block commit-pointer advancement, because the wiki is
  # already valid and the questions file can always be regenerated or edited.
  run_stage 7 "acceptance" bash "$STAGES_ROOT/05-acceptance/run.sh" \
    --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" \
    || echo "[$key] acceptance question generation skipped (non-fatal)" >&2

  run_stage 8 "apply_commit" env PROJECTS_ROOT="$PROJECTS_ROOT" bash "$ROOT_DIR/scripts/apply_commit.sh" --project "$key" || return 1

  local pipeline_end total_elapsed
  pipeline_end=$(date +%s)
  total_elapsed=$((pipeline_end - pipeline_start))
  profile_event run-finished --status completed
  echo "[$key] pipeline complete in ${total_elapsed}s" >&2
}

rc=0
for key in "${projects[@]}"; do
  if ! run_project "$key"; then
    echo "warn: [$key] failed; continuing" >&2
    rc=1
  fi
done

exit $rc
