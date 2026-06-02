from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def repo_root() -> Path:
    return REPO_ROOT


@pytest.fixture
def tmp_project(tmp_path: Path) -> Path:
    """A freshly scaffolded project directory under a tmp path."""
    project_dir = tmp_path / "projects" / "sample"
    (project_dir / "wiki" / "architecture").mkdir(parents=True)
    (project_dir / "wiki" / "systems").mkdir()
    (project_dir / "wiki" / "modules").mkdir()
    (project_dir / "wiki" / "integrations").mkdir()
    (project_dir / "wiki" / "decisions").mkdir()
    (project_dir / "wiki" / "runbooks").mkdir()
    (project_dir / "wiki" / "sessions").mkdir()
    (project_dir / "wiki" / "glossary").mkdir()
    (project_dir / "wiki" / "open-questions").mkdir()
    (project_dir / "state").mkdir()
    (project_dir / "sources").mkdir()
    (project_dir / "inbox").mkdir()

    (project_dir / "index.md").write_text("# Sample\n\n## Current Priorities\n\nNo verified project priorities are documented in source materials yet.\n")
    (project_dir / "changelog.md").write_text("# Changelog\n")

    (project_dir / "state" / "project.json").write_text(json.dumps({
        "key": "sample", "name": "Sample", "repo_paths": [],
        "tags": [], "entry_pages": [], "bootstrap_focuses": [],
        "related_concepts": [], "ignored_paths": []
    }, indent=2))
    (project_dir / "state" / "pages.json").write_text(json.dumps({"pages": []}, indent=2))
    (project_dir / "state" / "sources.json").write_text(json.dumps({"sources": []}, indent=2))
    (project_dir / "state" / "relationships.json").write_text(json.dumps({"relationships": []}, indent=2))
    (project_dir / "state" / "freshness.json").write_text(json.dumps({
        "last_seen_commit": None, "changed_paths": [], "impacted_pages": [],
        "status": "unknown", "updated_at": None
    }, indent=2))
    (project_dir / "state" / "bootstrap-state.json").write_text(json.dumps({
        "project": "sample", "latest_run_dir": None,
        "last_completed_stage": None, "latest_validation_report": None,
        "latest_validation_findings": None, "latest_lint_findings": None,
        "latest_ingest_findings": None, "reconciliation_required": False,
        "stages": {
            "orient": {
                "status": "pending",
                "last_run_dir": None,
                "last_completed_at": None,
                "summary_file": None,
            },
            "domains": {
                "status": "pending",
                "last_run_dir": None,
                "last_completed_at": None,
                "summary_file": None,
            },
            "expand": {
                "status": "pending",
                "last_run_dir": None,
                "last_completed_at": None,
                "summary_file": None,
            },
            "validate": {
                "status": "pending",
                "last_run_dir": None,
                "last_completed_at": None,
                "summary_file": None,
            },
            "reconcile": {
                "status": "pending",
                "last_run_dir": None,
                "last_completed_at": None,
                "summary_file": None,
            },
        }
    }, indent=2))
    return project_dir


FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def tmp_sample_project(tmp_path: Path) -> Path:
    """Clone project_state template into tmp and register it as 'sample'.

    Returns the project dir path. The sample_repo fixture is not copied here;
    tests that need a repo target should use tmp_sample_project_with_repo.
    """
    proj = tmp_path / "projects" / "sample"
    shutil.copytree(FIXTURES / "project_state", proj)
    pj = json.loads((proj / "state" / "project.json").read_text())
    pj["key"] = "sample"
    pj["name"] = "Sample"
    (proj / "state" / "project.json").write_text(json.dumps(pj, indent=2))
    (proj / "inbox").mkdir(exist_ok=True)
    (proj / "state" / "latest").mkdir(exist_ok=True)
    for shelf in ("architecture", "systems", "modules", "integrations",
                  "decisions", "runbooks", "sessions", "glossary", "open-questions"):
        (proj / "wiki" / shelf).mkdir(parents=True, exist_ok=True)
    return proj


@pytest.fixture
def tmp_sample_project_with_repo(tmp_sample_project: Path, tmp_path: Path) -> Path:
    """tmp_sample_project with sample_repo copied in and registered in repo_paths."""
    repo_src = FIXTURES / "sample_repo"
    repo_dst = tmp_path / "sample_repo"
    shutil.copytree(repo_src, repo_dst)
    pj = json.loads((tmp_sample_project / "state" / "project.json").read_text())
    pj["repo_paths"] = [str(repo_dst)]
    (tmp_sample_project / "state" / "project.json").write_text(json.dumps(pj, indent=2))
    return tmp_sample_project
