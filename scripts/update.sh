#!/usr/bin/env bash
# Incremental inbox-driven update pipeline.

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

[[ -n "$project_key" ]] || die "--project is required"

python3 "$ROOT_DIR/scripts/validate_stage_configs.py" --stages-root "$STAGES_ROOT" \
  || die "stage config validation failed; fix config.json files before running"

project_dir="$PROJECTS_ROOT/$project_key"
[[ -d "$project_dir" ]] || die "project not found: $project_dir"

count_top_level_inbox_items() {
  python3 - "$project_dir" <<'PY'
import sys
from pathlib import Path

project_dir = Path(sys.argv[1])
inbox = project_dir / "inbox"
if not inbox.is_dir():
    print(0)
    raise SystemExit(0)
count = 0
for entry in inbox.iterdir():
    if entry.is_file() and entry.suffix == ".json":
        count += 1
print(count)
PY
}

semantic_warn_count() {
  python3 - "$1" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
if not path.is_file():
    print(0)
    raise SystemExit(0)
data = json.loads(path.read_text(encoding="utf-8"))
count = 0
for finding in data.get("semantic", []):
    if str(finding.get("severity") or "").strip().lower() == "warn":
        count += 1
print(count)
PY
}

proposal_ready_for_apply() {
  python3 - "$1" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
if not path.is_file():
    print("False")
    raise SystemExit(0)
data = json.loads(path.read_text(encoding="utf-8"))
approved = bool(data.get("approved"))
units = data.get("units") or []
print("True" if approved and len(units) > 0 else "False")
PY
}

pipeline_total=7
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
    "$project_key" "$num" "$pipeline_total" "$name" "$(progress_bar "$completed" "$pipeline_total")" "$status" >&2
}

run_stage() {
  local num="$1"
  local name="$2"
  shift 2
  local start end elapsed rc start_progress
  start_progress=$((num > 1 ? num - 1 : 0))
  emit_stage_line "$num" "$name" "(running)" "$start_progress"
  start=$(date +%s)
  set +e
  "$@"
  rc=$?
  set -e
  end=$(date +%s)
  elapsed=$((end - start))
  if [[ "$rc" -eq 0 ]]; then
    emit_stage_line "$num" "$name" "${elapsed}s" "$num"
  else
    emit_stage_line "$num" "$name" "${elapsed}s FAILED (rc=$rc)" "$num"
  fi
  return "$rc"
}

skip_stage() {
  local num="$1"
  local name="$2"
  emit_stage_line "$num" "$name" "skipped" "$num"
}

terminalize_items() {
  local outcome="$1"
  local reason_file="$2"
  python3 - "$ROOT_DIR" "$project_dir" "$run_dir" "$outcome" "$reason_file" <<'PY'
import json
import sys
from pathlib import Path

root_dir = Path(sys.argv[1])
project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
outcome = sys.argv[4]
reason_file = sys.argv[5]

sys.path.insert(0, str(root_dir))

from agents.update._shared import ingest  # noqa: E402

snapshot = json.loads((run_dir / "inbox-snapshot.json").read_text(encoding="utf-8"))
reason = ""
if reason_file:
    reason = Path(reason_file).read_text(encoding="utf-8")
items = ingest.terminal_state_for_items(
    project_dir,
    snapshot.get("consumed_items", []),
    outcome=outcome,
    reason=reason or None,
)
(run_dir / "terminal-state.json").write_text(
    json.dumps({"project": project_dir.name, "items": items}, indent=2) + "\n",
    encoding="utf-8",
)
PY
}

run_id=""
run_dir=""
if [[ "${CONTINUE:-}" == "1" ]]; then
  latest="$(find "$ARTIFACTS_ROOT/$project_key/runs" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort | tail -n 1)"
  [[ -n "$latest" ]] || die "CONTINUE=1 set but no prior run found under $ARTIFACTS_ROOT/$project_key/runs"
  [[ -f "$latest/proposal.json" ]] || die "CONTINUE=1 set but $latest has no proposal.json"
  run_dir="$latest"
  run_id="$(basename "$run_dir")"
  echo "[$project_key] CONTINUE=1; resuming at apply (run_dir: $run_dir)" >&2
