#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


sys.path.insert(0, str(_repo_root()))

from agents.query import query_engine, query_planner  # noqa: E402


def _projects_root() -> Path:
    return Path(
        os.environ.get("PROJECTS_ROOT")
        or os.environ.get("UPDATE_PROJECTS_ROOT")
        or _repo_root() / "projects"
    )


def _legacy_router_prompt(
    *,
    question: str,
    catalog: list[dict[str, Any]],
    index_text: str,
    ranking_snapshot: dict[str, Any],
) -> str:
    return json.dumps(
        {
            "question": question,
            "catalog": [
                {
                    "path": page.get("path"),
                    "type": page.get("type"),
                    "summary": page.get("summary", ""),
                    "linked_topics": page.get("linked_topics", []),
                }
                for page in catalog
            ],
            "index_md": index_text,
            "ranking_snapshot": ranking_snapshot,
            "page_limit": 5,
        }
    )


def measure_route(
    *,
    project_key: str,
    task: str,
    projects_root: Path | None = None,
) -> dict[str, Any]:
    root = projects_root or _projects_root()
    project_dir = root / project_key
    if not project_dir.is_dir():
        raise FileNotFoundError(f"project not found: {project_dir}")

    catalog = query_engine._catalog_pages(project_dir)
    ranking_snapshot = query_engine._load_json(
        project_dir / "state" / "latest" / "ranking-snapshot.json",
        default={"ranked_domains": []},
    )
    route_plan = query_planner.plan_query(
        project_key=project_key,
        question=task,
        project_dir=project_dir,
        catalog=catalog,
        ranking_snapshot=ranking_snapshot,
    )
    current_prompt = query_engine._router_prompt(
        question=task,
        route_plan=route_plan,
        ranking_snapshot=ranking_snapshot,
    )
    index_text = (project_dir / "index.md").read_text(encoding="utf-8") if (project_dir / "index.md").is_file() else ""
    legacy_prompt = _legacy_router_prompt(
        question=task,
        catalog=catalog,
        index_text=index_text,
        ranking_snapshot=ranking_snapshot,
    )
    current_chars = len(current_prompt)
    legacy_chars = len(legacy_prompt)
    savings = legacy_chars - current_chars
    selected_pages = route_plan.get("selected_pages", [])
    if not isinstance(selected_pages, list):
        selected_pages = []

    return {
        "project_key": project_key,
        "task": task,
        "catalog_page_count": len(catalog),
        "planner_candidate_count": len(route_plan.get("candidate_pages", [])),
        "selected_page_count": len(selected_pages),
        "selected_pages": selected_pages,
        "route_confidence": route_plan.get("route_confidence", 0.0),
        "route_reason": route_plan.get("route_reason", ""),
        "freshness_warning_count": len(route_plan.get("freshness_warnings", [])),
        "metadata_available": bool(route_plan.get("debug", {}).get("metadata_available")),
        "current_router_prompt_chars": current_chars,
        "legacy_router_prompt_chars": legacy_chars,
        "estimated_router_prompt_savings_chars": savings,
        "estimated_router_prompt_savings_ratio": round(savings / legacy_chars, 4) if legacy_chars else 0.0,
        "page_bodies_loaded_count": 0,
        "would_read_pages": [
            str(page.get("path"))
            for page in selected_pages
            if isinstance(page, dict) and page.get("path")
        ],
        "estimate_notes": [
            "current_router_prompt_chars uses the metadata-aware query_engine router prompt",
            "legacy_router_prompt_chars estimates the former broad catalog plus index prompt shape",
            "no LLM calls are made and no page bodies are read",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure metadata-aware query route context size")
    parser.add_argument("--project", required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--projects-root")
    args = parser.parse_args()

    result = measure_route(
        project_key=args.project,
        task=args.task,
        projects_root=Path(args.projects_root) if args.projects_root else None,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
