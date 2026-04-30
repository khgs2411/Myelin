from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _write_item(project_dir: Path, *, gap_id: str, question: str, target_hint: str) -> None:
    payload = {
        "id": gap_id,
        "schema_version": 1,
        "source": "manual",
        "emitted_at": "2026-04-19T20:30:00Z",
        "project_key": "sample",
        "question": question,
        "target_hint": target_hint,
        "confidence": None,
        "pages_read": None,
        "pages_considered": None,
        "router_model": None,
        "synthesizer_model": None,
        "enriched_notes": None,
        "question_index": None,
        "question_tag": None,
        "score_awarded": None,
        "score_max": None,
        "expected_page": None,
        "measurement_run_id": None,
        "operator_notes": "manual seed",
    }
    inbox = project_dir / "inbox"
    inbox.mkdir(exist_ok=True)
    (inbox / f"{gap_id}.json").write_text(json.dumps(payload, indent=2) + "\n")


def _passing_ingest_stub() -> dict:
    return {
        "stage": "08-ingest",
        "response": {
            "project": "sample",
            "summary": "close auth gap",
            "ranking_snapshot_path": None,
            "max_new_pages": 25,
            "max_new_pages_config_source": "agents/update/08-ingest/config.json:stage_specific.max_items_per_run",
            "new_pages_count": 0,
            "deferred_domains": [],
            "units": [
                {
                    "id": "u1",
                    "action": "update",
                    "page_path": "wiki/systems/authentication.md",
                    "rename_from": None,
                    "destructive": False,
                    "uncertainty": "low",
                    "justification": "Fold inbox gap into auth page.",
                    "justification_signals": ["A"],
                    "referenced_ranking_domains": [],
                    "source_classification": {
                        "source_kind": "implementation-note",
                        "ownership": "project:sample",
                        "destination": "wiki/systems/authentication.md",
                        "update_targets": ["wiki/systems/authentication.md"],
                        "action": "update-existing-pages",
                    },
                    "content": "Session authentication for the sample app.\n\n## Repo pointers\n\n- `src/auth.py:1-23` - login/logout/whoami functions and SESSIONS dict\n\nThe auth module stores session state in `SESSIONS`.\n\n## Related\n\n- none\n",
                    "affected_cross_refs": [],
                    "source_citations": ["src/auth.py:1-23"],
                }
            ],
            "index_changes": None,
            "state_changes_intent": {
                "last_seen_commit_pending": None,
                "last_update_at_pending": None,
            },
        },
        "tokens_consumed": {"input_chars": 1000, "output_chars": 500, "is_estimate": True},
    }


def _passing_ingest_stub_with_stale_citation_range() -> dict:
    stub = _passing_ingest_stub()
    stub["response"]["units"][0]["content"] = (
        "Session authentication for the sample app.\n\n"
        "## Repo pointers\n\n"
        "- `src/auth.py:1-99` - login/logout/whoami functions and SESSIONS dict\n\n"
        "The auth module stores session state in `SESSIONS`.\n\n"
        "## Related\n\n"
        "- none\n"
    )
    stub["response"]["units"][0]["source_citations"] = ["src/auth.py:1-99"]
    return stub


def _passing_self_correct_stub() -> dict:
    return {
        "stage": "09-self-correct",
        "response": {
            "project": "sample",
            "summary": "self-correct: clarify auth page boundary",
            "ranking_snapshot_path": None,
            "max_new_pages": 25,
            "new_pages_count": 0,
            "deferred_domains": [],
            "approved": True,
            "units": [
                {
                    "id": "u2",
                    "action": "update",
                    "page_path": "wiki/systems/authentication.md",
                    "rename_from": None,
                    "destructive": False,
                    "uncertainty": "low",
                    "justification": "Use repo-grounded self-correction to clarify the auth page.",
                    "justification_signals": ["A"],
                    "referenced_ranking_domains": [],
                    "source_classification": {
                        "source_kind": "implementation-note",
                        "ownership": "project:sample",
                        "destination": "wiki/systems/authentication.md",
                        "update_targets": ["wiki/systems/authentication.md"],
                        "action": "update-existing-pages",
                    },
                    "content": "Session authentication for the sample app.\n\n## Repo pointers\n\n- `src/auth.py:1-23` - login/logout/whoami functions and SESSIONS dict\n\nThe auth module stores session state in `SESSIONS` and exposes the login shell only.\n\n## Related\n\n- none\n",
                    "affected_cross_refs": [],
                    "source_citations": ["src/auth.py:1-23"],
                }
            ],
            "index_changes": None,
            "state_changes_intent": {
                "last_seen_commit_pending": None,
                "last_update_at_pending": None,
            },
        },
        "tokens_consumed": {"input_chars": 900, "output_chars": 300, "is_estimate": True},
    }


