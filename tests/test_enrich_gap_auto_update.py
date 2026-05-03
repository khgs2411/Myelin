from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent
MCP_ROOT = REPO_ROOT / "mcp"


def _load_module():
    spec = importlib.util.spec_from_file_location("llm_wiki_mcp", MCP_ROOT / "llm_wiki_mcp.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.path.insert(0, str(REPO_ROOT))
    spec.loader.exec_module(module)
    return module


def _seed_project(root: Path, project_key: str = "sample") -> tuple[Path, str]:
    project_dir = root / "projects" / project_key
    (project_dir / "state").mkdir(parents=True)
    (root / "scripts").mkdir()
    (root / "scripts" / "_auto_update_wrapper.sh").write_text("#!/usr/bin/env bash\nexit 0\n")
    (project_dir / "state" / "project.json").write_text(
        json.dumps({"key": project_key, "name": "Sample"}, indent=2)
    )
    gap_id = "2026-04-19T19-22-14Z_a1b2c3"
    (project_dir / "inbox").mkdir()
    (project_dir / "inbox" / f"{gap_id}.json").write_text(
        json.dumps(
            {
                "id": gap_id,
                "schema_version": 1,
                "source": "mcp-auto",
                "emitted_at": "2026-04-19T19:22:14Z",
                "project_key": project_key,
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
    return project_dir, gap_id


def test_enrich_gap_auto_update_true_spawns_detached_update(monkeypatch, tmp_path: Path):
    project_dir, gap_id = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()
    monkeypatch.setattr(module, "LLM_WIKI_ROOT", str(tmp_path))

    popen_calls: list[dict[str, object]] = []

    class FakePopen:
        def __init__(self, args, **kwargs):
            popen_calls.append({"args": args, "kwargs": kwargs})

    monkeypatch.setattr(module.subprocess, "Popen", FakePopen)

    updated = module.enrich_gap("sample", gap_id, "first note", auto_update=True)

    lock_path = project_dir / "state" / ".update.lock"
    assert updated["auto_update_triggered"] is True
    assert updated["auto_update_status"] == "triggered"
    assert updated["auto_update_log_path"].startswith("projects/sample/logs/auto-update-")
    assert updated["auto_update_log_path"].endswith(".log")
    assert lock_path.is_file()
    assert lock_path.read_text().strip()
    assert len(popen_calls) == 1
    call = popen_calls[0]
    assert call["args"] == [
        "bash",
        str(tmp_path / "scripts" / "_auto_update_wrapper.sh"),
        "sample",
        str(lock_path),
    ]
    assert call["kwargs"]["cwd"] == str(tmp_path)
    assert call["kwargs"]["stdin"] is module.subprocess.DEVNULL
    assert call["kwargs"]["stderr"] is module.subprocess.STDOUT
    assert call["kwargs"]["start_new_session"] is True
    assert call["kwargs"]["env"]["AUTO"] == "1"


def test_enrich_gap_auto_update_skips_when_lock_exists(monkeypatch, tmp_path: Path):
    project_dir, gap_id = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()
    monkeypatch.setattr(module, "LLM_WIKI_ROOT", str(tmp_path))

    lock_path = project_dir / "state" / ".update.lock"
    lock_path.write_text("2026-04-20T10:00:00Z\n")

    def fail_popen(*_args, **_kwargs):
        raise AssertionError("Popen should not be called when lockfile already exists")

    monkeypatch.setattr(module.subprocess, "Popen", fail_popen)

    updated = module.enrich_gap("sample", gap_id, "first note", auto_update=True)

    assert updated["auto_update_triggered"] is False
    assert updated["auto_update_status"] == "skipped:already-running"
    assert updated["auto_update_log_path"] is None


def test_enrich_gap_auto_update_false_overrides_env(monkeypatch, tmp_path: Path):
    _project_dir, gap_id = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    monkeypatch.setenv("LLM_WIKI_AUTO_UPDATE", "1")
    module = _load_module()
    monkeypatch.setattr(module, "LLM_WIKI_ROOT", str(tmp_path))

    def fail_popen(*_args, **_kwargs):
        raise AssertionError("Popen should not be called when auto_update=False")

    monkeypatch.setattr(module.subprocess, "Popen", fail_popen)

    updated = module.enrich_gap("sample", gap_id, "first note", auto_update=False)

    assert updated["auto_update_triggered"] is False
    assert updated["auto_update_status"] == "skipped:override"
    assert updated["auto_update_log_path"] is None


def test_enrich_gap_auto_update_env_var_controls_default(monkeypatch, tmp_path: Path):
    _project_dir, gap_id = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    monkeypatch.setenv("LLM_WIKI_AUTO_UPDATE", "1")
    module = _load_module()
    monkeypatch.setattr(module, "LLM_WIKI_ROOT", str(tmp_path))

    popen_calls: list[list[str]] = []

    class FakePopen:
        def __init__(self, args, **_kwargs):
            popen_calls.append(args)

    monkeypatch.setattr(module.subprocess, "Popen", FakePopen)

    updated = module.enrich_gap("sample", gap_id, "first note")

    assert updated["auto_update_triggered"] is True
    assert updated["auto_update_status"] == "triggered"
    assert len(popen_calls) == 1


def test_enrich_gap_auto_update_defaults_to_enabled_when_env_unset(monkeypatch, tmp_path: Path):
    _project_dir, gap_id = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    monkeypatch.delenv("LLM_WIKI_AUTO_UPDATE", raising=False)
    module = _load_module()
    monkeypatch.setattr(module, "LLM_WIKI_ROOT", str(tmp_path))

    popen_calls: list[list[str]] = []

    class FakePopen:
        def __init__(self, args, **_kwargs):
            popen_calls.append(args)

    monkeypatch.setattr(module.subprocess, "Popen", FakePopen)

    updated = module.enrich_gap("sample", gap_id, "first note")

    assert updated["auto_update_triggered"] is True
    assert updated["auto_update_status"] == "triggered"
    assert len(popen_calls) == 1


def test_enrich_gap_auto_update_none_honors_env_when_env_unset(monkeypatch, tmp_path: Path):
    _project_dir, gap_id = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    monkeypatch.delenv("LLM_WIKI_AUTO_UPDATE", raising=False)
    module = _load_module()
    monkeypatch.setattr(module, "LLM_WIKI_ROOT", str(tmp_path))

    def fail_popen(*_args, **_kwargs):
        raise AssertionError("Popen should not be called when auto_update=None and env is unset")

    monkeypatch.setattr(module.subprocess, "Popen", fail_popen)

    updated = module.enrich_gap("sample", gap_id, "first note", auto_update=None)

    assert updated["auto_update_triggered"] is False
    assert updated["auto_update_status"] == "disabled"
    assert updated["auto_update_log_path"] is None
