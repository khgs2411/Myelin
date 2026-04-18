"""Impact stage tests. Uses LLM_STUB_RESPONSES_DIR for ranking + delta sub-tasks."""

import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _run_sense_then_impact(project_dir: Path, stub_dir: Path, run_dir: Path):
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(stub_dir)}
    sense_rc = subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "01-sense" / "run.sh"),
         "--project", "sample", "--project-dir", str(project_dir), "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    assert sense_rc.returncode == 0, f"sense: {sense_rc.stderr}"
    impact_rc = subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "02-impact" / "run.sh"),
         "--project", "sample", "--project-dir", str(project_dir), "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    return impact_rc


def test_impact_first_run_produces_ranking_and_delta(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    rc = _run_sense_then_impact(tmp_sample_project_with_repo, stub_dir, run_dir)
    assert rc.returncode == 0, f"stderr={rc.stderr}"

    ranking = json.loads((run_dir / "ranking-snapshot.json").read_text())
    assert ranking["cutoff"] == 20
    assert len(ranking["ranked_domains"]) >= 3

    impact = json.loads((run_dir / "impact-report.json").read_text())
    assert impact["run_id"] == run_dir.name
    assert "affected_pages" in impact
    assert "new_domains" in impact
    assert "stale_pages" in impact
    assert impact["ranking_snapshot_ref"].endswith("ranking-snapshot.json")


def test_impact_fails_without_sense_report(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()  # empty, no sense-report.json
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs")}
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "02-impact" / "run.sh"),
         "--project", "sample", "--project-dir", str(tmp_sample_project_with_repo),
         "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode != 0
    assert "sense-report" in rc.stderr
