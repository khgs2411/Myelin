"""Sense stage tests. Uses LLM_STUB_RESPONSES_DIR for the mechanical classifier."""

import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _run_sense(project_dir: Path, stub_dir: Path, run_dir: Path) -> subprocess.CompletedProcess:
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(stub_dir),
    }
    return subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "01-sense" / "run.sh"),
            "--project", "sample",
            "--project-dir", str(project_dir),
            "--run-dir", str(run_dir),
        ],
        env=env,
        capture_output=True,
        text=True,
    )


def test_sense_first_run_mode(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    result = _run_sense(tmp_sample_project_with_repo, stub_dir, run_dir)
    assert result.returncode == 0, f"stderr={result.stderr}"
    report = json.loads((run_dir / "sense-report.json").read_text())
    assert report["project"] == "sample"
    assert report["mode"] == "first-run"
    assert report["last_seen_commit"] is None
    assert isinstance(report["changed_paths"], list)


def test_sense_incremental_mode(tmp_sample_project_with_repo, tmp_path):
    freshness = tmp_sample_project_with_repo / "state" / "freshness.json"
    data = json.loads(freshness.read_text())
    repo_path = REPO_ROOT / "tests" / "fixtures" / "sample_repo"
    # Ensure the repo's git history exists before we try to read commits from it
    init_script = REPO_ROOT / "tests" / "fixtures" / "sample_repo_init.sh"
    subprocess.run(["bash", str(init_script)], check=True)
    first_sha = subprocess.run(
        ["git", "-C", str(repo_path), "rev-list", "--max-parents=0", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    data["last_seen_commit"] = first_sha
    freshness.write_text(json.dumps(data))

    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    result = _run_sense(tmp_sample_project_with_repo, stub_dir, run_dir)
    assert result.returncode == 0, f"stderr={result.stderr}"
    report = json.loads((run_dir / "sense-report.json").read_text())
    assert report["mode"] == "incremental"
    assert len(report["changed_paths"]) > 0


def test_sense_inbox_classification(tmp_sample_project_with_repo, tmp_path):
    inbox = tmp_sample_project_with_repo / "inbox"
    (inbox / "feature-spec.md").write_text("# Feature spec")
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    result = _run_sense(tmp_sample_project_with_repo, stub_dir, run_dir)
    assert result.returncode == 0, f"stderr={result.stderr}"
    report = json.loads((run_dir / "sense-report.json").read_text())
    assert len(report["inbox_sources"]) == 1
    src = report["inbox_sources"][0]
    assert src["source_kind_hint"] == "spec"
    assert src["classification_confidence"] == "high"
    assert src["path"].startswith("projects/"), f"unexpected path: {src['path']}"


def test_sense_report_has_all_required_fields(tmp_sample_project_with_repo, tmp_path):
    """sense-report.json must contain every field from spec Section 5.4."""
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    result = _run_sense(tmp_sample_project_with_repo, stub_dir, run_dir)
    assert result.returncode == 0, f"stderr={result.stderr}"
    report = json.loads((run_dir / "sense-report.json").read_text())
    for required in ("project", "run_id", "mode", "last_seen_commit",
                     "current_head", "inbox_sources", "changed_paths",
                     "commit_messages_read"):
        assert required in report, f"missing required field: {required}"


def test_sense_writes_stage_completion_marker(tmp_sample_project_with_repo, tmp_path):
    """After sense completes, update-state.json.stages.sense.status == completed."""
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    result = _run_sense(tmp_sample_project_with_repo, stub_dir, run_dir)
    assert result.returncode == 0
    us = json.loads((tmp_sample_project_with_repo / "state" / "update-state.json").read_text())
    assert us["stages"]["sense"]["status"] == "completed"
    assert us["stages"]["sense"]["summary_file"].endswith("sense-report.json")
    assert us["last_completed_stage"] == "sense"
