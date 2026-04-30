from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _seed_route_project(project_dir: Path, *, write_page_bodies: bool = True) -> None:
    (project_dir / "wiki" / "systems").mkdir(parents=True, exist_ok=True)
    (project_dir / "wiki" / "runbooks").mkdir(parents=True, exist_ok=True)
    (project_dir / "state" / "latest").mkdir(parents=True, exist_ok=True)
    (project_dir / "acceptance-questions.md").write_text(
        "\n".join(
            [
                "# Acceptance Questions",
                "",
                "1. [lookup] How does ATB combat work?  <!-- expected: wiki/systems/combat.md -->",
                "2. [runbook] Where is the deploy checklist?  <!-- expected: wiki/systems/missing.md -->",
                "3. [lookup] What does the pricing surface do?",
                "4. [lookup] What does the unknown scheduler do?  <!-- expected: wiki/systems/missing.md -->",
                "",
                "## Scoring",
                "- ignore this non-question line",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (project_dir / "state" / "project.json").write_text(
        json.dumps(
            {
                "key": "sample",
                "name": "Sample",
                "repo_paths": [],
                "tags": [],
                "entry_pages": ["index.md"],
                "related_concepts": [],
                "ignored_paths": [],
                "acceptance_questions_path": "acceptance-questions.md",
            },
            indent=2,
        ),
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
                        "aliases": ["ATB combat"],
                        "tags": ["domain/combat", "role/source-backed"],
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
                        "aliases": ["deploy checklist"],
                        "tags": ["domain/deployment"],
                        "source_paths": [],
                        "freshness_status": "stale",
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
                    "atb combat": [{"path": "wiki/systems/combat.md", "title": "Combat", "page_kind": "system"}],
                    "deploy checklist": [{"path": "wiki/runbooks/deploy.md", "title": "Deploy", "page_kind": "runbook"}],
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
        json.dumps(
            {"ranked_domains": [{"rank": 1, "domain": "combat", "score": 0.98}]},
            indent=2,
        ),
        encoding="utf-8",
    )
    if write_page_bodies:
        (project_dir / "index.md").write_text("# Sample\n", encoding="utf-8")
        (project_dir / "wiki" / "systems" / "combat.md").write_text("Combat body\n", encoding="utf-8")
        (project_dir / "wiki" / "runbooks" / "deploy.md").write_text("Deploy body\n", encoding="utf-8")


def test_measure_routes_writes_stable_json_and_markdown(tmp_path: Path):
    project_dir = tmp_path / "projects" / "sample"
    _seed_route_project(project_dir)

    rc = subprocess.run(
        ["python3", "scripts/measure_routes.py", "--project", "sample"],
        cwd=REPO_ROOT,
        env={**os.environ, "PROJECTS_ROOT": str(project_dir.parent)},
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, rc.stderr
    report_path = project_dir / "state" / "latest" / "route-measurement.json"
    markdown_path = project_dir / "state" / "latest" / "route-measurement.md"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert json.loads(rc.stdout) == report
    assert report["project_key"] == "sample"
    assert report["question_count"] == 4
    assert [item["question"] for item in report["questions"]] == [
        "How does ATB combat work?",
        "Where is the deploy checklist?",
        "What does the pricing surface do?",
        "What does the unknown scheduler do?",
    ]
    assert report["questions"][0]["selected_pages"] == ["wiki/systems/combat.md"]
    assert report["questions"][0]["expected_page"] == "wiki/systems/combat.md"
    assert report["questions"][0]["expected_page_selected"] is True
    assert report["questions"][0]["route_reason"] == "metadata products used"
    assert report["questions"][0]["metadata_available"] is True
    assert report["questions"][0]["router_prompt_chars"] > 0
    assert report["questions"][1]["freshness_warning_count"] == 1
    assert report["questions"][1]["expected_page"] == "wiki/systems/missing.md"
    assert report["questions"][1]["expected_page_selected"] is False
    assert report["questions"][2]["expected_page"] is None
    assert report["questions"][2]["expected_page_selected"] is None
    assert report["questions"][2]["route_confidence"] < 0.66
    assert report["questions"][3]["expected_page"] == "wiki/systems/missing.md"
    assert report["questions"][3]["expected_page_selected"] is False
    assert report["questions"][3]["route_confidence"] < 0.66
    assert report["summary"]["average_route_confidence"] > 0
    assert report["summary"]["freshness_warning_count"] == 3
    assert report["summary"]["expected_page_count"] == 3
    assert report["summary"]["expected_page_hit_count"] == 1
    assert report["summary"]["expected_page_hit_ratio"] == 0.3333
    assert report["summary"]["emitted_gap_count"] == 3
    assert report["summary"]["no_emit"] is False
    inbox_items = [json.loads(path.read_text(encoding="utf-8")) for path in sorted((project_dir / "inbox").glob("*.json"))]
    assert len(inbox_items) == 3
    notes = [json.loads(item["operator_notes"]) for item in inbox_items]
    failure_reasons = [note["failure_reasons"] for note in notes]
    assert ["expected_page_not_selected"] in failure_reasons
    assert ["low_route_confidence"] in failure_reasons
    assert ["low_route_confidence", "expected_page_not_selected"] in failure_reasons
    combined_item = next(item for item, note in zip(inbox_items, notes) if note["failure_reasons"] == ["low_route_confidence", "expected_page_not_selected"])
    assert combined_item["target_hint"] == "wiki/systems/missing.md"
    assert combined_item["expected_page"] == "wiki/systems/missing.md"
    assert isinstance(json.loads(combined_item["operator_notes"])["selected_pages"], list)
    markdown = markdown_path.read_text(encoding="utf-8")
    assert "| Question | Route Confidence | Selected Pages | Expected Page | Expected Hit | Freshness Warnings | Route Reason |" in markdown
    assert "wiki/systems/combat.md" in markdown
    assert "| yes |" in markdown
    assert "| no |" in markdown
    assert "| - |" in markdown
    assert "Emitted gap notes: 3" in markdown
    assert "Emission suppressed: no" in markdown


def test_no_emit_measure_routes_does_not_require_page_bodies_or_write_inbox(tmp_path: Path):
    project_dir = tmp_path / "projects" / "sample"
    _seed_route_project(project_dir, write_page_bodies=False)

    rc = subprocess.run(
        ["make", "measure-routes", "PROJECT=sample"],
        cwd=REPO_ROOT,
        env={**os.environ, "PROJECTS_ROOT": str(project_dir.parent), "NO_EMIT": "1"},
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, rc.stderr
    assert not (project_dir / "inbox").exists()
    report = json.loads(rc.stdout)
    assert report["summary"]["emitted_gap_count"] == 0
    assert report["summary"]["no_emit"] is True
    written = sorted(path.relative_to(project_dir / "state").as_posix() for path in (project_dir / "state").rglob("*"))
    assert "latest/route-measurement.json" in written
    assert "latest/route-measurement.md" in written
