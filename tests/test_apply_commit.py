"""Tests for apply_commit.sh - advances last_seen_commit_pending to last_seen_commit."""

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_apply_commit_advances_pointer(tmp_sample_project):
    """apply_commit moves _pending to committed and clears _pending."""
    freshness = tmp_sample_project / "state" / "freshness.json"
    data = json.loads(freshness.read_text())
    data["last_seen_commit_pending"] = "abc123"
    data["last_update_at_pending"] = "2026-04-18T00:00:00Z"
    data["last_seen_commit"] = None
    data["last_update_at"] = None
    freshness.write_text(json.dumps(data))

    env = {**os.environ, "PROJECTS_ROOT": str(tmp_sample_project.parent)}
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts" / "apply_commit.sh"),
            "--project",
            "sample",
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    after = json.loads(freshness.read_text())
    assert after["last_seen_commit"] == "abc123"
    assert after["last_update_at"] == "2026-04-18T00:00:00Z"
    assert after["last_seen_commit_pending"] is None
    assert after["last_update_at_pending"] is None


def test_apply_commit_noop_when_no_pending(tmp_sample_project):
    """apply_commit is a no-op when no _pending values are set."""
    freshness = tmp_sample_project / "state" / "freshness.json"
    data = json.loads(freshness.read_text())
    data["last_seen_commit"] = "old-sha"
    data["last_seen_commit_pending"] = None
    freshness.write_text(json.dumps(data))

    env = {**os.environ, "PROJECTS_ROOT": str(tmp_sample_project.parent)}
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts" / "apply_commit.sh"),
            "--project",
            "sample",
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0
    after = json.loads(freshness.read_text())
    assert after["last_seen_commit"] == "old-sha"


def test_apply_commit_appends_changelog(tmp_sample_project):
    """apply_commit must append a changelog entry when it advances the pointer."""
    freshness = tmp_sample_project / "state" / "freshness.json"
    data = json.loads(freshness.read_text())
    data["last_seen_commit_pending"] = "xyz789"
    data["last_update_at_pending"] = "2026-04-18T01:00:00Z"
    freshness.write_text(json.dumps(data))

    changelog = tmp_sample_project / "changelog.md"
    original_body = "# Changelog - Sample\n"
    changelog.write_text(original_body)

    env = {**os.environ, "PROJECTS_ROOT": str(tmp_sample_project.parent)}
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts" / "apply_commit.sh"),
            "--project",
            "sample",
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0
    new = changelog.read_text()
    assert len(new) > len(original_body)
    assert "apply-commit" in new
    assert "xyz789" in new


def test_apply_commit_leaves_no_tmp_file(tmp_sample_project):
    """Atomic write must not leave a .tmp file on disk."""
    freshness = tmp_sample_project / "state" / "freshness.json"
    data = json.loads(freshness.read_text())
    data["last_seen_commit_pending"] = "def456"
    data["last_update_at_pending"] = "2026-04-18T02:00:00Z"
    freshness.write_text(json.dumps(data))

    env = {**os.environ, "PROJECTS_ROOT": str(tmp_sample_project.parent)}
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts" / "apply_commit.sh"),
            "--project",
            "sample",
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0
    assert not (tmp_sample_project / "state" / "freshness.json.tmp").exists()
