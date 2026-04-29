from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from agents.query import query_planner
from agents.update._shared import llm_client


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _default_projects_root() -> Path:
    env_root = os.environ.get("UPDATE_PROJECTS_ROOT")
    if env_root:
        return Path(env_root)
    return _repo_root() / "projects"


def _resolve_weak_model() -> str:
    """Map the pipeline MODEL env to a weak-model variant for query ops."""
    backend = os.environ.get("MODEL", "codex")
    if backend.startswith("claude"):
        return "claude/claude-haiku-4-5"
    return "codex/gpt-5.4-mini"


def _load_json(path: Path, *, default: dict | None = None) -> dict:
    if path.is_file():
        return json.loads(path.read_text())
    if default is not None:
        return default
    raise FileNotFoundError(path)


def _resolve_project_dir(project_key: str, projects_root: Path | None) -> Path:
    return (projects_root or _default_projects_root()) / project_key


def _catalog_pages(project_dir: Path) -> list[dict[str, Any]]:
    data = _load_json(project_dir / "state" / "pages.json")
    pages = data.get("pages", [])
    if not isinstance(pages, list):
        raise RuntimeError("state/pages.json missing pages list")
    return pages


def _router_prompt(
    *,
    question: str,
    route_plan: dict[str, Any],
    ranking_snapshot: dict[str, Any],
) -> str:
    return json.dumps(
        {
            "question": question,
            "planner_candidates": route_plan.get("candidate_pages", []),
            "relationship_hints": route_plan.get("relationship_hops", []),
            "freshness_warnings": route_plan.get("freshness_warnings", []),
            "route_confidence": route_plan.get("route_confidence", 0.0),
            "route_reason": route_plan.get("route_reason", ""),
            "ranking_snapshot": ranking_snapshot,
            "page_limit": 5,
        }
    )


def _read_selected_pages(project_dir: Path, selected_paths: list[str]) -> list[dict[str, str]]:
    pages: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw_path in selected_paths[:5]:
        if not raw_path or raw_path in seen:
            continue
        seen.add(raw_path)
        page_path = project_dir / raw_path
        if not page_path.is_file():
            continue
        pages.append({"page_path": raw_path, "content": page_path.read_text()})
    return pages


def _synthesizer_prompt(
    *,
    question: str,
    selected_pages: list[dict[str, str]],
    route_plan: dict[str, Any],
) -> str:
    return json.dumps(
        {
            "question": question,
            "route_context": {
                "selected_pages": route_plan.get("selected_pages", []),
                "freshness_warnings": route_plan.get("freshness_warnings", []),
                "route_confidence": route_plan.get("route_confidence", 0.0),
            },
            "pages": selected_pages,
        }
    )


def _merge_tokens(*token_sets: dict[str, Any]) -> dict[str, Any]:
    return {
        "input_chars": sum(int(tokens.get("input_chars", 0)) for tokens in token_sets),
        "output_chars": sum(int(tokens.get("output_chars", 0)) for tokens in token_sets),
        "is_estimate": any(bool(tokens.get("is_estimate", True)) for tokens in token_sets),
    }


def query(
    project_key: str,
    question: str,
    *,
    projects_root: Path | None = None,
    raw: bool = False,
) -> dict:
    """Answer a question from a single project's wiki.

    When `raw=False` (default), runs router + synthesizer and returns a weak-model
    synthesized answer. When `raw=True`, runs router only and returns the raw
    markdown of selected pages under `pages_content`; `answer` is an empty string,
    `synthesizer_model` is None, and `confidence` comes from the router.
    """
    project_dir = _resolve_project_dir(project_key, projects_root)
    if not project_dir.is_dir():
        raise FileNotFoundError(f"project not found: {project_dir}")

    catalog = _catalog_pages(project_dir)
    ranking_snapshot = _load_json(
        project_dir / "state" / "latest" / "ranking-snapshot.json",
        default={"ranked_domains": []},
    )
    route_plan = query_planner.plan_query(
        project_key=project_key,
        question=question,
        project_dir=project_dir,
        catalog=catalog,
        ranking_snapshot=ranking_snapshot,
    )
    weak_model = _resolve_weak_model()

    router_result = llm_client.invoke(
        stage_id="query.router",
        prompt=_router_prompt(
            question=question,
            route_plan=route_plan,
            ranking_snapshot=ranking_snapshot,
        ),
        model_override=weak_model,
    )
    router_response = router_result["response"]
    selected_paths = router_response.get("pages", [])
    if not isinstance(selected_paths, list):
        selected_paths = []
    selected_pages = _read_selected_pages(project_dir, [str(path) for path in selected_paths])
    pages_read = [page["page_path"] for page in selected_pages]
    route_selected_by_path = {
        str(page.get("path")): page
        for page in route_plan.get("candidate_pages", [])
        if isinstance(page, dict)
    }
    route_selected_pages = [
        route_selected_by_path.get(
            path,
            {
                "path": path,
                "title": Path(path).stem.replace("-", " ").replace("_", " ").title(),
                "page_kind": "source_reference",
                "domains": [],
                "freshness_status": "unknown",
                "selection_reason": "router-selected fallback",
                "score": 0.0,
            },
        )
        for path in pages_read
    ]
    active_freshness_warnings = [
        warning
        for warning in route_plan.get("freshness_warnings", [])
        if isinstance(warning, dict) and warning.get("path") in pages_read
    ]

    if raw:
        return {
            "confidence": float(router_response.get("confidence", 0.0)),
            "route_confidence": float(route_plan.get("route_confidence", 0.0)),
            "pages_read": pages_read,
            "pages_considered": len(route_plan.get("candidate_pages", [])),
            "selected_pages": route_selected_pages,
            "freshness_warnings": active_freshness_warnings,
            "router_model": weak_model,
            "synthesizer_model": None,
            "tokens_consumed": _merge_tokens(router_result.get("tokens_consumed", {})),
            "citations": list(pages_read),
            "pages_content": [
                {"page_path": page["page_path"], "content": page["content"]}
                for page in selected_pages
            ],
            "answer": "",
        }

    synthesizer_result = llm_client.invoke(
        stage_id="query.synthesizer",
        prompt=_synthesizer_prompt(
            question=question,
            selected_pages=selected_pages,
            route_plan={**route_plan, "selected_pages": route_selected_pages},
        ),
        model_override=weak_model,
    )
    synthesizer_response = synthesizer_result["response"]

    citations = [
        citation
        for citation in synthesizer_response.get("citations", [])
        if citation in pages_read
    ]

    return {
        "confidence": float(synthesizer_response.get("confidence", 0.0)),
        "route_confidence": float(route_plan.get("route_confidence", 0.0)),
        "pages_read": pages_read,
        "pages_considered": len(route_plan.get("candidate_pages", [])),
        "selected_pages": route_selected_pages,
        "freshness_warnings": active_freshness_warnings,
        "router_model": weak_model,
        "synthesizer_model": weak_model,
        "tokens_consumed": _merge_tokens(
            router_result.get("tokens_consumed", {}),
            synthesizer_result.get("tokens_consumed", {}),
        ),
        "citations": citations,
        "answer": synthesizer_response.get("answer", ""),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Query a project wiki")
    parser.add_argument("--project", required=True)
    parser.add_argument("--question", required=True)
    parser.add_argument("--projects-root")
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Skip synthesizer; return raw markdown of router-selected pages",
    )
    args = parser.parse_args(argv)

    result = query(
        args.project,
        args.question,
        projects_root=Path(args.projects_root) if args.projects_root else None,
        raw=args.raw,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
