#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


sys.path.insert(0, str(_repo_root()))

from agents._shared import inbox_writer  # noqa: E402
from agents.query import query_engine, query_planner  # noqa: E402


_NUMBERED_QUESTION_RE = re.compile(r"^\s*(\d+)\.\s*(.*?)\s*$")
_COMMENT_RE = re.compile(r"\s*<!--(.*?)-->\s*$")
_EXPECTED_PAGE_RE = re.compile(r"(?:^|\|)\s*expected:\s*([^|]+?)\s*(?:$|\|)")
_TAG_RE = re.compile(r"^\[[^\]]+\]\s*(.*)$")
LOW_ROUTE_CONFIDENCE_THRESHOLD = 0.66


def _projects_root() -> Path:
    return Path(
        os.environ.get("PROJECTS_ROOT")
        or os.environ.get("UPDATE_PROJECTS_ROOT")
        or _repo_root() / "projects"
    )


def _registered_project_dirs(projects_root: Path) -> list[Path]:
    if not projects_root.is_dir():
        return []
    return sorted(
        path
        for path in projects_root.iterdir()
        if path.is_dir() and (path / "state" / "project.json").is_file()
    )


def _load_project_config(project_dir: Path) -> dict[str, Any]:
    return query_engine._load_json(project_dir / "state" / "project.json", default={})


def _acceptance_questions_path(project_dir: Path) -> Path:
    project_config = _load_project_config(project_dir)
    relative = str(project_config.get("acceptance_questions_path") or "acceptance-questions.md")
    return project_dir / relative


def _missing_metadata_products(project_dir: Path) -> list[str]:
    required = ("page-metadata.json", "tag-index.json", "alias-index.json", "relationships.json")
    return [name for name in required if not (project_dir / "state" / name).is_file()]


def _strip_question_markup(value: str) -> str:
    text = _COMMENT_RE.sub("", value).strip()
    tag_match = _TAG_RE.match(text)
    if tag_match:
        text = tag_match.group(1).strip()
    return text


def _question_tag(value: str) -> str | None:
    text = _COMMENT_RE.sub("", value).strip()
    tag_match = _TAG_RE.match(text)
    if not tag_match:
        return None
    return tag_match.group(1).strip() or None


def _expected_page(value: str) -> str | None:
    comment_match = _COMMENT_RE.search(value)
    if not comment_match:
        return None
    expected_match = _EXPECTED_PAGE_RE.search(comment_match.group(1))
    if not expected_match:
        return None
    expected = expected_match.group(1).strip()
    return expected or None


def parse_acceptance_questions(markdown: str) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    for line in markdown.splitlines():
        match = _NUMBERED_QUESTION_RE.match(line)
        if not match:
            continue
        raw_question = match.group(2)
        question = _strip_question_markup(raw_question)
        if question:
            questions.append(
                {
                    "index": int(match.group(1)),
                    "question": question,
                    "question_tag": _question_tag(raw_question),
                    "expected_page": _expected_page(raw_question),
                }
            )
    return questions


def _question_measurement(
    *,
    project_key: str,
    project_dir: Path,
    question_item: dict[str, Any],
    catalog: list[dict[str, Any]],
    ranking_snapshot: dict[str, Any],
) -> dict[str, Any]:
    question = str(question_item["question"])
    expected_page = question_item.get("expected_page")
    route_plan = query_planner.plan_query(
        project_key=project_key,
        question=question,
        project_dir=project_dir,
        catalog=catalog,
        ranking_snapshot=ranking_snapshot,
    )
    router_prompt = query_engine._router_prompt(
        question=question,
        route_plan=route_plan,
        ranking_snapshot=ranking_snapshot,
    )
    selected_pages = [
        str(page.get("path"))
        for page in route_plan.get("selected_pages", [])
        if isinstance(page, dict) and page.get("path")
    ]
    freshness_warnings = [
        warning
        for warning in route_plan.get("freshness_warnings", [])
        if isinstance(warning, dict)
    ]
    expected_page_selected = None
    if expected_page is not None:
        expected_page_selected = str(expected_page) in selected_pages

    return {
        "question": question,
        "route_confidence": float(route_plan.get("route_confidence", 0.0)),
        "route_reason": str(route_plan.get("route_reason", "")),
        "selected_pages": selected_pages,
        "expected_page": expected_page,
        "expected_page_selected": expected_page_selected,
        "freshness_warning_count": len(freshness_warnings),
        "metadata_available": bool(route_plan.get("debug", {}).get("metadata_available")),
        "router_prompt_chars": len(router_prompt),
    }


