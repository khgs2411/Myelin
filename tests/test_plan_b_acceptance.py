"""Plan B acceptance: make compile runs sense -> impact -> propose.

Under AUTO=1, also runs apply + apply_commit and produces a wiki.
Without AUTO=1, stops at propose and prompts operator to continue.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _prepare_isolated_run(tmp_path: Path) -> tuple[Path, Path, Path]:
    """Seed an isolated sample project with a working sample_repo copy + git history."""
    projects_root = tmp_path / "projects"
    projects_root.mkdir()
    project_dir = projects_root / "sample"
    sample_source = REPO_ROOT / "projects" / "sample"
    if not sample_source.is_dir():
        sample_source = REPO_ROOT / "tests" / "fixtures" / "project_state"
    shutil.copytree(sample_source, project_dir)

    subprocess.run(
        ["bash", str(REPO_ROOT / "tests" / "fixtures" / "sample_repo_init.sh")],
        check=True,
    )
    repo_src = REPO_ROOT / "tests" / "fixtures" / "sample_repo"
    repo_dst = tmp_path / "sample_repo"
    shutil.copytree(repo_src, repo_dst)

    project_json_path = project_dir / "state" / "project.json"
    project_json = json.loads(project_json_path.read_text())
    project_json["key"] = "sample"
    project_json["name"] = "Sample"
    project_json["repo_paths"] = [str(repo_dst)]
    project_json_path.write_text(json.dumps(project_json, indent=2))

    for shelf in (
        "architecture",
        "systems",
        "modules",
        "integrations",
        "decisions",
        "runbooks",
        "sessions",
        "glossary",
        "open-questions",
    ):
        (project_dir / "wiki" / shelf).mkdir(parents=True, exist_ok=True)

    artifacts_root = tmp_path / "artifacts"
    artifacts_root.mkdir()
    return projects_root, project_dir, artifacts_root


def _write_stub(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n")


def _passing_self_correct_stub() -> dict:
    return {
        "stage": "09-self-correct",
        "response": {
            "project": "sample",
            "summary": "self-correct: clarify authentication",
            "ranking_snapshot_path": None,
            "max_new_pages": 25,
            "new_pages_count": 0,
            "deferred_domains": [],
            "approved": True,
            "units": [
                {
                    "id": "u4",
                    "action": "update",
                    "page_path": "wiki/systems/authentication.md",
                    "rename_from": None,
                    "destructive": False,
                    "uncertainty": "low",
                    "justification": "Clarify the authentication boundary from repo-grounded validation feedback.",
                    "justification_signals": ["A"],
                    "referenced_ranking_domains": [],
                    "source_classification": {
                        "source_kind": "implementation-note",
                        "ownership": "project:sample",
                        "destination": "wiki/systems/authentication.md",
                        "update_targets": ["wiki/systems/authentication.md"],
                        "action": "update-existing-pages",
                    },
                    "content": "Session authentication for the sample app. Owns the SESSIONS dict.\n\n## Repo pointers\n\n- `src/auth.py:1-23` - login/logout/whoami functions and SESSIONS dict\n\nThe auth module issues an opaque session id on login and tracks it in the in-memory `SESSIONS` dictionary. The page covers session lifecycle only.\n\n## Related\n\n- [data-store](../systems/data-store.md) - where session-authenticated users write data\n- [entry-point](../systems/entry-point.md) - how the app wires auth in\n",
                    "affected_cross_refs": ["wiki/systems/data-store.md", "wiki/systems/entry-point.md"],
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


def test_compile_auto_mode_produces_wiki(tmp_path):
    """make compile AUTO=1 runs end-to-end and writes a wiki."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
        "AUTO": "1",
    }
    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "compile.sh"), "--project", "sample"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"

    assert (project_dir / "wiki" / "systems" / "authentication.md").is_file()
    assert (project_dir / "wiki" / "systems" / "data-store.md").is_file()
    assert (project_dir / "wiki" / "systems" / "entry-point.md").is_file()
    assert (project_dir / "index.md").read_text().strip().startswith("Sample project")

    freshness = json.loads((project_dir / "state" / "freshness.json").read_text())
    assert freshness["last_seen_commit"] is not None
    assert freshness["last_seen_commit_pending"] is None


