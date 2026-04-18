"""status.sh must read update-state.json on v2 projects and fall back to bootstrap-state.json on v1."""

import json
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_status_reads_v2_update_state(tmp_sample_project):
    update_state = json.loads((tmp_sample_project / "state" / "update-state.json").read_text())
    update_state["last_completed_stage"] = "impact"
    update_state["stages"]["sense"]["status"] = "completed"
    update_state["stages"]["impact"]["status"] = "completed"
    (tmp_sample_project / "state" / "update-state.json").write_text(json.dumps(update_state, indent=2))

    result = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts" / "status.sh"),
            "--project",
            "sample",
            "--project-dir",
            str(tmp_sample_project),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"
    assert "impact" in result.stdout


def test_status_falls_back_to_v1_bootstrap_state(tmp_path):
    """If only bootstrap-state.json (v1) exists, status still prints with a warning."""
    project_dir = tmp_path / "projects" / "v1_project"
    (project_dir / "state").mkdir(parents=True)
    (project_dir / "state" / "project.json").write_text(json.dumps({
        "key": "v1_project",
        "name": "V1",
        "repo_paths": [],
        "entry_pages": ["index.md"],
        "bootstrap_focuses": [],
        "related_concepts": [],
        "ignored_paths": [],
        "tags": [],
    }))
    (project_dir / "state" / "bootstrap-state.json").write_text(json.dumps({
        "project": "v1_project",
        "last_completed_stage": "validate",
        "stages": {},
    }))
    (project_dir / "state" / "freshness.json").write_text(json.dumps({"status": "unknown"}))
    (project_dir / "state" / "pages.json").write_text(json.dumps({"pages": []}))

    result = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts" / "status.sh"),
            "--project",
            "v1_project",
            "--project-dir",
            str(project_dir),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"
    combined = result.stdout + result.stderr
    assert "validate" in combined
    assert "not yet migrated" in combined.lower() or "v1" in combined.lower() or "bootstrap-state" in combined.lower()
