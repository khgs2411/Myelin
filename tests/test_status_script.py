from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


def test_status_script_renders_human_dashboard(repo_root: Path, tmp_project: Path) -> None:
    latest_dir = tmp_project / "state" / "latest"
    latest_dir.mkdir(parents=True, exist_ok=True)
    (tmp_project / "inbox" / "processed").mkdir(parents=True, exist_ok=True)

    project_json = json.loads((tmp_project / "state" / "project.json").read_text())
    project_json["repo_paths"] = ["/tmp/source-repo"]
    (tmp_project / "state" / "project.json").write_text(json.dumps(project_json, indent=2))

    bootstrap_state = json.loads((tmp_project / "state" / "bootstrap-state.json").read_text())
    bootstrap_state["last_completed_stage"] = "validate"
    bootstrap_state["reconciliation_required"] = False
    bootstrap_state["stages"]["validate"]["last_completed_at"] = "2026-04-18T10:00:00+00:00"
    (tmp_project / "state" / "bootstrap-state.json").write_text(json.dumps(bootstrap_state, indent=2))

    (tmp_project / "state" / "freshness.json").write_text(json.dumps({
        "last_seen_commit": "abc1234567890def",
        "changed_paths": [],
        "impacted_pages": [],
        "status": "fresh",
        "updated_at": "2026-04-18T10:05:00+00:00",
        "repo_dirty": True,
    }, indent=2))
    (latest_dir / "validation-findings.json").write_text(json.dumps({
        "status": "pass",
        "semantic": [
            {
                "category": "stale",
                "severity": "warn",
                "pages": ["index.md"],
                "evidence": "Index status metadata is stale.",
                "suggested_action": "Refresh index status metadata to the current reviewed commit and update timestamp.",
            }
        ],
    }, indent=2))
    (latest_dir / "ingest-findings.json").write_text(json.dumps({
        "updated_at": "2026-04-18T10:10:00+00:00",
        "source": "projects/sample/inbox",
        "source_id": "2026-04-18T10-00-00Z_aaaaaa,2026-04-18T10-05-00Z_bbbbbb",
        "source_kind": "gap-note",
        "unit_count": 4,
        "actions": {"create": 0, "update": 4},
    }, indent=2))
    (latest_dir / "validation-report.md").write_text("# Validation report\n")
    (latest_dir / "ingest-report.md").write_text("# Ingest report\n")
    (latest_dir / "measurement-report.md").write_text("# Measurement report\n")
    (latest_dir / "route-measurement.json").write_text(json.dumps({
        "project_key": "sample",
        "question_count": 4,
        "generated_at": "2026-04-30T00:00:00+00:00",
        "summary": {
            "average_route_confidence": 0.75,
            "low_confidence_count": 1,
            "expected_page_count": 4,
            "expected_page_hit_count": 3,
            "expected_page_hit_ratio": 0.75,
            "emitted_gap_count": 1,
            "no_emit": False,
        },
    }, indent=2))
    (latest_dir / "route-measurement.md").write_text("# Route measurement\n")
    (latest_dir / "run-profile.json").write_text(json.dumps({
        "project_key": "sample",
        "run_id": "20260430-120000-update",
        "pipeline": "update",
        "duration_seconds": 125.4,
        "status": "completed",
        "summary": {
            "stage_count": 7,
            "llm_stage_count": 3,
            "total_input_chars": 1911,
            "total_output_chars": 802,
            "slowest_stage": "ingest",
        },
    }, indent=2))
    (latest_dir / "ranking-snapshot.md").write_text("# Ranking snapshot\n")
    (latest_dir / "bootstrap-summary.md").write_text("# Bootstrap summary\n")
    (tmp_project / "inbox" / "2026-04-18T10-15-00Z_cccccc.json").write_text("{}")
    (tmp_project / "inbox" / "processed" / "2026-04-18T09-00-00Z_dddddd.json").write_text("{}")

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
        env={**os.environ, "TZ": "Asia/Jerusalem"},
    )

    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"
    assert "Project: sample (Sample)" in result.stdout
    assert "Primary repo: /tmp/source-repo" in result.stdout
    assert "Overall: needs attention - 1 pending inbox item, 1 validation warning" in result.stdout
    assert "Inbox: 1 pending, 1 processed; oldest pending 2026-04-18 13:15 IDT" in result.stdout
    assert "Latest activity: validate completed 2026-04-18 13:00 IDT; last ingest 2026-04-18 13:10 IDT updated 4 units from 2 gap-notes" in result.stdout
    assert "Validation: pass with 1 warning - index status metadata is behind the latest reviewed commit" in result.stdout
    assert "Route health: 3/4 expected pages hit across 4 questions, avg confidence 0.75, 1 low-confidence route, 1 emitted gap note, measured 2026-04-30T00:00:00+00:00" in result.stdout
    assert "Runtime: update completed in 125.4s across 7 stages, 3 LLM stages, 1911 input chars, 802 output chars, slowest ingest" in result.stdout
    assert "Freshness: commit abc12345, clean, repo dirty" in result.stdout
    assert "Todo hints:" in result.stdout
    assert "What this means: the wiki passed validation, but the status block in index.md still points at an older reviewed commit." in result.stdout
    assert "Next step: make update PROJECT=sample" in result.stdout
    assert "If the warning remains after update: make compile PROJECT=sample" in result.stdout
    assert "Path hints:" in result.stdout
    assert str(tmp_project / "state" / "latest" / "validation-report.md") in result.stdout
    assert str(tmp_project / "state" / "latest" / "ingest-report.md") in result.stdout
    assert str(tmp_project / "state" / "latest" / "route-measurement.md") in result.stdout
    assert str(tmp_project / "state" / "latest" / "measurement-report.md") not in result.stdout
    assert str(tmp_project / "state" / "latest" / "ranking-snapshot.md") not in result.stdout
    assert str(tmp_project / "state" / "latest" / "bootstrap-summary.md") not in result.stdout