def test_update_empty_inbox_exits_cleanly(tmp_sample_project: Path, tmp_path: Path):
    env = {
        **os.environ,
        "UPDATE_PROJECTS_ROOT": str(tmp_sample_project.parent),
        "UPDATE_ARTIFACTS_ROOT": str(tmp_path / "artifacts"),
        "PROJECTS_ROOT": str(tmp_sample_project.parent),
    }
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env,
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, f"stdout={rc.stdout}\nstderr={rc.stderr}"
    assert "update: inbox empty, nothing to ingest" in rc.stdout
    assert not list((tmp_path / "artifacts").glob("*"))


def test_make_update_empty_inbox_backfills_metadata_before_obsidian(tmp_sample_project: Path, tmp_path: Path):
    for name in ("page-metadata.json", "tag-index.json", "alias-index.json"):
        (tmp_sample_project / "state" / name).unlink(missing_ok=True)
    env = {
        **os.environ,
        "UPDATE_PROJECTS_ROOT": str(tmp_sample_project.parent),
        "UPDATE_ARTIFACTS_ROOT": str(tmp_path / "artifacts"),
        "PROJECTS_ROOT": str(tmp_sample_project.parent),
        "AUTO": "1",
    }

    rc = subprocess.run(
        ["make", "update", "PROJECT=sample", "AUTO=1"],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, f"stdout={rc.stdout}\nstderr={rc.stderr}"
    assert "update: inbox empty, nothing to ingest" in rc.stdout
    assert (tmp_sample_project / "state" / "page-metadata.json").is_file()
    assert (tmp_sample_project / "state" / "tag-index.json").is_file()
    assert (tmp_sample_project / "state" / "alias-index.json").is_file()
    assert (tmp_sample_project / "obsidian" / "_brain-sample.md").is_file()


def test_update_runs_pipeline_and_records_ingest_summary(tmp_sample_project_with_repo: Path, tmp_path: Path):
    _write_item(
        tmp_sample_project_with_repo,
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        question="Where are sessions stored?",
        target_hint="wiki/systems/authentication.md",
    )
    stub_dir = tmp_path / "stubs"
    stub_dir.mkdir()
    (stub_dir / "08-ingest.json").write_text(json.dumps(_passing_ingest_stub(), indent=2) + "\n")
    (stub_dir / "06-validate.semantic.json").write_text(
        json.dumps({"stage": "06-validate.semantic", "response": {"findings": []}, "tokens_consumed": {"input_chars": 1, "output_chars": 1, "is_estimate": True}}, indent=2)
        + "\n"
    )
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(stub_dir),
        "UPDATE_PROJECTS_ROOT": str(tmp_sample_project_with_repo.parent),
        "UPDATE_ARTIFACTS_ROOT": str(tmp_path / "artifacts"),
        "PROJECTS_ROOT": str(tmp_sample_project_with_repo.parent),
        "AUTO": "1",
    }
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env,
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, f"stdout={rc.stdout}\nstderr={rc.stderr}"
    latest_run = sorted((tmp_path / "artifacts" / "sample" / "runs").glob("*-update"))[-1]
    assert (latest_run / "proposal.json").is_file()
    assert (latest_run / "terminal-state.json").is_file()
    assert "ingest: closed 1 gap-notes" in (tmp_sample_project_with_repo / "changelog.md").read_text()


def test_update_normalizes_stale_citation_ranges_before_apply(tmp_sample_project_with_repo: Path, tmp_path: Path):
    _write_item(
        tmp_sample_project_with_repo,
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        question="Where are sessions stored?",
        target_hint="wiki/systems/authentication.md",
    )
    stub_dir = tmp_path / "stubs"
    stub_dir.mkdir()
    (stub_dir / "08-ingest.json").write_text(json.dumps(_passing_ingest_stub_with_stale_citation_range(), indent=2) + "\n")
    (stub_dir / "06-validate.semantic.json").write_text(
        json.dumps({"stage": "06-validate.semantic", "response": {"findings": []}, "tokens_consumed": {"input_chars": 1, "output_chars": 1, "is_estimate": True}}, indent=2)
        + "\n"
    )
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(stub_dir),
        "UPDATE_PROJECTS_ROOT": str(tmp_sample_project_with_repo.parent),
        "UPDATE_ARTIFACTS_ROOT": str(tmp_path / "artifacts"),
        "PROJECTS_ROOT": str(tmp_sample_project_with_repo.parent),
        "AUTO": "1",
    }
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env,
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, f"stdout={rc.stdout}\nstderr={rc.stderr}"
    latest_run = sorted((tmp_path / "artifacts" / "sample" / "runs").glob("*-update"))[-1]
    proposal = json.loads((latest_run / "proposal.json").read_text())
    assert proposal["units"][0]["source_citations"] == ["src/auth.py:1-23"]
    page_text = (tmp_sample_project_with_repo / "wiki" / "systems" / "authentication.md").read_text()
    assert "`src/auth.py:1-23`" in page_text
    assert "`src/auth.py:1-99`" not in page_text


