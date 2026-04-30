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

from agents.query import query_engine, query_planner  # noqa: E402


_NUMBERED_QUESTION_RE = re.compile(r"^\s*(\d+)\.\s*(.*?)\s*$")
_COMMENT_RE = re.compile(r"\s*<!--(.*?)-->\s*$")
_EXPECTED_PAGE_RE = re.compile(r"(?:^|\|)\s*expected:\s*([^|]+?)\s*(?:$|\|)")
_TAG_RE = re.compile(r"^\[[^\]]+\]\s*(.*)$")


def _projects_root() -> Path:
    return Path(
        os.environ.get("PROJECTS_ROOT")
        or os.environ.get("UPDATE_PROJECTS_ROOT")
        or _repo_root() / "projects"
    )


def _load_project_config(project_dir: Path) -> dict[str, Any]:
    return query_engine._load_json(project_dir / "state" / "project.json", default={})


def _acceptance_questions_path(project_dir: Path) -> Path:
    project_config = _load_project_config(project_dir)
    relative = str(project_config.get("acceptance_questions_path") or "acceptance-questions.md")
    return project_dir / relative


def _strip_question_markup(value: str) -> str:
    text = _COMMENT_RE.sub("", value).strip()
    tag_match = _TAG_RE.match(text)
    if tag_match:
        text = tag_match.group(1).strip()
    return text


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
                    "question": question,
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
    report = {
        "project_key": project_key,
        "question_count": len(measured_questions),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "questions": measured_questions,
        "summary": _summary(measured_questions),
    }

    latest_dir = project_dir / "state" / "latest"
    latest_dir.mkdir(parents=True, exist_ok=True)
    (latest_dir / "route-measurement.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (latest_dir / "route-measurement.md").write_text(_markdown_table(report), encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure deterministic query planner routes for acceptance questions")
    parser.add_argument("--project", required=True)
    parser.add_argument("--projects-root")
    args = parser.parse_args()

    report = measure_routes(
        project_key=args.project,
        projects_root=Path(args.projects_root) if args.projects_root else None,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