def test_status_script_generic_warning_points_to_validation_report(repo_root: Path, tmp_project: Path) -> None:
    latest_dir = tmp_project / "state" / "latest"
    latest_dir.mkdir(parents=True, exist_ok=True)

    project_json = json.loads((tmp_project / "state" / "project.json").read_text())
    project_json["repo_paths"] = ["/tmp/source-repo"]
    (tmp_project / "state" / "project.json").write_text(json.dumps(project_json, indent=2))

    bootstrap_state = json.loads((tmp_project / "state" / "bootstrap-state.json").read_text())
    bootstrap_state["last_completed_stage"] = "validate"
    bootstrap_state["stages"]["validate"]["last_completed_at"] = "2026-04-18T10:00:00+00:00"
    (tmp_project / "state" / "bootstrap-state.json").write_text(json.dumps(bootstrap_state, indent=2))

    (tmp_project / "state" / "freshness.json").write_text(json.dumps({
        "last_seen_commit": "abc1234567890def",
        "changed_paths": [],
        "impacted_pages": [],
        "status": "fresh",
        "updated_at": "2026-04-18T10:05:00+00:00",
        "repo_dirty": False,
    }, indent=2))
    (latest_dir / "validation-findings.json").write_text(json.dumps({
        "status": "pass",
        "semantic": [
            {
                "category": "index_routing",
                "severity": "warn",
                "pages": ["index.md", "wiki/integrations/mcp-server-and-auto-update.md"],
                "evidence": "`index.md` undersells the page scope.",
                "suggested_action": "Update the MCP entries in `index.md` to mention resources/resource templates in addition to tools and auto-update behavior.",
            }
        ],
    }, indent=2))
    (latest_dir / "validation-report.md").write_text("# Validation report\n")
    (latest_dir / "ingest-report.md").write_text("# Ingest report\n")

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
        env={**os.environ, "TZ": "Asia/Jerusalem"},
    )

    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"
    assert "Validation: pass with 1 warning - index_routing on index.md, wiki/integrations/mcp-server-and-auto-update.md" in result.stdout
    assert "What this means: the validation gate passed, but the wiki still has a maintenance warning to clear." in result.stdout
    assert "Review the validation report: " in result.stdout
    assert "Suggested fix: Update the MCP entries in `index.md` to mention resources/resource templates in addition to tools and auto-update behavior." in result.stdout
    assert "Next step: make compile PROJECT=sample" not in result.stdout