def test_update_runs_one_self_correct_pass_after_semantic_warning(tmp_sample_project_with_repo: Path, tmp_path: Path):
    _write_item(
        tmp_sample_project_with_repo,
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        question="Where are sessions stored?",
        target_hint="wiki/systems/authentication.md",
    )
    stub_dir = tmp_path / "stubs"
    stub_dir.mkdir()
    (stub_dir / "08-ingest.json").write_text(json.dumps(_passing_ingest_stub(), indent=2) + "\n")
    (stub_dir / "06-validate.semantic.1.json").write_text(json.dumps({
        "stage": "06-validate.semantic",
        "response": {
            "findings": [
                {
                    "category": "coverage_gap",
                    "severity": "warn",
                    "pages": ["wiki/systems/authentication.md"],
                    "evidence": "Auth page still needs one scoped clarification.",
                    "suggested_action": "Add one sentence clarifying the page boundary.",
                }
            ]
        },
        "tokens_consumed": {"input_chars": 1, "output_chars": 1, "is_estimate": True},
    }, indent=2) + "\n")
    (stub_dir / "06-validate.semantic.2.json").write_text(json.dumps({
        "stage": "06-validate.semantic",
        "response": {"findings": []},
        "tokens_consumed": {"input_chars": 1, "output_chars": 1, "is_estimate": True},
    }, indent=2) + "\n")
    (stub_dir / "09-self-correct.1.json").write_text(json.dumps(_passing_self_correct_stub(), indent=2) + "\n")
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(stub_dir),
        "UPDATE_PROJECTS_ROOT": str(tmp_sample_project_with_repo.parent),
        "UPDATE_ARTIFACTS_ROOT": str(tmp_path / "artifacts"),
        "PROJECTS_ROOT": str(tmp_sample_project_with_repo.parent),
        "AUTO": "1",
    }
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env,
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, f"stdout={rc.stdout}\nstderr={rc.stderr}"
    latest_run = sorted((tmp_path / "artifacts" / "sample" / "runs").glob("*-update"))[-1]
    assert (latest_run / "self-correct-proposal.json").is_file()
    assert "[sample] [5/7] self-correct" in rc.stderr
    assert "[sample] [2/7] apply (self-correct)" in rc.stderr
    assert "[sample] [3/7] validate (self-correct)" in rc.stderr


def test_update_writes_run_profile_with_retry_stages_and_tokens(tmp_sample_project_with_repo: Path, tmp_path: Path):
    _write_item(
        tmp_sample_project_with_repo,
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        question="Where are sessions stored?",
        target_hint="wiki/systems/authentication.md",
    )
    stub_dir = tmp_path / "stubs"
    stub_dir.mkdir()
    (stub_dir / "08-ingest.json").write_text(json.dumps(_passing_ingest_stub(), indent=2) + "\n")
    (stub_dir / "06-validate.semantic.1.json").write_text(json.dumps({
        "stage": "06-validate.semantic",
        "response": {
            "findings": [
                {
                    "category": "coverage_gap",
                    "severity": "warn",
                    "pages": ["wiki/systems/authentication.md"],
                    "evidence": "Auth page still needs one scoped clarification.",
                    "suggested_action": "Add one sentence clarifying the page boundary.",
                }
            ]
        },
        "tokens_consumed": {"input_chars": 10, "output_chars": 2, "is_estimate": True},
    }, indent=2) + "\n")
    (stub_dir / "06-validate.semantic.2.json").write_text(json.dumps({
        "stage": "06-validate.semantic",
        "response": {"findings": []},
        "tokens_consumed": {"input_chars": 11, "output_chars": 3, "is_estimate": True},
    }, indent=2) + "\n")
    (stub_dir / "09-self-correct.1.json").write_text(json.dumps(_passing_self_correct_stub(), indent=2) + "\n")
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(stub_dir),
        "UPDATE_PROJECTS_ROOT": str(tmp_sample_project_with_repo.parent),
        "UPDATE_ARTIFACTS_ROOT": str(tmp_path / "artifacts"),
        "PROJECTS_ROOT": str(tmp_sample_project_with_repo.parent),
        "AUTO": "1",
    }

    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env,
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, f"stdout={rc.stdout}\nstderr={rc.stderr}"
    latest_run = sorted((tmp_path / "artifacts" / "sample" / "runs").glob("*-update"))[-1]
    run_profile = json.loads((latest_run / "run-profile.json").read_text())
    latest_profile = json.loads((tmp_sample_project_with_repo / "state" / "latest" / "run-profile.json").read_text())
    assert run_profile["pipeline"] == "update"
    assert run_profile["status"] == "completed"
    assert latest_profile["run_id"] == run_profile["run_id"]
    stage_names = [stage["name"] for stage in run_profile["stages"]]
    assert "self-correct" in stage_names
    assert "apply (self-correct)" in stage_names
    assert "validate (self-correct)" in stage_names
    assert any(stage["status"] == "skipped" and stage["name"] == "reconcile" for stage in run_profile["stages"])
    assert run_profile["summary"]["total_input_chars"] == 1921
    assert run_profile["summary"]["total_output_chars"] == 805
    assert run_profile["summary"]["llm_stage_count"] == 4
    assert (latest_run / "run-profile.md").is_file()
    assert (tmp_sample_project_with_repo / "state" / "latest" / "run-profile.md").is_file()
