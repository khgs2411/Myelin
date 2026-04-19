"""Plan A acceptance: scripts/compile.sh orchestrates sense + impact end-to-end.

Uses an isolated tmp copy of projects/sample so the test does not mutate the
working tree. Also supports overriding the artifacts root via UPDATE_ARTIFACTS_ROOT.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _prepare_isolated_run(tmp_path: Path) -> tuple[Path, Path, Path]:
    """Create tmp copies of projects/sample + artifacts root, return (projects_root, project_dir, artifacts_root)."""
    projects_root = tmp_path / "projects"
    projects_root.mkdir()
    project_dir = projects_root / "sample"
    shutil.copytree(REPO_ROOT / "projects" / "sample", project_dir)
    artifacts_root = tmp_path / "artifacts"
    artifacts_root.mkdir()
    return projects_root, project_dir, artifacts_root


def test_compile_script_runs_sense_and_impact(tmp_path):
    """compile.sh must orchestrate sense -> impact end-to-end without touching the real working tree."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "compile.sh"), "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"

    runs = sorted((artifacts_root / "sample" / "runs").glob("*-update"))
    assert runs, "no run dirs under isolated artifacts root"
    latest_run = runs[-1]

    assert (latest_run / "sense-report.json").is_file()
    assert (latest_run / "ranking-snapshot.json").is_file()
    assert (latest_run / "impact-report.json").is_file()

    latest_state = project_dir / "state" / "latest"
    assert (latest_state / "ranking-snapshot.json").is_file()
    assert (latest_state / "ranking-snapshot.md").is_file()


def test_compile_script_fails_when_stage_configs_invalid(tmp_path):
    """If agents/update/*/config.json is broken, compile.sh aborts before stages run."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    bad_stages = tmp_path / "agents-update"
    (bad_stages / "01-sense").mkdir(parents=True)
    (bad_stages / "01-sense" / "config.json").write_text('{"bogus": true}')
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_STAGES_ROOT": str(bad_stages),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "compile.sh"), "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    assert result.returncode != 0


def test_make_compile_target_exists():
    """Makefile must define compile target."""
    makefile = REPO_ROOT / "Makefile"
    content = makefile.read_text()
    assert "compile:" in content or "compile " in content


def test_make_compile_invokes_compile_sh(tmp_path):
    """make compile PROJECT=sample succeeds end-to-end against an isolated project copy."""
    projects_root = tmp_path / "projects"
    projects_root.mkdir()
    shutil.copytree(REPO_ROOT / "projects" / "sample", projects_root / "sample")
    artifacts_root = tmp_path / "artifacts"
    artifacts_root.mkdir()
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    result = subprocess.run(
        ["make", "compile", "PROJECT=sample"],
        cwd=str(REPO_ROOT), env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"
    assert (projects_root / "sample" / "state" / "latest" / "ranking-snapshot.md").is_file()
