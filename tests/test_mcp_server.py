from __future__ import annotations

import importlib.util
import json
import os
import sys
import typing
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).parent.parent
MCP_ROOT = REPO_ROOT / "mcp"


def _load_module():
    spec = importlib.util.spec_from_file_location("llm_wiki_mcp", MCP_ROOT / "llm_wiki_mcp.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.path.insert(0, str(REPO_ROOT))
    spec.loader.exec_module(module)
    return module


def _seed_metadata_project(root: Path, project_key: str = "sample") -> Path:
    project_dir = root / "projects" / project_key
    state_dir = project_dir / "state"
    state_dir.mkdir(parents=True)
    (state_dir / "project.json").write_text(json.dumps({"key": project_key, "name": "Sample"}))
    (state_dir / "page-metadata.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "project_key": project_key,
                "pages": [
                    {
                        "path": "index.md",
                        "title": "Index",
                        "page_kind": "index",
                        "domains": ["overview"],
                        "freshness_status": "fresh",
                        "canonical": True,
                        "entrypoint_rank": 1,
                    },
                    {
                        "path": "wiki/systems/auth.md",
                        "title": "Auth",
                        "page_kind": "system",
                        "domains": ["authentication"],
                        "freshness_status": "stale",
                        "canonical": True,
                        "entrypoint_rank": None,
                    },
                ],
            }
        )
    )
    (state_dir / "tag-index.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "project_key": project_key,
                "tags": {
                    "kind/index": ["index.md"],
                    "kind/system": ["wiki/systems/auth.md"],
                    "status/stale": ["wiki/systems/auth.md"],
                },
            }
        )
    )
    (state_dir / "alias-index.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "project_key": project_key,
                "aliases": {
                    "auth": [
                        {
                            "path": "wiki/systems/auth.md",
                            "title": "Auth",
                            "page_kind": "system",
                        }
                    ]
                },
            }
        )
    )
    (state_dir / "relationships.json").write_text(
        json.dumps(
            {
                "relationships": [
                    {
                        "from": "index.md",
                        "to": "wiki/systems/auth.md",
                        "relationship_type": "references",
                        "confidence": "high",
                    }
                ]
            }
        )
    )
    return project_dir


def test_mcp_module_loads_and_exposes_tools(monkeypatch, tmp_path):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()

    assert hasattr(module, "query_wiki")
    assert hasattr(module, "list_wiki_projects")
    assert hasattr(module, "get_wiki_page")
    assert callable(module.main)


def test_query_wiki_docstring_instructs_low_confidence_follow_up(monkeypatch):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()

    doc = module.query_wiki.__doc__ or ""
    assert "enrich_gap" in doc
    assert "emitted_gap_id" in doc
    assert "low confidence" in doc.lower()


def test_mcp_module_registers_discovery_resources(monkeypatch):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()

    assert "llm-wiki://capabilities" in module.mcp._resources
    assert "llm-wiki://project/{project_key}/index" in module.mcp._resource_templates
    assert "llm-wiki://project/{project_key}/latest/{product}{?format}" in module.mcp._resource_templates
    assert "llm-wiki://project/{project_key}/page/{page_path*}" in module.mcp._resource_templates
    assert "llm-wiki://project/{project_key}/metadata" in module.mcp._resource_templates
    assert "llm-wiki://project/{project_key}/pages" in module.mcp._resource_templates
    assert "llm-wiki://project/{project_key}/tags" in module.mcp._resource_templates
    assert "llm-wiki://project/{project_key}/aliases" in module.mcp._resource_templates
    assert "llm-wiki://project/{project_key}/relationships" in module.mcp._resource_templates
    assert "llm-wiki://project/{project_key}/map" in module.mcp._resource_templates


def test_list_wiki_projects_reads_registered_projects(monkeypatch, tmp_path):
    projects_root = tmp_path / "projects"
    project_dir = projects_root / "sample"
    (project_dir / "state" / "latest").mkdir(parents=True)
    (project_dir / "state" / "project.json").write_text(
        json.dumps(
            {
                "key": "sample",
                "name": "Sample",
                "repo_paths": ["/tmp/repo"],
                "tags": ["demo"],
            }
        )
    )
    (project_dir / "state" / "latest" / "measurement-report.json").write_text("{}")
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    projects = module.list_wiki_projects()
    assert projects == [
        {
            "key": "sample",
            "name": "Sample",
            "repo_paths": ["/tmp/repo"],
            "tags": ["demo"],
            "last_update_at": None,
        }
    ]


