"""Reconcile stage tests."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _run_through_validate(project_dir: Path, run_dir: Path, stub_dir: Path, break_wiki: bool):
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(stub_dir), "AUTO": "1"}
    for stage in ("01-sense", "02-impact", "03-propose", "04-apply"):
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
        assert rc.returncode == 0, f"{stage}: {rc.stderr}"
    if break_wiki:
        (project_dir / "wiki" / "runtime").mkdir(parents=True, exist_ok=True)
        (project_dir / "wiki" / "runtime" / "injected.md").write_text(
            "bad\n\n## Repo pointers\n\n- `src/main.py:1-5` - x\n\n## Related\n- none\n"
        )
    subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "06-validate" / "run.sh"),
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
    return env


def test_reconcile_emits_proposal_when_validate_fails(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_through_validate(
        tmp_sample_project_with_repo,
        run_dir,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        break_wiki=True,
    )
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "07-reconcile" / "run.sh"),
            "--project",
            "sample",
            "--project-dir",
            str(tmp_sample_project_with_repo),
            "--run-dir",
            str(run_dir),
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    proposal = json.loads((run_dir / "reconcile-proposal.json").read_text())
    assert "units" in proposal
    assert "approved" in proposal


def test_reconcile_refuses_when_validate_passed(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_through_validate(
        tmp_sample_project_with_repo,
        run_dir,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        break_wiki=False,
    )
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "07-reconcile" / "run.sh"),
            "--project",
            "sample",
            "--project-dir",
            str(tmp_sample_project_with_repo),
            "--run-dir",
            str(run_dir),
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode != 0
    assert "validation" in rc.stderr.lower() or "pass" in rc.stderr.lower()


def test_reconcile_writes_completion_marker(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_through_validate(
        tmp_sample_project_with_repo,
        run_dir,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        break_wiki=True,
    )
    subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "07-reconcile" / "run.sh"),
            "--project",
            "sample",
            "--project-dir",
            str(tmp_sample_project_with_repo),
            "--run-dir",
            str(run_dir),
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    update_state = json.loads((tmp_sample_project_with_repo / "state" / "update-state.json").read_text())
    assert update_state["stages"]["reconcile"]["status"] == "completed"


def test_reconcile_sees_semantic_findings_alongside_structural_blockers(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = tmp_path / "stubs"
    shutil.copytree(REPO_ROOT / "tests" / "fixtures" / "stubs", stub_dir)
    shutil.copy(
        REPO_ROOT / "tests" / "fixtures" / "stubs" / "06-validate.semantic.with_finding.json",
        stub_dir / "06-validate.semantic.json",
    )
    env = _run_through_validate(
        tmp_sample_project_with_repo,
        run_dir,
        stub_dir,
        break_wiki=True,
    )
    findings = json.loads((run_dir / "validation-findings.json").read_text())
    assert findings["structural"], findings
    assert findings["semantic"], findings

    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "07-reconcile" / "run.sh"),
            "--project",
            "sample",
            "--project-dir",
            str(tmp_sample_project_with_repo),
            "--run-dir",
            str(run_dir),
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    assert (run_dir / "reconcile-proposal.json").is_file()
