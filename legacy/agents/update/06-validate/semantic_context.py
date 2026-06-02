"""Semantic validation prompt context selection."""

from __future__ import annotations

from pathlib import Path
from typing import Any


def _all_wiki_pages(project_dir: Path) -> list[dict[str, str]]:
    wiki_dir = project_dir / "wiki"
    if not wiki_dir.is_dir():
        return []
    return [
        {
            "path": str(page.relative_to(project_dir)),
            "content": page.read_text(),
        }
        for page in sorted(wiki_dir.rglob("*.md"))
        if page.is_file()
    ]


def _project_markdown_rel(project_dir: Path, raw: object) -> str | None:
    if not isinstance(raw, str) or not raw.endswith(".md"):
        return None
    if raw.startswith("/") or "://" in raw:
        return None
    candidate = (project_dir / raw).resolve()
    try:
        rel = str(candidate.relative_to(project_dir.resolve()))
    except ValueError:
        return None
    if rel != "index.md" and not rel.startswith("wiki/"):
        return None
    if not candidate.is_file():
        return None
    return rel


def _ingest_touched_pages(project_dir: Path, proposal: dict[str, Any]) -> set[str]:
    touched: set[str] = set()
    for unit in proposal.get("units", []):
        if not isinstance(unit, dict):
            continue
        page_path = _project_markdown_rel(project_dir, unit.get("page_path"))
        if page_path is not None:
            touched.add(page_path)
        for raw in unit.get("affected_cross_refs") or []:
            cross_ref = _project_markdown_rel(project_dir, raw)
            if cross_ref is not None:
                touched.add(cross_ref)

    index_changes = proposal.get("index_changes")
    if isinstance(index_changes, dict) and index_changes.get("action") == "update":
        index_path = _project_markdown_rel(project_dir, "index.md")
        if index_path is not None:
            touched.add(index_path)

    return touched


def build_semantic_prompt_payload(
    *,
    project_key: str,
    project_dir: Path,
    ranking: dict[str, Any],
    proposal: dict[str, Any],
    enabled_rules: list[str],
    ingest_mode: bool,
) -> dict[str, Any]:
    """Build the semantic validation prompt payload.

    Compile validation keeps the historical full wiki context. Ingest/update
    validation scopes markdown bodies to touched proposal pages and explicit
    cross-references, falling back to full context if no touched page resolves.
    """
    index_path = project_dir / "index.md"
    all_wiki_pages = _all_wiki_pages(project_dir)
    context_scope = "full"
    included_pages = [page["path"] for page in all_wiki_pages]
    include_index = index_path.is_file()

    if ingest_mode:
        touched = _ingest_touched_pages(project_dir, proposal)
        if touched:
            context_scope = "ingest_touched"
            included_pages = sorted(path for path in touched if path.startswith("wiki/"))
            include_index = "index.md" in touched
            included_set = set(included_pages)
            wiki_pages = [page for page in all_wiki_pages if page["path"] in included_set]
        else:
            wiki_pages = all_wiki_pages
    else:
        wiki_pages = all_wiki_pages

    return {
        "project_key": project_key,
        "ranking_snapshot": ranking,
        "proposal": proposal,
        "index_md": index_path.read_text() if include_index and index_path.is_file() else "",
        "wiki_pages": wiki_pages,
        "enabled_rules": enabled_rules,
        "semantic_context": {
            "scope": context_scope,
            "included_pages": (["index.md"] if include_index else []) + included_pages,
            "omitted_wiki_page_count": max(0, len(all_wiki_pages) - len(wiki_pages)),
        },
    }
