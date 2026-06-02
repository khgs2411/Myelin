from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _seed_project(project_dir: Path) -> None:
    (project_dir / "wiki" / "systems").mkdir(parents=True, exist_ok=True)
    (project_dir / "wiki" / "runbooks").mkdir(parents=True, exist_ok=True)
    (project_dir / "state" / "latest").mkdir(parents=True, exist_ok=True)
    (project_dir / "index.md").write_text(
        "# Sample\n\n## Start here\n- [combat](wiki/systems/combat.md)\n- [deploy](wiki/runbooks/deploy.md)\n",
        encoding="utf-8",
    )
    (project_dir / "wiki" / "systems" / "combat.md").write_text(
        "Combat body should not be needed for route measurement.\n",
        encoding="utf-8",
    )
    (project_dir / "wiki" / "runbooks" / "deploy.md").write_text(
        "Deploy body should not be needed for route measurement.\n",
        encoding="utf-8",
    )
    (project_dir / "state" / "pages.json").write_text(
        json.dumps(
            {
                "pages": [
                    {
                        "path": "wiki/systems/combat.md",
                        "type": "systems",
                        "summary": "Combat loop and ATB scheduling.",
                        "linked_topics": ["combat", "atb"],
                    },
                    {
                        "path": "wiki/runbooks/deploy.md",
                        "type": "runbooks",
                        "summary": "Deployment checklist and smoke tests.",
                        "linked_topics": ["deployment"],
                    },
                ]
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (project_dir / "state" / "page-metadata.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "project_key": "sample",
                "pages": [
                    {
                        "path": "wiki/systems/combat.md",
                        "title": "Combat",
                        "page_kind": "system",
                        "domains": ["combat", "atb"],
                        "topics": ["combat", "atb"],
                        "aliases": ["Combat", "ATB"],
                        "tags": ["project/sample", "kind/system", "domain/combat", "role/source-backed"],
                        "source_paths": ["src/combat.py:1-10"],
                        "freshness_status": "fresh",
                        "summary": "Combat loop and ATB scheduling.",
                        "canonical": True,
                    },
                    {
                        "path": "wiki/runbooks/deploy.md",
                        "title": "Deploy",
                        "page_kind": "runbook",
                        "domains": ["deployment"],
                        "topics": ["deployment"],
                        "aliases": ["Deploy"],
                        "tags": ["project/sample", "kind/runbook", "domain/deployment"],
                        "source_paths": [],
                        "freshness_status": "fresh",
                        "summary": "Deployment checklist and smoke tests.",
                        "canonical": True,
                    },
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (project_dir / "state" / "tag-index.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "project_key": "sample",
                "tags": {
                    "domain/combat": ["wiki/systems/combat.md"],
                    "domain/deployment": ["wiki/runbooks/deploy.md"],
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (project_dir / "state" / "alias-index.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "project_key": "sample",
                "aliases": {
                    "atb": [{"path": "wiki/systems/combat.md", "title": "Combat", "page_kind": "system"}],
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (project_dir / "state" / "relationships.json").write_text(
        json.dumps({"relationships": []}, indent=2),
        encoding="utf-8",
    )
    (project_dir / "state" / "latest" / "ranking-snapshot.json").write_text(
        json.dumps({"ranked_domains": [{"rank": 1, "domain": "combat", "score": 0.98}]}, indent=2),
        encoding="utf-8",
    )


def test_measure_tokens_reports_metadata_aware_route_without_llm_or_writes(tmp_project: Path):
    _seed_project(tmp_project)
    before_state = sorted(path.relative_to(tmp_project).as_posix() for path in (tmp_project / "state").rglob("*"))

    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "scripts" / "measure_tokens.sh"),
            "--project",
            "sample",
            "--task",
            "How does ATB combat work?",
        ],
        cwd=REPO_ROOT,
        env={**os.environ, "PROJECTS_ROOT": str(tmp_project.parent)},
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, rc.stderr
    report = json.loads(rc.stdout)
    assert report["project_key"] == "sample"
    assert report["task"] == "How does ATB combat work?"
    assert report["catalog_page_count"] == 2
    assert report["planner_candidate_count"] == 1
    assert report["selected_page_count"] == 1
    assert report["selected_pages"][0]["path"] == "wiki/systems/combat.md"
    assert report["route_confidence"] > 0
    assert report["route_reason"] == "metadata products used"
    assert report["freshness_warning_count"] == 0
    assert report["metadata_available"] is True
    assert report["current_router_prompt_chars"] > 0
    assert report["legacy_router_prompt_chars"] > 0
    assert report["estimated_router_prompt_savings_chars"] == (
        report["legacy_router_prompt_chars"] - report["current_router_prompt_chars"]
    )
    assert report["selected_page_count"] == 1
    assert report["page_bodies_loaded_count"] == 0
    assert report["would_read_pages"] == ["wiki/systems/combat.md"]
    assert any("no LLM calls" in note for note in report["estimate_notes"])
    after_state = sorted(path.relative_to(tmp_project).as_posix() for path in (tmp_project / "state").rglob("*"))
    assert after_state == before_state


def test_make_measure_tokens_uses_measurement_script(tmp_project: Path):
    _seed_project(tmp_project)

    rc = subprocess.run(
        ["make", "measure-tokens", "PROJECT=sample", "TASK=How does ATB work?"],
        cwd=REPO_ROOT,
        env={**os.environ, "PROJECTS_ROOT": str(tmp_project.parent)},
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, rc.stderr
    report = json.loads(rc.stdout)
    assert report["project_key"] == "sample"
    assert report["task"] == "How does ATB work?"
