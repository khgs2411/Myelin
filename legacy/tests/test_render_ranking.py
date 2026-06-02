"""Tests for stable_products.py render-ranking subcommand."""

import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_render_ranking_writes_json_and_md(tmp_sample_project, tmp_path):
    ranking = {
        "run_id": "20260418-100000-update-sample",
        "cutoff": 20,
        "cutoff_config_source": "agents/update/02-impact/config.json:stage_specific.ranking_cutoff",
        "signal_a_sources": ["README.md"],
        "signal_b_entry_points": ["src/main.py"],
        "ranked_domains": [
            {
                "rank": 1, "domain": "authentication", "score": 0.85,
                "signals": ["A", "B", "C"],
                "signal_a_evidence": ["README.md:6-14"],
                "signal_b_evidence": ["src/auth.py"],
                "signal_c_reasoning": "session owner"
            }
        ]
    }
    input_path = tmp_path / "ranking-snapshot.json"
    input_path.write_text(json.dumps(ranking))

    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "stable_products.py"),
         "render-ranking", "--input", str(input_path),
         "--project-dir", str(tmp_sample_project)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"

    latest = tmp_sample_project / "state" / "latest"
    assert (latest / "ranking-snapshot.json").is_file()
    assert (latest / "ranking-snapshot.md").is_file()

    md = (latest / "ranking-snapshot.md").read_text()
    assert "# Ranking" in md or "## Ranked domains" in md
    assert "authentication" in md
    assert "session owner" in md