else
  inbox_count="$(count_top_level_inbox_items)"
  if [[ "$inbox_count" == "0" ]]; then
    echo "update: inbox empty, nothing to ingest"
    exit 0
  fi
  run_id="$(date -u +%Y%m%d-%H%M%S)-update"
  run_dir="$ARTIFACTS_ROOT/$project_key/runs/$run_id"
  mkdir -p "$run_dir"
  echo "[$project_key] run_dir: $run_dir" >&2

  run_stage 1 "ingest" bash "$STAGES_ROOT/08-ingest/run.sh" \
    --project "$project_key" --project-dir "$project_dir" --run-dir "$run_dir"

  if [[ ! -f "$run_dir/proposal.json" ]]; then
    echo "update: no valid inbox items after schema validation"
    exit 0
  fi
fi

proposal_path="$run_dir/proposal.json"
approved="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('approved', False))" "$proposal_path")"

if [[ "$approved" != "True" ]]; then
  cat <<EOM
[$project_key] Proposal awaits approval.
  Review: $run_dir/proposal.md
  Edit:   $proposal_path (set "approved": true)
  Apply:  make update-continue PROJECT=$project_key
EOM
  exit 0
fi

apply_exit=0
run_stage 2 "apply" bash "$STAGES_ROOT/04-apply/run.sh" \
  --project "$project_key" --project-dir "$project_dir" --run-dir "$run_dir" \
  || apply_exit=$?

validate_exit=0
reason_file=""
if [[ "$apply_exit" -eq 0 ]]; then
  run_stage 3 "validate" env INGEST_MODE=1 VALIDATE_AUTO_EMIT=0 bash "$STAGES_ROOT/06-validate/run.sh" \
    --project "$project_key" --project-dir "$project_dir" --run-dir "$run_dir" \
    || validate_exit=$?

  if [[ -f "$run_dir/validation-findings.json" ]]; then
    python3 "$ROOT_DIR/scripts/stable_products.py" render-validation \
      --input "$run_dir/validation-findings.json" \
      --project-dir "$project_dir"
    reason_file="$run_dir/validation-findings.json"
  fi
else
  reason_file="$run_dir/apply-failure.reason.md"
  printf 'Apply failed for ingest run %s.\n' "$run_id" >"$reason_file"
fi

if [[ "$apply_exit" -eq 0 && "$validate_exit" -ne 0 ]]; then
  run_stage 4 "reconcile" bash "$STAGES_ROOT/07-reconcile/run.sh" \
    --project "$project_key" --project-dir "$project_dir" --run-dir "$run_dir" || true

  reconcile_approved="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("approved", False))' "$run_dir/reconcile-proposal.json" 2>/dev/null || printf 'False')"
  if [[ "$reconcile_approved" == "True" ]]; then
    original_proposal_path="$run_dir/proposal.original.json"
    [[ -f "$original_proposal_path" ]] || cp "$run_dir/proposal.json" "$original_proposal_path"
    python3 "$ROOT_DIR/scripts/merge_reconcile.py" \
      "$original_proposal_path" \
      "$run_dir/reconcile-proposal.json" \
      "$run_dir/proposal.json"
    apply_exit=0
    run_stage 2 "apply (retry)" bash "$STAGES_ROOT/04-apply/run.sh" \
      --project "$project_key" --project-dir "$project_dir" --run-dir "$run_dir" \
      || apply_exit=$?
    validate_exit=0
    if [[ "$apply_exit" -eq 0 ]]; then
      run_stage 3 "validate (retry)" env INGEST_MODE=1 VALIDATE_AUTO_EMIT=0 bash "$STAGES_ROOT/06-validate/run.sh" \
        --project "$project_key" --project-dir "$project_dir" --run-dir "$run_dir" \
        || validate_exit=$?
      if [[ -f "$run_dir/validation-findings.json" ]]; then
        python3 "$ROOT_DIR/scripts/stable_products.py" render-validation \
          --input "$run_dir/validation-findings.json" \
          --project-dir "$project_dir"
        reason_file="$run_dir/validation-findings.json"
      fi
    else
      reason_file="$run_dir/apply-failure.reason.md"
      printf 'Apply retry failed for ingest run %s.\n' "$run_id" >"$reason_file"
    fi
  fi
else
  skip_stage 4 "reconcile"
fi

