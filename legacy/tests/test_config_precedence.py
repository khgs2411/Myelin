"""Tests for agents/update/_shared/config.py precedence logic.

Precedence: env var > project.json override > config.json default.
"""

import json
import os
from pathlib import Path

import pytest


def _import_config():
    import sys
    repo_root = Path(__file__).parent.parent
    sys.path.insert(0, str(repo_root))
    from agents.update._shared import config as config_module
    return config_module


def test_default_from_config_json(tmp_path):
    config_module = _import_config()
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps({
        "stage": "impact",
        "agent_kind": "llm-agent",
        "token_budget_input": 40000,
        "token_budget_output": 8000,
        "on_over_budget": "fail-clean",
        "stage_specific": {"ranking_cutoff": 20}
    }))
    value = config_module.resolve(
        config_path=config_path,
        project_config_path=None,
        env_override_name=None,
        key_path="stage_specific.ranking_cutoff",
    )
    assert value == 20


def test_project_overrides_config(tmp_path):
    config_module = _import_config()
    config_path = tmp_path / "config.json"
    project_path = tmp_path / "project.json"
    config_path.write_text(json.dumps({"stage_specific": {"ranking_cutoff": 20}}))
    project_path.write_text(json.dumps({"ranking_cutoff": 5}))
    value = config_module.resolve(
        config_path=config_path,
        project_config_path=project_path,
        env_override_name=None,
        key_path="stage_specific.ranking_cutoff",
        project_key="ranking_cutoff",
    )
    assert value == 5


def test_env_overrides_project(tmp_path, monkeypatch):
    config_module = _import_config()
    config_path = tmp_path / "config.json"
    project_path = tmp_path / "project.json"
    config_path.write_text(json.dumps({"stage_specific": {"ranking_cutoff": 20}}))
    project_path.write_text(json.dumps({"ranking_cutoff": 5}))
    monkeypatch.setenv("RANKING_CUTOFF", "100")
    value = config_module.resolve(
        config_path=config_path,
        project_config_path=project_path,
        env_override_name="RANKING_CUTOFF",
        key_path="stage_specific.ranking_cutoff",
        project_key="ranking_cutoff",
        value_type=int,
    )
    assert value == 100


def test_missing_config_raises(tmp_path):
    config_module = _import_config()
    with pytest.raises(FileNotFoundError):
        config_module.resolve(
            config_path=tmp_path / "nope.json",
            project_config_path=None,
            env_override_name=None,
            key_path="stage_specific.x",
        )
