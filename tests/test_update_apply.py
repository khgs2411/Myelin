"""Apply stage tests. Script-only; no LLM calls needed."""

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _run_through_apply(project_dir: Path, stub_dir: Path, run_dir: Path, auto: bool = False):
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
        proposal_path = run_dir / "proposal.json"
        proposal = json.loads(proposal_path.read_text())
        proposal["approved"] = True
        proposal_path.write_text(json.dumps(proposal, indent=2) + "\n")

    apply_rc = subprocess.run(
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
    return apply_rc


def test_apply_writes_wiki_pages(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    wiki = tmp_sample_project_with_repo / "wiki"
    assert (wiki / "systems" / "authentication.md").is_file()
    assert (wiki / "systems" / "data-store.md").is_file()
    assert (wiki / "systems" / "entry-point.md").is_file()


def test_apply_regenerates_index(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0
    index = (tmp_sample_project_with_repo / "index.md").read_text()
    assert "Start here" in index
    assert "authentication" in index


def test_apply_rejects_unapproved_proposal(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs")}
    for stage in ("01-sense", "02-impact", "03-propose"):
        rc = subprocess.run(
            [
                "bash",
                str(REPO_ROOT / "agents" / "update" / stage / "run.sh"),
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
        assert rc.returncode == 0
    apply_rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "04-apply" / "run.sh"),
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
    assert apply_rc.returncode != 0
    assert "approved" in apply_rc.stderr.lower()
    wiki = tmp_sample_project_with_repo / "wiki" / "systems"
    assert not any(wiki.glob("*.md")), "wiki was modified despite unapproved proposal"


def test_apply_updates_pages_json(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0
    pages = json.loads((tmp_sample_project_with_repo / "state" / "pages.json").read_text())
    paths = [page["path"] for page in pages["pages"]]
    assert "wiki/systems/authentication.md" in paths
    assert "wiki/systems/data-store.md" in paths
    assert "wiki/systems/entry-point.md" in paths


def test_apply_writes_freshness_pending(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0
    freshness = json.loads((tmp_sample_project_with_repo / "state" / "freshness.json").read_text())
    assert freshness["last_seen_commit_pending"] is not None
    assert freshness["last_update_at_pending"] is not None
    assert freshness["last_seen_commit"] is None


def test_apply_canonicalizes_index_status_after_duplicate_index_units(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0

    proposal_path = run_dir / "proposal.json"
    proposal = json.loads(proposal_path.read_text())
    proposal["approved"] = True
    proposal["state_changes_intent"] = {
        "last_seen_commit_pending": "newcommit123",
        "last_update_at_pending": "2026-04-25T12:32:45+00:00",
    }
    proposal["index_changes"] = None
    stale_index = "\n".join(
        [
            "# Sample",
            "",
            "Sample project index.",
            "",
            "## Status",
            "- Freshness: `state/freshness.json`",
            "- Ranking snapshot: `state/latest/ranking-snapshot.json`",
            "- Last seen commit: `oldcommit456`",
            "- Update state: `state/update-state.json`",
        ]
    )
    proposal["units"] = [
        {
            **proposal["units"][0],
            "id": "status-refresh",
            "page_path": "index.md",
            "content": stale_index.replace("oldcommit456", "newcommit123")
            + "\n- Last update: `2026-04-25T12:32:45+00:00`",
        },
        {
            **proposal["units"][0],
            "id": "content-refresh",
            "page_path": "index.md",
            "content": stale_index,
        },
    ]
    proposal_path.write_text(json.dumps(proposal, indent=2) + "\n")

    apply_rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "04-apply" / "run.sh"),
            "--project",
            "sample",
            "--project-dir",
            str(tmp_sample_project_with_repo),
            "--run-dir",
            str(run_dir),
        ],
        env=os.environ,
        capture_output=True,
        text=True,
    )

    assert apply_rc.returncode == 0, f"stderr={apply_rc.stderr}"
    index = (tmp_sample_project_with_repo / "index.md").read_text()
    assert "- Last update: `2026-04-25T12:32:45+00:00`" in index
    assert "- Last seen commit: `newcommit123`" in index
    assert "- Ranking snapshot: `state/latest/ranking-snapshot.json`" in index
    assert "- Ranking snapshot: `state/latest/ranking-snapshot.md`" not in index
    assert "oldcommit456" not in index


def test_apply_writes_completion_marker(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0
    update_state = json.loads((tmp_sample_project_with_repo / "state" / "update-state.json").read_text())
    assert update_state["stages"]["apply"]["status"] == "completed"
    assert update_state["last_completed_stage"] == "apply"


def test_apply_auto_mode_destructive_split(tmp_sample_project_with_repo, tmp_path):
    """AUTO=1 with a destructive unit must split it to pending-approvals, not apply."""
    target = tmp_sample_project_with_repo / "wiki" / "systems" / "obsolete-legacy.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("# Obsolete\n")

    run_dir = tmp_path / "run"
    run_dir.mkdir()

    destructive_stub_dir = tmp_path / "stubs"
    destructive_stub_dir.mkdir()

    import shutil

    for name in ("01-sense.classifier.json", "02-impact.ranking.json", "02-impact.delta.json"):
        shutil.copy(REPO_ROOT / "tests" / "fixtures" / "stubs" / name, destructive_stub_dir / name)
    shutil.copy(
        REPO_ROOT / "tests" / "fixtures" / "stubs" / "03-propose.destructive.json",
        destructive_stub_dir / "03-propose.json",
    )

    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(destructive_stub_dir),
        "AUTO": "1",
    }
    for stage in ("01-sense", "02-impact", "03-propose"):
        rc = subprocess.run(
            [
                "bash",
                str(REPO_ROOT / "agents" / "update" / stage / "run.sh"),
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
        assert rc.returncode == 0, f"{stage}: {rc.stderr}"

    apply_rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "04-apply" / "run.sh"),
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
    assert apply_rc.returncode == 0, f"stderr={apply_rc.stderr}"
    assert target.is_file(), "destructive delete should be deferred, not applied under AUTO=1"

    pending_root = tmp_sample_project_with_repo / "state" / "pending-approvals"
    assert pending_root.is_dir()
    slices = list(pending_root.iterdir())
    assert len(slices) == 1, f"expected 1 pending slice, got {len(slices)}"
    slice_data = json.loads((slices[0] / "proposal-slice.json").read_text())
    assert slice_data["slice_reason"] in ("destructive", "mixed")
    assert any(unit["action"] == "delete" for unit in slice_data["units"])


def test_apply_rejects_unit_missing_source_classification(tmp_sample_project_with_repo, tmp_path):
    """Pre-flight must reject a unit whose source_classification is missing or has an unknown source_kind."""
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(stub_dir)}
    for stage in ("01-sense", "02-impact", "03-propose"):
        rc = subprocess.run(
            [
                "bash",
                str(REPO_ROOT / "agents" / "update" / stage / "run.sh"),
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
        assert rc.returncode == 0
    proposal_path = run_dir / "proposal.json"
    proposal = json.loads(proposal_path.read_text())
    proposal["approved"] = True
    proposal["units"][0].pop("source_classification", None)
    proposal_path.write_text(json.dumps(proposal, indent=2))

    apply_rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "04-apply" / "run.sh"),
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
    assert apply_rc.returncode != 0
    assert "source_classification" in apply_rc.stderr


def test_apply_rejects_unit_with_unknown_source_kind(tmp_sample_project_with_repo, tmp_path):
    """Pre-flight must reject source_classification.source_kind not in allowed set."""
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(stub_dir)}
    for stage in ("01-sense", "02-impact", "03-propose"):
        rc = subprocess.run(
            [
                "bash",
                str(REPO_ROOT / "agents" / "update" / stage / "run.sh"),
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
        assert rc.returncode == 0
    proposal_path = run_dir / "proposal.json"
    proposal = json.loads(proposal_path.read_text())
    proposal["approved"] = True
    proposal["units"][0]["source_classification"]["source_kind"] = "nonsense-kind"
    proposal_path.write_text(json.dumps(proposal, indent=2))

    apply_rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "04-apply" / "run.sh"),
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
    assert apply_rc.returncode != 0
    assert "source_kind" in apply_rc.stderr.lower()
