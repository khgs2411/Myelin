"""Validate stage end-to-end tests."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _run_pipeline_through_apply(project_dir: Path, stub_dir: Path, run_dir: Path, auto: bool = True):
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(stub_dir)}
    if auto:
        env["AUTO"] = "1"
    for stage in ("01-sense", "02-impact", "03-propose"):
        rc = subprocess.run(
            [
                "bash",
                str(REPO_ROOT / "agents" / "update" / stage / "run.sh"),
                "--project",
                "sample",
                "--project-dir",
                str(project_dir),
                "--run-dir",
                str(run_dir),
            ],
            env=env,
            capture_output=True,
            text=True,
        )
        assert rc.returncode == 0, f"{stage}: {rc.stderr}"
    if not auto:
        proposal = json.loads((run_dir / "proposal.json").read_text())
        proposal["approved"] = True
        (run_dir / "proposal.json").write_text(json.dumps(proposal, indent=2) + "\n")
    rc = subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "04-apply" / "run.sh"),
            "--project",
            "sample",
            "--project-dir",
            str(project_dir),
            "--run-dir",
            str(run_dir),
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0, f"apply: {rc.stderr}"
    return env


def _run_validate(project_dir: Path, run_dir: Path, env: dict[str, str]):
    return subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "06-validate" / "run.sh"),
            "--project",
            "sample",
            "--project-dir",
            str(project_dir),
            "--run-dir",
            str(run_dir),
        ],
        env=env,
        capture_output=True,
        text=True,
    )


def test_validate_passes_on_clean_apply(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    findings = json.loads((run_dir / "validation-findings.json").read_text())
    assert findings["status"] == "pass"
    assert findings["structural"] == []


def test_validate_fails_on_unprescribed_shelf(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    runtime = tmp_sample_project_with_repo / "wiki" / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    (runtime / "entry.md").write_text(
        "summary\n\n## Repo pointers\n\n- `src/main.py:1-5` - x\n\n## Related\n\n- none\n"
    )
    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)
    assert rc.returncode != 0
    findings = json.loads((run_dir / "validation-findings.json").read_text())
    assert findings["status"] == "fail"
    shelf_findings = [f for f in findings["structural"] if f["rule_id"] == "shelf_allowlist"]
    assert shelf_findings
    assert any("runtime" in finding["issue"] for finding in shelf_findings)


def test_validate_collects_semantic_even_when_structural_blocks(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = tmp_path / "stubs"
    shutil.copytree(REPO_ROOT / "tests" / "fixtures" / "stubs", stub_dir)
    shutil.copy(
        REPO_ROOT / "tests" / "fixtures" / "stubs" / "06-validate.semantic.with_finding.json",
        stub_dir / "06-validate.semantic.json",
    )
    env = _run_pipeline_through_apply(tmp_sample_project_with_repo, stub_dir, run_dir)
    (tmp_sample_project_with_repo / "wiki" / "systems" / "authentication.md").unlink()
    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)
    assert rc.returncode != 0
    findings = json.loads((run_dir / "validation-findings.json").read_text())
    assert findings["status"] == "fail"
    assert findings["semantic"], findings
    assert findings["semantic"][0]["category"] == "coverage_gap"


def test_validate_writes_completion_marker(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    _run_validate(tmp_sample_project_with_repo, run_dir, env)
    update_state = json.loads((tmp_sample_project_with_repo / "state" / "update-state.json").read_text())
    assert update_state["stages"]["validate"]["status"] == "completed"


def test_apply_generates_brain_metadata_products(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )

    state_dir = tmp_sample_project_with_repo / "state"
    page_metadata = json.loads((state_dir / "page-metadata.json").read_text())
    tag_index = json.loads((state_dir / "tag-index.json").read_text())
    alias_index = json.loads((state_dir / "alias-index.json").read_text())

    assert page_metadata["schema_version"] == 1
    assert page_metadata["project_key"] == "sample"
    assert page_metadata["pages"]
    assert tag_index["tags"]["project/sample"]
    assert alias_index["aliases"]
    assert env["AUTO"] == "1"


def test_apply_preserves_existing_pages_json_fields(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    before_payload = json.loads((tmp_sample_project_with_repo / "state" / "pages.json").read_text())
    before_keys = {
        entry["path"]: set(entry.keys())
        for entry in before_payload.get("pages", [])
        if isinstance(entry, dict) and "path" in entry
    }

    _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )

    after_payload = json.loads((tmp_sample_project_with_repo / "state" / "pages.json").read_text())
    after_by_path = {
        entry["path"]: entry
        for entry in after_payload.get("pages", [])
        if isinstance(entry, dict) and "path" in entry
    }
    for path, keys in before_keys.items():
        assert path in after_by_path
        assert keys <= set(after_by_path[path].keys())


def test_validate_fails_when_metadata_products_are_missing(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    for name in ("page-metadata.json", "tag-index.json", "alias-index.json"):
        (tmp_sample_project_with_repo / "state" / name).unlink()

    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)

    assert rc.returncode != 0
    findings = json.loads((run_dir / "validation-findings.json").read_text())
    rule_ids = {finding["rule_id"] for finding in findings["structural"]}
    assert "page_metadata_shape" in rule_ids
    assert "tag_index_consistency" in rule_ids
    assert "alias_index_consistency" in rule_ids


def test_make_lint_backfills_metadata_for_legacy_project(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    for name in ("page-metadata.json", "tag-index.json", "alias-index.json"):
        (tmp_sample_project_with_repo / "state" / name).unlink()

    rc = subprocess.run(
        ["make", "lint", "PROJECT=sample"],
        cwd=REPO_ROOT,
        env={**env, "UPDATE_PROJECTS_ROOT": str(tmp_sample_project_with_repo.parent)},
        capture_output=True,
        text=True,
    )

    assert rc.returncode == 0, f"stdout={rc.stdout} stderr={rc.stderr}"
    state_dir = tmp_sample_project_with_repo / "state"
    assert (state_dir / "page-metadata.json").is_file()
    assert (state_dir / "tag-index.json").is_file()
    assert (state_dir / "alias-index.json").is_file()


def test_validate_accepts_legacy_references_relationship(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    relationships_path = tmp_sample_project_with_repo / "state" / "relationships.json"
    relationships_path.write_text(json.dumps({
        "relationships": [
            {
                "from": "index.md",
                "to": "wiki/systems/authentication.md",
                "relationship_type": "references",
                "confidence": "high",
            }
        ]
    }) + "\n")

    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)

    assert rc.returncode == 0, rc.stderr


def test_validate_accepts_legacy_relationship_extra_fields(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    relationships_path = tmp_sample_project_with_repo / "state" / "relationships.json"
    relationships_path.write_text(json.dumps({
        "relationships": [
            {
                "from": "index.md",
                "to": "wiki/systems/authentication.md",
                "relationship_type": "references",
                "confidence": "high",
                "legacy_note": "preserve additive fields",
            }
        ]
    }) + "\n")

    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)

    assert rc.returncode == 0, rc.stderr


def test_validate_rejects_unknown_relationship_page_endpoint(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    relationships_path = tmp_sample_project_with_repo / "state" / "relationships.json"
    relationships_path.write_text(json.dumps({
        "relationships": [
            {
                "from": "index.md",
                "to": "wiki/systems/missing.md",
                "relationship_type": "references",
                "confidence": "high",
            }
        ]
    }) + "\n")

    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)

    assert rc.returncode != 0
    findings = json.loads((run_dir / "validation-findings.json").read_text())
    assert any(finding["rule_id"] == "relationship_schema" for finding in findings["structural"])


def test_validate_emits_curated_semantic_warning_to_inbox(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = tmp_path / "stubs"
    shutil.copytree(REPO_ROOT / "tests" / "fixtures" / "stubs", stub_dir)
    shutil.copy(
        REPO_ROOT / "tests" / "fixtures" / "stubs" / "06-validate.semantic.redundancy.json",
        stub_dir / "06-validate.semantic.json",
    )
    env = _run_pipeline_through_apply(tmp_sample_project_with_repo, stub_dir, run_dir)

    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)

    assert rc.returncode == 0, f"stderr={rc.stderr}"
    inbox_files = sorted((tmp_sample_project_with_repo / "inbox").glob("*.json"))
    assert len(inbox_files) == 1
    item = json.loads(inbox_files[0].read_text())
    assert item["source"] == "validate-auto"
    assert item["target_hint"] == "wiki/systems/admin-and-configuration.md"
    assert item["pages_read"] == [
        "wiki/systems/admin-and-configuration.md",
        "wiki/systems/coach-and-scheduling.md",
    ]
    assert "Clarify overlap between" in item["question"]
    assert "Suggested action:" in item["enriched_notes"]
    assert json.loads(item["operator_notes"]) == {
        "category": "redundancy",
        "pages": [
            "wiki/systems/admin-and-configuration.md",
            "wiki/systems/coach-and-scheduling.md",
        ],
        "suggested_action": "Add one sentence clarifying that coach exercise CRUD is the exception routed through `admin_config`, while most other coach operations remain under `coach_config`.",
    }


def test_validate_does_not_emit_duplicate_curated_warning_while_pending(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = tmp_path / "stubs"
    shutil.copytree(REPO_ROOT / "tests" / "fixtures" / "stubs", stub_dir)
    shutil.copy(
        REPO_ROOT / "tests" / "fixtures" / "stubs" / "06-validate.semantic.redundancy.json",
        stub_dir / "06-validate.semantic.json",
    )
    env = _run_pipeline_through_apply(tmp_sample_project_with_repo, stub_dir, run_dir)

    first = _run_validate(tmp_sample_project_with_repo, run_dir, env)
    second = _run_validate(tmp_sample_project_with_repo, run_dir, env)

    assert first.returncode == 0, f"stderr={first.stderr}"
    assert second.returncode == 0, f"stderr={second.stderr}"
    inbox_files = sorted((tmp_sample_project_with_repo / "inbox").glob("*.json"))
    assert len(inbox_files) == 1
