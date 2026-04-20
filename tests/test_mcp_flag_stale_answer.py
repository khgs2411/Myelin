from __future__ import annotations

import importlib.util
import json
import sys
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


def _seed_project(root: Path, project_key: str = "sample") -> Path:
    project_dir = root / "projects" / project_key
    (project_dir / "state").mkdir(parents=True)
    (project_dir / "state" / "project.json").write_text(
        json.dumps({"key": project_key, "name": "Sample"}, indent=2)
    )
    return project_dir


def test_inbox_writer_accepts_agent_flagged_source(tmp_path: Path):
    sys.path.insert(0, str(REPO_ROOT))
    from agents._shared import inbox_writer

    project_dir = _seed_project(tmp_path)

    item = inbox_writer.write_gap(
        project_dir,
        source="agent-flagged",
        question="How does auth refresh?",
        target_hint="wiki/systems/auth.md",
        confidence=0.85,
        enriched_notes="Actually refresh uses HS256 per Handlers/Auth.cs:42.",
        router_model="gpt-5.4-mini",
        synthesizer_model="gpt-5.4-mini",
    )

    assert item["source"] == "agent-flagged"
    assert item["enriched_notes"].startswith("Actually refresh")
    assert item["confidence"] == 0.85
    written = json.loads((project_dir / "inbox" / f"{item['id']}.json").read_text())
    assert written["source"] == "agent-flagged"


def test_flag_stale_answer_writes_gap_with_correction(monkeypatch, tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    result = module.flag_stale_answer(
        project_key="sample",
        question="How does auth refresh work?",
        correction_notes="Refresh uses HS256 per server/Handlers/Auth.cs:42, not RS256 as the wiki claimed.",
        citations=["wiki/systems/auth.md"],
        original_confidence=0.87,
        router_model="gpt-5.4-mini",
        synthesizer_model="gpt-5.4-mini",
    )

    inbox_files = sorted((project_dir / "inbox").glob("*.json"))
    assert len(inbox_files) == 1
    item = json.loads(inbox_files[0].read_text())

    assert result["id"] == item["id"]
    assert item["source"] == "agent-flagged"
    assert item["question"] == "How does auth refresh work?"
    assert item["target_hint"] == "wiki/systems/auth.md"
    assert item["confidence"] == pytest.approx(0.87)
    assert item["pages_read"] == ["wiki/systems/auth.md"]
    assert item["router_model"] == "gpt-5.4-mini"
    assert item["synthesizer_model"] == "gpt-5.4-mini"
    assert item["enriched_notes"].startswith("Refresh uses HS256")
    assert result["auto_update_triggered"] is False
    assert result["auto_update_status"] == "disabled"
    assert result["auto_update_log_path"] is None


def test_flag_stale_answer_auto_update_true_triggers_spawn(monkeypatch, tmp_path: Path):
    _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    calls: list[tuple[str, Path]] = []

    def fake_trigger(project_dir_arg: Path, project_key_arg: str):
        calls.append((project_key_arg, project_dir_arg))
        return True, "triggered", "projects/sample/logs/fake.log"

    monkeypatch.setattr(module, "_trigger_auto_update", fake_trigger)

    result = module.flag_stale_answer(
        project_key="sample",
        question="q?",
        correction_notes="see Handlers/Auth.cs:42",
        citations=["wiki/systems/auth.md"],
        auto_update=True,
    )

    assert len(calls) == 1
    assert calls[0][0] == "sample"
    assert result["auto_update_triggered"] is True
    assert result["auto_update_status"] == "triggered"
    assert result["auto_update_log_path"] == "projects/sample/logs/fake.log"


def test_flag_stale_answer_auto_update_false_overrides_env(monkeypatch, tmp_path: Path):
    _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    monkeypatch.setenv("LLM_WIKI_AUTO_UPDATE", "1")
    module = _load_module()

    triggered_calls = []
    monkeypatch.setattr(
        module,
        "_trigger_auto_update",
        lambda *a, **kw: (triggered_calls.append(a) or (True, "triggered", "x")),
    )

    result = module.flag_stale_answer(
        project_key="sample",
        question="q?",
        correction_notes="note",
        citations=["wiki/x.md"],
        auto_update=False,
    )

    assert triggered_calls == []
    assert result["auto_update_triggered"] is False
    assert result["auto_update_status"] == "skipped:override"


def test_flag_stale_answer_env_fallback_honored(monkeypatch, tmp_path: Path):
    _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    monkeypatch.setenv("LLM_WIKI_AUTO_UPDATE", "1")
    module = _load_module()

    monkeypatch.setattr(
        module,
        "_trigger_auto_update",
        lambda *a, **kw: (True, "triggered", "projects/sample/logs/fake.log"),
    )

    result = module.flag_stale_answer(
        project_key="sample",
        question="q?",
        correction_notes="note",
        citations=["wiki/x.md"],
    )

    assert result["auto_update_triggered"] is True
    assert result["auto_update_status"] == "triggered"


def test_flag_stale_answer_without_citations_uses_empty_target_hint(
    monkeypatch, tmp_path: Path
):
    project_dir = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    result = module.flag_stale_answer(
        project_key="sample",
        question="general question?",
        correction_notes="see Handlers/Auth.cs:42",
    )

    inbox_files = sorted((project_dir / "inbox").glob("*.json"))
    assert len(inbox_files) == 1
    item = json.loads(inbox_files[0].read_text())
    assert item["target_hint"] == ""
    assert item["pages_read"] is None
    assert result["id"] == item["id"]
