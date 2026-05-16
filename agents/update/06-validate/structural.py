"""Deterministic structural validator helpers for update validate."""

from __future__ import annotations

import json
import re
from pathlib import Path


_REQUIRED_SECTIONS = ("## Repo pointers", "## Related")
_CITATION_RE = re.compile(r"`([^`:\n]+):(\d+)-(\d+)`")
_MD_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)#]+\.md)\)")
_ARCHIVAL_SESSION_NOTE_RE = re.compile(r"^wiki/sessions/\d{4}-\d{2}-\d{2}-.+\.md$")
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

# Phrases that mean the writer described the wiki instead of the project. Any
# of these appearing in index.md's opening sentence or in Current Priorities
# is a blocker - CLAUDE.md writing-style rules ban this explicitly and the
# first run of rpg_game showed the model will default to this framing unless
# validate enforces it.
_WIKI_META_OPENING_PHRASES = (
    "entry point for the maintained",
    "is the entry point for",
    "project wiki",
    "this wiki",
    "maintained knowledge layer",
    "baseline pass",
    "baseline established",
    "broad bootstrap",
    "focused follow-up pass",
    "has not been bootstrapped",
)

_WIKI_META_PRIORITIES_PHRASES = (
    "establish the canonical",
    "keep system pages grounded",
    "no verified project priorities",
    "first canonical bootstrap",
    "bootstrap against the mapped repo",
)

_ALLOWED_PAGE_KINDS = {
    "index",
    "architecture",
    "system",
    "module",
    "integration",
    "runbook",
    "decision",
    "session",
    "glossary",
    "open_question",
    "source_reference",
}

