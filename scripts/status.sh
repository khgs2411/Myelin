#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/status.sh --project <project-key> [--project-dir <abs-path>]
  scripts/status.sh --all
EOF
}

mode=""
project_key=""
project_dir_override=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      shift
      [[ $# -gt 0 ]] || { echo "error: --project requires a value" >&2; exit 1; }
      mode="project"
      project_key="$1"
      shift
      ;;
    --project-dir)
      shift
      [[ $# -gt 0 ]] || { echo "error: --project-dir requires a value" >&2; exit 1; }
      project_dir_override="$1"
      shift
      ;;
    --all)
      mode="all"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

[[ -n "$mode" ]] || { usage >&2; exit 1; }

python3 - "$ROOT_DIR" "$mode" "$project_key" "$project_dir_override" <<'PY'
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

root_dir = Path(sys.argv[1]).resolve()
mode = sys.argv[2]
project_key = sys.argv[3]
project_dir_override = sys.argv[4]


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def load_pipeline_state(project_dir: Path) -> dict:
    v2_path = project_dir / "state" / "update-state.json"
    if v2_path.is_file():
        return load_json(v2_path)
    v1_path = project_dir / "state" / "bootstrap-state.json"
    if v1_path.is_file():
        print(f"warning: {project_dir.name} not yet migrated to v2 state", file=sys.stderr)
        return load_json(v1_path)
    return {}


def status_view(project_dir: Path) -> dict:
    project = load_json(project_dir / "state" / "project.json")
    bootstrap = load_pipeline_state(project_dir)
    freshness = load_json(project_dir / "state" / "freshness.json")
    validation = load_json(project_dir / "state" / "latest" / "validation-findings.json")
    ingest = load_json(project_dir / "state" / "latest" / "ingest-findings.json")
    route_measurement = load_json(project_dir / "state" / "latest" / "route-measurement.json")
    run_profile = load_json(project_dir / "state" / "latest" / "run-profile.json")
    last_stage = bootstrap.get("last_completed_stage")
    last_stage_data = (bootstrap.get("stages") or {}).get(last_stage or "", {}) if last_stage else {}
    return {
        "project": project,
        "bootstrap": bootstrap,
        "freshness": freshness,
        "validation": validation,
        "ingest": ingest,
        "route_measurement": route_measurement,
        "run_profile": run_profile,
        "last_stage_timestamp": last_stage_data.get("last_completed_at"),
        "project_dir": project_dir,
    }


def scalar(value: object, fallback: str = "none") -> str:
    if value is None:
        return fallback
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value)
    return text if text else fallback


def pluralize(count: int, singular: str, plural: str | None = None) -> str:
    if count == 1:
        return singular
    return plural or f"{singular}s"


def clip_text(text: str, limit: int = 140) -> str:
    stripped = " ".join(text.split())
    if len(stripped) <= limit:
        return stripped
    return stripped[: limit - 1].rstrip() + "…"


def shorten_commit(commit: object) -> str:
    text = scalar(commit)
    return text[:8] if text != "none" else text


def parse_iso_timestamp(raw: str) -> datetime | None:
    value = raw.strip()
    if not value:
        return None
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_filename_timestamp(name: str) -> datetime | None:
    stem = name.split("_", 1)[0]
    if "T" not in stem:
        return None
    date_part, time_part = stem.split("T", 1)
    time_part = time_part.rstrip("Z")
    time_pieces = time_part.split("-")
    if len(time_pieces) != 3:
        return None
    return parse_iso_timestamp(f"{date_part}T{':'.join(time_pieces)}+00:00")


def display_timezone():
    tz_name = os.environ.get("TZ")
    if tz_name:
        try:
            return ZoneInfo(tz_name)
        except ZoneInfoNotFoundError:
            pass
    return datetime.now().astimezone().tzinfo or timezone.utc


def format_timestamp(raw: object) -> str:
    if raw is None:
        return "unknown"
    parsed = parse_iso_timestamp(str(raw))
    if parsed is None:
        return scalar(raw)
    local_value = parsed.astimezone(display_timezone())
    return local_value.strftime("%Y-%m-%d %H:%M %Z")


def summarize_inbox(project_dir: Path) -> dict:
    inbox_dir = project_dir / "inbox"
    pending_items = sorted(
        path for path in inbox_dir.glob("*.json")
        if path.is_file()
    )
    processed_dir = inbox_dir / "processed"
    processed_count = 0
    if processed_dir.is_dir():
        processed_count = sum(1 for path in processed_dir.glob("*.json") if path.is_file())
    oldest_pending = None
    if pending_items:
        oldest_pending = parse_filename_timestamp(pending_items[0].name)
    return {
        "pending_count": len(pending_items),
        "processed_count": processed_count,
        "oldest_pending": oldest_pending,
    }


def collect_findings(findings_doc: dict) -> list[dict]:
    findings: list[dict] = []
    for key in ("structural", "semantic"):
        value = findings_doc.get(key)
        if isinstance(value, list):
            findings.extend(item for item in value if isinstance(item, dict))
    return findings


def concise_finding_detail(finding: dict) -> str:
    category = scalar(finding.get("category"), "").strip().lower()
    pages = finding.get("pages") or []
    if category == "stale" and pages == ["index.md"]:
        return "index status metadata is behind the latest reviewed commit"
    if category and pages:
        page_list = ", ".join(str(page) for page in pages[:2])
        if len(pages) > 2:
            page_list += ", …"
        return f"{category} on {page_list}"
    if category:
        return category
    return clip_text(scalar(finding.get("evidence"), ""))


def validation_summary(validation: dict) -> dict:
    findings = collect_findings(validation)
    warning_count = sum(1 for item in findings if scalar(item.get("severity")) in {"warn", "warning"})
    blocker_count = sum(1 for item in findings if scalar(item.get("severity")) in {"blocker", "error", "fail"})
    total_count = len(findings)
    status = scalar(validation.get("status"))
    summary = status
    if status == "fail" and total_count:
        summary = f"fail with {total_count} {pluralize(total_count, 'finding')}"
    elif warning_count:
        summary = f"{status} with {warning_count} {pluralize(warning_count, 'warning')}"
    elif total_count:
        summary = f"{status} with {total_count} {pluralize(total_count, 'finding')}"
    detail = ""
    suggested_action = ""
    operator_explanation = ""
    category = ""
    if findings:
        detail = concise_finding_detail(findings[0])
        suggested_action = scalar(findings[0].get("suggested_action"), "")
        first = findings[0]
        category = scalar(first.get("category"), "").strip().lower()
        if category == "stale" and (first.get("pages") or []) == ["index.md"]:
            operator_explanation = (
                "the wiki passed validation, but the status block in index.md still points at an older reviewed commit."
            )
    return {
        "status": status,
        "summary": summary,
        "detail": detail,
        "suggested_action": suggested_action,
        "operator_explanation": operator_explanation,
        "category": category,
        "warning_count": warning_count,
        "blocker_count": blocker_count,
        "total_count": total_count,
    }


def route_health_summary(route_measurement: dict) -> dict:
    if not isinstance(route_measurement, dict) or not route_measurement:
        return {"available": False}
    summary = route_measurement.get("summary")
    if not isinstance(summary, dict):
        return {"available": False}

    def int_value(value: object) -> int | None:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def float_value(value: object) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    question_count = int_value(route_measurement.get("question_count"))
    expected_page_count = int_value(summary.get("expected_page_count"))
    expected_page_hit_count = int_value(summary.get("expected_page_hit_count"))
    low_confidence_count = int_value(summary.get("low_confidence_count"))
    emitted_gap_count = int_value(summary.get("emitted_gap_count"))
    average_route_confidence = float_value(summary.get("average_route_confidence"))
    if None in {
        question_count,
        expected_page_count,
        expected_page_hit_count,
        low_confidence_count,
        emitted_gap_count,
    } or average_route_confidence is None:
        return {"available": False}
    generated_at = scalar(route_measurement.get("generated_at"), "unknown")
    has_attention = (
        low_confidence_count > 0
        or emitted_gap_count > 0
        or (
            expected_page_count > 0
            and expected_page_hit_count < expected_page_count
        )
    )
    return {
        "available": True,
        "question_count": question_count,
        "expected_page_count": expected_page_count,
        "expected_page_hit_count": expected_page_hit_count,
        "low_confidence_count": low_confidence_count,
        "emitted_gap_count": emitted_gap_count,
        "average_route_confidence": average_route_confidence,
        "generated_at": generated_at,
        "has_attention": has_attention,
    }


def route_health_line(route_health: dict) -> str:
    low_count = route_health["low_confidence_count"]
    emitted_count = route_health["emitted_gap_count"]
    return (
        "Route health: "
        f"{route_health['expected_page_hit_count']}/{route_health['expected_page_count']} expected pages hit "
        f"across {route_health['question_count']} {pluralize(route_health['question_count'], 'question')}, "
        f"avg confidence {route_health['average_route_confidence']:.2f}, "
        f"{low_count} low-confidence {pluralize(low_count, 'route')}, "
        f"{emitted_count} emitted gap {pluralize(emitted_count, 'note')}, "
        f"measured {route_health['generated_at']}"
    )


def run_profile_summary(run_profile: dict) -> dict:
    if not isinstance(run_profile, dict) or not run_profile:
        return {"available": False}
    status = scalar(run_profile.get("status"))
    if status == "running":
        return {"available": False}
    if status not in {"completed", "failed", "awaiting-approval"} and not run_profile.get("completed_at"):
        return {"available": False}
    summary = run_profile.get("summary")
    if not isinstance(summary, dict):
        return {"available": False}

    def int_value(value: object) -> int | None:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def float_value(value: object) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    duration = float_value(run_profile.get("duration_seconds"))
    stage_count = int_value(summary.get("stage_count"))
    llm_stage_count = int_value(summary.get("llm_stage_count"))
    total_input_chars = int_value(summary.get("total_input_chars"))
    total_output_chars = int_value(summary.get("total_output_chars"))
    if None in {duration, stage_count, llm_stage_count, total_input_chars, total_output_chars}:
        return {"available": False}
    if stage_count == 0:
        return {"available": False}
    return {
        "available": True,
        "pipeline": scalar(run_profile.get("pipeline")),
        "status": status,
        "duration_seconds": duration,
        "stage_count": stage_count,
        "llm_stage_count": llm_stage_count,
        "total_input_chars": total_input_chars,
        "total_output_chars": total_output_chars,
        "slowest_stage": scalar(summary.get("slowest_stage"), "none"),
    }


def run_profile_line(profile_summary: dict) -> str:
    return (
        "Runtime: "
        f"{profile_summary['pipeline']} {profile_summary['status']} "
        f"in {profile_summary['duration_seconds']:g}s "
        f"across {profile_summary['stage_count']} {pluralize(profile_summary['stage_count'], 'stage')}, "
        f"{profile_summary['llm_stage_count']} LLM {pluralize(profile_summary['llm_stage_count'], 'stage')}, "
        f"{profile_summary['total_input_chars']} input chars, "
        f"{profile_summary['total_output_chars']} output chars, "
        f"slowest {profile_summary['slowest_stage']}"
    )


def latest_activity_summary(view: dict) -> str:
    bootstrap = view["bootstrap"]
    ingest = view["ingest"]
    parts: list[str] = []
    last_stage = bootstrap.get("last_completed_stage")
    last_stage_time = view.get("last_stage_timestamp")
    if last_stage and last_stage_time:
        parts.append(f"{last_stage} completed {format_timestamp(last_stage_time)}")
    elif last_stage:
        parts.append(f"{last_stage} completed at unknown time")

    ingest_time = ingest.get("updated_at")
    if ingest_time:
        ingest_text = f"last ingest {format_timestamp(ingest_time)}"
        unit_count = ingest.get("unit_count")
        if unit_count is not None:
            ingest_text += f" updated {unit_count} {pluralize(int(unit_count), 'unit')}"
        source_ids = [piece.strip() for piece in scalar(ingest.get("source_id"), "").split(",") if piece.strip()]
        source_kind = scalar(ingest.get("source_kind"), "")
        if source_ids and source_kind:
            ingest_text += f" from {len(source_ids)} {pluralize(len(source_ids), source_kind)}"
        parts.append(ingest_text)

    if not parts:
        return "none recorded"
    return "; ".join(parts)


def overall_summary(view: dict, inbox: dict, validation: dict) -> str:
    freshness = view["freshness"]
    issues: list[str] = []
    pending_count = inbox["pending_count"]
    if pending_count:
        issues.append(f"{pending_count} pending inbox {pluralize(pending_count, 'item')}")
    warning_count = validation["warning_count"]
    blocker_count = validation["blocker_count"]
    if blocker_count:
        issues.append(f"{blocker_count} validation {pluralize(blocker_count, 'blocker')}")
    elif warning_count:
        issues.append(f"{warning_count} validation {pluralize(warning_count, 'warning')}")
    impacted_count = len(freshness.get("impacted_pages") or [])
    if impacted_count:
        issues.append(f"{impacted_count} impacted {pluralize(impacted_count, 'page')}")
    if issues:
        return f"needs attention - {', '.join(issues)}"
    if scalar(freshness.get("status")) == "stale":
        return "stale"
    return "ready"


def path_hints(project_dir: Path, inbox: dict, validation: dict, freshness: dict) -> list[str]:
    latest_dir = project_dir / "state" / "latest"
    hints: list[str] = []
    wanted: list[tuple[str, str]] = []
    if validation["total_count"] or validation["status"] in {"fail", "pass"}:
        wanted.append(("validation report", "validation-report.md"))
    if inbox["pending_count"] or (latest_dir / "ingest-report.md").is_file():
        wanted.append(("ingest report", "ingest-report.md"))
    if len(freshness.get("impacted_pages") or []) > 0:
        wanted.append(("ranking snapshot", "ranking-snapshot.md"))
    route_health = route_health_summary(load_json(latest_dir / "route-measurement.json"))
    if route_health.get("available") and route_health.get("has_attention"):
        wanted.append(("route measurement", "route-measurement.md"))
    if not wanted:
        wanted.append(("measurement report", "measurement-report.md"))
    for label, filename in wanted:
        path = latest_dir / filename
        if path.is_file():
            hints.append(f"- {label}: {path}")
    return hints


def latest_run_used_self_correct(view: dict) -> bool:
    bootstrap = view["bootstrap"]
    latest_run_dir = scalar(bootstrap.get("latest_run_dir"), "")
    self_correct = (bootstrap.get("stages") or {}).get("self-correct", {})
    self_correct_run_dir = scalar(self_correct.get("last_run_dir"), "")
    return bool(latest_run_dir and self_correct_run_dir and latest_run_dir == self_correct_run_dir)


def todo_hints(view: dict, project_key: str, inbox: dict, validation: dict) -> list[str]:
    hints: list[str] = []
    curated_self_heal_categories = {"stale", "redundancy", "contradiction"}
    self_correct_exhausted = latest_run_used_self_correct(view) and validation["total_count"] > 0
    if inbox["pending_count"]:
        if validation["operator_explanation"]:
            hints.append(f"- What this means: {validation['operator_explanation']}")
        elif validation["total_count"]:
            hints.append("- What this means: the validation gate passed, but the wiki still has a maintenance warning to clear.")
        hints.append(f"- Next step: make update PROJECT={project_key}")
        if validation["total_count"]:
            hints.append(f"- If the warning remains after update: make compile PROJECT={project_key}")
    elif validation["total_count"]:
        if self_correct_exhausted:
            hints.append(
                "- What this means: the latest update already used one bounded self-correction pass, but this warning still needs manual review."
            )
            hints.append("- Review the validation report: use the path hint below for the full warning details.")
            if validation["suggested_action"]:
                hints.append(f"- Suggested fix: {validation['suggested_action']}")
        elif validation["operator_explanation"]:
            hints.append(f"- What this means: {validation['operator_explanation']}")
        else:
            hints.append("- What this means: the validation gate passed, but the wiki still has a maintenance warning to clear.")
        if not self_correct_exhausted and validation["category"] in curated_self_heal_categories:
            hints.append(f"- Next step: make update PROJECT={project_key}")
            hints.append(f"- If the warning remains after update: make compile PROJECT={project_key}")
        elif not self_correct_exhausted:
            hints.append("- Review the validation report: use the path hint below for the full warning details.")
            if validation["suggested_action"]:
                hints.append(f"- Suggested fix: {validation['suggested_action']}")
    return hints


def full_output(view: dict) -> str:
    project = view["project"]
    freshness = view["freshness"]
    project_dir = view["project_dir"]
    repo_paths = project.get("repo_paths") or []
    inbox = summarize_inbox(project_dir)
    validation = validation_summary(view["validation"])
    route_health = route_health_summary(view["route_measurement"])
    runtime = run_profile_summary(view["run_profile"])
    lines = [f"Project: {scalar(project.get('key'))} ({scalar(project.get('name'))})"]
    if repo_paths:
        lines.append(f"Primary repo: {repo_paths[0]}")
        if len(repo_paths) > 1:
            lines.append(f"Repo paths: {len(repo_paths)}")
    else:
        lines.append("Primary repo: none")

    lines.append(f"Overall: {overall_summary(view, inbox, validation)}")

    inbox_line = (
        f"Inbox: {inbox['pending_count']} pending, {inbox['processed_count']} processed"
    )
    if inbox["oldest_pending"] is not None:
        inbox_line += f"; oldest pending {inbox['oldest_pending'].astimezone(display_timezone()).strftime('%Y-%m-%d %H:%M %Z')}"
    lines.append(inbox_line)

    lines.append(f"Latest activity: {latest_activity_summary(view)}")

    validation_line = f"Validation: {validation['summary']}"
    if validation["detail"]:
        validation_line += f" - {validation['detail']}"
    lines.append(validation_line)
    if route_health.get("available"):
        lines.append(route_health_line(route_health))
    if runtime.get("available"):
        lines.append(run_profile_line(runtime))

    freshness_bits = [f"commit {shorten_commit(freshness.get('last_seen_commit'))}"]
    impacted_count = len(freshness.get("impacted_pages") or [])
    if impacted_count:
        freshness_bits.append(f"{impacted_count} impacted {pluralize(impacted_count, 'page')}")
    else:
        freshness_bits.append("clean")
    if freshness.get("repo_dirty"):
        freshness_bits.append("repo dirty")
    lines.append(f"Freshness: {', '.join(freshness_bits)}")

    todos = todo_hints(view, scalar(project.get("key")), inbox, validation)
    if todos:
        lines.append("Todo hints:")
        lines.extend(todos)

    hints = path_hints(project_dir, inbox, validation, freshness)
    if hints:
        lines.append("Path hints:")
        lines.extend(hints)

    return "\n".join(lines)


def one_line_output(view: dict) -> str:
    project = view["project"]
    bootstrap = view["bootstrap"]
    freshness = view["freshness"]
    ingest = view["ingest"]
    inbox = summarize_inbox(view["project_dir"])
    validation = validation_summary(view["validation"])
    return (
        f"{scalar(project.get('key'))} | "
        f"bootstrap={scalar(bootstrap.get('last_completed_stage'))}@{scalar(view.get('last_stage_timestamp'))} | "
        f"inbox={inbox['pending_count']} pending | "
        f"validation={validation['summary']} | "
        f"ingest={scalar(ingest.get('source'))}@{scalar(ingest.get('updated_at'))} | "
        f"freshness={scalar(freshness.get('last_seen_commit'))}/{len(freshness.get('impacted_pages') or [])}"
    )


if mode == "project":
    project_dir = Path(project_dir_override) if project_dir_override else root_dir / "projects" / project_key
    print(full_output(status_view(project_dir)))
    raise SystemExit(0)

project_dirs = sorted(path.parent.parent for path in (root_dir / "projects").glob("*/state/project.json"))
for project_dir in project_dirs:
    print(one_line_output(status_view(project_dir)))
PY
