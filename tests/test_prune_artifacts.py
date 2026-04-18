from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


def test_prune_artifacts_keeps_latest_ten_and_pinned_run(repo_root: Path, tmp_project: Path) -> None:
    runs_dir = tmp_project.parent.parent / "artifacts" / "sample" / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    created = []
    for index in range(1, 12):
        run_dir = runs_dir / f"20260101-0000{index:02d}-lint"
        run_dir.mkdir()
        created.append(run_dir)

    bootstrap_state = json.loads((tmp_project / "state" / "bootstrap-state.json").read_text())
    bootstrap_state["latest_lint_findings"] = {
        "status": "pass",
        "findings_path": str(tmp_project / "state" / "latest" / "lint-findings.json"),
        "audit_run_dir": str(created[-1]),
        "updated_at": "2026-04-18T10:00:00+00:00",
    }
    (tmp_project / "state" / "bootstrap-state.json").write_text(json.dumps(bootstrap_state, indent=2))

    env = os.environ.copy()
    env["ARTIFACT_KEEP"] = "10"
    result = subprocess.run(
        [
            "bash",
            str(repo_root / "scripts" / "prune_artifacts.sh"),
            "--project",
            "sample",
            "--root-dir",
            str(tmp_project.parent.parent),
        ],
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"
    remaining = sorted(path.name for path in runs_dir.iterdir() if path.is_dir())
    assert len(remaining) == 10
    assert created[-1].name in remaining
    assert "deleted" in result.stdout