def test_capabilities_resource_reports_tools_and_templates(monkeypatch):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()

    data = module.capabilities_resource()

    assert data["server"] == "llm-wiki"
    assert "query_wiki" in data["tools"]
    assert "llm-wiki://project/{project_key}/latest/{product}{?format}" in data["resource_templates"]
    assert "llm-wiki://project/{project_key}/metadata" in data["resource_templates"]
    assert "llm-wiki://project/{project_key}/map" in data["resource_templates"]
    assert data["recommended_flow"] == [
        "list_wiki_projects",
        "metadata resource",
        "map resource",
        "query_wiki",
        "get_wiki_page",
    ]


def test_project_index_resource_reads_index_markdown(monkeypatch, tmp_path):
    project_dir = tmp_path / "projects" / "sample"
    (project_dir / "state").mkdir(parents=True)
    (project_dir / "state" / "project.json").write_text(json.dumps({"key": "sample", "name": "Sample"}))
    (project_dir / "index.md").write_text("# Sample\n\nhello\n")

    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    assert module.project_index_resource("sample") == "# Sample\n\nhello\n"


def test_latest_product_resource_reads_markdown_and_json(monkeypatch, tmp_path):
    project_dir = tmp_path / "projects" / "sample"
    latest_dir = project_dir / "state" / "latest"
    latest_dir.mkdir(parents=True)
    (project_dir / "state" / "project.json").write_text(json.dumps({"key": "sample", "name": "Sample"}))
    (latest_dir / "validation-report.md").write_text("# Validation\n\npass\n")
    (latest_dir / "validation-findings.json").write_text(json.dumps({"status": "pass"}))

    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    assert module.latest_product_resource("sample", "validation") == "# Validation\n\npass\n"
    assert module.latest_product_resource("sample", "validation", format="json") == {"status": "pass"}


def test_latest_product_resource_rejects_unknown_product_and_format(monkeypatch, tmp_path):
    project_dir = tmp_path / "projects" / "sample"
    (project_dir / "state" / "latest").mkdir(parents=True)
    (project_dir / "state" / "project.json").write_text(json.dumps({"key": "sample", "name": "Sample"}))

    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    with pytest.raises(ValueError):
        module.latest_product_resource("sample", "unknown")

    with pytest.raises(ValueError):
        module.latest_product_resource("sample", "validation", format="xml")


def test_wiki_page_resource_reads_nested_page_and_blocks_traversal(monkeypatch, tmp_path):
    project_dir = tmp_path / "projects" / "sample"
    (project_dir / "state").mkdir(parents=True)
    (project_dir / "state" / "project.json").write_text(json.dumps({"key": "sample", "name": "Sample"}))
    page = project_dir / "wiki" / "systems" / "auth.md"
    page.parent.mkdir(parents=True)
    page.write_text("auth page\n")
    sibling_dir = tmp_path / "projects" / "sample-evil"
    sibling_dir.mkdir(parents=True)
    (sibling_dir / "secret.md").write_text("nope")

    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    assert module.wiki_page_resource("sample", "wiki/systems/auth.md") == "auth page\n"
    with pytest.raises(ValueError):
        module.wiki_page_resource("sample", "../sample-evil/secret.md")


def test_metadata_resources_read_generated_state(monkeypatch, tmp_path):
    _seed_metadata_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    metadata = module.project_metadata_resource("sample")
    pages = module.project_pages_resource("sample")
    tags = module.project_tags_resource("sample")
    aliases = module.project_aliases_resource("sample")
    relationships = module.project_relationships_resource("sample")

    assert metadata["pages"][1]["path"] == "wiki/systems/auth.md"
    assert pages["pages"] == metadata["pages"]
    assert tags["tags"]["kind/system"] == ["wiki/systems/auth.md"]
    assert aliases["aliases"]["auth"][0]["path"] == "wiki/systems/auth.md"
    assert relationships["relationships"][0]["relationship_type"] == "references"


def test_metadata_resource_missing_state_raises_clear_error(monkeypatch, tmp_path):
    project_dir = tmp_path / "projects" / "sample"
    (project_dir / "state").mkdir(parents=True)
    (project_dir / "state" / "project.json").write_text(json.dumps({"key": "sample", "name": "Sample"}))
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    with pytest.raises(FileNotFoundError, match="metadata has not been generated yet"):
        module.project_metadata_resource("sample")