self_correct_exit=0
if [[ "$apply_exit" -eq 0 && "$validate_exit" -eq 0 ]]; then
  remaining_warns="$(semantic_warn_count "$run_dir/validation-findings.json")"
  if [[ "$remaining_warns" -gt 0 ]]; then
    run_stage 5 "self-correct" bash "$STAGES_ROOT/09-self-correct/run.sh" \
      --project "$project_key" --project-dir "$project_dir" --run-dir "$run_dir" \
      || self_correct_exit=$?

    if [[ "$self_correct_exit" -eq 0 ]]; then
      self_correct_proposal_path="$run_dir/self-correct-proposal.json"
      self_correct_ready="$(proposal_ready_for_apply "$self_correct_proposal_path")"
      if [[ "$self_correct_ready" == "True" ]]; then
        self_correct_base="$run_dir/proposal.pre-self-correct.json"
        cp "$run_dir/proposal.json" "$self_correct_base"
        python3 "$ROOT_DIR/scripts/merge_reconcile.py" \
          "$self_correct_base" \
          "$self_correct_proposal_path" \
          "$run_dir/proposal.json"
        apply_exit=0
        run_stage 2 "apply (self-correct)" bash "$STAGES_ROOT/04-apply/run.sh" \
          --project "$project_key" --project-dir "$project_dir" --run-dir "$run_dir" \
          || apply_exit=$?
        validate_exit=0
        if [[ "$apply_exit" -eq 0 ]]; then
          run_stage 3 "validate (self-correct)" env INGEST_MODE=1 VALIDATE_AUTO_EMIT=0 bash "$STAGES_ROOT/06-validate/run.sh" \
            --project "$project_key" --project-dir "$project_dir" --run-dir "$run_dir" \
            || validate_exit=$?
          if [[ -f "$run_dir/validation-findings.json" ]]; then
            python3 "$ROOT_DIR/scripts/stable_products.py" render-validation \
              --input "$run_dir/validation-findings.json" \
              --project-dir "$project_dir"
            reason_file="$run_dir/validation-findings.json"
          fi
        else
          reason_file="$run_dir/apply-failure.reason.md"
          printf 'Apply self-correct failed for ingest run %s.\n' "$run_id" >"$reason_file"
        fi
      fi
    else
      reason_file="$run_dir/self-correct-failure.reason.md"
      printf 'Self-correct stage failed for ingest run %s.\n' "$run_id" >"$reason_file"
    fi
  else
    skip_stage 5 "self-correct"
  fi
else
  skip_stage 5 "self-correct"
fi

final_status="pass"
terminal_outcome="processed"
if [[ "$apply_exit" -ne 0 || "$validate_exit" -ne 0 || "$self_correct_exit" -ne 0 ]]; then
  final_status="fail"
  terminal_outcome="needs-review"
fi

run_stage 6 "terminal-state" terminalize_items "$terminal_outcome" "$reason_file" || true

render_ingest_args=(
  python3 "$ROOT_DIR/scripts/stable_products.py" render-ingest
  --project-dir "$project_dir"
  --audit-run-dir "$run_dir"
  --status "$final_status"
  --proposal-json "$run_dir/proposal.json"
)
if [[ -f "$run_dir/validation-findings.json" ]]; then
  render_ingest_args+=(--lint-findings-path "$run_dir/validation-findings.json")
fi
"${render_ingest_args[@]}"

python3 "$ROOT_DIR/agents/update/_shared/state.py" record-ingest \
  --project-dir "$project_dir" \
  --project "$project_key" \
  --status "$final_status" \
  --findings-path "$project_dir/state/latest/ingest-findings.json" \
  --audit-run-dir "$run_dir"

if [[ "$final_status" != "pass" ]]; then
  echo "[$project_key] update failed; consumed inbox items moved to needs-review" >&2
  exit 1
fi

commit_message="$(python3 - "$run_dir/inbox-snapshot.json" <<'PY'
import json
import sys
from pathlib import Path

snapshot = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
items = snapshot.get("consumed_items", [])
targets = []
for item in items:
    target = (item.get("target_hint") or "").strip() or "routing-needed"
    if target not in targets:
        targets.append(target)
summary = ", ".join(targets[:3])
if len(targets) > 3:
    summary += ", +more"
print(f"ingest: closed {len(items)} gap-notes ({summary})")
PY
)"

run_stage 7 "apply_commit" env PROJECTS_ROOT="$PROJECTS_ROOT" APPLY_COMMIT_MESSAGE="$commit_message" \
  bash "$ROOT_DIR/scripts/apply_commit.sh" --project "$project_key"

pipeline_end=$(date +%s)
total_elapsed=$((pipeline_end - pipeline_start))
echo "[$project_key] update complete in ${total_elapsed}s" >&2
