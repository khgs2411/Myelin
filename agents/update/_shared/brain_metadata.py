from __future__ import annotations

import re
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
CONFIDENCE_RANK = {"unknown": 0, "low": 1, "medium": 2, "high": 3}


_PAGE_KIND_BY_TYPE = {
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


def slug(value: str) -> str:
    lowered = value.strip().lower().replace("_", "-")
    collapsed = re.sub(r"[^a-z0-9/-]+", "-", lowered)
    return re.sub(r"-+", "-", collapsed).strip("-")


def page_kind_from_catalog_type(catalog_type: str | None) -> str:
    if not catalog_type:
        return "source_reference"
    return _PAGE_KIND_BY_TYPE.get(catalog_type, "source_reference")


def build_tags(
    *,
    project_key: str,
    page_kind: str,
    domains: list[str],
    freshness_status: str,
    source_paths: list[str],
    canonical: bool,
) -> list[str]:
    tags = [f"project/{slug(project_key)}", f"kind/{slug(page_kind)}"]
    tags.extend(f"domain/{slug(domain)}" for domain in domains if domain.strip())
    tags.append(f"status/{slug(freshness_status or 'unknown')}")
    if source_paths:
        tags.append("role/source-backed")
    if canonical:
        tags.append("role/canonical")
    return tags


def is_page_reference_topic(topic: str) -> bool:
    value = topic.strip()
    if not value:
        return False
    lowered = value.lower()
    return lowered == "index.md" or lowered.endswith(".md") or "/" in value


def domains_from_topics(topics: list[str]) -> list[str]:
    return [topic for topic in topics if not is_page_reference_topic(topic)]


def title_from_path(path: str) -> str:
    if path == "index.md":
        return "Index"
    stem = Path(path).stem
    return stem.replace("-", " ").replace("_", " ").title()


def aliases_for_page(path: str, title: str) -> list[str]:
    aliases = [title, title.lower()]
    stem = Path(path).stem.replace("-", " ").replace("_", " ")
    if stem and stem not in aliases:
        aliases.append(stem)
    return list(dict.fromkeys(alias for alias in aliases if alias.strip()))


def _entrypoint_rank(path: str, entry_pages: list[str]) -> int | None:
    try:
        return entry_pages.index(path) + 1
    except ValueError:
        return None


def _append_index(index: dict[str, list[Any]], key: str, value: Any) -> None:
    index.setdefault(key, [])
    if value not in index[key]:
        index[key].append(value)


def build_metadata_products(
    *,
    project_key: str,
    project_state: dict[str, Any],
    pages: list[dict[str, Any]],
    freshness: dict[str, Any],
    generated_at: str,
) -> dict[str, dict[str, Any]]:
    entry_pages = [str(path) for path in project_state.get("entry_pages", [])]
    last_seen_commit = freshness.get("last_seen_commit_pending") or freshness.get("last_seen_commit")

    metadata_pages: list[dict[str, Any]] = []
    tags: dict[str, list[str]] = {}
    aliases: dict[str, list[dict[str, str]]] = {}

    for page in pages:
        path = str(page.get("path") or "")
        if not path:
            continue
        page_kind = page_kind_from_catalog_type(page.get("type"))
        topics = [str(topic) for topic in page.get("linked_topics", []) if str(topic).strip()]
        domains = domains_from_topics(topics)
        source_paths = [str(source) for source in page.get("linked_sources", []) if str(source).strip()]
        freshness_status = str(page.get("freshness_status") or "unknown")
        canonical = path in entry_pages or page_kind in {
            "architecture",
            "system",
            "module",
            "integration",
            "runbook",
            "decision",
        }
        title = title_from_path(path)
        page_aliases = aliases_for_page(path, title)
        page_tags = build_tags(
            project_key=project_key,
            page_kind=page_kind,
            domains=domains,
            freshness_status=freshness_status,
            source_paths=source_paths,
            canonical=canonical,
        )
        record = {
            "path": path,
            "title": title,
            "project_key": project_key,
            "page_kind": page_kind,
            "domains": domains,
            "topics": topics,
            "aliases": page_aliases,
            "tags": page_tags,
            "source_paths": source_paths,
            "freshness_status": freshness_status,
            "confidence": "high",
            "last_verified_at": page.get("last_reviewed_at") or generated_at,
            "last_verified_commit": last_seen_commit,
            "summary": str(page.get("summary") or ""),
            "entrypoint_rank": _entrypoint_rank(path, entry_pages),
            "canonical": canonical,
        }
        metadata_pages.append(record)
        for tag in page_tags:
            _append_index(tags, tag, path)
        for alias in page_aliases:
            _append_index(
                aliases,
                alias.lower(),
                {"path": path, "title": title, "page_kind": page_kind},
            )

    return {
        "page_metadata": {
            "schema_version": SCHEMA_VERSION,
            "generated_at": generated_at,
            "project_key": project_key,
            "pages": metadata_pages,
        },
        "tag_index": {
            "schema_version": SCHEMA_VERSION,
            "generated_at": generated_at,
            "project_key": project_key,
            "tags": dict(sorted(tags.items())),
        },
        "alias_index": {
            "schema_version": SCHEMA_VERSION,
            "generated_at": generated_at,
            "project_key": project_key,
            "aliases": dict(sorted(aliases.items())),
        },
    }


def normalize_relationships(
    relationships: list[dict[str, Any]],
    pages: list[dict[str, Any]],
) -> dict[str, Any]:
    known_paths = {str(page.get("path")) for page in pages if isinstance(page, dict) and page.get("path")}
    best_by_key: dict[tuple[str, str, str], dict[str, str]] = {}
    dropped_count = 0

    sorted_relationships = sorted(
        (relationship for relationship in relationships if isinstance(relationship, dict)),
        key=lambda relationship: (
            str(relationship.get("from") or relationship.get("source") or ""),
            str(relationship.get("to") or relationship.get("target") or ""),
            str(relationship.get("relationship_type") or relationship.get("type") or ""),
            str(relationship.get("confidence") or "unknown"),
        ),
    )

    for relationship in sorted_relationships:
        source = str(relationship.get("from") or relationship.get("source") or "").strip()
        target = str(relationship.get("to") or relationship.get("target") or "").strip()
        relationship_type = str(relationship.get("relationship_type") or relationship.get("type") or "").strip()
        if not source or not target or not relationship_type:
            dropped_count += 1
            continue
        if source not in known_paths or target not in known_paths:
            dropped_count += 1
            continue

        confidence = str(relationship.get("confidence") or "unknown").strip().lower() or "unknown"
        if confidence not in CONFIDENCE_RANK:
            confidence = "unknown"
        key = (source, target, relationship_type)
        extras = {
            str(extra_key): extra_value
            for extra_key, extra_value in relationship.items()
            if extra_key not in {"from", "source", "to", "target", "relationship_type", "type", "confidence"}
        }
        normalized = {
            **extras,
            "from": source,
            "to": target,
            "relationship_type": relationship_type,
            "confidence": confidence,
        }
        current = best_by_key.get(key)
        if current is None:
            best_by_key[key] = normalized
        elif CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[str(current["confidence"])]:
            current["confidence"] = confidence

    return {
        "relationships": [best_by_key[key] for key in sorted(best_by_key)],
        "dropped_count": dropped_count,
    }