def test_compile_auto_runs_one_self_correct_pass_after_semantic_warning(tmp_path):
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    stub_dir = tmp_path / "stubs"
    shutil.copytree(REPO_ROOT / "tests" / "fixtures" / "stubs", stub_dir)
    _write_stub(
        stub_dir / "06-validate.semantic.1.json",
        {
            "stage": "06-validate.semantic",
            "response": {
                "findings": [
                    {
                        "category": "stale",
                        "severity": "warn",
                        "pages": ["wiki/systems/authentication.md"],
                        "evidence": "Authentication page needs one scoped clarification.",
                        "suggested_action": "Add one sentence clarifying the page boundary.",
                    }
                ]
            },
            "tokens_consumed": {"input_chars": 1, "output_chars": 1, "is_estimate": True},
        },
    )
    _write_stub(
        stub_dir / "06-validate.semantic.2.json",
        {
            "stage": "06-validate.semantic",
            "response": {"findings": []},
            "tokens_consumed": {"input_chars": 1, "output_chars": 1, "is_estimate": True},
        },
    )
    _write_stub(stub_dir / "09-self-correct.1.json", _passing_self_correct_stub())
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(stub_dir),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
        "AUTO": "1",
    }

    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "compile.sh"), "--project", "sample"],
        env=env,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"
    latest_run = sorted((artifacts_root / "sample" / "runs").glob("*-update"))[-1]
    assert (latest_run / "self-correct-proposal.json").is_file()
    assert "[sample] [7/9] self-correct" in result.stderr
    assert "[sample] [4/9] apply (self-correct)" in result.stderr
    assert "[sample] [5/9] validate (self-correct)" in result.stderr
    assert not list((project_dir / "inbox").glob("*.json"))
    findings = json.loads((latest_run / "validation-findings.json").read_text())
    assert findings["semantic"] == []


def test_compile_gated_mode_stops_at_propose(tmp_path):
    """Without AUTO, make compile runs propose and stops, does not write wiki."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    systems_dir = project_dir / "wiki" / "systems"
    baseline_pages = {
        path.name: path.read_text()
        for path in systems_dir.glob("*.md")
    }
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "compile.sh"), "--project", "sample"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"

    runs = sorted((artifacts_root / "sample" / "runs").glob("*-update"))
    assert runs, "expected a run dir"
    assert (runs[-1] / "proposal.json").is_file()

    current_pages = {
        path.name: path.read_text()
        for path in systems_dir.glob("*.md")
    }
    assert current_pages == baseline_pages, "wiki should be untouched"
    assert "make compile-continue" in result.stdout + result.stderr


def test_compile_continue_after_gated_approval(tmp_path):
    """After gated propose, operator approves and re-runs with CONTINUE=1 to apply."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    first_run = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "compile.sh"), "--project", "sample"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert first_run.returncode == 0

    runs = sorted((artifacts_root / "sample" / "runs").glob("*-update"))
    latest = runs[-1]
    proposal = json.loads((latest / "proposal.json").read_text())
    proposal["approved"] = True
    (latest / "proposal.json").write_text(json.dumps(proposal, indent=2))

    continue_env = {**env, "CONTINUE": "1"}
    second_run = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "compile.sh"), "--project", "sample"],
        env=continue_env,
        capture_output=True,
        text=True,
    )
    assert second_run.returncode == 0, f"stderr={second_run.stderr}"
    assert (project_dir / "wiki" / "systems" / "authentication.md").is_file()


def test_make_compile_continue_target_exists():
    makefile_content = (REPO_ROOT / "Makefile").read_text()
    assert "compile-continue:" in makefile_content


def test_make_apply_pending_target_exists():
    makefile_content = (REPO_ROOT / "Makefile").read_text()
    assert "apply-pending:" in makefile_content


def test_make_reject_pending_target_exists():
    makefile_content = (REPO_ROOT / "Makefile").read_text()
    assert "reject-pending:" in makefile_content
