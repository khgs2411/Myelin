import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

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
                "linked_topics": [
                    "authentication",
                    "sessions",
                    "index.md",
                    "wiki/architecture/project-state.md",
                ],
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
    assert page_metadata["pages"][1]["topics"] == [
        "authentication",
        "sessions",
        "index.md",
        "wiki/architecture/project-state.md",
    ]
    assert page_metadata["pages"][1]["domains"] == ["authentication", "sessions"]
    assert page_metadata["pages"][1]["source_paths"] == ["src/auth.py:1-10"]
    assert page_metadata["pages"][1]["last_verified_commit"] == "def456"

    tag_index = products["tag_index"]
    assert tag_index["tags"]["kind/system"] == ["wiki/systems/authentication.md"]
    assert tag_index["tags"]["role/source-backed"] == ["wiki/systems/authentication.md"]
    assert tag_index["tags"]["domain/authentication"] == ["wiki/systems/authentication.md"]
    assert tag_index["tags"]["domain/sessions"] == ["wiki/systems/authentication.md"]
    assert "domain/index-md" not in tag_index["tags"]
    assert not any(tag.startswith("domain/wiki/") for tag in tag_index["tags"])

    alias_index = products["alias_index"]
    assert alias_index["aliases"]["authentication"] == [
        {
            "path": "wiki/systems/authentication.md",
            "title": "Authentication",
            "page_kind": "system",
        }
    ]
