from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


MAX_CANDIDATES = 12
MAX_SELECTED_PAGES = 5


_WORD_RE = re.compile(r"[a-z0-9][a-z0-9_-]*")
_BROAD_TERMS = {"what", "overview", "main", "components", "architecture", "system", "project"}
_HOW_TERMS = {"how", "work", "works", "flow", "trace", "process", "implemented", "implementation"}


def _load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.is_file():
        return default
    return json.loads(path.read_text())


def _terms(value: str) -> list[str]:
    return _WORD_RE.findall(value.lower())


def _slug(value: str) -> str:
    return "-".join(_terms(value))


def _title_from_path(path: str) -> str:
    if path == "index.md":
        return "Index"
    return Path(path).stem.replace("-", " ").replace("_", " ").title()


def _page_kind_from_catalog_type(catalog_type: str | None) -> str:
    mapping = {
        "index": "index",
        "architecture": "architecture",
        "systems": "system",
        "modules": "module",
        "integrations": "integration",
        "runbooks": "runbook",
        "decisions": "decision",
        "sessions": "session",
        "glossary": "glossary",
        "open-questions": "open_question",
    }
    return mapping.get(catalog_type or "", "source_reference")


def _metadata_available(project_dir: Path) -> bool:
    state = project_dir / "state"
    return all((state / name).is_file() for name in ("page-metadata.json", "tag-index.json", "alias-index.json"))


def _candidate_from_catalog(page: dict[str, Any]) -> dict[str, Any]:
    path = str(page.get("path") or "")
    topics = [str(topic) for topic in page.get("linked_topics", []) if str(topic).strip()]
    domains = [topic for topic in topics if not topic.endswith(".md") and "/" not in topic]
    return {
        "path": path,
        "title": _title_from_path(path),
        "page_kind": _page_kind_from_catalog_type(page.get("type")),
        "domains": domains,
        "topics": topics,
        "aliases": [_title_from_path(path), Path(path).stem.replace("-", " ")],
        "tags": [],
        "source_paths": [str(source) for source in page.get("linked_sources", []) if str(source).strip()],
        "freshness_status": str(page.get("freshness_status") or "unknown"),
        "summary": str(page.get("summary") or ""),
        "entrypoint_rank": page.get("entrypoint_rank"),
        "canonical": path == "index.md",
    }


def _normalise_metadata_page(page: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": str(page.get("path") or ""),
        "title": str(page.get("title") or _title_from_path(str(page.get("path") or ""))),
        "page_kind": str(page.get("page_kind") or "source_reference"),
        "domains": [str(domain) for domain in page.get("domains", []) if str(domain).strip()],
        "topics": [str(topic) for topic in page.get("topics", []) if str(topic).strip()],
        "aliases": [str(alias) for alias in page.get("aliases", []) if str(alias).strip()],
        "tags": [str(tag) for tag in page.get("tags", []) if str(tag).strip()],
        "source_paths": [str(source) for source in page.get("source_paths", []) if str(source).strip()],
        "freshness_status": str(page.get("freshness_status") or "unknown"),
        "summary": str(page.get("summary") or ""),
        "entrypoint_rank": page.get("entrypoint_rank"),
        "canonical": bool(page.get("canonical")),
    }


def _load_pages(project_dir: Path, catalog: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], bool]:
    if _metadata_available(project_dir):
        payload = _load_json(project_dir / "state" / "page-metadata.json", {"pages": []})
        pages = payload.get("pages", [])
        if isinstance(pages, list):
            records = [_normalise_metadata_page(page) for page in pages if isinstance(page, dict)]
            return {page["path"]: page for page in records if page["path"]}, True
    records = [_candidate_from_catalog(page) for page in catalog if isinstance(page, dict)]
    return {page["path"]: page for page in records if page["path"]}, False


def _matched_aliases(
    *,
    project_dir: Path,
    question: str,
    pages_by_path: dict[str, dict[str, Any]],
    metadata_available: bool,
) -> tuple[list[dict[str, Any]], set[str]]:
    aliases: list[dict[str, Any]] = []
    paths: set[str] = set()
    haystack = f" {' '.join(_terms(question))} "
    if metadata_available:
        payload = _load_json(project_dir / "state" / "alias-index.json", {"aliases": {}})
        alias_index = payload.get("aliases", {})
        if isinstance(alias_index, dict):
            for alias, candidates in alias_index.items():
                alias_text = " ".join(_terms(str(alias)))
                if not alias_text or f" {alias_text} " not in haystack:
                    continue
                for candidate in candidates if isinstance(candidates, list) else []:
                    if not isinstance(candidate, dict):
                        continue
                    path = str(candidate.get("path") or "")
                    if path in pages_by_path:
                        paths.add(path)
                        aliases.append({"alias": alias_text, "path": path})
    else:
        for path, page in pages_by_path.items():
            for alias in page.get("aliases", []):
                alias_text = " ".join(_terms(str(alias)))
                if alias_text and f" {alias_text} " in haystack:
                    paths.add(path)
                    aliases.append({"alias": alias_text, "path": path})
    return aliases, paths


