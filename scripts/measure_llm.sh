#!/usr/bin/env bash
# Acceptance-question regression measurement via the query engine.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="${PROJECTS_ROOT:-${UPDATE_PROJECTS_ROOT:-$ROOT_DIR/projects}}"

die() { echo "error: $*" >&2; exit 1; }

project_key=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    -h|--help) echo "Usage: scripts/measure_llm.sh --project <key>"; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
project_dir="$PROJECTS_ROOT/$project_key"
[[ -d "$project_dir" ]] || die "project not found: $project_dir"
aq_path="$project_dir/$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('acceptance_questions_path', 'acceptance-questions.md'))" "$project_dir/state/project.json")"
[[ -f "$aq_path" ]] || die "acceptance-questions file not found: $aq_path"
[[ -d "$project_dir/wiki" ]] || die "no wiki to measure; run make compile first"
find "$project_dir/wiki" -name '*.md' -print -quit | grep -q . || die "no wiki pages to measure; run make compile first"

python3 - "$project_key" "$project_dir" "$aq_path" "$ROOT_DIR" "$PROJECTS_ROOT" <<'PY'
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
aq_path = Path(sys.argv[3])
root_dir = Path(sys.argv[4])
projects_root = Path(sys.argv[5])

sys.path.insert(0, str(root_dir))
from agents._shared import inbox_writer
from agents.query import query_engine


def score_from_confidence(confidence: float) -> int:
    if confidence >= 0.9:
        return 2
    if confidence >= 0.5:
        return 1
    return 0


def parse_question(line: str) -> dict | None:
    match = re.match(r"^(\d+)\.\s*(.*)$", line.strip())
    if not match:
        return None
    raw_text = match.group(2).strip()
    metadata = {}
    comment_match = re.search(r"\s*<!--\s*(.*?)\s*-->\s*$", raw_text)
    if comment_match:
        for chunk in comment_match.group(1).split("|"):
            chunk = chunk.strip()
            if ":" not in chunk:
                continue
            key, value = chunk.split(":", 1)
            metadata[key.strip()] = value.strip()
        raw_text = raw_text[:comment_match.start()].rstrip()

    tag_match = re.match(r"^\[([^\]]+)\]\s*(.*)$", raw_text)
    question_tag = None
    if tag_match:
        question_tag = tag_match.group(1)

    return {
        "index": int(match.group(1)),
        "text": raw_text,
        "question_tag": question_tag,
        "expected_page": metadata.get("expected"),
    }


aq_text = aq_path.read_text()
version_match = re.search(r"<!-- version:\s*([^\s>]+)\s*-->", aq_text)
version = version_match.group(1) if version_match else "unversioned"

questions = []
for line in aq_text.splitlines():
    parsed = parse_question(line)
    if parsed:
        questions.append(parsed)

pages_considered = len(json.loads((project_dir / "state" / "pages.json").read_text()).get("pages", []))
print(
    f"measure: scoring {len(questions)} question(s) against {pages_considered} catalog page(s)",
    file=sys.stderr,
    flush=True,
)

per_question = []
emitted_gap_count = 0
gap_emission_suppressed = os.environ.get("NO_EMIT") == "1"
measurement_run_id = datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
wall_start = time.time()
for pos, question in enumerate(questions, start=1):
    preview = question["text"][:72] + ("..." if len(question["text"]) > 72 else "")
    print(
        f"  [{pos}/{len(questions)}] Q{question['index']}: {preview}",
        file=sys.stderr,
        flush=True,
    )
    q_start = time.time()
    try:
        result = query_engine.query(project_key, question["text"], projects_root=projects_root)
        score = score_from_confidence(float(result.get("confidence", 0.0)))
        per_question.append(
            {
                "index": question["index"],
                "question": question["text"],
                "score": score,
                "answer": result.get("answer", ""),
                "citations": result.get("citations", []),
                "reasoning": "",
                "confidence": result.get("confidence", 0.0),
                "pages_read": result.get("pages_read", []),
                "tokens_consumed": result.get("tokens_consumed", {}),
            }
        )
        if not gap_emission_suppressed and score < 2:
            inbox_writer.write_gap(
                project_dir,
                source="measure-auto",
                question=question["text"],
                target_hint=question.get("expected_page") or "",
                question_index=question["index"],
                question_tag=question.get("question_tag"),
                score_awarded=score,
                score_max=2,
                expected_page=question.get("expected_page"),
                measurement_run_id=measurement_run_id,
            )
            emitted_gap_count += 1
        elapsed = time.time() - q_start
        running = sum(item.get("score") or 0 for item in per_question)
        running_max = 2 * len(per_question)
        print(
            f"  [{pos}/{len(questions)}] -> score={score}/2 "
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
                "confidence": 0.0,
                "pages_read": [],
                "tokens_consumed": {},
            }
        )
        elapsed = time.time() - q_start
        print(
            f"  [{pos}/{len(questions)}] -> ERROR ({elapsed:.1f}s): {exc}",
            file=sys.stderr,
            flush=True,
        )

wall_elapsed = time.time() - wall_start
print(
    f"measure: {len(questions)} question(s) scored in {wall_elapsed:.1f}s "
    f"({wall_elapsed / max(len(questions), 1):.1f}s avg)",
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
    lines.append(f"Confidence: {item.get('confidence', 0.0):.2f}")
    if item.get("pages_read"):
        lines.append(f"Pages read: {', '.join(item['pages_read'])}")
    lines.append("")
lines.append("## Token calibration")
lines.append("")
lines.append("- (run `make measure-tokens` for calibration data)")
(latest / "measurement-report.md").write_text("\n".join(lines) + "\n")

print(f"measure: {total}/{max_possible} over {len(per_question)} question(s)")
if gap_emission_suppressed:
    print("measure: gap emission suppressed (NO_EMIT=1)")
else:
    print(f"measure: emitted {emitted_gap_count} gap-note(s) to projects/{project_key}/inbox/")
PY
