"""Validates that every agents/update/<stage>/config.json has required fields."""

import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_all_present_configs_pass(tmp_path):
    """Run validator against a tmp dir with all-valid configs. Must exit 0."""
    stages_root = tmp_path / "agents" / "update"
    (stages_root / "01-sense").mkdir(parents=True)
    (stages_root / "01-sense" / "config.json").write_text(json.dumps({
        "stage": "sense",
        "agent_kind": "script+classifier",
        "token_budget_input": 4000,
        "token_budget_output": 500,
        "on_over_budget": "fail-clean",
        "stage_specific": {"inbox_filename_patterns": {}}
    }))
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "validate_stage_configs.py"),
         "--stages-root", str(stages_root)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"


def test_missing_required_field_fails(tmp_path):
    stages_root = tmp_path / "agents" / "update"
    (stages_root / "02-impact").mkdir(parents=True)
    (stages_root / "02-impact" / "config.json").write_text(json.dumps({
        "stage": "impact",
        "agent_kind": "llm-agent"
    }))
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "validate_stage_configs.py"),
         "--stages-root", str(stages_root)],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert "token_budget_input" in result.stderr or "token_budget_input" in result.stdout


def test_no_configs_found_fails(tmp_path):
    stages_root = tmp_path / "agents" / "update"
    stages_root.mkdir(parents=True)
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "validate_stage_configs.py"),
         "--stages-root", str(stages_root)],
        capture_output=True, text=True,
    )
    assert result.returncode != 0


def test_real_sense_config_validates():
    """The real sense config must pass validation."""
    stages_root = REPO_ROOT / "agents" / "update"
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "validate_stage_configs.py"),
         "--stages-root", str(stages_root)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"


def test_impact_config_exists_and_validates():
    """Impact stage config must exist, load, and declare the ranking_cutoff key."""
    stages_root = REPO_ROOT / "agents" / "update"
    impact_config = stages_root / "02-impact" / "config.json"
    assert impact_config.is_file(), f"missing: {impact_config}"
    data = json.loads(impact_config.read_text())
    assert data["stage"] == "impact"
    assert "ranking_cutoff" in data["stage_specific"]


def test_propose_config_exists_and_validates():
    """Propose stage config must exist, load, and declare max_new_pages."""
    stages_root = REPO_ROOT / "agents" / "update"
    propose_config = stages_root / "03-propose" / "config.json"
    assert propose_config.is_file(), f"missing: {propose_config}"
    data = json.loads(propose_config.read_text())
    assert data["stage"] == "propose"
    assert "max_new_pages" in data["stage_specific"]
    assert data["stage_specific"]["max_new_pages"] == 25


def test_apply_config_exists_and_validates():
    """Apply stage config must exist and validate (script-only stage)."""
    stages_root = REPO_ROOT / "agents" / "update"
    apply_config = stages_root / "04-apply" / "config.json"
    assert apply_config.is_file(), f"missing: {apply_config}"
    data = json.loads(apply_config.read_text())
    assert data["stage"] == "apply"
    assert data["agent_kind"] == "script-only"


def test_validate_config_exists():
    stages_root = REPO_ROOT / "agents" / "update"
    config = stages_root / "06-validate" / "config.json"
    assert config.is_file(), f"missing: {config}"
    data = json.loads(config.read_text())
    assert data["stage"] == "validate"
    assert "structural_rules" in data["stage_specific"]
    assert "shelf_allowlist" in data["stage_specific"]
    allowed = data["stage_specific"]["shelf_allowlist"]
    expected = {
        "architecture",
        "systems",
        "modules",
        "integrations",
        "decisions",
        "runbooks",
        "sessions",
        "glossary",
        "open-questions",
    }
    assert set(allowed) == expected


def test_reconcile_config_exists():
    stages_root = REPO_ROOT / "agents" / "update"
    config = stages_root / "07-reconcile" / "config.json"
    assert config.is_file()
    data = json.loads(config.read_text())
    assert data["stage"] == "reconcile"
    assert data["stage_specific"]["max_loop_iterations"] == 1


def test_self_correct_config_exists():
    stages_root = REPO_ROOT / "agents" / "update"
    config = stages_root / "09-self-correct" / "config.json"
    assert config.is_file()
    data = json.loads(config.read_text())
    assert data["stage"] == "self-correct"
    assert data["stage_specific"]["max_repo_search_terms"] >= 1
