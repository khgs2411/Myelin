from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _seed_project(tmp_path: Path) -> Path:
    project_dir = tmp_path / "projects" / "sample"
    (project_dir / "state").mkdir(parents=True)
    (project_dir / "wiki" / "systems").mkdir(parents=True)
    (project_dir / "index.md").write_text("# Sample\n\nCanonical index.\n", encoding="utf-8")
    (project_dir / "wiki" / "systems" / "auth.md").write_text(
        "# Auth\n\nCanonical auth page.\n",
        encoding="utf-8",
    )
    (project_dir / "state" / "project.json").write_text(
        json.dumps({"key": "sample", "name": "Sample"}, indent=2) + "\n",
        encoding="utf-8",
    )
    (project_dir / "state" / "page-metadata.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "project_key": "sample",
                "pages": [
                    {
                        "path": "index.md",
                        "title": "Index",
                        "project_key": "sample",
                        "page_kind": "index",
                        "domains": ["overview"],
                        "topics": ["overview"],
                        "aliases": ["Index", "Sample"],
                        "tags": ["project/sample", "kind/index", "status/fresh", "role/canonical"],
                        "source_paths": [],
                        "freshness_status": "fresh",
                        "last_verified_commit": "abc123",
                        "last_verified_at": "2026-04-29T12:00:00+00:00",
                        "entrypoint_rank": 1,
                        "canonical": True,
                    },
                    {
                        "path": "wiki/systems/auth.md",
                        "title": "Auth",
                        "project_key": "sample",
                        "page_kind": "system",
                        "domains": ["authentication"],
                        "topics": ["sessions"],
                        "aliases": ["Auth", "Authentication"],
                        "tags": [
                            "project/sample",
                            "kind/system",
                            "domain/authentication",
                            "status/stale",
                            "role/source-backed",
                            "role/canonical",
                        ],
                        "source_paths": ["src/auth.py:1-10"],
                        "freshness_status": "stale",
                        "last_verified_commit": "def456",
                        "last_verified_at": "2026-04-29T13:00:00+00:00",
                        "entrypoint_rank": None,
                        "canonical": True,
                    },
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return project_dir


def _seed_legacy_project(tmp_path: Path) -> Path:
    project_dir = tmp_path / "projects" / "sample"
    (project_dir / "state").mkdir(parents=True)
    (project_dir / "index.md").write_text("# Sample\n\nCanonical index.\n", encoding="utf-8")
    (project_dir / "state" / "project.json").write_text(
        json.dumps({"key": "sample", "name": "Sample", "entry_pages": ["index.md"]}, indent=2) + "\n",
        encoding="utf-8",
    )
    (project_dir / "state" / "pages.json").write_text(
        json.dumps(
            {
                "pages": [
                    {
                        "path": "index.md",
                        "type": "index",
                        "summary": "Primary entry point.",
                        "linked_sources": [],
                        "linked_topics": ["overview"],
                        "last_reviewed_at": "2026-04-29T12:00:00+00:00",
                        "freshness_status": "fresh",
                    }
                ]
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (project_dir / "state" / "freshness.json").write_text(
        json.dumps({"last_seen_commit": "abc123", "updated_at": "2026-04-29T12:00:00+00:00"}, indent=2) + "\n",
        encoding="utf-8",
    )
    return project_dir


def test_make_obsidian_generates_export_tree_and_preserves_canonical_pages(tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    before_index = (project_dir / "index.md").read_text(encoding="utf-8")
    before_auth = (project_dir / "wiki" / "systems" / "auth.md").read_text(encoding="utf-8")

    rc = subprocess.run(
        ["make", "obsidian", "PROJECT=sample"],
        cwd=REPO_ROOT,
        env={**os.environ, "UPDATE_PROJECTS_ROOT": str(project_dir.parent)},
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, f"stdout={rc.stdout} stderr={rc.stderr}"
    export_dir = project_dir / "obsidian"
    assert (export_dir / "README.md").is_file()
    assert (export_dir / "graph-groups.md").is_file()
    assert (export_dir / "bases" / "README.md").is_file()
    assert (export_dir / "_brain-sample.md").is_file()
    assert (export_dir / "pages" / "index.md").is_file()
    assert (export_dir / "pages" / "wiki" / "systems" / "auth.md").is_file()
    assert (project_dir / "index.md").read_text(encoding="utf-8") == before_index
    assert (project_dir / "wiki" / "systems" / "auth.md").read_text(encoding="utf-8") == before_auth


def test_make_obsidian_backfills_metadata_for_legacy_project(tmp_path: Path):
    project_dir = _seed_legacy_project(tmp_path)

    rc = subprocess.run(
        ["make", "obsidian", "PROJECT=sample"],
        cwd=REPO_ROOT,
        env={**os.environ, "UPDATE_PROJECTS_ROOT": str(project_dir.parent)},
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, f"stdout={rc.stdout} stderr={rc.stderr}"
    assert (project_dir / "state" / "page-metadata.json").is_file()
    assert (project_dir / "state" / "tag-index.json").is_file()
    assert (project_dir / "state" / "alias-index.json").is_file()
    assert (project_dir / "obsidian" / "_brain-sample.md").is_file()
    assert (project_dir / "obsidian" / "pages" / "index.md").is_file()


def test_projected_page_includes_frontmatter_tags_and_canonical_content(tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    rc = subprocess.run(
        ["python3", str(REPO_ROOT / "scripts" / "export_obsidian.py"), "--project-dir", str(project_dir)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, rc.stderr
    content = (project_dir / "obsidian" / "pages" / "wiki" / "systems" / "auth.md").read_text(
        encoding="utf-8"
    )
    assert content.startswith("---\n")
    assert 'project: "sample"' in content
    assert 'kind: "system"' in content
    assert '  - "authentication"' in content
    assert '  - "#project/sample"' in content
    assert '  - "#kind/system"' in content
    assert '  - "#status/stale"' in content
    assert '  - "Authentication"' in content
    assert 'freshness: "stale"' in content
    assert 'canonical_path: "wiki/systems/auth.md"' in content
    assert "# Auth\n\nCanonical auth page.\n" in content


def test_index_projection_has_graph_label_brain_home_and_project_alias(tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    rc = subprocess.run(
        ["python3", str(REPO_ROOT / "scripts" / "export_obsidian.py"), "--project-dir", str(project_dir)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, rc.stderr
    content = (project_dir / "obsidian" / "pages" / "index.md").read_text(encoding="utf-8")
    assert 'graph_label: "sample: Index"' in content
    assert 'brain_home: "_brain-sample.md"' in content
    assert '  - "Sample Index"' in content


def test_hub_note_links_every_projected_page(tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    rc = subprocess.run(
        ["python3", str(REPO_ROOT / "scripts" / "export_obsidian.py"), "--project-dir", str(project_dir)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, rc.stderr
    content = (project_dir / "obsidian" / "_brain-sample.md").read_text(encoding="utf-8")
    assert 'graph_label: "sample: Home"' in content
    assert "brain_home: true" in content
    assert "- [Index](pages/index.md)" in content
    assert "- [Auth](pages/wiki/systems/auth.md)" in content
    readme = (project_dir / "obsidian" / "README.md").read_text(encoding="utf-8")
    graph_groups = (project_dir / "obsidian" / "graph-groups.md").read_text(encoding="utf-8")
    assert "`_brain-sample.md` is the generated graph hub" in readme
    assert "The generated `_brain-sample.md` hub links every projected page." in graph_groups


def test_missing_metadata_fails_clearly(tmp_path: Path):
    project_dir = tmp_path / "projects" / "sample"
    (project_dir / "state").mkdir(parents=True)

    rc = subprocess.run(
        ["python3", str(REPO_ROOT / "scripts" / "export_obsidian.py"), "--project-dir", str(project_dir)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )

    assert rc.returncode != 0
    assert "metadata has not been generated yet" in rc.stderr


def test_export_deletion_is_constrained_to_obsidian_directory(tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    keep_dir = project_dir / "not-obsidian"
    keep_dir.mkdir()
    (keep_dir / "keep.md").write_text("keep\n", encoding="utf-8")
    old_export = project_dir / "obsidian"
    old_export.mkdir()
    (old_export / "old.md").write_text("old\n", encoding="utf-8")

    rc = subprocess.run(
        ["python3", str(REPO_ROOT / "scripts" / "export_obsidian.py"), "--project-dir", str(project_dir)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, rc.stderr
    assert not (project_dir / "obsidian" / "old.md").exists()
    assert (keep_dir / "keep.md").read_text(encoding="utf-8") == "keep\n"


def test_bases_markdown_escapes_table_pipes(tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    metadata_path = project_dir / "state" / "page-metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["pages"][1]["title"] = "Auth | Sessions"
    metadata["pages"][1]["domains"] = ["auth|sessions"]
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    rc = subprocess.run(
        ["python3", str(REPO_ROOT / "scripts" / "export_obsidian.py"), "--project-dir", str(project_dir)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, rc.stderr
    bases = (project_dir / "obsidian" / "bases" / "README.md").read_text(encoding="utf-8")
    assert "Auth \\| Sessions" in bases
    assert "auth\\|sessions" in bases


def test_graph_groups_do_not_include_path_derived_domain_tags(tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    metadata_path = project_dir / "state" / "page-metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["pages"][1]["topics"] = [
        "authentication",
        "index.md",
        "wiki/architecture/project-state.md",
    ]
    metadata["pages"][1]["domains"] = ["authentication"]
    metadata["pages"][1]["tags"] = [
        "project/sample",
        "kind/system",
        "domain/authentication",
        "status/stale",
    ]
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    rc = subprocess.run(
        ["python3", str(REPO_ROOT / "scripts" / "export_obsidian.py"), "--project-dir", str(project_dir)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, rc.stderr
    graph_groups = (project_dir / "obsidian" / "graph-groups.md").read_text(encoding="utf-8")
    assert "#domain/authentication" in graph_groups
    assert "#domain/index-md" not in graph_groups
    assert "#domain/wiki/" not in graph_groups
