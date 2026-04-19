"""Deterministic structural validator helpers for update validate."""

from __future__ import annotations

import json
import re
from pathlib import Path


_REQUIRED_SECTIONS = ("## Repo pointers", "## Related")
_CITATION_RE = re.compile(r"`([^`:\n]+):(\d+)-(\d+)`")
_MD_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)#]+\.md)\)")
_ALLOWED_SOURCE_KINDS = {
    "spec",
    "design",
    "plan",
    "implementation-note",
    "api-doc",
    "reference",
    "session-note",
    "decision-candidate",
    "troubleshooting",
}


def _wiki_pages(project_dir: Path) -> list[Path]:
    wiki = project_dir / "wiki"
    if not wiki.is_dir():
        return []
    return sorted(path for path in wiki.rglob("*.md") if path.is_file())


def _finding(page: str, issue: str, rule_id: str, severity: str = "blocker") -> dict:
    return {
        "page": page,
        "issue": issue,
        "severity": severity,
        "rule_id": rule_id,
    }


def required_page_sections(project_dir: Path) -> list[dict]:
    findings: list[dict] = []
    for page in _wiki_pages(project_dir):
        rel = str(page.relative_to(project_dir))
        text = page.read_text()
        first_nonempty = next((line for line in text.splitlines() if line.strip()), "")
        if not first_nonempty or first_nonempty.startswith("#"):
            findings.append(
                _finding(
                    rel,
                    "page does not open with a non-heading summary line",
                    "required_page_sections.summary",
                )
            )
        for section in _REQUIRED_SECTIONS:
            if section not in text:
                findings.append(
                    _finding(rel, f"missing required section: {section}", "required_page_sections")
                )
    return findings


def shelf_allowlist(project_dir: Path, allowed: list[str]) -> list[dict]:
    findings: list[dict] = []
    wiki = project_dir / "wiki"
    if not wiki.is_dir():
        return findings
    allowed_set = set(allowed)
    for entry in sorted(wiki.iterdir()):
        if entry.is_dir() and entry.name not in allowed_set:
            findings.append(
                _finding(
                    str(entry.relative_to(project_dir)),
                    f"shelf directory {entry.name!r} is not in the allowed set {sorted(allowed)}",
                    "shelf_allowlist",
                )
            )
    return findings


def _iter_citations(page: Path):
    for match in _CITATION_RE.finditer(page.read_text()):
        yield match.group(1), int(match.group(2)), int(match.group(3))


def citation_resolvability(project_dir: Path, repo_root: Path) -> list[dict]:
    findings: list[dict] = []
    for page in _wiki_pages(project_dir):
        rel = str(page.relative_to(project_dir))
        for file_part, _, _ in _iter_citations(page):
            if not (repo_root / file_part).is_file():
                findings.append(
                    _finding(rel, f"citation file not found: {file_part}", "citation_resolvability")
                )
    return findings


def citation_line_range(project_dir: Path, repo_root: Path) -> list[dict]:
    findings: list[dict] = []
    for page in _wiki_pages(project_dir):
        rel = str(page.relative_to(project_dir))
        for file_part, start, end in _iter_citations(page):
            target = repo_root / file_part
            if not target.is_file():
                continue
            line_count = sum(1 for _ in target.open())
            if start < 1 or end < start or end > line_count:
                findings.append(
                    _finding(
                        rel,
                        f"citation line range {start}-{end} out of bounds for {file_part} (file has {line_count} lines)",
                        "citation_line_range",
                    )
                )
    return findings


def _resolve_markdown_link(source: Path, raw: str, project_dir: Path) -> Path | None:
    if raw.startswith("/") or "://" in raw:
        return None
    return (source.parent / raw).resolve()


def no_orphan_pages(project_dir: Path) -> list[dict]:
    findings: list[dict] = []
    referenced: set[str] = set()
    index_path = project_dir / "index.md"
    if index_path.is_file():
        for match in _MD_LINK_RE.finditer(index_path.read_text()):
            resolved = (project_dir / match.group(1)).resolve()
            try:
                referenced.add(str(resolved.relative_to(project_dir.resolve())))
            except ValueError:
                pass
    for page in _wiki_pages(project_dir):
        for match in _MD_LINK_RE.finditer(page.read_text()):
            resolved = _resolve_markdown_link(page, match.group(1), project_dir)
            if resolved is None:
                continue
            try:
                referenced.add(str(resolved.relative_to(project_dir.resolve())))
            except ValueError:
                continue
    for page in _wiki_pages(project_dir):
        rel = str(page.relative_to(project_dir))
        if rel not in referenced:
            findings.append(
                _finding(
                    rel,
                    "orphan page - not referenced from index.md or another wiki page",
                    "no_orphan_pages",
                    severity="warn",
                )
            )
    return findings


