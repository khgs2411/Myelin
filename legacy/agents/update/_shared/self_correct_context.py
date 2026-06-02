from __future__ import annotations

import re
from pathlib import PurePosixPath


_BACKTICK_RE = re.compile(r"`([^`]+)`")
_TOKEN_RE = re.compile(r"[A-Za-z0-9_./-]{3,}")
_CAMEL_RE = re.compile(r"[a-z][A-Z]")
_STOPWORDS = {
    "the",
    "and",
    "for",
    "that",
    "this",
    "with",
    "from",
    "into",
    "still",
    "page",
    "pages",
    "open",
    "questions",
    "question",
    "bullet",
    "frames",
    "provided",
    "rewrite",
    "confirm",
    "whether",
    "expected",
    "exists",
    "local",
    "path",
    "latest",
    "reviewed",
    "commit",
    "index",
}


def clip_chars(text: str, max_chars: int) -> str:
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    if max_chars <= 12:
        return text[:max_chars]
    suffix = "\n...[trimmed]"
    return text[: max_chars - len(suffix)].rstrip() + suffix


def normalize_project_link(base_page: str, target: str) -> str | None:
    target = target.strip()
    if not target or "://" in target or target.startswith("#"):
        return None
    target = target.split("#", 1)[0]
    if not target.endswith(".md"):
        return None
    base = PurePosixPath(base_page).parent
    candidate = (base / target).as_posix() if not target.startswith("/") else target.lstrip("/")
    normalized = PurePosixPath(candidate)
    if ".." in normalized.parts:
        return None
    return normalized.as_posix()


def is_codeish_term(term: str) -> bool:
    stripped = term.strip().strip(".,:;()[]{}")
    if len(stripped) < 3:
        return False
    lowered = stripped.lower()
    if lowered in _STOPWORDS:
        return False
    if "/" in stripped or "_" in stripped or "." in stripped:
        return True
    if _CAMEL_RE.search(stripped):
        return True
    if stripped.isupper() and len(stripped) <= 16:
        return True
    return False


def _iter_codeish_from_text(text: str):
    for token in _TOKEN_RE.findall(text):
        if is_codeish_term(token):
            yield token.strip().strip(".,:;()[]{}")


def extract_search_terms(findings: list[dict], affected_pages: list[str], max_terms: int) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> bool:
        normalized = term.strip().strip(".,:;()[]{}")
        lowered = normalized.lower()
        if not normalized or lowered in seen or not is_codeish_term(normalized):
            return False
        seen.add(lowered)
        terms.append(normalized)
        return len(terms) >= max_terms

    for finding in findings:
        for field in ("evidence", "suggested_action"):
            text = str(finding.get(field) or "")
            for span in _BACKTICK_RE.findall(text):
                for token in _iter_codeish_from_text(span):
                    if add(token):
                        return terms
            for token in _iter_codeish_from_text(text):
                if add(token):
                    return terms

    for rel in affected_pages:
        for part in PurePosixPath(rel).stem.split("-"):
            if add(part):
                return terms

    return terms
