# Brain Metadata Relationship Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate validated, migration-safe brain metadata and typed-compatible relationship products for each project brain without breaking existing `pages.json` or legacy `references` consumers.

**Architecture:** Add a pure Python metadata generator under `agents/update/_shared/` and call it from `04-apply` after the existing page/catalog/relationship writes. Keep `pages.json` as the compatibility catalog, generate richer `page-metadata.json`, `tag-index.json`, and `alias-index.json`, preserve legacy `relationship_type: "references"`, validate generated state in `06-validate`, and publish stable JSON products under `state/latest/` after validation passes.

**Tech Stack:** Python standard library, Bash stage runners, file-backed JSON state, pytest.

---

## Implementation Constraints

- Do not commit unless the operator explicitly asks.
- Do not edit the five design specs unless a blocker is found during implementation.
- Do not introduce LLM/model-generated metadata in v1.
- Do not remove or rewrite existing `pages.json` fields.
- Do not remove legacy `relationship_type: "references"` entries.
- Do not add MCP or Obsidian features in this plan.
- Use `rtk` shell commands where practical.

## V1 Decisions

- Metadata is deterministic-only in v1.
- `pages.json` remains the compatibility catalog and primary fallback.
- New generated state files:
  - `projects/<key>/state/page-metadata.json`
  - `projects/<key>/state/tag-index.json`
  - `projects/<key>/state/alias-index.json`
- Stable products after validation:
  - `projects/<key>/state/latest/page-metadata.json`
  - `projects/<key>/state/latest/tag-index.json`
  - `projects/<key>/state/latest/alias-index.json`
  - `projects/<key>/state/latest/relationships.json`
- Relationship hop limits are not implemented in this plan; that belongs to the later query planner plan.
- Project/brain-level metadata is not implemented in this plan; `page-metadata.json` is the first milestone.
- `last_verified_commit` uses `last_seen_commit_pending` when present, falling back to `last_seen_commit`. This records the commit the just-applied wiki state is intended to represent before `apply_commit.sh` advances the committed pointer.
- Relationship endpoint validation is included in v1 for project-relative Markdown endpoints. External or future source-node endpoints can be added later, but page-to-page `from` / `to` values must resolve to known pages when they look like `index.md` or `wiki/**/*.md`.

## JSON Contracts

### `page-metadata.json`

```json
{
  "schema_version": 1,
  "generated_at": "2026-04-29T12:00:00+00:00",
  "project_key": "sample",
  "pages": [
    {
      "path": "wiki/systems/authentication.md",
      "title": "Authentication",
      "project_key": "sample",
      "page_kind": "system",
      "domains": ["authentication"],
      "topics": ["auth", "sessions"],
      "aliases": ["Authentication", "authentication"],
      "tags": ["project/sample", "kind/system", "domain/authentication", "status/fresh", "role/source-backed"],
      "source_paths": ["src/auth.py:1-20"],
      "freshness_status": "fresh",
      "confidence": "high",
      "last_verified_at": "2026-04-29T12:00:00+00:00",
      "last_verified_commit": "abc123",
      "summary": "Authentication handles user sessions.",
      "entrypoint_rank": null,
      "canonical": true
    }
  ]
}
```

### `tag-index.json`

```json
{
  "schema_version": 1,
  "generated_at": "2026-04-29T12:00:00+00:00",
  "project_key": "sample",
  "tags": {
    "project/sample": ["wiki/systems/authentication.md"],
    "kind/system": ["wiki/systems/authentication.md"],
    "domain/authentication": ["wiki/systems/authentication.md"]
  }
}
```

### `alias-index.json`

```json
{
  "schema_version": 1,
  "generated_at": "2026-04-29T12:00:00+00:00",
  "project_key": "sample",
  "aliases": {
    "authentication": [
      {
        "path": "wiki/systems/authentication.md",
        "title": "Authentication",
        "page_kind": "system"
      }
    ]
  }
}
```

### `relationships.json`

Existing payload shape remains valid. The first implementation only guarantees that current and future entries pass structural validation:

```json
{
  "relationships": [
    {
      "from": "wiki/systems/authentication.md",
      "to": "wiki/modules/session-store.md",
      "relationship_type": "references",
      "confidence": "high"
    }
  ]
}
```

Typed relationship expansion happens in a later relationship-enhancement plan. This plan validates compatibility and preserves legacy entries.

