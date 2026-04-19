from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _seed_project(project_dir: Path) -> None:
    (project_dir / "wiki" / "systems").mkdir(parents=True, exist_ok=True)
    (project_dir / "state" / "latest").mkdir(parents=True, exist_ok=True)
    (project_dir / "index.md").write_text(
        "# Sample\n\n## Start here\n- [authentication](wiki/systems/authentication.md)\n"
    )
    (project_dir / "wiki" / "systems" / "authentication.md").write_text(
        "Authentication uses sessions stored in the auth module.\n"
    )
    (project_dir / "state" / "pages.json").write_text(
        json.dumps(
            {
                "pages": [
                    {
                        "path": "wiki/systems/authentication.md",
                        "type": "systems",
                        "summary": "Authentication and session handling.",
                        "linked_topics": [],
                    }
                ]
            },
            indent=2,
        )
    )
    (project_dir / "state" / "latest" / "ranking-snapshot.json").write_text(
        json.dumps(
            {
                "ranked_domains": [
                    {"rank": 1, "domain": "authentication", "score": 0.95},
                ]
            },
            indent=2,
        )
    )


def _write_query_stubs(stub_dir: Path) -> None:
    (stub_dir / "query.router.json").write_text(
        json.dumps(
            {
                "stage": "query.router",
                "response": {
                    "pages": ["wiki/systems/authentication.md"],
                    "confidence": 0.92,
                    "reasoning": "auth match",
                },
                "tokens_consumed": {"input_chars": 10, "output_chars": 3, "is_estimate": True},
            }
        )
    )
    (stub_dir / "query.synthesizer.json").write_text(
        json.dumps(
            {
                "stage": "query.synthesizer",
                "response": {
                    "answer": "The auth module stores sessions.",
                    "citations": ["wiki/systems/authentication.md"],
                    "confidence": 0.92,
                    "reasoning": "grounded",
                },
                "tokens_consumed": {"input_chars": 7, "output_chars": 4, "is_estimate": True},
            }
        )
    )


def test_measure_llm_produces_report_and_maps_confidence(tmp_sample_project):
    _seed_project(tmp_sample_project)
    stub_dir = tmp_sample_project.parent / "stubs"
    stub_dir.mkdir()
    _write_query_stubs(stub_dir)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(stub_dir),
        "PROJECTS_ROOT": str(tmp_sample_project.parent),
    }

    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "measure_llm.sh"), "--project", "sample"],
        env=env,
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, f"stderr={rc.stderr}"
    report = json.loads((tmp_sample_project / "state" / "latest" / "measurement-report.json").read_text())
    per_question = report["acceptance_scores"]["per_question"]
    assert per_question
    assert per_question[0]["score"] == 2
    assert per_question[0]["citations"] == ["wiki/systems/authentication.md"]
    assert report["acceptance_scores"]["total_score"] >= 2
    assert "running" in rc.stderr


def test_makefile_points_measure_to_llm_variant():
    content = (REPO_ROOT / "Makefile").read_text()
    assert "measure-legacy:" in content
    assert "scripts/measure_llm.sh" in content
    assert "scripts/measure.sh" in content
