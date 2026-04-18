import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent
SAMPLE_REPO = Path(__file__).parent / "fixtures" / "sample_repo"
INIT_SCRIPT = Path(__file__).parent / "fixtures" / "sample_repo_init.sh"


def _ensure_sample_repo_git() -> None:
    """Auto-initialize the fixture's git history if missing (idempotent)."""
    if not (SAMPLE_REPO / ".git").is_dir():
        subprocess.run(["bash", str(INIT_SCRIPT)], check=True)


def test_sample_repo_has_git_history():
    """Sample fixture must be a real git repo with >= 3 commits."""
    _ensure_sample_repo_git()
    assert (SAMPLE_REPO / ".git").is_dir(), "sample_repo/.git missing after init"
    result = subprocess.run(
        ["git", "-C", str(SAMPLE_REPO), "log", "--oneline"],
        capture_output=True,
        text=True,
        check=True,
    )
    commits = [line for line in result.stdout.splitlines() if line.strip()]
    assert len(commits) >= 3, f"expected >=3 commits, got {len(commits)}"


def test_project_state_template_is_complete():
    template_dir = Path(__file__).parent / "fixtures" / "project_state"
    assert (template_dir / "state" / "project.json").is_file()
    assert (template_dir / "state" / "pages.json").is_file()
    assert (template_dir / "state" / "sources.json").is_file()
    assert (template_dir / "state" / "relationships.json").is_file()
    assert (template_dir / "state" / "freshness.json").is_file()
    assert (template_dir / "state" / "update-state.json").is_file()
    assert (template_dir / "acceptance-questions.md").is_file()

    freshness = json.loads((template_dir / "state" / "freshness.json").read_text())
    assert "last_seen_commit" in freshness
    assert "last_seen_commit_pending" in freshness
    assert "last_update_at" in freshness

    project = json.loads((template_dir / "state" / "project.json").read_text())
    assert "acceptance_questions_path" in project
    assert "ranking_cutoff" in project
    assert "bootstrap_focuses" not in project


def test_tmp_sample_project_fixture_clones_template(tmp_sample_project):
    """tmp_sample_project must clone fixtures into a writable tmp path with v2 state."""
    assert (tmp_sample_project / "state" / "project.json").is_file()
    assert (tmp_sample_project / "state" / "freshness.json").is_file()
    assert (tmp_sample_project / "acceptance-questions.md").is_file()
    project = json.loads((tmp_sample_project / "state" / "project.json").read_text())
    assert project["key"] == "sample"
    assert project["ranking_cutoff"] == 20


def test_migrate_v1_to_v2_renames_bootstrap_state(tmp_path):
    """Given a v1 project with bootstrap-state.json, migrate creates update-state.json."""
    proj = tmp_path / "projects" / "mini"
    (proj / "state").mkdir(parents=True)
    (proj / "state" / "bootstrap-state.json").write_text(json.dumps({
        "project": "mini",
        "stages": {"orient": {"status": "completed"}},
    }))
    (proj / "state" / "project.json").write_text(json.dumps({
        "key": "mini",
        "name": "Mini",
        "repo_paths": [],
        "bootstrap_focuses": ["auth", "combat"],
        "entry_pages": ["index.md"],
    }))
    (proj / "state" / "freshness.json").write_text(json.dumps({
        "status": "unknown"
    }))

    result = subprocess.run(
        [str(REPO_ROOT / "scripts" / "migrate_state_v1_to_v2.sh")],
        env={**os.environ, "PROJECTS_ROOT": str(tmp_path / "projects"), "PROJECT": "mini"},
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"

    assert (proj / "state" / "update-state.json").is_file()
    assert not (proj / "state" / "bootstrap-state.json").is_file()

    pj = json.loads((proj / "state" / "project.json").read_text())
    assert "bootstrap_focuses" not in pj
    assert pj["acceptance_questions_path"] == "acceptance-questions.md"
    assert pj["ranking_cutoff"] == 20

    archive = proj / ".migration-hints" / "bootstrap-focuses-archive.md"
    assert archive.is_file()
    assert "auth" in archive.read_text()
    assert "combat" in archive.read_text()

    f = json.loads((proj / "state" / "freshness.json").read_text())
    assert "last_seen_commit" in f
    assert "last_seen_commit_pending" in f
    assert "last_update_at" in f


def test_migrate_v2_to_v1_is_reverse(tmp_path):
    """Reverse migration restores v1 shape: rename file, restore bootstrap_focuses."""
    proj = tmp_path / "projects" / "mini2"
    (proj / "state").mkdir(parents=True)
    (proj / ".migration-hints").mkdir()
    (proj / "state" / "update-state.json").write_text(json.dumps({
        "project": "mini2",
        "stages": {"sense": {"status": "pending"}}
    }))
    (proj / "state" / "project.json").write_text(json.dumps({
        "key": "mini2",
        "acceptance_questions_path": "acceptance-questions.md",
        "ranking_cutoff": 20,
        "entry_pages": ["index.md"],
    }))
    (proj / "state" / "freshness.json").write_text(json.dumps({
        "last_seen_commit": "abc",
        "last_seen_commit_pending": None,
        "last_update_at": "2026-04-18T00:00:00Z",
    }))
    (proj / ".migration-hints" / "bootstrap-focuses-archive.md").write_text(
        "# Archived bootstrap_focuses\n\n- auth\n- combat\n"
    )

    result = subprocess.run(
        [str(REPO_ROOT / "scripts" / "migrate_state_v2_to_v1.sh")],
        env={**os.environ, "PROJECTS_ROOT": str(tmp_path / "projects"), "PROJECT": "mini2"},
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"
    assert (proj / "state" / "bootstrap-state.json").is_file()
    assert not (proj / "state" / "update-state.json").is_file()
    pj = json.loads((proj / "state" / "project.json").read_text())
    assert pj["bootstrap_focuses"] == ["auth", "combat"]
    assert "acceptance_questions_path" not in pj
    assert "ranking_cutoff" not in pj


def test_sample_project_registered():
    """projects/sample/ must exist with v2 state and point to fixture repo."""
    sample = REPO_ROOT / "projects" / "sample"
    assert (sample / "state" / "project.json").is_file()
    assert (sample / "state" / "update-state.json").is_file()
    assert (sample / "state" / "freshness.json").is_file()
    assert (sample / "acceptance-questions.md").is_file()
    assert (sample / "inbox").is_dir()

    pj = json.loads((sample / "state" / "project.json").read_text())
    assert pj["key"] == "sample"
    assert pj["ranking_cutoff"] == 20
    assert pj["repo_paths"], "repo_paths must be non-empty"
    assert any("tests/fixtures/sample_repo" in p for p in pj["repo_paths"])