## Task 1: Add Pure Metadata Generator

**Files:**
- Create: `agents/update/_shared/brain_metadata.py`
- Create: `tests/test_brain_metadata.py`

- [ ] **Step 1: Write failing tests for page-kind mapping and tag generation**

Add this to `tests/test_brain_metadata.py`:

```python
from agents.update._shared import brain_metadata


def test_page_kind_from_catalog_type_maps_existing_shelves():
    assert brain_metadata.page_kind_from_catalog_type("systems") == "system"
    assert brain_metadata.page_kind_from_catalog_type("modules") == "module"
    assert brain_metadata.page_kind_from_catalog_type("integrations") == "integration"
    assert brain_metadata.page_kind_from_catalog_type("runbooks") == "runbook"
    assert brain_metadata.page_kind_from_catalog_type("index") == "index"


def test_build_tags_includes_project_kind_status_domain_and_source_role():
    tags = brain_metadata.build_tags(
        project_key="sample",
        page_kind="system",
        domains=["Authentication Flow"],
        freshness_status="fresh",
        source_paths=["src/auth.py:1-10"],
        canonical=True,
    )

    assert tags == [
        "project/sample",
        "kind/system",
        "domain/authentication-flow",
        "status/fresh",
        "role/source-backed",
        "role/canonical",
    ]
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```bash
.venv/bin/pytest tests/test_brain_metadata.py -q
```

Expected: fail with import or missing function errors for `brain_metadata`.

- [ ] **Step 3: Implement the minimal mapping and tag helpers**

Create `agents/update/_shared/brain_metadata.py`:

```python
from __future__ import annotations

import re


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
```

- [ ] **Step 4: Run tests and confirm they pass**

Run:

```bash
.venv/bin/pytest tests/test_brain_metadata.py -q
```

Expected: `2 passed`.

## Task 2: Generate Page Metadata And Indexes From Existing State

**Files:**
- Modify: `agents/update/_shared/brain_metadata.py`
- Modify: `tests/test_brain_metadata.py`

- [ ] **Step 1: Write failing tests for metadata payload and indexes**

Append to `tests/test_brain_metadata.py`:

```python
def test_build_metadata_products_uses_existing_catalog_without_mutating_pages_json():
    products = brain_metadata.build_metadata_products(
        project_key="sample",
        project_state={"entry_pages": ["index.md"]},
        pages=[
            {
                "path": "index.md",
                "type": "index",
                "summary": "Sample brain.",
                "linked_sources": [],
                "linked_topics": ["overview"],
                "last_reviewed_at": "2026-04-29T12:00:00+00:00",
                "freshness_status": "fresh",
            },
            {
                "path": "wiki/systems/authentication.md",
                "type": "systems",
                "summary": "Authentication handles sessions.",
                "linked_sources": ["src/auth.py:1-10"],
                "linked_topics": ["authentication", "sessions"],
                "last_reviewed_at": "2026-04-29T12:00:00+00:00",
                "freshness_status": "fresh",
            },
        ],
        freshness={"last_seen_commit": "abc123", "last_seen_commit_pending": "def456"},
        generated_at="2026-04-29T12:00:00+00:00",
    )

    page_metadata = products["page_metadata"]
    assert page_metadata["schema_version"] == 1
    assert page_metadata["project_key"] == "sample"
    assert page_metadata["pages"][0]["page_kind"] == "index"
    assert page_metadata["pages"][0]["canonical"] is True
    assert page_metadata["pages"][1]["page_kind"] == "system"
    assert page_metadata["pages"][1]["domains"] == ["authentication", "sessions"]
    assert page_metadata["pages"][1]["source_paths"] == ["src/auth.py:1-10"]
    assert page_metadata["pages"][1]["last_verified_commit"] == "def456"

    tag_index = products["tag_index"]
    assert tag_index["tags"]["kind/system"] == ["wiki/systems/authentication.md"]
    assert tag_index["tags"]["role/source-backed"] == ["wiki/systems/authentication.md"]

    alias_index = products["alias_index"]
    assert alias_index["aliases"]["authentication"] == [
        {
            "path": "wiki/systems/authentication.md",
            "title": "Authentication",
            "page_kind": "system",
        }
    ]
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```bash
.venv/bin/pytest tests/test_brain_metadata.py -q
```

Expected: fail with missing `build_metadata_products`.