def _matched_tags(
    *,
    project_dir: Path,
    query_terms: set[str],
    metadata_available: bool,
) -> tuple[list[str], set[str]]:
    if not metadata_available:
        return [], set()
    payload = _load_json(project_dir / "state" / "tag-index.json", {"tags": {}})
    tag_index = payload.get("tags", {})
    if not isinstance(tag_index, dict):
        return [], set()
    tags: list[str] = []
    paths: set[str] = set()
    for tag, tag_paths in tag_index.items():
        tag_text = str(tag)
        tag_slug = tag_text.split("/", 1)[-1]
        tag_terms = set(_terms(tag_slug))
        if not tag_terms or not (tag_terms & query_terms or tag_slug in query_terms):
            continue
        tags.append(tag_text)
        if isinstance(tag_paths, list):
            paths.update(str(path) for path in tag_paths)
    return tags, paths


def _ranking_domain_paths(
    ranking_snapshot: dict[str, Any],
    pages_by_path: dict[str, dict[str, Any]],
    query_terms: set[str],
) -> set[str]:
    matched: set[str] = set()
    for domain in ranking_snapshot.get("ranked_domains", []):
        if not isinstance(domain, dict):
            continue
        name = str(domain.get("domain") or "")
        domain_terms = set(_terms(name))
        if not domain_terms or not (domain_terms & query_terms):
            continue
        for path, page in pages_by_path.items():
            searchable = " ".join(page.get("domains", []) + page.get("topics", []) + [page.get("summary", "")])
            if domain_terms & set(_terms(searchable)):
                matched.add(path)
    return matched


def _relationship_edges(project_dir: Path) -> list[dict[str, Any]]:
    payload = _load_json(project_dir / "state" / "relationships.json", {"relationships": []})
    relationships = payload.get("relationships", [])
    if not isinstance(relationships, list):
        return []
    return [rel for rel in relationships if isinstance(rel, dict)]


def _expand_relationships(
    *,
    base_paths: set[str],
    relationships: list[dict[str, Any]],
    pages_by_path: dict[str, dict[str, Any]],
) -> tuple[set[str], list[dict[str, str]]]:
    expanded: set[str] = set()
    hops: list[dict[str, str]] = []
    for rel in relationships:
        source = str(rel.get("from") or "")
        target = str(rel.get("to") or "")
        rel_type = str(rel.get("relationship_type") or "")
        pairs = ((source, target), (target, source))
        for from_path, to_path in pairs:
            if from_path in base_paths and to_path in pages_by_path and to_path not in base_paths:
                expanded.add(to_path)
                hops.append({"from": from_path, "to": to_path, "relationship_type": rel_type})
    return expanded, hops


def _score_page(
    page: dict[str, Any],
    *,
    query_terms: set[str],
    alias_paths: set[str],
    tag_paths: set[str],
    ranking_paths: set[str],
    expanded_paths: set[str],
    is_broad_question: bool,
    is_how_question: bool,
) -> tuple[float, list[str]]:
    path = page["path"]
    reasons: list[str] = []
    score = 0.0
    if path in alias_paths:
        score += 8.0
        reasons.append("alias match")
    if path in tag_paths:
        score += 4.0
        reasons.append("tag match")
    if path in ranking_paths:
        score += 2.0
        reasons.append("ranking domain match")
    searchable_terms = set(
        _terms(
            " ".join(
                [
                    page.get("title", ""),
                    page.get("summary", ""),
                    " ".join(page.get("domains", [])),
                    " ".join(page.get("topics", [])),
                    " ".join(page.get("aliases", [])),
                ]
            )
        )
    )
    overlap = query_terms & searchable_terms
    if overlap:
        score += min(len(overlap), 5) * 1.0
        reasons.append("term match")
    if is_broad_question and (page.get("entrypoint_rank") or page.get("page_kind") in {"index", "architecture"}):
        score += 3.0
        reasons.append("entry page for broad question")
    if is_how_question and page.get("source_paths"):
        score += 2.0
        reasons.append("source-backed for how question")
    if page.get("canonical"):
        score += 0.5
    if path in expanded_paths:
        score += 1.25
        reasons.append("one-hop relationship")
    if page.get("freshness_status") == "stale":
        score -= 1.0
        reasons.append("stale")
    if not reasons and page.get("page_kind") == "index":
        score += 0.25
        reasons.append("fallback entry page")
    return score, reasons


