"""Tests for the deterministic structural validator."""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _import_struct():
    stage_dir = REPO_ROOT / "agents" / "update" / "06-validate"
    sys.path.insert(0, str(stage_dir))
    if "structural" in sys.modules:
        return importlib.reload(sys.modules["structural"])
    import structural
    return structural


def test_required_page_sections_passes_on_well_formed(tmp_path):
    struct = _import_struct()
    page = tmp_path / "wiki" / "systems" / "foo.md"
    page.parent.mkdir(parents=True)
    page.write_text(
        "One-line summary.\n\n"
        "## Repo pointers\n\n"
        "- `src/foo.py:1-10` - the foo module\n\n"
        "## Related\n\n"
        "- Known gaps: none known\n"
    )
    findings = struct.required_page_sections(tmp_path)
    assert findings == []


def test_required_page_sections_fails_on_missing_pointers(tmp_path):
    struct = _import_struct()
    page = tmp_path / "wiki" / "systems" / "foo.md"
    page.parent.mkdir(parents=True)
    page.write_text("Summary only.\n\n## Related\n- gap\n")
    findings = struct.required_page_sections(tmp_path)
    assert len(findings) == 1
    assert "Repo pointers" in findings[0]["issue"]


def test_shelf_allowlist_flags_unprescribed_dir(tmp_path):
    struct = _import_struct()
    allowed = ["architecture", "systems", "modules"]
    legal = tmp_path / "wiki" / "systems" / "ok.md"
    legal.parent.mkdir(parents=True)
    legal.write_text("ok\n\n## Repo pointers\n\n- `src/x.py:1-2` - x\n\n## Related\n\n- none\n")
    illegal = tmp_path / "wiki" / "runtime" / "bad.md"
    illegal.parent.mkdir(parents=True)
    illegal.write_text("bad\n\n## Repo pointers\n\n- `src/x.py:1-2` - x\n\n## Related\n\n- none\n")
    findings = struct.shelf_allowlist(tmp_path, allowed)
    assert len(findings) == 1
    assert "runtime" in findings[0]["issue"]
    assert findings[0]["rule_id"] == "shelf_allowlist"


def test_citation_line_range_flags_out_of_bounds(tmp_path):
    struct = _import_struct()
    src = tmp_path / "src" / "small.py"
    src.parent.mkdir(parents=True)
    src.write_text("line1\nline2\nline3\n")
    page = tmp_path / "wiki" / "systems" / "p.md"
    page.parent.mkdir(parents=True)
    page.write_text(
        "summary\n\n"
        "## Repo pointers\n\n"
        "- `src/small.py:1-10` - exceeds file length\n\n"
        "## Related\n\n- none\n"
    )
    findings = struct.citation_line_range(tmp_path, repo_root=tmp_path)
    assert len(findings) == 1
    assert "10" in findings[0]["issue"]


def test_no_orphan_pages(tmp_path):
    struct = _import_struct()
    (tmp_path / "index.md").write_text("[foo](wiki/systems/foo.md)\n")
    (tmp_path / "wiki" / "systems").mkdir(parents=True)
    (tmp_path / "wiki" / "systems" / "foo.md").write_text("foo\n")
    (tmp_path / "wiki" / "systems" / "bar.md").write_text("bar\n")
    findings = struct.no_orphan_pages(tmp_path)
    assert len(findings) == 1
    assert "bar.md" in findings[0]["page"]


def test_no_orphan_pages_exempts_only_date_prefixed_session_notes(tmp_path):
    struct = _import_struct()
    (tmp_path / "index.md").write_text("[foo](wiki/systems/foo.md)\n")
    (tmp_path / "wiki" / "systems").mkdir(parents=True)
    (tmp_path / "wiki" / "systems" / "foo.md").write_text("foo\n")
    (tmp_path / "wiki" / "systems" / "2026-04-25-foo.md").write_text("system orphan\n")
    (tmp_path / "wiki" / "sessions").mkdir(parents=True)
    (tmp_path / "wiki" / "sessions" / "2026-04-25-repair.md").write_text("archival session\n")
    (tmp_path / "wiki" / "sessions" / "current-session.md").write_text("live session\n")

    findings = struct.no_orphan_pages(tmp_path)

    orphan_pages = {finding["page"] for finding in findings}
    assert "wiki/sessions/2026-04-25-repair.md" not in orphan_pages
    assert orphan_pages == {
        "wiki/sessions/current-session.md",
        "wiki/systems/2026-04-25-foo.md",
    }


def test_pages_json_filesystem_agreement(tmp_path):
    struct = _import_struct()
    state = tmp_path / "state"
    state.mkdir()
    (tmp_path / "wiki" / "systems").mkdir(parents=True)
    (tmp_path / "wiki" / "systems" / "only-on-disk.md").write_text("x\n")
    (state / "pages.json").write_text(json.dumps({
        "pages": [
            {"path": "wiki/systems/ghost.md", "type": "systems"},
        ]
    }))
    findings = struct.pages_json_filesystem_agreement(tmp_path)
    assert len(findings) == 2


def test_pages_json_filesystem_agreement_allows_entry_pages(tmp_path):
    struct = _import_struct()
    state = tmp_path / "state"
    state.mkdir()
    (tmp_path / "index.md").write_text("Sample index\n")
    (state / "project.json").write_text(json.dumps({
        "entry_pages": ["index.md"],
    }))
    (state / "pages.json").write_text(json.dumps({
        "pages": [
            {"path": "index.md", "type": "index"},
        ]
    }))
    findings = struct.pages_json_filesystem_agreement(tmp_path)
    assert findings == []