- [ ] **Step 3: Implement deterministic metadata generation**

Extend `agents/update/_shared/brain_metadata.py`:

```python
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1


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


def _append_index(index: dict[str, list[str]], key: str, path: str) -> None:
    index.setdefault(key, [])
    if path not in index[key]:
        index[key].append(path)


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
        domains = topics[:]
        source_paths = [str(source) for source in page.get("linked_sources", []) if str(source).strip()]
        freshness_status = str(page.get("freshness_status") or "unknown")
        canonical = path in entry_pages or page_kind in {"architecture", "system", "module", "integration", "runbook", "decision"}
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
```

- [ ] **Step 4: Fix `_append_index` to support alias objects**

Replace `_append_index` with:

```python
def _append_index(index: dict[str, list[Any]], key: str, value: Any) -> None:
    index.setdefault(key, [])
    if value not in index[key]:
        index[key].append(value)
```

- [ ] **Step 5: Run focused tests and confirm they pass**

Run:

```bash
.venv/bin/pytest tests/test_brain_metadata.py -q
```

Expected: all tests in `tests/test_brain_metadata.py` pass.

## Task 3: Wire Metadata Generation Into `04-apply`

**Files:**
- Modify: `agents/update/04-apply/run.sh`
- Modify: `tests/test_update_validate.py`

- [ ] **Step 1: Write failing apply-path test for generated state files**

Append to `tests/test_update_validate.py`:

```python
def test_apply_generates_brain_metadata_products(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )

    state_dir = tmp_sample_project_with_repo / "state"
    page_metadata = json.loads((state_dir / "page-metadata.json").read_text())
    tag_index = json.loads((state_dir / "tag-index.json").read_text())
    alias_index = json.loads((state_dir / "alias-index.json").read_text())

    assert page_metadata["schema_version"] == 1
    assert page_metadata["project_key"] == "sample"
    assert page_metadata["pages"]
    assert tag_index["tags"]["project/sample"]
    assert alias_index["aliases"]
    assert env["AUTO"] == "1"


def test_apply_preserves_existing_pages_json_fields(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    before_payload = json.loads((tmp_sample_project_with_repo / "state" / "pages.json").read_text())
    before_keys = {
        entry["path"]: set(entry.keys())
        for entry in before_payload.get("pages", [])
        if isinstance(entry, dict) and "path" in entry
    }

    _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )

    after_payload = json.loads((tmp_sample_project_with_repo / "state" / "pages.json").read_text())
    after_by_path = {
        entry["path"]: entry
        for entry in after_payload.get("pages", [])
        if isinstance(entry, dict) and "path" in entry
    }
    for path, keys in before_keys.items():
        assert path in after_by_path
        assert keys <= set(after_by_path[path].keys())
```

- [ ] **Step 2: Run the single test and confirm it fails**

Run:

```bash
.venv/bin/pytest tests/test_update_validate.py::test_apply_generates_brain_metadata_products tests/test_update_validate.py::test_apply_preserves_existing_pages_json_fields -q
```

Expected: fail because `state/page-metadata.json` does not exist.

- [ ] **Step 3: Add repo-root import path inside apply**

In the embedded Python block in `agents/update/04-apply/run.sh`, after `root_dir = Path(sys.argv[5])`, add:

```python
sys.path.insert(0, str(root_dir))
```

This matches the import pattern used by the other Python-backed stages and keeps `04-apply` runnable outside the repo cwd.

- [ ] **Step 4: Import and call the generator inside apply**

In the embedded Python block in `agents/update/04-apply/run.sh`, import the generator near the other imports:

```python
from agents.update._shared import brain_metadata
```

Then after `freshness_path.write_text(json.dumps(freshness, indent=2) + "\n")`, add:

```python
project_state = json.loads((project_dir / "state" / "project.json").read_text())
pages_payload = json.loads((project_dir / "state" / "pages.json").read_text())
freshness_payload = json.loads((project_dir / "state" / "freshness.json").read_text())
products = brain_metadata.build_metadata_products(
    project_key=project_key,
    project_state=project_state,
    pages=pages_payload.get("pages", []),
    freshness=freshness_payload,
    generated_at=now,
)
(project_dir / "state" / "page-metadata.json").write_text(
    json.dumps(products["page_metadata"], indent=2) + "\n"
)
(project_dir / "state" / "tag-index.json").write_text(
    json.dumps(products["tag_index"], indent=2) + "\n"
)
(project_dir / "state" / "alias-index.json").write_text(
    json.dumps(products["alias_index"], indent=2) + "\n"
)
```