def _route_confidence(scored: list[dict[str, Any]], *, metadata_available: bool, matched_aliases: list[dict[str, Any]]) -> float:
    if not scored:
        return 0.0
    top_score = float(scored[0]["score"])
    if top_score <= 0:
        return 0.15
    confidence = min(0.95, 0.30 + (top_score / 12.0))
    if metadata_available:
        confidence += 0.05
    if matched_aliases:
        confidence += 0.10
    return min(0.95, round(confidence, 3))


def plan_query(
    *,
    project_key: str,
    question: str,
    project_dir: Path,
    catalog: list[dict[str, Any]],
    ranking_snapshot: dict[str, Any],
) -> dict[str, Any]:
    pages_by_path, metadata_available = _load_pages(project_dir, catalog)
    query_terms = set(_terms(question))
    is_broad_question = bool(query_terms & _BROAD_TERMS) and len(query_terms) <= 8
    is_how_question = bool(query_terms & _HOW_TERMS)

    matched_aliases, alias_paths = _matched_aliases(
        project_dir=project_dir,
        question=question,
        pages_by_path=pages_by_path,
        metadata_available=metadata_available,
    )
    matched_tags, tag_paths = _matched_tags(
        project_dir=project_dir,
        query_terms=query_terms,
        metadata_available=metadata_available,
    )
    ranking_paths = _ranking_domain_paths(ranking_snapshot, pages_by_path, query_terms)
    base_paths = alias_paths | tag_paths | ranking_paths
    if not base_paths:
        for path, page in pages_by_path.items():
            searchable = " ".join([page.get("title", ""), page.get("summary", ""), " ".join(page.get("domains", []))])
            if query_terms & set(_terms(searchable)):
                base_paths.add(path)
    if is_broad_question:
        base_paths.update(
            path
            for path, page in pages_by_path.items()
            if page.get("entrypoint_rank") or page.get("page_kind") in {"index", "architecture"}
        )
    if not base_paths:
        base_paths.update(path for path, page in pages_by_path.items() if page.get("page_kind") == "index")

    expanded_paths, relationship_hops = _expand_relationships(
        base_paths=base_paths,
        relationships=_relationship_edges(project_dir),
        pages_by_path=pages_by_path,
    )
    candidate_paths = base_paths | expanded_paths
    if not candidate_paths:
        candidate_paths = set(pages_by_path)

    scored: list[dict[str, Any]] = []
    for path in candidate_paths:
        page = pages_by_path.get(path)
        if not page:
            continue
        score, reasons = _score_page(
            page,
            query_terms=query_terms,
            alias_paths=alias_paths,
            tag_paths=tag_paths,
            ranking_paths=ranking_paths,
            expanded_paths=expanded_paths,
            is_broad_question=is_broad_question,
            is_how_question=is_how_question,
        )
        scored.append(
            {
                **page,
                "selection_reason": ", ".join(reasons) if reasons else "candidate",
                "score": round(score, 3),
            }
        )

    scored.sort(
        key=lambda page: (
            -float(page["score"]),
            page.get("entrypoint_rank") is None,
            page.get("entrypoint_rank") or 999,
            page["path"],
        )
    )
    candidates = scored[:MAX_CANDIDATES]
    selected = candidates[:MAX_SELECTED_PAGES]
    freshness_warnings = [
        {
            "path": page["path"],
            "freshness_status": page.get("freshness_status", "unknown"),
            "message": f"{page['path']} is marked {page.get('freshness_status', 'unknown')}",
        }
        for page in selected
        if page.get("freshness_status") not in {"fresh", "unknown", ""}
    ]
    matched_domains = sorted(
        {
            domain
            for page in candidates
            for domain in page.get("domains", [])
            if set(_terms(domain)) & query_terms or _slug(domain) in query_terms
        }
    )
    selected_pages = [_compact_page(page) for page in selected]
    return {
        "question": question,
        "project_key": project_key,
        "normalized_terms": sorted(query_terms),
        "matched_aliases": matched_aliases,
        "matched_tags": matched_tags,
        "matched_domains": matched_domains,
        "candidate_pages": [_compact_page(page) for page in candidates],
        "selected_pages": selected_pages,
        "excluded_pages": [_compact_page(page) for page in scored[MAX_CANDIDATES:]],
        "relationship_hops": relationship_hops,
        "freshness_warnings": freshness_warnings,
        "route_confidence": _route_confidence(candidates, metadata_available=metadata_available, matched_aliases=matched_aliases),
        "route_reason": "metadata products used" if metadata_available else "pages.json fallback",
        "debug": {"metadata_available": metadata_available},
    }


def _compact_page(page: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": page["path"],
        "title": page.get("title", _title_from_path(page["path"])),
        "page_kind": page.get("page_kind", "source_reference"),
        "domains": list(page.get("domains", [])),
        "freshness_status": page.get("freshness_status", "unknown"),
        "selection_reason": page.get("selection_reason", ""),
        "score": page.get("score", 0.0),
    }