def no_dead_cross_refs(project_dir: Path) -> list[dict]:
    findings: list[dict] = []
    for page in _wiki_pages(project_dir):
        rel = str(page.relative_to(project_dir))
        for match in _MD_LINK_RE.finditer(page.read_text()):
            resolved = _resolve_markdown_link(page, match.group(1), project_dir)
            if resolved is None:
                continue
            if not resolved.is_file():
                findings.append(
                    _finding(rel, f"dead cross-ref: {match.group(1)}", "no_dead_cross_refs")
                )
    return findings


def index_routing_resolves(project_dir: Path) -> list[dict]:
    findings: list[dict] = []
    index_path = project_dir / "index.md"
    if not index_path.is_file():
        return findings
    for match in _MD_LINK_RE.finditer(index_path.read_text()):
        raw = match.group(1)
        if raw.startswith("/") or "://" in raw:
            continue
        if not (project_dir / raw).is_file():
            findings.append(
                _finding("index.md", f"index routing entry does not resolve: {raw}", "index_routing_resolves")
            )
    return findings


def pages_json_filesystem_agreement(project_dir: Path) -> list[dict]:
    findings: list[dict] = []
    pages_path = project_dir / "state" / "pages.json"
    if not pages_path.is_file():
        return findings
    on_disk = {str(page.relative_to(project_dir)) for page in _wiki_pages(project_dir)}
    project_json_path = project_dir / "state" / "project.json"
    if project_json_path.is_file():
        project_json = json.loads(project_json_path.read_text())
        for rel in project_json.get("entry_pages", []):
            path = project_dir / rel
            if path.is_file():
                on_disk.add(str(path.relative_to(project_dir)))
    in_state = {
        entry["path"]
        for entry in json.loads(pages_path.read_text()).get("pages", [])
        if isinstance(entry, dict) and "path" in entry
    }
    for ghost in sorted(in_state - on_disk):
        findings.append(
            _finding(
                ghost,
                "pages.json lists a page that does not exist on disk",
                "pages_json_filesystem_agreement",
            )
        )
    for missing in sorted(on_disk - in_state):
        findings.append(
            _finding(
                missing,
                "wiki has a page not listed in pages.json",
                "pages_json_filesystem_agreement",
            )
        )
    return findings


def validate_proposal(run_dir: Path, ranking_snapshot: dict, allowed_shelves: list[str]) -> list[dict]:
    findings: list[dict] = []
    proposal_path = run_dir / "proposal.json"
    if not proposal_path.is_file():
        return findings
    proposal = json.loads(proposal_path.read_text())
    ranked_domain_names = {
        entry.get("domain")
        for entry in ranking_snapshot.get("ranked_domains", [])
        if isinstance(entry, dict)
    }
    max_new = proposal.get("max_new_pages", 25)
    new_count = proposal.get("new_pages_count", 0)
    if new_count > max_new:
        findings.append(
            _finding(
                "proposal.json",
                f"new_pages_count {new_count} exceeds max_new_pages {max_new}",
                "proposal_max_new_pages",
            )
        )
    for unit in proposal.get("units", []):
        uid = unit.get("id", "<no-id>")
        if not any(sig in ("A", "B", "C") for sig in unit.get("justification_signals", [])):
            findings.append(
                _finding(
                    "proposal.json",
                    f"unit {uid} missing valid justification_signals",
                    "proposal_justification_signals",
                )
            )
        for domain in unit.get("referenced_ranking_domains", []):
            if domain not in ranked_domain_names:
                findings.append(
                    _finding(
                        "proposal.json",
                        f"unit {uid} references domain not in ranking snapshot: {domain}",
                        "proposal_referenced_ranking_domains",
                    )
                )
        source_classification = unit.get("source_classification")
        if not isinstance(source_classification, dict):
            findings.append(
                _finding(
                    "proposal.json",
                    f"unit {uid} missing source_classification",
                    "proposal_source_classification",
                )
            )
        elif source_classification.get("source_kind") not in _ALLOWED_SOURCE_KINDS:
            findings.append(
                _finding(
                    "proposal.json",
                    f"unit {uid} has unknown source_kind: {source_classification.get('source_kind')!r}",
                    "proposal_source_classification",
                )
            )
        for key in ("page_path", "rename_from"):
            path = unit.get(key)
            if not isinstance(path, str) or not path.startswith("wiki/"):
                continue
            parts = path.split("/")
            shelf = parts[1] if len(parts) > 1 else ""
            if shelf not in allowed_shelves:
                findings.append(
                    _finding(
                        "proposal.json",
                        f"unit {uid} {key}={path!r} uses shelf {shelf!r} not in allowlist",
                        "shelf_allowlist",
                    )
                )
    return findings