- [ ] **Step 5: Run the apply-path tests and confirm they pass**

Run:

```bash
.venv/bin/pytest tests/test_update_validate.py::test_apply_generates_brain_metadata_products tests/test_update_validate.py::test_apply_preserves_existing_pages_json_fields -q
```

Expected: both tests pass.

## Task 4: Add Structural Validation Rules For Metadata Products

**Files:**
- Modify: `agents/update/06-validate/structural.py`
- Modify: `agents/update/06-validate/config.json`
- Modify: `agents/update/06-validate/run.sh`
- Modify: `tests/test_update_validate.py`
- Modify: `tests/test_validate_stage_configs.py`

- [ ] **Step 1: Add config assertion for new structural rules**

Extend `test_validate_config_exists` in `tests/test_validate_stage_configs.py`:

```python
    for rule in {
        "page_metadata_shape",
        "tag_index_consistency",
        "alias_index_consistency",
        "relationship_schema",
    }:
        assert rule in data["stage_specific"]["structural_rules"]
```

- [ ] **Step 2: Add failing validate test for missing metadata products**

Append to `tests/test_update_validate.py`:

```python
def test_validate_fails_when_metadata_products_are_missing(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    for name in ("page-metadata.json", "tag-index.json", "alias-index.json"):
        (tmp_sample_project_with_repo / "state" / name).unlink()

    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)

    assert rc.returncode != 0
    findings = json.loads((run_dir / "validation-findings.json").read_text())
    rule_ids = {finding["rule_id"] for finding in findings["structural"]}
    assert "page_metadata_shape" in rule_ids
    assert "tag_index_consistency" in rule_ids
    assert "alias_index_consistency" in rule_ids
```

- [ ] **Step 3: Add validation helper functions**

Add these functions to `agents/update/06-validate/structural.py`:

```python
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
```

- [ ] **Step 4: Register rules in config**

Add these strings to `agents/update/06-validate/config.json::stage_specific.structural_rules`:

```json
"page_metadata_shape",
"tag_index_consistency",
"alias_index_consistency",
"relationship_schema"
```

- [ ] **Step 5: Wire rules into validate run loop**

In `agents/update/06-validate/run.sh`, after `pages_json_filesystem_agreement`, add:

```python
structural_findings.extend(structural.page_metadata_shape(project_dir))
structural_findings.extend(structural.tag_index_consistency(project_dir))
structural_findings.extend(structural.alias_index_consistency(project_dir))
structural_findings.extend(structural.relationship_schema(project_dir))
```

- [ ] **Step 6: Run focused validation tests**

Run:

```bash
.venv/bin/pytest tests/test_validate_stage_configs.py::test_validate_config_exists tests/test_update_validate.py::test_validate_fails_when_metadata_products_are_missing tests/test_update_validate.py::test_validate_passes_on_clean_apply -q
```

Expected: all selected tests pass.

## Task 5: Publish Stable Metadata Products

**Files:**
- Modify: `scripts/stable_products.py`
- Modify: `scripts/compile.sh`
- Modify: `scripts/update.sh`
- Create or modify: `tests/test_stable_metadata_products.py`

- [ ] **Step 1: Write failing stable-product renderer test**

Create `tests/test_stable_metadata_products.py`:

```python
import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_render_metadata_products_copies_generated_state_to_latest(tmp_sample_project):
    state = tmp_sample_project / "state"
    (state / "page-metadata.json").write_text(json.dumps({"schema_version": 1, "pages": []}) + "\n")
    (state / "tag-index.json").write_text(json.dumps({"schema_version": 1, "tags": {}}) + "\n")
    (state / "alias-index.json").write_text(json.dumps({"schema_version": 1, "aliases": {}}) + "\n")
    (state / "relationships.json").write_text(json.dumps({"relationships": []}) + "\n")

    result = subprocess.run(
        [
            sys.executable,
            str(REPO_ROOT / "scripts" / "stable_products.py"),
            "render-metadata",
            "--project-dir",
            str(tmp_sample_project),
        ],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    latest = state / "latest"
    assert json.loads((latest / "page-metadata.json").read_text())["schema_version"] == 1
    assert json.loads((latest / "tag-index.json").read_text())["schema_version"] == 1
    assert json.loads((latest / "alias-index.json").read_text())["schema_version"] == 1
    assert json.loads((latest / "relationships.json").read_text())["relationships"] == []
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
.venv/bin/pytest tests/test_stable_metadata_products.py -q
```

