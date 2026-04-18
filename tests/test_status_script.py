from __future__ import annotations

import json
import subprocess
from pathlib import Path


def test_status_script_reads_stable_products(repo_root: Path, tmp_project: Path) -> None:
    latest_dir = tmp_project / "state" / "latest"
    latest_dir.mkdir(parents=True, exist_ok=True)

    project_json = json.loads((tmp_project / "state" / "project.json").read_text())
    project_json["repo_paths"] = ["/tmp/source-repo"]
    (tmp_project / "state" / "project.json").write_text(json.dumps(project_json, indent=2))

    bootstrap_state = json.loads((tmp_project / "state" / "bootstrap-state.json").read_text())
    bootstrap_state["last_completed_stage"] = "validate"
    bootstrap_state["reconciliation_required"] = False
    bootstrap_state["stages"]["validate"]["last_completed_at"] = "2026-04-18T10:00:00+00:00"
    (tmp_project / "state" / "bootstrap-state.json").write_text(json.dumps(bootstrap_state, indent=2))

    (tmp_project / "state" / "freshness.json").write_text(json.dumps({
        "last_seen_commit": "abc123",
        "changed_paths": [],
        "impacted_pages": ["wiki/systems/a.md", "wiki/systems/b.md"],
        "status": "fresh",
        "updated_at": "2026-04-18T10:05:00+00:00",
    }, indent=2))
    (latest_dir / "lint-findings.json").write_text(json.dumps({
        "status": "pass",
        "finding_count": 0,
    }, indent=2))
    (latest_dir / "validation-findings.json").write_text(json.dumps({
        "status": "pass",
        "finding_count": 1,
    }, indent=2))
    (latest_dir / "ingest-findings.json").write_text(json.dumps({
        "updated_at": "2026-04-18T10:10:00+00:00",
        "source": "inbox/session-note.md",
    }, indent=2))

    result = subprocess.run(
        [
            "bash",
            str(repo_root / "scripts" / "status.sh"),
            "--project",
            "sample",
            "--project-dir",
            str(tmp_project),
        ],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"
    assert "Project: sample (Sample)" in result.stdout
    assert "Repo paths:" in result.stdout
    assert "/tmp/source-repo" in result.stdout
    assert "Bootstrap: last_completed_stage=validate reconciliation_required=false timestamp=2026-04-18T10:00:00+00:00" in result.stdout
    assert f"path={tmp_project / 'state' / 'latest' / 'lint-findings.md'}" in result.stdout
    assert "Latest validation: status=pass findings=1" in result.stdout
    assert "Latest ingest: timestamp=2026-04-18T10:10:00+00:00 source=inbox/session-note.md" in result.stdout
    assert "Freshness: last_seen_commit=abc123 impacted_pages=2" in result.stdout
