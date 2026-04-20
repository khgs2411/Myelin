from __future__ import annotations

import importlib.util
import json
import os
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


def test_query_wiki_low_confidence_emits_gap(monkeypatch, tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    def fake_query(_project_key: str, _question: str, *, projects_root: Path | None = None):
        assert projects_root == tmp_path / "projects"
        return {
            "answer": "Not sure.",
            "citations": ["wiki/systems/combat.md"],
            "confidence": 0.3,
            "pages_read": ["wiki/systems/combat.md"],
            "pages_considered": 21,
            "router_model": "gpt-5.4-mini",
            "synthesizer_model": "gpt-5.4-mini",
            "tokens_consumed": {"input_chars": 1, "output_chars": 1, "is_estimate": True},
        }

    monkeypatch.setattr(module, "_load_query_function", lambda: fake_query)

    result = module.query_wiki("sample", "what is missing?")

    inbox_files = sorted((project_dir / "inbox").glob("*.json"))
    assert len(inbox_files) == 1
    item = json.loads(inbox_files[0].read_text())
    assert result["emitted_gap_id"] == item["id"]
    assert item["source"] == "mcp-auto"
    assert item["question"] == "what is missing?"
    assert item["target_hint"] == "wiki/systems/combat.md"
    assert item["confidence"] == pytest.approx(0.3)
    assert item["pages_read"] == ["wiki/systems/combat.md"]
    assert item["pages_considered"] == 21
    assert item["router_model"] == "gpt-5.4-mini"
    assert item["synthesizer_model"] == "gpt-5.4-mini"
    assert item["enriched_notes"] is None


def test_query_wiki_high_confidence_does_not_emit_gap(monkeypatch, tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    def fake_query(_project_key: str, _question: str, *, projects_root: Path | None = None):
        return {
            "answer": "Grounded answer.",
            "citations": ["wiki/systems/combat.md"],
            "confidence": 0.7,
            "pages_read": ["wiki/systems/combat.md"],
            "pages_considered": 21,
            "router_model": "gpt-5.4-mini",
            "synthesizer_model": "gpt-5.4-mini",
            "tokens_consumed": {"input_chars": 1, "output_chars": 1, "is_estimate": True},
        }

    monkeypatch.setattr(module, "_load_query_function", lambda: fake_query)

    result = module.query_wiki("sample", "what is grounded?")

    assert result["emitted_gap_id"] is None
    assert not list((project_dir / "inbox").glob("*.json"))


def test_enrich_gap_appends_notes_flips_source_and_writes_atomically(monkeypatch, tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    inbox_dir = project_dir / "inbox"
    inbox_dir.mkdir()
    gap_id = "2026-04-19T19-22-14Z_a1b2c3"
    path = inbox_dir / f"{gap_id}.json"
    path.write_text(
        json.dumps(
            {
                "id": gap_id,
                "schema_version": 1,
                "source": "mcp-auto",
                "emitted_at": "2026-04-19T19:22:14Z",
                "project_key": "sample",
                "question": "what is missing?",
                "target_hint": "wiki/systems/combat.md",
                "confidence": 0.3,
                "pages_read": ["wiki/systems/combat.md"],
                "pages_considered": 21,
                "router_model": "gpt-5.4-mini",
                "synthesizer_model": "gpt-5.4-mini",
                "enriched_notes": None,
                "question_index": None,
                "question_tag": None,
                "score_awarded": None,
                "score_max": None,
                "expected_page": None,
                "measurement_run_id": None,
                "operator_notes": None,
            },
            indent=2,
        )
        + "\n"
    )

    updated = module.enrich_gap("sample", gap_id, "first note")
    updated = module.enrich_gap("sample", gap_id, "second note")

    assert updated["source"] == "agent-enriched"
    assert updated["enriched_notes"] == "first note\n\n---\n\nsecond note"
    assert updated["auto_update_triggered"] is False
    assert updated["auto_update_status"] == "disabled"
    assert updated["auto_update_log_path"] is None
    assert json.loads(path.read_text())["enriched_notes"] == "first note\n\n---\n\nsecond note"
    assert not list(inbox_dir.glob("*.tmp"))


def test_enrich_gap_missing_id_raises(monkeypatch, tmp_path: Path):
    _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    with pytest.raises(FileNotFoundError):
        module.enrich_gap("sample", "missing-gap", "notes")