Expected: fail because `render-metadata` subcommand does not exist.

- [ ] **Step 3: Add `render-metadata` subcommand**

In `scripts/stable_products.py`, add:

```python
def cmd_render_metadata(args: argparse.Namespace) -> int:
    project_dir = Path(args.project_dir)
    latest_dir = ensure_latest_dir(project_dir)
    state_dir = project_dir / "state"
    for name in ("page-metadata.json", "tag-index.json", "alias-index.json", "relationships.json"):
        source = state_dir / name
        if not source.is_file():
            raise SystemExit(f"missing metadata product: {source}")
        payload = load_json(source)
        write_json(latest_dir / name, payload)
    return 0
```

Then register the parser in `main()`:

```python
metadata = sub.add_parser("render-metadata")
metadata.add_argument("--project-dir", required=True)
metadata.set_defaults(func=cmd_render_metadata)
```

Use the existing parser variable names in the file. Do not rename existing subcommands.

- [ ] **Step 4: Run stable-product test**

Run:

```bash
.venv/bin/pytest tests/test_stable_metadata_products.py -q
```

Expected: `1 passed`.

- [ ] **Step 5: Wire stable product publication after final validation passes**

In `scripts/compile.sh`, add metadata publication only after the reconcile block has finished and `validate_exit` is confirmed zero. Place it immediately before the acceptance stage:

```bash
  python3 "$ROOT_DIR/scripts/stable_products.py" render-metadata \
    --project-dir "$project_dir" || return 1
```

The intended location is after this block:

```bash
  if [[ "$validate_exit" -ne 0 ]]; then
    ...
  else
    skip_stage 6 "reconcile"
  fi
```

and before:

```bash
  run_stage 7 "acceptance" bash "$STAGES_ROOT/05-acceptance/run.sh" \
```

In `scripts/update.sh`, add metadata publication only after all reconcile/self-correct paths have completed and after `final_status` is computed. Place it after:

```bash
if [[ "$apply_exit" -ne 0 || "$validate_exit" -ne 0 || "$self_correct_exit" -ne 0 ]]; then
  final_status="fail"
  terminal_outcome="needs-review"
fi
```

and before:

```bash
run_stage 6 "terminal-state" terminalize_items "$terminal_outcome" "$reason_file" || true
```

Use this guard:

```bash
if [[ "$final_status" == "pass" ]]; then
  python3 "$ROOT_DIR/scripts/stable_products.py" render-metadata \
    --project-dir "$project_dir"
fi
```

Preserve existing validation and ingest rendering calls. Do not publish metadata on intermediate validation passes before reconcile or self-correct can apply more changes.

- [ ] **Step 6: Run focused orchestration smoke tests**

Run:

```bash
.venv/bin/pytest tests/test_stable_metadata_products.py tests/test_update_validate.py::test_validate_passes_on_clean_apply -q
```

Expected: all selected tests pass.

## Task 6: Add Compatibility Regression Coverage

**Files:**
- Modify: `tests/test_query_engine.py`
- Modify: `tests/test_update_validate.py`

- [ ] **Step 1: Add test that query still works without metadata products**

In `tests/test_query_engine.py`, add a test that removes `page-metadata.json`, `tag-index.json`, and `alias-index.json` from the fixture project before calling `query_engine.query(...)`.

Use this structure:

```python
def test_query_still_uses_pages_json_when_metadata_products_are_absent(tmp_sample_project, monkeypatch):
    from agents.query import query_engine

    for name in ("page-metadata.json", "tag-index.json", "alias-index.json"):
        path = tmp_sample_project / "state" / name
        if path.exists():
            path.unlink()

    def fake_invoke(*, stage_id: str, prompt: str, model_override: str | None = None):
        if stage_id == "query.router":
            return {
                "response": {"pages": ["index.md"], "confidence": 0.8},
                "tokens_consumed": {"input_chars": 1, "output_chars": 1},
            }
        return {
            "response": {"answer": "ok", "confidence": 0.8, "citations": ["index.md"]},
            "tokens_consumed": {"input_chars": 1, "output_chars": 1},
        }

    monkeypatch.setattr(query_engine.llm_client, "invoke", fake_invoke)

    result = query_engine.query(
        project_key="sample",
        question="what is this",
        projects_root=tmp_sample_project.parent,
    )

    assert result["answer"] == "ok"
    assert result["citations"] == ["index.md"]
```

