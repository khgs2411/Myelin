#!/usr/bin/env bash
# Unified update pipeline entry. Plan A scope: sense + impact only.
# Plans B/C add propose, apply, validate, reconcile.
#
# Usage:
#   scripts/update.sh --project <project-key>
#   scripts/update.sh                            # iterate all registered projects
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
  scripts/update.sh --project <project-key>
  scripts/update.sh                           # iterate all registered projects
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

  local run_id
  local run_dir

  if [[ "${CONTINUE:-}" == "1" ]]; then
    local latest
    latest="$(find "$ARTIFACTS_ROOT/$key/runs" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort | tail -n 1)"
    [[ -n "$latest" ]] || die "CONTINUE=1 set but no prior run found under $ARTIFACTS_ROOT/$key/runs"
    [[ -f "$latest/proposal.json" ]] || die "CONTINUE=1 set but $latest has no proposal.json"
    run_dir="$latest"
    run_id="$(basename "$run_dir")"
    echo "[$key] CONTINUE=1; using existing run_dir: $run_dir"
  else
    run_id="$(date -u +%Y%m%d-%H%M%S)-update"
    run_dir="$ARTIFACTS_ROOT/$key/runs/$run_id"
    mkdir -p "$run_dir"
    echo "[$key] run_dir: $run_dir"

    bash "$STAGES_ROOT/01-sense/run.sh" \
      --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" || return 1

    bash "$STAGES_ROOT/02-impact/run.sh" \
      --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" || return 1

    python3 "$ROOT_DIR/scripts/stable_products.py" render-ranking \
      --input "$run_dir/ranking-snapshot.json" \
      --project-dir "$project_dir" || return 1

    bash "$STAGES_ROOT/03-propose/run.sh" \
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
  Apply:  make update-v2-continue PROJECT=$key
EOM
    return 0
  fi

  bash "$STAGES_ROOT/04-apply/run.sh" \
    --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" || return 1

  local validate_exit=0
  bash "$STAGES_ROOT/06-validate/run.sh" \
    --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" \
    || validate_exit=$?

  if [[ -f "$run_dir/validation-findings.json" ]]; then
    python3 "$ROOT_DIR/scripts/stable_products.py" render-validation \
      --input "$run_dir/validation-findings.json" \
      --project-dir "$project_dir" || return 1
  fi

  if [[ "$validate_exit" -ne 0 ]]; then
    bash "$STAGES_ROOT/07-reconcile/run.sh" \
      --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" || return 1

    local reconcile_approved
    reconcile_approved="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("approved", False))' "$run_dir/reconcile-proposal.json")"

    if [[ "$reconcile_approved" == "True" ]]; then
      cp "$run_dir/reconcile-proposal.json" "$run_dir/proposal.json"
      bash "$STAGES_ROOT/04-apply/run.sh" \
        --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" || return 1
      validate_exit=0
      bash "$STAGES_ROOT/06-validate/run.sh" \
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
  fi

  # Auto-generate acceptance questions by dogfooding the fresh wiki. Non-fatal:
  # failures here don't block commit-pointer advancement, because the wiki is
  # already valid and the questions file can always be regenerated or edited.
  bash "$STAGES_ROOT/05-acceptance/run.sh" \
    --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" \
    || echo "[$key] acceptance question generation skipped (non-fatal)" >&2

  PROJECTS_ROOT="$PROJECTS_ROOT" bash "$ROOT_DIR/scripts/apply_commit.sh" --project "$key" || return 1

  echo "[$key] pipeline complete"
}

rc=0
for key in "${projects[@]}"; do
  if ! run_project "$key"; then
    echo "warn: [$key] failed; continuing" >&2
    rc=1
  fi
done

exit $rc