_ALLOWED_CONFIDENCE = {"high", "medium", "low"}
_ALLOWED_RELATIONSHIP_TYPES = {
    "links_to",
    "related_to",
    "depends_on",
    "documents",
    "implemented_by",
    "source_backed_by",
    "entrypoint_for",
    "supersedes",
    "contradicts",
    "stale_due_to",
    "answers",
    "references",
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


def _is_archival_session_note(rel: str) -> bool:
    return bool(_ARCHIVAL_SESSION_NOTE_RE.fullmatch(rel))


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
        if _is_archival_session_note(rel):
            continue
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


def _known_page_paths(project_dir: Path) -> set[str]:
    pages_path = project_dir / "state" / "pages.json"
    if not pages_path.is_file():
        return set()
    return {
        entry["path"]
        for entry in json.loads(pages_path.read_text()).get("pages", [])
        if isinstance(entry, dict) and isinstance(entry.get("path"), str)
    }


def _looks_like_project_markdown_path(value: object) -> bool:
    return (
        isinstance(value, str)
        and (value == "index.md" or value.startswith("wiki/"))
        and value.endswith(".md")
    )


def _load_state_json(project_dir: Path, name: str, rule_id: str) -> tuple[dict | None, list[dict]]:
    path = project_dir / "state" / name
    if not path.is_file():
        return None, [_finding(f"state/{name}", "required metadata product is missing", rule_id)]
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        return None, [_finding(f"state/{name}", f"invalid JSON: {exc}", rule_id)]
    if not isinstance(payload, dict):
        return None, [_finding(f"state/{name}", "metadata product must be a JSON object", rule_id)]
    return payload, []


def page_metadata_shape(project_dir: Path) -> list[dict]:
    payload, findings = _load_state_json(project_dir, "page-metadata.json", "page_metadata_shape")
    if payload is None:
        return findings
    pages = payload.get("pages")
    if payload.get("schema_version") != 1:
        findings.append(_finding("state/page-metadata.json", "schema_version must be 1", "page_metadata_shape"))
    if not isinstance(pages, list):
        findings.append(_finding("state/page-metadata.json", "pages must be a list", "page_metadata_shape"))
        return findings
    seen_paths: set[str] = set()
    for page in pages:
        if not isinstance(page, dict):
            findings.append(_finding("state/page-metadata.json", "page entry must be an object", "page_metadata_shape"))
            continue
        path = page.get("path")
        if not isinstance(path, str) or not path:
            findings.append(_finding("state/page-metadata.json", "page entry missing path", "page_metadata_shape"))
            continue
        seen_paths.add(path)
        if page.get("page_kind") not in _ALLOWED_PAGE_KINDS:
            findings.append(_finding(path, f"invalid page_kind: {page.get('page_kind')}", "page_metadata_shape"))
        if page.get("confidence") not in _ALLOWED_CONFIDENCE:
            findings.append(_finding(path, f"invalid confidence: {page.get('confidence')}", "page_metadata_shape"))
        tags = page.get("tags")
        if not isinstance(tags, list) or f"project/{payload.get('project_key')}" not in tags:
            findings.append(_finding(path, "page tags must include project/<key>", "page_metadata_shape"))
        kind_tag = f"kind/{page.get('page_kind')}"
        if not isinstance(tags, list) or kind_tag not in tags:
            findings.append(_finding(path, f"page tags must include {kind_tag}", "page_metadata_shape"))
    catalog_path = project_dir / "state" / "pages.json"
    if catalog_path.is_file():
        catalog_pages = {
            entry["path"]
            for entry in json.loads(catalog_path.read_text()).get("pages", [])
            if isinstance(entry, dict) and "path" in entry
        }
        for missing in sorted(catalog_pages - seen_paths):
            findings.append(_finding(missing, "page missing from page-metadata.json", "page_metadata_shape"))
    return findings


def tag_index_consistency(project_dir: Path) -> list[dict]:
    metadata, findings = _load_state_json(project_dir, "page-metadata.json", "tag_index_consistency")
    tag_index, tag_findings = _load_state_json(project_dir, "tag-index.json", "tag_index_consistency")
    findings.extend(tag_findings)
    if metadata is None or tag_index is None:
        return findings
    tags = tag_index.get("tags")
    if not isinstance(tags, dict):
        return findings + [_finding("state/tag-index.json", "tags must be an object", "tag_index_consistency")]
    for page in metadata.get("pages", []):
        if not isinstance(page, dict):
            continue
        path = page.get("path")
        for tag in page.get("tags", []):
            if path not in tags.get(tag, []):
                findings.append(_finding(path, f"tag-index missing {tag}", "tag_index_consistency"))
    known_paths = {
        page.get("path")
        for page in metadata.get("pages", [])
        if isinstance(page, dict) and isinstance(page.get("path"), str)
    }
    for tag, paths in tags.items():
        if not isinstance(paths, list):
            findings.append(_finding("state/tag-index.json", f"tag {tag} must map to a list", "tag_index_consistency"))
            continue
        for path in paths:
            if path not in known_paths:
                findings.append(_finding(str(path), f"tag-index references unknown page for {tag}", "tag_index_consistency"))
    return findings


def alias_index_consistency(project_dir: Path) -> list[dict]:
    metadata, findings = _load_state_json(project_dir, "page-metadata.json", "alias_index_consistency")
    alias_index, alias_findings = _load_state_json(project_dir, "alias-index.json", "alias_index_consistency")
    findings.extend(alias_findings)
    if metadata is None or alias_index is None:
        return findings
    aliases = alias_index.get("aliases")
    if not isinstance(aliases, dict):
        return findings + [_finding("state/alias-index.json", "aliases must be an object", "alias_index_consistency")]
    for page in metadata.get("pages", []):
        if not isinstance(page, dict):
            continue
        path = page.get("path")
        for alias in page.get("aliases", []):
            candidates = aliases.get(str(alias).lower(), [])
            if not any(isinstance(candidate, dict) and candidate.get("path") == path for candidate in candidates):
                findings.append(_finding(path, f"alias-index missing {alias}", "alias_index_consistency"))
    known_paths = {
        page.get("path")
        for page in metadata.get("pages", [])
        if isinstance(page, dict) and isinstance(page.get("path"), str)
    }
    for alias, candidates in aliases.items():
        if not isinstance(candidates, list):
            findings.append(_finding("state/alias-index.json", f"alias {alias} must map to a list", "alias_index_consistency"))
            continue
        for candidate in candidates:
            if not isinstance(candidate, dict) or candidate.get("path") not in known_paths:
                findings.append(_finding(str(candidate), f"alias-index references unknown page for {alias}", "alias_index_consistency"))
    return findings


def relationship_schema(project_dir: Path) -> list[dict]:
    payload, findings = _load_state_json(project_dir, "relationships.json", "relationship_schema")
    if payload is None:
        return findings
    relationships = payload.get("relationships")
    if not isinstance(relationships, list):
        return findings + [_finding("state/relationships.json", "relationships must be a list", "relationship_schema")]
    known_paths = _known_page_paths(project_dir)
    for relationship in relationships:
        if not isinstance(relationship, dict):
            findings.append(_finding("state/relationships.json", "relationship entry must be an object", "relationship_schema"))
            continue
        source = relationship.get("from")
        target = relationship.get("to")
        rel_type = relationship.get("relationship_type")
        confidence = relationship.get("confidence")
        if not isinstance(source, str) or not source:
            findings.append(_finding("state/relationships.json", "relationship missing from", "relationship_schema"))
        if not isinstance(target, str) or not target:
            findings.append(_finding("state/relationships.json", "relationship missing to", "relationship_schema"))
        if rel_type not in _ALLOWED_RELATIONSHIP_TYPES:
            findings.append(_finding(str(source or "state/relationships.json"), f"invalid relationship_type: {rel_type}", "relationship_schema"))
        if confidence not in _ALLOWED_CONFIDENCE:
            findings.append(_finding(str(source or "state/relationships.json"), f"invalid confidence: {confidence}", "relationship_schema"))
        for endpoint_name, endpoint in (("from", source), ("to", target)):
            if _looks_like_project_markdown_path(endpoint) and endpoint not in known_paths:
                findings.append(_finding(str(endpoint), f"relationship {endpoint_name} endpoint not listed in pages.json", "relationship_schema"))
    return findings


def index_not_wiki_meta(project_dir: Path) -> list[dict]:
    """Block index.md content that describes the wiki instead of the project.

    The index must open by answering "what is this project" - not "what is
    this wiki." Current Priorities must carry real project priorities (or
    read honestly about the uncertain state of them), not bootstrap/wiki-
    construction narration.
    """
    findings: list[dict] = []
    index_path = project_dir / "index.md"
    if not index_path.is_file():
        return findings
    text = index_path.read_text()
    lines = text.splitlines()

    # First non-heading, non-empty line after the title heading should be a
    # project summary. If it contains any banned meta phrase, flag it.
    opening = ""
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        opening = stripped
        break

    opening_lc = opening.lower()
    for phrase in _WIKI_META_OPENING_PHRASES:
        if phrase in opening_lc:
            findings.append(
                _finding(
                    "index.md",
                    f"opening line narrates the wiki itself (contains {phrase!r}); "
                    "first non-heading line must describe the project, not the wiki",
                    "index_not_wiki_meta.opening",
                )
            )
            break

    # Current Priorities block: everything between `## Current Priorities`
    # and the next `##` heading. Banned phrases here are wiki-construction
    # narration rather than real project priorities.
    current_priorities_body: list[str] = []
    in_section = False
    for line in lines:
        stripped = line.strip()
        if stripped.lower().startswith("## current priorities"):
            in_section = True
            continue
        if in_section and stripped.startswith("## "):
            break
        if in_section:
            current_priorities_body.append(line)

    body_lc = "\n".join(current_priorities_body).lower()
    for phrase in _WIKI_META_PRIORITIES_PHRASES:
        if phrase in body_lc:
            findings.append(
                _finding(
                    "index.md",
                    f"Current Priorities narrates wiki construction (contains {phrase!r}); "
                    "replace with real project priorities or remove the section",
                    "index_not_wiki_meta.current_priorities",
                )
            )
            break

    return findings


def ranked_domain_coverage(run_dir: Path, ranking_snapshot: dict) -> list[dict]:
    """Every ranked domain must have a home: a dedicated page or a defer.

    Without this rule propose collapses high-ranked domains into umbrella
    pages, so targeted lookups ('where is entity dispatch defined?') fail
    even though the domain scored in the top-N. The ranking cutoff already
    caps the set by project size, so the rule scales automatically: small
    projects get every ranked domain on its own page, large projects get
    the top-N with everything else explicitly deferred.

    A ranked domain is considered "homed" if:
      - it appears in at least one unit's referenced_ranking_domains, OR
      - it appears in deferred_domains with a non-empty reason.
    """
    findings: list[dict] = []
    proposal_path = run_dir / "proposal.json"
    if not proposal_path.is_file():
        return findings
    proposal = json.loads(proposal_path.read_text())

    ranked_domains = [
        entry.get("domain")
        for entry in ranking_snapshot.get("ranked_domains", [])
        if isinstance(entry, dict) and entry.get("domain")
    ]

    homed: set[str] = set()
    for unit in proposal.get("units", []):
        for domain in unit.get("referenced_ranking_domains", []):
            if domain:
                homed.add(domain)

    for deferred in proposal.get("deferred_domains", []):
        if not isinstance(deferred, dict):
            continue
        domain = deferred.get("domain")
        reason = (deferred.get("reason") or "").strip()
        if domain and reason:
            homed.add(domain)

    for domain in ranked_domains:
        if domain not in homed:
            findings.append(
                _finding(
                    "proposal.json",
                    f"ranked domain '{domain}' has no home: not referenced by any "
                    "unit and not listed in deferred_domains with a reason",
                    "ranked_domain_coverage",
                )
            )

    return findings


def domain_collapse_check(run_dir: Path) -> list[dict]:
    """Flag units that collapse 3+ ranked domains into one destination page.

    Collapsing is how the first rpg_game run produced an umbrella
    `mvp-dungeon-and-quest-loop.md` that folded dungeoneering, questing,
    dynamic mobs, inventory, and loadout into a single page - defeating
    targeted lookup. Allow 2 domains per page (natural pairing), blocker
    at 3+.
    """
    findings: list[dict] = []
    proposal_path = run_dir / "proposal.json"
    if not proposal_path.is_file():
        return findings
    proposal = json.loads(proposal_path.read_text())

    for unit in proposal.get("units", []):
        referenced = [d for d in unit.get("referenced_ranking_domains", []) if d]
        if len(set(referenced)) >= 3:
            findings.append(
                _finding(
                    "proposal.json",
                    f"unit {unit.get('id', '<no-id>')} "
                    f"page_path={unit.get('page_path')!r} collapses "
                    f"{len(set(referenced))} ranked domains "
                    f"({sorted(set(referenced))}); split into dedicated pages "
                    "or justify via deferred_domains",
                    "domain_collapse_check",
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