- [ ] **Step 2: Add test that legacy `references` relationship remains valid**

Append to `tests/test_update_validate.py`:

```python
def test_validate_accepts_legacy_references_relationship(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    relationships_path = tmp_sample_project_with_repo / "state" / "relationships.json"
    relationships_path.write_text(json.dumps({
        "relationships": [
            {
                "from": "index.md",
                "to": "wiki/systems/authentication.md",
                "relationship_type": "references",
                "confidence": "high",
            }
        ]
    }) + "\n")

    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)

    assert rc.returncode == 0, rc.stderr


def test_validate_accepts_legacy_relationship_extra_fields(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    relationships_path = tmp_sample_project_with_repo / "state" / "relationships.json"
    relationships_path.write_text(json.dumps({
        "relationships": [
            {
                "from": "index.md",
                "to": "wiki/systems/authentication.md",
                "relationship_type": "references",
                "confidence": "high",
                "legacy_note": "preserve additive fields",
            }
        ]
    }) + "\n")

    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)

    assert rc.returncode == 0, rc.stderr


def test_validate_rejects_unknown_relationship_page_endpoint(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    relationships_path = tmp_sample_project_with_repo / "state" / "relationships.json"
    relationships_path.write_text(json.dumps({
        "relationships": [
            {
                "from": "index.md",
                "to": "wiki/systems/missing.md",
                "relationship_type": "references",
                "confidence": "high",
            }
        ]
    }) + "\n")

    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)

    assert rc.returncode != 0
    findings = json.loads((run_dir / "validation-findings.json").read_text())
    assert any(finding["rule_id"] == "relationship_schema" for finding in findings["structural"])
```

- [ ] **Step 3: Run compatibility tests**

Run:

```bash
.venv/bin/pytest tests/test_query_engine.py::test_query_still_uses_pages_json_when_metadata_products_are_absent tests/test_update_validate.py::test_validate_accepts_legacy_references_relationship tests/test_update_validate.py::test_validate_accepts_legacy_relationship_extra_fields tests/test_update_validate.py::test_validate_rejects_unknown_relationship_page_endpoint -q
```

Expected: all selected tests pass.

## Task 7: Final Verification

**Files:**
- Modify: none

- [ ] **Step 1: Run focused metadata foundation suite**

Run:

```bash
.venv/bin/pytest tests/test_brain_metadata.py tests/test_stable_metadata_products.py tests/test_validate_stage_configs.py tests/test_update_validate.py tests/test_query_engine.py -q
```

Expected: all selected tests pass. If unrelated existing fixture failures appear, isolate and report them with exact failing test names.

- [ ] **Step 2: Inspect diff**

Run:

```bash
rtk git diff -- agents/update/_shared/brain_metadata.py agents/update/04-apply/run.sh agents/update/06-validate/structural.py agents/update/06-validate/config.json agents/update/06-validate/run.sh scripts/stable_products.py tests/test_brain_metadata.py tests/test_stable_metadata_products.py tests/test_update_validate.py tests/test_validate_stage_configs.py tests/test_query_engine.py
```

Expected: diff only contains metadata foundation work described in this plan.

- [ ] **Step 3: Confirm no generated project state was accidentally committed into fixtures**

Run:

```bash
rtk git status --short
```

Expected: source/test files changed; no unexpected `projects/<key>/state/page-metadata.json`, `tag-index.json`, `alias-index.json`, or `state/latest/*` artifacts unless a test fixture explicitly needs them.

## Acceptance Criteria

- `04-apply` generates `page-metadata.json`, `tag-index.json`, and `alias-index.json`.
- Existing `pages.json` shape remains compatible with current query code.
- Legacy `relationship_type: "references"` remains valid.
- `06-validate` fails clearly when metadata products are missing or malformed.
- Successful validation can publish stable metadata JSON products under `state/latest/`.
- Query code continues to work when metadata products are absent.
- No MCP or Obsidian behavior changes are included in this plan.
