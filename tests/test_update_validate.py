"""Validate stage end-to-end tests."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _import_semantic_context():
    stage_dir = REPO_ROOT / "agents" / "update" / "06-validate"
    sys.path.insert(0, str(stage_dir))
    import semantic_context
    return semantic_context


def _run_pipeline_through_apply(project_dir: Path, stub_dir: Path, run_dir: Path, auto: bool = True, pre_apply=None):
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
    if pre_apply is not None:
        pre_apply(project_dir)
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


def test_validate_skips_semantic_when_structural_blocks(tmp_sample_project_with_repo, tmp_path):
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
    assert findings["semantic"] == []
    assert findings["semantic_skipped_reason"] == "structural_blockers"
    assert not (stub_dir / ".06-validate.semantic.count").exists()


def test_ingest_semantic_context_includes_only_touched_and_cross_ref_pages(tmp_path):
    semantic_context = _import_semantic_context()
    project_dir = tmp_path / "project"
    (project_dir / "wiki" / "systems").mkdir(parents=True)
    (project_dir / "index.md").write_text("Index body\n")
    (project_dir / "wiki" / "systems" / "touched.md").write_text("Touched body\n")
    (project_dir / "wiki" / "systems" / "related.md").write_text("Related body\n")
    (project_dir / "wiki" / "systems" / "unrelated.md").write_text("Unrelated body\n")
    proposal = {
        "units": [
            {
                "page_path": "wiki/systems/touched.md",
                "affected_cross_refs": ["wiki/systems/related.md"],
            }
        ],
        "index_changes": None,
    }

    payload = semantic_context.build_semantic_prompt_payload(
        project_key="sample",
        project_dir=project_dir,
        ranking={},
        proposal=proposal,
        enabled_rules=["coverage_gap"],
        ingest_mode=True,
    )

    assert payload["index_md"] == ""
    assert [page["path"] for page in payload["wiki_pages"]] == [
        "wiki/systems/related.md",
        "wiki/systems/touched.md",
    ]
    assert "Unrelated body" not in json.dumps(payload)
    assert payload["semantic_context"]["scope"] == "ingest_touched"
    assert payload["semantic_context"]["omitted_wiki_page_count"] == 1


def test_ingest_semantic_context_includes_index_only_when_touched(tmp_path):
    semantic_context = _import_semantic_context()
    project_dir = tmp_path / "project"
    (project_dir / "wiki" / "systems").mkdir(parents=True)
    (project_dir / "index.md").write_text("Index body\n")
    (project_dir / "wiki" / "systems" / "touched.md").write_text("Touched body\n")
    proposal = {
        "units": [{"page_path": "wiki/systems/touched.md", "affected_cross_refs": []}],
        "index_changes": {"action": "update"},
    }

    payload = semantic_context.build_semantic_prompt_payload(
        project_key="sample",
        project_dir=project_dir,
        ranking={},
        proposal=proposal,
        enabled_rules=["coverage_gap"],
        ingest_mode=True,
    )

    assert payload["index_md"] == "Index body\n"
    assert payload["semantic_context"]["included_pages"] == [
        "index.md",
        "wiki/systems/touched.md",
    ]


def test_ingest_semantic_context_falls_back_to_full_wiki_when_no_pages_resolve(tmp_path):
    semantic_context = _import_semantic_context()
    project_dir = tmp_path / "project"
    (project_dir / "wiki" / "systems").mkdir(parents=True)
    (project_dir / "index.md").write_text("Index body\n")
    (project_dir / "wiki" / "systems" / "kept.md").write_text("Kept body\n")
    proposal = {
        "units": [{"page_path": "wiki/systems/missing.md", "affected_cross_refs": []}],
        "index_changes": None,
    }

    payload = semantic_context.build_semantic_prompt_payload(
        project_key="sample",
        project_dir=project_dir,
        ranking={},
        proposal=proposal,
        enabled_rules=["coverage_gap"],
        ingest_mode=True,
    )

    assert payload["index_md"] == "Index body\n"
    assert [page["path"] for page in payload["wiki_pages"]] == ["wiki/systems/kept.md"]
    assert payload["semantic_context"]["scope"] == "full"


def test_compile_semantic_context_uses_full_wiki(tmp_path):
    semantic_context = _import_semantic_context()
    project_dir = tmp_path / "project"
    (project_dir / "wiki" / "systems").mkdir(parents=True)
    (project_dir / "index.md").write_text("Index body\n")
    (project_dir / "wiki" / "systems" / "touched.md").write_text("Touched body\n")
    (project_dir / "wiki" / "systems" / "unrelated.md").write_text("Unrelated body\n")
    proposal = {
        "units": [{"page_path": "wiki/systems/touched.md", "affected_cross_refs": []}],
        "index_changes": None,
    }

    payload = semantic_context.build_semantic_prompt_payload(
        project_key="sample",
        project_dir=project_dir,
        ranking={},
        proposal=proposal,
        enabled_rules=["coverage_gap"],
        ingest_mode=False,
    )

    assert payload["index_md"] == "Index body\n"
    assert [page["path"] for page in payload["wiki_pages"]] == [
        "wiki/systems/touched.md",
        "wiki/systems/unrelated.md",
    ]
    assert payload["semantic_context"]["scope"] == "full"


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


def test_apply_normalizes_legacy_relationships_before_building_keys(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()

    def write_legacy_relationships(project_dir: Path) -> None:
        (project_dir / "state" / "relationships.json").write_text(json.dumps({
            "relationships": [
                {
                    "source": "index.md",
                    "target": "wiki/systems/authentication.md",
                    "type": "references",
                    "confidence": "medium",
                },
                {
                    "from": "index.md",
                    "to": "wiki/systems/authentication.md",
                    "relationship_type": "references",
                    "confidence": "high",
                },
                {
                    "source": "missing.md",
                    "target": "wiki/systems/authentication.md",
                    "type": "references",
                },
            ]
        }, indent=2) + "\n")

    _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
        pre_apply=write_legacy_relationships,
    )

    relationships = json.loads((tmp_sample_project_with_repo / "state" / "relationships.json").read_text())
    assert {
        "from": "index.md",
        "to": "wiki/systems/authentication.md",
        "relationship_type": "references",
        "confidence": "high",
    } in relationships["relationships"]
    assert all("source" not in relationship for relationship in relationships["relationships"])
    assert all(relationship.get("from") != "missing.md" for relationship in relationships["relationships"])


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
