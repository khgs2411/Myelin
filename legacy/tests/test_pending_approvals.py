"""Tests for pending-approvals apply and reject scripts."""

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _seed_pending_slice(project_dir: Path, proposal_id: str) -> Path:
    """Create a minimal pending slice for testing."""
    pending = project_dir / "state" / "pending-approvals" / proposal_id
    pending.mkdir(parents=True, exist_ok=True)
    slice_data = {
        "origin_run_id": proposal_id,
        "project": "sample",
        "summary": "test slice",
        "ranking_snapshot_path": "n/a",
        "max_new_pages": 25,
        "created_at": "2026-04-18T00:00:00+00:00",
        "slice_reason": "destructive",
        "units": [
            {
                "id": "u1",
                "action": "delete",
                "page_path": "wiki/systems/obsolete.md",
                "destructive": True,
                "uncertainty": "low",
                "justification": "feature removed",
                "justification_signals": ["A"],
                "referenced_ranking_domains": [],
                "content": None,
                "source_citations": [],
                "affected_cross_refs": [],
                "source_classification": {
                    "source_kind": "implementation-note",
                    "ownership": "project:sample",
                    "destination": "wiki/systems/obsolete.md",
                    "update_targets": ["wiki/systems/obsolete.md"],
                    "action": "delete"
                }
            }
        ],
        "index_changes": None,
        "state_changes_intent": {
            "last_seen_commit_pending": None,
            "last_update_at_pending": None,
            "note": "slice from test"
        }
    }
    (pending / "proposal-slice.json").write_text(json.dumps(slice_data, indent=2))
    (pending / "proposal-slice.md").write_text("# test slice\n")
    return pending


def test_apply_pending_deletes_target_page(tmp_sample_project):
    """apply_pending runs the delete unit and removes the page."""
    target = tmp_sample_project / "wiki" / "systems" / "obsolete.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("# Obsolete\n")
    _seed_pending_slice(tmp_sample_project, "20260418-000000-update")
    env = {
        **os.environ,
        "PROJECTS_ROOT": str(tmp_sample_project.parent),
    }
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts" / "apply_pending.sh"),
            "--project",
            "sample",
            "--proposal",
            "20260418-000000-update",
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    assert not target.is_file(), "target page should be deleted"
    assert not (tmp_sample_project / "state" / "pending-approvals" / "20260418-000000-update").is_dir()


def test_reject_pending_archives_slice(tmp_sample_project, tmp_path):
    """reject_pending moves the slice to artifacts/<project>/rejected/ and does not apply."""
    target = tmp_sample_project / "wiki" / "systems" / "obsolete.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("# Obsolete\n")
    _seed_pending_slice(tmp_sample_project, "20260418-000000-update")
    artifacts_root = tmp_path / "artifacts"
    artifacts_root.mkdir()
    env = {
        **os.environ,
        "PROJECTS_ROOT": str(tmp_sample_project.parent),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts" / "reject_pending.sh"),
            "--project",
            "sample",
            "--proposal",
            "20260418-000000-update",
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    assert target.is_file(), "target page should NOT be deleted (reject = don't apply)"
    assert not (tmp_sample_project / "state" / "pending-approvals" / "20260418-000000-update").is_dir()
    archived = artifacts_root / "sample" / "rejected" / "20260418-000000-update"
    assert archived.is_dir(), f"rejected slice not archived at {archived}"
    assert (archived / "proposal-slice.json").is_file()


def test_apply_pending_missing_proposal_fails(tmp_sample_project):
    env = {**os.environ, "PROJECTS_ROOT": str(tmp_sample_project.parent)}
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts" / "apply_pending.sh"),
            "--project",
            "sample",
            "--proposal",
            "nonexistent",
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode != 0
    assert "not found" in rc.stderr.lower() or "missing" in rc.stderr.lower()


def test_apply_pending_applies_deferred_index_change(tmp_sample_project, tmp_path):
    """When index-changes.json is present in the slice dir, apply_pending must write it to index.md."""
    proposal_id = "20260418-010000-update"
    pending = tmp_sample_project / "state" / "pending-approvals" / proposal_id
    pending.mkdir(parents=True, exist_ok=True)
    (pending / "proposal-slice.json").write_text(json.dumps({
        "origin_run_id": proposal_id,
        "project": "sample",
        "units": [],
        "index_changes": None,
        "state_changes_intent": {"note": "index-change only"},
    }))
    (pending / "proposal-slice.md").write_text("# slice\n")
    new_index = "Sample project - restructured.\n\n## Start here\n- [auth](wiki/systems/authentication.md)\n"
    (pending / "index-changes.json").write_text(json.dumps({
        "action": "update",
        "destructive": True,
        "content": new_index,
        "categories_reshuffled": 2,
    }))

    env = {**os.environ, "PROJECTS_ROOT": str(tmp_sample_project.parent)}
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts" / "apply_pending.sh"),
            "--project",
            "sample",
            "--proposal",
            proposal_id,
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    assert (tmp_sample_project / "index.md").read_text() == new_index
    assert not pending.is_dir()
