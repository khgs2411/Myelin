"""Propose stage tests. Uses LLM_STUB_RESPONSES_DIR for the LLM call."""

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _run_through_propose(project_dir: Path, stub_dir: Path, run_dir: Path, auto: bool = False):
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(stub_dir)}
    if auto:
        env["AUTO"] = "1"
    rc = None
    for stage in ("01-sense", "02-impact", "03-propose"):
        rc = subprocess.run(
            [
                "bash",
                str(REPO_ROOT / "agents" / "update" / stage / "run.sh"),
                "--project",
                "sample",
                "--project-dir",
                str(project_dir),
                "--run-dir",
                str(run_dir),
            ],
            env=env,
            capture_output=True,
            text=True,
        )
        if rc.returncode != 0:
            return rc
    return rc


def test_propose_writes_proposal_json_and_md(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_propose(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    assert (run_dir / "proposal.json").is_file()
    assert (run_dir / "proposal.md").is_file()
    proposal = json.loads((run_dir / "proposal.json").read_text())
    assert proposal["project"] == "sample"
    assert proposal["run_id"] == run_dir.name
    assert proposal["approved"] is False
    assert len(proposal["units"]) >= 1


def test_propose_auto_mode_marks_approved(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_propose(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
        auto=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    proposal = json.loads((run_dir / "proposal.json").read_text())
    assert proposal["approved"] is True


def test_propose_writes_completion_marker(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_propose(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0
    us = json.loads((tmp_sample_project_with_repo / "state" / "update-state.json").read_text())
    assert us["stages"]["propose"]["status"] == "completed"
    assert us["last_completed_stage"] == "propose"
