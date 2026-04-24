from __future__ import annotations

import re
from pathlib import Path


_INLINE_CITATION_RE = re.compile(r"`([^`:\n]+):(\d+)(?:-(\d+))?`")


def _line_count(path: Path) -> int:
    return sum(1 for _ in path.open(encoding="utf-8"))


def normalize_citation(citation: str, repo_root: Path | None) -> str | None:
    if repo_root is None:
        return citation
    text = str(citation or "").strip()
    if not text:
        return None
    if ":" not in text:
        resolved = repo_root / text
        return text if resolved.is_file() else None

    path_part, line_part = text.split(":", 1)
    resolved = repo_root / path_part
    if not resolved.is_file():
        return None
    if not line_part:
        return path_part

    line_count = _line_count(resolved)
    if "-" in line_part:
        start_text, end_text = line_part.split("-", 1)
    else:
        start_text, end_text = line_part, line_part
    try:
        start = int(start_text)
        end = int(end_text)
    except ValueError:
        return None

    start = max(1, min(start, line_count))
    end = max(1, min(end, line_count))
    if end < start:
        end = start
    return f"{path_part}:{start}" if start == end else f"{path_part}:{start}-{end}"


def normalize_markdown_citations(text: str, repo_root: Path | None) -> str:
    if repo_root is None or not text:
        return text

    def replace(match: re.Match[str]) -> str:
        file_part = match.group(1)
        start = match.group(2)
        end = match.group(3)
        raw = f"{file_part}:{start}" + (f"-{end}" if end else "")
        normalized = normalize_citation(raw, repo_root)
        if normalized is None:
            return f"`{file_part}`"
        return f"`{normalized}`"

    return _INLINE_CITATION_RE.sub(replace, text)


def normalize_proposal_citations(proposal: dict, repo_root: Path | None) -> dict:
    if repo_root is None:
        return proposal

    for unit in proposal.get("units", []):
        citations = []
        for citation in unit.get("source_citations", []) or []:
            normalized = normalize_citation(str(citation), repo_root)
            if normalized and normalized not in citations:
                citations.append(normalized)
        unit["source_citations"] = citations
        content = unit.get("content")
        if isinstance(content, str):
            unit["content"] = normalize_markdown_citations(content, repo_root)

    index_changes = proposal.get("index_changes")
    if isinstance(index_changes, dict):
        content = index_changes.get("content")
        if isinstance(content, str):
            index_changes["content"] = normalize_markdown_citations(content, repo_root)

    return proposal
