#!/usr/bin/env bash
# Acceptance-question regression measurement.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="${PROJECTS_ROOT:-$ROOT_DIR/projects}"

die() { echo "error: $*" >&2; exit 1; }

project_key=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    -h|--help) echo "Usage: scripts/measure.sh --project <key>"; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
project_dir="$PROJECTS_ROOT/$project_key"
[[ -d "$project_dir" ]] || die "project not found: $project_dir"
aq_path="$project_dir/$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('acceptance_questions_path', 'acceptance-questions.md'))" "$project_dir/state/project.json")"
[[ -f "$aq_path" ]] || die "acceptance-questions file not found: $aq_path"
[[ -d "$project_dir/wiki" ]] || die "no wiki to measure; run make update first"
find "$project_dir/wiki" -name '*.md' -print -quit | grep -q . || die "no wiki pages to measure; run make update first"

python3 - "$project_key" "$project_dir" "$aq_path" "$ROOT_DIR" <<'PY'
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
aq_path = Path(sys.argv[3])
root_dir = Path(sys.argv[4])

sys.path.insert(0, str(root_dir))
from agents.update._shared import llm_client

aq_text = aq_path.read_text()
version_match = re.search(r"<!-- version:\s*([^\s>]+)\s*-->", aq_text)
version = version_match.group(1) if version_match else "unversioned"

questions = []
for line in aq_text.splitlines():
    match = re.match(r"^(\d+)\.\s*(.*)$", line.strip())
    if match:
        questions.append({"index": int(match.group(1)), "text": match.group(2)})

wiki_chunks = []
index_path = project_dir / "index.md"
if index_path.is_file():
    wiki_chunks.append(f"=== index.md ===\n{index_path.read_text()}")
for page in sorted((project_dir / "wiki").rglob("*.md")):
    wiki_chunks.append(f"=== {page.relative_to(project_dir)} ===\n{page.read_text()}")
wiki_concat = "\n\n".join(wiki_chunks)
if len(wiki_concat) > 50000:
    wiki_concat = wiki_concat[:50000] + "\n... [truncated]"

total_questions = len(questions)
print(
    f"measure: scoring {total_questions} question(s) against "
    f"{len(wiki_chunks)} wiki chunk(s) ({len(wiki_concat)} chars)",
    file=sys.stderr,
    flush=True,
)

per_question = []
wall_start = time.time()
for pos, question in enumerate(questions, start=1):
    stage_id = f"measure.q{question['index']}"
    preview = question["text"][:72] + ("..." if len(question["text"]) > 72 else "")
    print(
        f"  [{pos}/{total_questions}] Q{question['index']}: {preview}",
        file=sys.stderr,
        flush=True,
    )
    q_start = time.time()
    prompt = json.dumps({"question": question["text"], "wiki": wiki_concat})
    try:
        result = llm_client.invoke(stage_id=stage_id, prompt=prompt)
        response = result["response"]
        score = response.get("score", 0)
        per_question.append(
            {
                "index": question["index"],
                "question": question["text"],
                "score": score,
                "answer": response.get("answer", ""),
                "citations": response.get("citations", []),
                "reasoning": response.get("reasoning", ""),
                "tokens_consumed": result.get("tokens_consumed", {}),
            }
        )
        elapsed = time.time() - q_start
        running = sum(item.get("score") or 0 for item in per_question)
        running_max = 2 * len(per_question)
        print(
            f"  [{pos}/{total_questions}] -> score={score}/2 "
            f"({elapsed:.1f}s, running {running}/{running_max})",
            file=sys.stderr,
            flush=True,
        )
    except (FileNotFoundError, RuntimeError) as exc:
        per_question.append(
            {
                "index": question["index"],
                "question": question["text"],
                "score": 0,
                "answer": f"(measurement error: {exc})",
                "citations": [],
                "reasoning": "error",
                "tokens_consumed": {},
            }
        )
        elapsed = time.time() - q_start
        print(
            f"  [{pos}/{total_questions}] -> ERROR ({elapsed:.1f}s): {exc}",
            file=sys.stderr,
            flush=True,
        )

wall_elapsed = time.time() - wall_start
print(
    f"measure: {total_questions} question(s) scored in {wall_elapsed:.1f}s "
    f"({wall_elapsed / max(total_questions, 1):.1f}s avg)",
    file=sys.stderr,
    flush=True,
)

total = sum(item.get("score") or 0 for item in per_question)
max_possible = 2 * len(per_question)
report = {
    "project": project_key,
    "measured_at": datetime.now(timezone.utc).isoformat(),
    "question_set_version": version,
    "acceptance_scores": {
        "per_question": per_question,
        "total_score": total,
        "max_possible": max_possible,
    },
    "token_calibration": None,
}

latest = project_dir / "state" / "latest"
latest.mkdir(parents=True, exist_ok=True)
(latest / "measurement-report.json").write_text(json.dumps(report, indent=2) + "\n")

lines = [
    f"# Measurement report - {project_key}",
    "",
    f"Measured at: {report['measured_at']} | Question set: {version}",
    "",
    f"Total: {total} / {max_possible}",
    "",
    "## Per-question",
    "",
]
for item in per_question:
    lines.append(f"### Q{item['index']} - score {item['score']}")
    lines.append(item["answer"])
    if item.get("citations"):
        lines.append(f"Citations: {', '.join(item['citations'])}")
    if item.get("reasoning"):
        lines.append(f"Reasoning: {item['reasoning']}")
    lines.append("")
lines.append("## Token calibration")
lines.append("")
lines.append("- (run `make measure-tokens` for calibration data)")
(latest / "measurement-report.md").write_text("\n".join(lines) + "\n")

print(f"measure: {total}/{max_possible} over {len(per_question)} question(s)")
PY
