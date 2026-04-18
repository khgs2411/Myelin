"""init_project produces v2-shape project.json."""

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_init_project_creates_v2_project_json(tmp_path):
    env = {**os.environ, "PROJECTS_DIR": str(tmp_path / "projects")}
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts" / "init_project.sh"),
            "--project",
            "newproj",
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    project_json = json.loads((tmp_path / "projects" / "newproj" / "state" / "project.json").read_text())
    assert project_json["key"] == "newproj"
    assert "bootstrap_focuses" not in project_json
    assert project_json["acceptance_questions_path"] == "acceptance-questions.md"
    assert project_json["ranking_cutoff"] == 20


def test_init_project_creates_update_state_not_bootstrap_state(tmp_path):
    env = {**os.environ, "PROJECTS_DIR": str(tmp_path / "projects")}
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts" / "init_project.sh"),
            "--project",
            "newproj2",
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    project_dir = tmp_path / "projects" / "newproj2"
    assert (project_dir / "state" / "update-state.json").is_file()
    assert not (project_dir / "state" / "bootstrap-state.json").is_file()