def test_project_map_resource_returns_compact_summary(monkeypatch, tmp_path):
    _seed_metadata_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    data = module.project_map_resource("sample")

    assert data == {
        "project_key": "sample",
        "page_count": 2,
        "canonical_pages": [
            {
                "path": "index.md",
                "title": "Index",
                "page_kind": "index",
                "domains": ["overview"],
                "freshness_status": "fresh",
            },
            {
                "path": "wiki/systems/auth.md",
                "title": "Auth",
                "page_kind": "system",
                "domains": ["authentication"],
                "freshness_status": "stale",
            },
        ],
        "stale_pages": [
            {
                "path": "wiki/systems/auth.md",
                "title": "Auth",
                "page_kind": "system",
                "domains": ["authentication"],
                "freshness_status": "stale",
            }
        ],
        "tags_summary": [
            {"tag": "kind/index", "page_count": 1},
            {"tag": "kind/system", "page_count": 1},
            {"tag": "status/stale", "page_count": 1},
        ],
        "aliases_count": 1,
        "relationship_count": 1,
    }


def test_project_default_env_resolution(monkeypatch):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    monkeypatch.setenv("LLM_WIKI_PROJECT", "sample")
    module = _load_module()

    assert module._resolve_project_key(None) == "sample"
    assert module._resolve_project_key("explicit") == "explicit"


def test_missing_root_env_raises(monkeypatch, tmp_path):
    monkeypatch.delenv("LLM_WIKI_ROOT", raising=False)
    monkeypatch.delenv("LLM_WIKI_PROJECT", raising=False)
    old_cwd = Path.cwd()
    try:
        os.chdir(tmp_path)
        with pytest.raises(KeyError):
            _load_module()
    finally:
        os.chdir(old_cwd)


def test_mcp_module_does_not_depend_on_importable_agents_package(monkeypatch, tmp_path):
    fake_site = tmp_path / "fake_site"
    (fake_site / "agents").mkdir(parents=True)
    (fake_site / "agents" / "__init__.py").write_text("")

    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    monkeypatch.syspath_prepend(str(fake_site))
    sys.modules.pop("agents", None)
    sys.modules.pop("agents.query", None)
    sys.modules.pop("agents.query.query_engine", None)

    module = _load_module()

    assert callable(module.query_wiki)


def test_get_wiki_page_blocks_sibling_prefix_traversal(monkeypatch, tmp_path):
    project_dir = tmp_path / "projects" / "sample"
    sibling_dir = tmp_path / "projects" / "sample-evil"
    (project_dir / "state").mkdir(parents=True)
    (sibling_dir).mkdir(parents=True)
    (project_dir / "state" / "project.json").write_text(json.dumps({"key": "sample", "name": "Sample"}))
    (sibling_dir / "secret.md").write_text("nope")

    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    with pytest.raises(ValueError):
        module.get_wiki_page("sample", "../sample-evil/secret.md")


def test_load_query_function_has_explicit_return_type(monkeypatch):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()

    hints = typing.get_type_hints(module._load_query_function, globalns=vars(module))

    assert "return" in hints


def test_module_autoloads_llm_wiki_root_from_dotenv(monkeypatch, tmp_path):
    dotenv_dir = tmp_path / "mcp-run"
    dotenv_dir.mkdir()
    (dotenv_dir / ".env").write_text(f"LLM_WIKI_ROOT={REPO_ROOT}\nLLM_WIKI_PROJECT=sample\n")
    monkeypatch.delenv("LLM_WIKI_ROOT", raising=False)
    monkeypatch.delenv("LLM_WIKI_PROJECT", raising=False)
    old_cwd = Path.cwd()
    try:
        os.chdir(dotenv_dir)
        module = _load_module()
    finally:
        os.chdir(old_cwd)

    assert module._root() == REPO_ROOT
    assert module._resolve_project_key(None) == "sample"


def test_main_exits_cleanly_on_keyboard_interrupt(monkeypatch):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()

    def raise_interrupt():
        raise KeyboardInterrupt()

    exit_codes: list[int] = []

    def fake_exit(code: int):
        exit_codes.append(code)
        raise SystemExit(code)

    monkeypatch.setattr(module.mcp, "run", raise_interrupt)
    monkeypatch.setattr(module.os, "_exit", fake_exit)

    with pytest.raises(SystemExit) as excinfo:
        module.main()

    assert excinfo.value.code == 130
    assert exit_codes == [130]
