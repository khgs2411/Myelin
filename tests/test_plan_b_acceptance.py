"""Plan B acceptance: make update-v2 runs sense -> impact -> propose.

Under AUTO=1, also runs apply + apply_commit and produces a wiki.
Without AUTO=1, stops at propose and prompts operator to continue.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _prepare_isolated_run(tmp_path: Path) -> tuple[Path, Path, Path]:
    """Seed an isolated sample project with a working sample_repo copy + git history."""
    projects_root = tmp_path / "projects"
    projects_root.mkdir()
    project_dir = projects_root / "sample"
    shutil.copytree(REPO_ROOT / "projects" / "sample", project_dir)

    subprocess.run(
        ["bash", str(REPO_ROOT / "tests" / "fixtures" / "sample_repo_init.sh")],
        check=True,
    )
    repo_src = REPO_ROOT / "tests" / "fixtures" / "sample_repo"
    repo_dst = tmp_path / "sample_repo"
    shutil.copytree(repo_src, repo_dst)

    project_json_path = project_dir / "state" / "project.json"
    project_json = json.loads(project_json_path.read_text())
    project_json["repo_paths"] = [str(repo_dst)]
    project_json_path.write_text(json.dumps(project_json, indent=2))

    artifacts_root = tmp_path / "artifacts"
    artifacts_root.mkdir()
    return projects_root, project_dir, artifacts_root


def test_update_auto_mode_produces_wiki(tmp_path):
    """make update-v2 AUTO=1 runs end-to-end and writes a wiki."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
        "AUTO": "1",
    }
    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"

    assert (project_dir / "wiki" / "systems" / "authentication.md").is_file()
    assert (project_dir / "wiki" / "systems" / "data-store.md").is_file()
    assert (project_dir / "wiki" / "systems" / "entry-point.md").is_file()
    assert (project_dir / "index.md").read_text().strip().startswith("Sample project")

    freshness = json.loads((project_dir / "state" / "freshness.json").read_text())
    assert freshness["last_seen_commit"] is not None
    assert freshness["last_seen_commit_pending"] is None


def test_update_gated_mode_stops_at_propose(tmp_path):
    """Without AUTO, make update-v2 runs propose and stops, does not write wiki."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"

    runs = sorted((artifacts_root / "sample" / "runs").glob("*-update"))
    assert runs, "expected a run dir"
    assert (runs[-1] / "proposal.json").is_file()

    assert not any((project_dir / "wiki" / "systems").glob("*.md")), "wiki should be untouched"
    assert "make update-v2-continue" in result.stdout + result.stderr


def test_update_continue_after_gated_approval(tmp_path):
    """After gated propose, operator approves and re-runs with CONTINUE=1 to apply."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    first_run = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert first_run.returncode == 0

    runs = sorted((artifacts_root / "sample" / "runs").glob("*-update"))
    latest = runs[-1]
    proposal = json.loads((latest / "proposal.json").read_text())
    proposal["approved"] = True
    (latest / "proposal.json").write_text(json.dumps(proposal, indent=2))

    continue_env = {**env, "CONTINUE": "1"}
    second_run = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=continue_env,
        capture_output=True,
        text=True,
    )
    assert second_run.returncode == 0, f"stderr={second_run.stderr}"
    assert (project_dir / "wiki" / "systems" / "authentication.md").is_file()


def test_make_update_v2_continue_target_exists():
    makefile_content = (REPO_ROOT / "Makefile").read_text()
    assert "update-v2-continue:" in makefile_content


def test_make_apply_pending_target_exists():
    makefile_content = (REPO_ROOT / "Makefile").read_text()
    assert "apply-pending:" in makefile_content


def test_make_reject_pending_target_exists():
    makefile_content = (REPO_ROOT / "Makefile").read_text()
    assert "reject-pending:" in makefile_content
