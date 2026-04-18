#!/usr/bin/env bash
# Dry-run harness: execute the full Plan B pipeline against projects/sample
# using a real LLM backend, then capture outputs in a timestamped bundle.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

die() { echo "error: $*" >&2; exit 1; }

if [[ -n "${LLM_STUB_RESPONSES_DIR:-}" ]]; then
  die "LLM_STUB_RESPONSES_DIR is set; this harness runs the real LLM. Unset it and retry."
fi

MODEL="${MODEL:-codex}"

case "$MODEL" in
  claude|claude/*)
    command -v "${CLAUDE_BIN:-claude}" >/dev/null 2>&1 || die "claude CLI not on PATH"
    ;;
  *)
    command -v "${CODEX_BIN:-codex}" >/dev/null 2>&1 || die "codex CLI not on PATH"
    ;;
esac

bash "$ROOT_DIR/tests/fixtures/sample_repo_init.sh"

ts="$(date -u +%Y%m%d-%H%M%S)"
bundle="$ROOT_DIR/docs/superpowers/dry-run-notes/artifacts/${ts}-dry-run"
mkdir -p "$bundle"/{project-copy,artifacts}

cp -R "$ROOT_DIR/projects/sample" "$bundle/project-copy/sample"
cp -R "$ROOT_DIR/tests/fixtures/sample_repo" "$bundle/sample_repo"

python3 - "$bundle/project-copy/sample/state/project.json" "$bundle/sample_repo" <<'PY'
import json
import sys
from pathlib import Path

project_json_path = Path(sys.argv[1])
repo_abs = sys.argv[2]
project_json = json.loads(project_json_path.read_text())
project_json["repo_paths"] = [repo_abs]
project_json_path.write_text(json.dumps(project_json, indent=2))
PY

python3 - "$bundle/env.json" "$MODEL" "$ts" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

out = sys.argv[1]
model = sys.argv[2]
run_id = sys.argv[3]
payload = {
    "started_at": datetime.now(timezone.utc).isoformat(),
    "MODEL": model,
    "CODEX_BIN": os.environ.get("CODEX_BIN", "codex"),
    "CLAUDE_BIN": os.environ.get("CLAUDE_BIN", "claude"),
    "run_id": run_id,
}
with open(out, "w", encoding="utf-8") as fh:
    fh.write(json.dumps(payload, indent=2))
PY

echo "[dry-run] bundle: $bundle"
echo "[dry-run] MODEL: $MODEL"
echo "[dry-run] starting pipeline..."

set +e
MODEL="$MODEL" \
UPDATE_PROJECTS_ROOT="$bundle/project-copy" \
UPDATE_ARTIFACTS_ROOT="$bundle/artifacts" \
AUTO=1 \
make -C "$ROOT_DIR" update-v2 PROJECT=sample \
  >"$bundle/stdout.log" 2>"$bundle/stderr.log"
exit_code=$?
set -e

echo "$exit_code" >"$bundle/exit-code"

python3 - "$bundle/env.json" <<'PY'
import json
import sys
from datetime import datetime, timezone

path = sys.argv[1]
data = json.loads(open(path, encoding="utf-8").read())
data["ended_at"] = datetime.now(timezone.utc).isoformat()
open(path, "w", encoding="utf-8").write(json.dumps(data, indent=2))
PY

echo "[dry-run] exit: $exit_code"
echo "[dry-run] stdout: $bundle/stdout.log"
echo "[dry-run] stderr: $bundle/stderr.log"
echo "[dry-run] wiki:   $bundle/project-copy/sample/wiki/"
if [[ "$exit_code" -ne 0 ]]; then
  echo "[dry-run] FAILED - tail of stderr:"
  tail -n 30 "$bundle/stderr.log" >&2
  exit "$exit_code"
fi
echo "[dry-run] OK"