def test_status_script_ignores_route_measurement_with_malformed_numeric_values(repo_root: Path, tmp_project: Path) -> None:
    latest_dir = tmp_project / "state" / "latest"
    latest_dir.mkdir(parents=True, exist_ok=True)
    (latest_dir / "route-measurement.json").write_text(json.dumps({
        "project_key": "sample",
        "question_count": "not-a-number",
        "generated_at": "2026-04-30T00:00:00+00:00",
        "summary": {
            "average_route_confidence": "bad",
            "low_confidence_count": "bad",
            "expected_page_count": "bad",
            "expected_page_hit_count": "bad",
            "emitted_gap_count": "bad",
        },
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
        env={**os.environ, "TZ": "Asia/Jerusalem"},
    )

    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"
    assert "Route health:" not in result.stdout


def test_status_script_ignores_running_zero_stage_profile(repo_root: Path, tmp_project: Path) -> None:
    latest_dir = tmp_project / "state" / "latest"
    latest_dir.mkdir(parents=True, exist_ok=True)
    (latest_dir / "run-profile.json").write_text(json.dumps({
        "project_key": "sample",
        "run_id": "test",
        "pipeline": "update",
        "completed_at": None,
        "duration_seconds": 0,
        "status": "running",
        "stages": [],
        "summary": {
            "stage_count": 0,
            "llm_stage_count": 0,
            "total_input_chars": 0,
            "total_output_chars": 0,
            "slowest_stage": None,
        },
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
        env={**os.environ, "TZ": "Asia/Jerusalem"},
    )

    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"
    assert "Runtime:" not in result.stdout


def test_status_script_marks_residual_warning_after_self_correct_for_manual_review(repo_root: Path, tmp_project: Path) -> None:
    latest_dir = tmp_project / "state" / "latest"
    latest_dir.mkdir(parents=True, exist_ok=True)

    project_json = json.loads((tmp_project / "state" / "project.json").read_text())
    project_json["repo_paths"] = ["/tmp/source-repo"]
    (tmp_project / "state" / "project.json").write_text(json.dumps(project_json, indent=2))

    run_dir = "/tmp/artifacts/sample/runs/20260421-090218-update"
    (tmp_project / "state" / "update-state.json").write_text(json.dumps({
        "latest_run_dir": run_dir,
        "last_completed_stage": "apply_commit",
        "stages": {
            "apply_commit": {
                "last_run_dir": run_dir,
                "last_completed_at": "2026-04-21T09:07:00+00:00",
            },
            "self-correct": {
                "last_run_dir": run_dir,
                "last_completed_at": "2026-04-21T09:05:00+00:00",
            },
        },
    }, indent=2))

    (tmp_project / "state" / "freshness.json").write_text(json.dumps({
        "last_seen_commit": "abc1234567890def",
        "changed_paths": [],
        "impacted_pages": [],
        "status": "fresh",
        "updated_at": "2026-04-21T09:07:00+00:00",
        "repo_dirty": False,
    }, indent=2))
    (latest_dir / "validation-findings.json").write_text(json.dumps({
        "status": "pass",
        "semantic": [
            {
                "category": "coverage_gap",
                "severity": "warn",
                "pages": ["wiki/systems/admin-and-configuration.md"],
                "evidence": "Admin page still implies broader stats/analytics coverage than has been grounded.",
                "suggested_action": "Either verify the current stats/analytics routes or screens and add a short grounded subsection, or trim the broader admin-shell wording to the verified surfaces only.",
            }
        ],
    }, indent=2))
    (latest_dir / "validation-report.md").write_text("# Validation report\n")
    (latest_dir / "ingest-report.md").write_text("# Ingest report\n")

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
        env={**os.environ, "TZ": "Asia/Jerusalem"},
    )

    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"
    assert "Validation: pass with 1 warning - coverage_gap on wiki/systems/admin-and-configuration.md" in result.stdout
    assert "What this means: the latest update already used one bounded self-correction pass, but this warning still needs manual review." in result.stdout
    assert "Review the validation report: " in result.stdout
    assert "Suggested fix: Either verify the current stats/analytics routes or screens and add a short grounded subsection, or trim the broader admin-shell wording to the verified surfaces only." in result.stdout
    assert "Next step: make update PROJECT=sample" not in result.stdout
    assert "If the warning remains after update: make compile PROJECT=sample" not in result.stdout
