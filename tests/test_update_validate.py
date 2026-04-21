"""Validate stage end-to-end tests."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _run_pipeline_through_apply(project_dir: Path, stub_dir: Path, run_dir: Path, auto: bool = True):
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(stub_dir)}
    if auto:
        env["AUTO"] = "1"
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
        assert rc.returncode == 0, f"{stage}: {rc.stderr}"
    if not auto:
        proposal = json.loads((run_dir / "proposal.json").read_text())
        proposal["approved"] = True
        (run_dir / "proposal.json").write_text(json.dumps(proposal, indent=2) + "\n")
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "04-apply" / "run.sh"),
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
    assert rc.returncode == 0, f"apply: {rc.stderr}"
    return env


def _run_validate(project_dir: Path, run_dir: Path, env: dict[str, str]):
    return subprocess.run(
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


def test_validate_passes_on_clean_apply(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    findings = json.loads((run_dir / "validation-findings.json").read_text())
    assert findings["status"] == "pass"
    assert findings["structural"] == []


def test_validate_fails_on_unprescribed_shelf(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    runtime = tmp_sample_project_with_repo / "wiki" / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    (runtime / "entry.md").write_text(
        "summary\n\n## Repo pointers\n\n- `src/main.py:1-5` - x\n\n## Related\n\n- none\n"
    )
    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)
    assert rc.returncode != 0
    findings = json.loads((run_dir / "validation-findings.json").read_text())
    assert findings["status"] == "fail"
    shelf_findings = [f for f in findings["structural"] if f["rule_id"] == "shelf_allowlist"]
    assert shelf_findings
    assert any("runtime" in finding["issue"] for finding in shelf_findings)


def test_validate_collects_semantic_even_when_structural_blocks(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = tmp_path / "stubs"
    shutil.copytree(REPO_ROOT / "tests" / "fixtures" / "stubs", stub_dir)
    shutil.copy(
        REPO_ROOT / "tests" / "fixtures" / "stubs" / "06-validate.semantic.with_finding.json",
        stub_dir / "06-validate.semantic.json",
    )
    env = _run_pipeline_through_apply(tmp_sample_project_with_repo, stub_dir, run_dir)
    (tmp_sample_project_with_repo / "wiki" / "systems" / "authentication.md").unlink()
    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)
    assert rc.returncode != 0
    findings = json.loads((run_dir / "validation-findings.json").read_text())
    assert findings["status"] == "fail"
    assert findings["semantic"], findings
    assert findings["semantic"][0]["category"] == "coverage_gap"


def test_validate_writes_completion_marker(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    _run_validate(tmp_sample_project_with_repo, run_dir, env)
    update_state = json.loads((tmp_sample_project_with_repo / "state" / "update-state.json").read_text())
    assert update_state["stages"]["validate"]["status"] == "completed"