def _summary(questions: list[dict[str, Any]]) -> dict[str, Any]:
    total_confidence = sum(float(item.get("route_confidence", 0.0)) for item in questions)
    expected_page_count = sum(1 for item in questions if item.get("expected_page") is not None)
    expected_page_hit_count = sum(1 for item in questions if item.get("expected_page_selected") is True)
    return {
        "average_route_confidence": round(total_confidence / len(questions), 4) if questions else 0.0,
        "low_confidence_count": sum(1 for item in questions if float(item.get("route_confidence", 0.0)) < 0.66),
        "freshness_warning_count": sum(int(item.get("freshness_warning_count", 0)) for item in questions),
        "expected_page_count": expected_page_count,
        "expected_page_hit_count": expected_page_hit_count,
        "expected_page_hit_ratio": round(expected_page_hit_count / expected_page_count, 4) if expected_page_count else 0.0,
    }


def _failure_reasons(item: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if float(item.get("route_confidence", 0.0)) < LOW_ROUTE_CONFIDENCE_THRESHOLD:
        reasons.append("low_route_confidence")
    if item.get("expected_page") is not None and item.get("expected_page_selected") is False:
        reasons.append("expected_page_not_selected")
    return reasons


def _target_hint(item: dict[str, Any]) -> str:
    if item.get("expected_page"):
        return str(item["expected_page"])
    selected_pages = item.get("selected_pages", [])
    if isinstance(selected_pages, list) and selected_pages:
        return str(selected_pages[0])
    return "index.md"


def _operator_notes(item: dict[str, Any], failure_reasons: list[str]) -> str:
    return json.dumps(
        {
            "failure_reasons": failure_reasons,
            "route_confidence": item["route_confidence"],
            "route_reason": item["route_reason"],
            "expected_page": item["expected_page"],
            "expected_page_selected": item["expected_page_selected"],
            "selected_pages": item["selected_pages"],
            "freshness_warning_count": item["freshness_warning_count"],
            "metadata_available": item["metadata_available"],
            "router_prompt_chars": item["router_prompt_chars"],
        },
        sort_keys=True,
    )


def _emit_route_gaps(
    *,
    project_dir: Path,
    measured_questions: list[dict[str, Any]],
    question_items: list[dict[str, Any]],
    measurement_run_id: str,
    no_emit: bool,
) -> int:
    if no_emit:
        return 0

    emitted_count = 0
    for item, question_item in zip(measured_questions, question_items):
        failure_reasons = _failure_reasons(item)
        if not failure_reasons:
            continue
        inbox_writer.write_gap(
            project_dir,
            source="measure-auto",
            question=item["question"],
            target_hint=_target_hint(item),
            confidence=item["route_confidence"],
            pages_read=item["selected_pages"],
            expected_page=item["expected_page"],
            measurement_run_id=measurement_run_id,
            question_index=question_item.get("index"),
            question_tag=question_item.get("question_tag"),
            operator_notes=_operator_notes(item, failure_reasons),
        )
        emitted_count += 1
    return emitted_count


def _markdown_table(report: dict[str, Any]) -> str:
    def cell(value: object) -> str:
        return str(value).replace("\n", " ").replace("|", "\\|")

    lines = [
        f"# Route measurement - {report['project_key']}",
        "",
        f"Generated at: {report['generated_at']}",
        "",
        "| Question | Route Confidence | Selected Pages | Expected Page | Expected Hit | Freshness Warnings | Route Reason |",
        "| --- | ---: | --- | --- | --- | ---: | --- |",
    ]
    for item in report["questions"]:
        expected_hit = "-"
        if item["expected_page_selected"] is True:
            expected_hit = "yes"
        elif item["expected_page_selected"] is False:
            expected_hit = "no"
        lines.append(
            "| "
            + " | ".join(
                [
                    cell(item["question"]),
                    f"{float(item['route_confidence']):.2f}",
                    cell(", ".join(item["selected_pages"]) or "-"),
                    cell(item["expected_page"] or "-"),
                    expected_hit,
                    str(item["freshness_warning_count"]),
                    cell(item["route_reason"]),
                ]
            )
            + " |"
        )
    lines.extend(
        [
            "",
            "## Summary",
            "",
            f"- Questions: {report['question_count']}",
            f"- Average route confidence: {report['summary']['average_route_confidence']:.2f}",
            f"- Low confidence routes: {report['summary']['low_confidence_count']}",
            f"- Freshness warnings: {report['summary']['freshness_warning_count']}",
            f"- Expected page hits: {report['summary']['expected_page_hit_count']} / {report['summary']['expected_page_count']}",
            f"- Emitted gap notes: {report['summary']['emitted_gap_count']}",
            f"- Emission suppressed: {'yes' if report['summary']['no_emit'] else 'no'}",
        ]
    )
    return "\n".join(lines) + "\n"


def measure_routes(*, project_key: str, projects_root: Path | None = None) -> dict[str, Any]:
    root = projects_root or _projects_root()
    project_dir = root / project_key
    if not project_dir.is_dir():
        raise FileNotFoundError(f"project not found: {project_dir}")

    aq_path = _acceptance_questions_path(project_dir)
    if not aq_path.is_file():
        raise FileNotFoundError(f"acceptance-questions file not found: {aq_path}")

    questions = parse_acceptance_questions(aq_path.read_text(encoding="utf-8"))
    catalog = query_engine._catalog_pages(project_dir)
    ranking_snapshot = query_engine._load_json(
        project_dir / "state" / "latest" / "ranking-snapshot.json",
        default={"ranked_domains": []},
    )
    measured_questions = [
        _question_measurement(
            project_key=project_key,
            project_dir=project_dir,
            question_item=question,
            catalog=catalog,
            ranking_snapshot=ranking_snapshot,
        )
        for question in questions
    ]
    no_emit = os.environ.get("NO_EMIT") == "1"
    measurement_run_id = datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
    emitted_gap_count = _emit_route_gaps(
        project_dir=project_dir,
        measured_questions=measured_questions,
        question_items=questions,
        measurement_run_id=measurement_run_id,
        no_emit=no_emit,
    )
    summary = _summary(measured_questions)
    summary["emitted_gap_count"] = emitted_gap_count
    summary["no_emit"] = no_emit
    report = {
        "project_key": project_key,
        "question_count": len(measured_questions),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "questions": measured_questions,
        "summary": summary,
    }

    latest_dir = project_dir / "state" / "latest"
    latest_dir.mkdir(parents=True, exist_ok=True)
    (latest_dir / "route-measurement.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (latest_dir / "route-measurement.md").write_text(_markdown_table(report), encoding="utf-8")
    return report


def _project_summary_row(report: dict[str, Any]) -> dict[str, Any]:
    summary = report.get("summary") if isinstance(report.get("summary"), dict) else {}
    return {
        "project_key": report.get("project_key"),
        "status": "measured",
        "question_count": report.get("question_count", 0),
        "expected_page_hit_ratio": summary.get("expected_page_hit_ratio", 0.0),
        "average_route_confidence": summary.get("average_route_confidence", 0.0),
        "low_confidence_count": summary.get("low_confidence_count", 0),
        "emitted_gap_count": summary.get("emitted_gap_count", 0),
    }


def measure_all_routes(*, projects_root: Path | None = None) -> tuple[dict[str, Any], int]:
    root = projects_root or _projects_root()
    rows: list[dict[str, Any]] = []
    measured_count = 0
    skipped_count = 0
    failed_count = 0

    for project_dir in _registered_project_dirs(root):
        project_key = project_dir.name
        aq_path = _acceptance_questions_path(project_dir)
        if not aq_path.is_file():
            skipped_count += 1
            rows.append({
                "project_key": project_key,
                "status": "skipped",
                "reason": f"missing acceptance questions: {aq_path.relative_to(project_dir)}",
            })
            continue

        missing_metadata = _missing_metadata_products(project_dir)
        if missing_metadata:
            skipped_count += 1
            rows.append({
                "project_key": project_key,
                "status": "skipped",
                "reason": "missing metadata products: " + ", ".join(missing_metadata),
            })
            continue

        try:
            report = measure_routes(project_key=project_key, projects_root=root)
        except Exception as exc:  # noqa: BLE001 - all-mode should finish every project.
            failed_count += 1
            rows.append({
                "project_key": project_key,
                "status": "failed",
                "reason": str(exc),
            })
            continue

        measured_count += 1
        rows.append(_project_summary_row(report))

    payload = {
        "projects_root": str(root),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "project_count": len(rows),
            "measured_count": measured_count,
            "skipped_count": skipped_count,
            "failed_count": failed_count,
            "no_emit": os.environ.get("NO_EMIT") == "1",
        },
        "projects": rows,
    }
    return payload, 1 if failed_count else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure deterministic query planner routes for acceptance questions")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--project")
    group.add_argument("--all", action="store_true")
    parser.add_argument("--projects-root")
    args = parser.parse_args()

    projects_root = Path(args.projects_root) if args.projects_root else None
    if args.all:
        report, rc = measure_all_routes(projects_root=projects_root)
        print(json.dumps(report, indent=2))
        return rc

    report = measure_routes(
        project_key=args.project,
        projects_root=projects_root,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
