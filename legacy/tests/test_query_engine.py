from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).parent.parent


def _import_query_engine():
    sys.path.insert(0, str(REPO_ROOT))
    from agents.query import query_engine

    return query_engine


def _write_stub(stub_dir: Path, stage_id: str, response: dict) -> None:
    (stub_dir / f"{stage_id}.json").write_text(
        json.dumps(
            {
                "stage": stage_id,
                "response": response,
                "tokens_consumed": {"input_chars": 120, "output_chars": 30, "is_estimate": True},
            }
        )
    )


def _seed_query_project(project_dir: Path) -> None:
    (project_dir / "wiki" / "systems").mkdir(parents=True, exist_ok=True)
    (project_dir / "wiki" / "runbooks").mkdir(parents=True, exist_ok=True)
    (project_dir / "state" / "latest").mkdir(parents=True, exist_ok=True)
    (project_dir / "index.md").write_text(
        "# Sample\n\n## Start here\n- [combat](wiki/systems/combat.md)\n- [deploy](wiki/runbooks/deploy.md)\n"
    )
    (project_dir / "wiki" / "systems" / "combat.md").write_text(
        "Combat system routes actions through the ATB loop.\n"
    )
    (project_dir / "wiki" / "runbooks" / "deploy.md").write_text(
        "Deploy runbook covers server rollout and smoke tests.\n"
    )
    (project_dir / "state" / "pages.json").write_text(
        json.dumps(
            {
                "pages": [
                    {
                        "path": "wiki/systems/combat.md",
                        "type": "systems",
                        "summary": "Combat loop and ATB scheduling.",
                        "linked_topics": ["wiki/runbooks/deploy.md"],
                    },
                    {
                        "path": "wiki/runbooks/deploy.md",
                        "type": "runbooks",
                        "summary": "Deployment checklist and smoke tests.",
                        "linked_topics": ["wiki/systems/combat.md"],
                    },
                ]
            },
            indent=2,
        )
    )
    (project_dir / "state" / "latest" / "ranking-snapshot.json").write_text(
        json.dumps(
            {
                "ranked_domains": [
                    {"rank": 1, "domain": "combat-system", "score": 0.98},
                    {"rank": 2, "domain": "deployment", "score": 0.50},
                ]
            },
            indent=2,
        )
    )


def _write_query_metadata(project_dir: Path, *, combat_freshness: str = "fresh") -> None:
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
                        "aliases": ["Combat", "combat", "ATB", "atb"],
                        "tags": ["project/sample", "kind/system", "domain/combat", "status/fresh", "role/source-backed", "role/canonical"],
                        "source_paths": ["src/combat.py:1-10"],
                        "freshness_status": combat_freshness,
                        "summary": "Combat loop and ATB scheduling.",
                        "entrypoint_rank": None,
                        "canonical": True,
                    },
                    {
                        "path": "wiki/runbooks/deploy.md",
                        "title": "Deploy",
                        "page_kind": "runbook",
                        "domains": ["deployment"],
                        "topics": ["deployment"],
                        "aliases": ["Deploy", "deploy"],
                        "tags": ["project/sample", "kind/runbook", "domain/deployment", "status/fresh", "role/canonical"],
                        "source_paths": [],
                        "freshness_status": "fresh",
                        "summary": "Deployment checklist and smoke tests.",
                        "entrypoint_rank": None,
                        "canonical": True,
                    },
                ],
            },
            indent=2,
        )
    )
    (project_dir / "state" / "tag-index.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "project_key": "sample",
                "tags": {
                    "domain/combat": ["wiki/systems/combat.md"],
                    "domain/deployment": ["wiki/runbooks/deploy.md"],
                    "kind/system": ["wiki/systems/combat.md"],
                    "kind/runbook": ["wiki/runbooks/deploy.md"],
                },
            },
            indent=2,
        )
    )
    (project_dir / "state" / "alias-index.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "project_key": "sample",
                "aliases": {
                    "atb": [{"path": "wiki/systems/combat.md", "title": "Combat", "page_kind": "system"}],
                    "combat": [{"path": "wiki/systems/combat.md", "title": "Combat", "page_kind": "system"}],
                    "deploy": [{"path": "wiki/runbooks/deploy.md", "title": "Deploy", "page_kind": "runbook"}],
                },
            },
            indent=2,
        )
    )


def test_query_happy_path_uses_router_and_synthesizer(tmp_project, monkeypatch):
    _seed_query_project(tmp_project)
    stub_dir = tmp_project.parent / "stubs"
    stub_dir.mkdir()
    _write_stub(
        stub_dir,
        "query.router",
        {
            "pages": ["wiki/systems/combat.md"],
            "confidence": 0.93,
            "reasoning": "combat keyword matched",
        },
    )
    _write_stub(
        stub_dir,
        "query.synthesizer",
        {
            "answer": "Combat resolves through the ATB loop.",
            "citations": ["wiki/systems/combat.md"],
            "confidence": 0.91,
            "reasoning": "directly stated",
        },
    )
    monkeypatch.setenv("LLM_STUB_RESPONSES_DIR", str(stub_dir))

    query_engine = _import_query_engine()
    result = query_engine.query("sample", "how does combat resolve?", projects_root=tmp_project.parent)

    assert result["answer"] == "Combat resolves through the ATB loop."
    assert result["citations"] == ["wiki/systems/combat.md"]
    assert result["confidence"] == pytest.approx(0.91)
    assert result["pages_read"] == ["wiki/systems/combat.md"]
    assert result["pages_considered"] == 1
    assert result["router_model"] == "codex/gpt-5.4-mini"
    assert result["synthesizer_model"] == "codex/gpt-5.4-mini"
    assert result["tokens_consumed"]["input_chars"] == 240
    assert result["tokens_consumed"]["output_chars"] == 60
    assert result["tokens_consumed"]["is_estimate"] is True
    assert list(result.keys()) == [
        "confidence",
        "route_confidence",
        "pages_read",
        "pages_considered",
        "selected_pages",
        "freshness_warnings",
        "router_model",
        "synthesizer_model",
        "tokens_consumed",
        "citations",
        "answer",
    ]


def test_query_uses_selected_page_content_for_domain_question(tmp_project, monkeypatch):
    _seed_query_project(tmp_project)
    stub_dir = tmp_project.parent / "stubs"
    stub_dir.mkdir()

    captured_prompts: list[tuple[str, str]] = []

    def fake_invoke(*, stage_id: str, prompt: str, model_override: str | None = None):
        captured_prompts.append((stage_id, prompt))
        if stage_id == "query.router":
            return {
                "response": {
                    "pages": ["wiki/systems/combat.md"],
                    "confidence": 0.88,
                    "reasoning": "combat domain",
                },
                "tokens_consumed": {"input_chars": 10, "output_chars": 5, "is_estimate": True},
            }
        if stage_id == "query.synthesizer":
            return {
                "response": {
                    "answer": "Combat answer",
                    "citations": ["wiki/systems/combat.md"],
                    "confidence": 0.8,
                    "reasoning": "used provided page",
                },
                "tokens_consumed": {"input_chars": 8, "output_chars": 6, "is_estimate": True},
            }
        raise AssertionError(stage_id)

    query_engine = _import_query_engine()
    monkeypatch.setattr(query_engine.llm_client, "invoke", fake_invoke)

    result = query_engine.query("sample", "combat timing?", projects_root=tmp_project.parent)

    assert result["citations"] == ["wiki/systems/combat.md"]
    synth_prompt = next(prompt for stage_id, prompt in captured_prompts if stage_id == "query.synthesizer")
    assert "wiki/systems/combat.md" in synth_prompt
    assert "ATB loop" in synth_prompt
    assert "wiki/runbooks/deploy.md" not in synth_prompt


def test_query_falls_back_when_router_returns_zero_pages(tmp_project, monkeypatch):
    _seed_query_project(tmp_project)
    stub_dir = tmp_project.parent / "stubs"
    stub_dir.mkdir()
    _write_stub(
        stub_dir,
        "query.router",
        {"pages": [], "confidence": 0.2, "reasoning": "no match"},
    )
    _write_stub(
        stub_dir,
        "query.synthesizer",
        {
            "answer": "I could not find a grounded answer in the provided pages.",
            "citations": [],
            "confidence": 0.15,
            "reasoning": "no pages provided",
        },
    )
    monkeypatch.setenv("LLM_STUB_RESPONSES_DIR", str(stub_dir))

    query_engine = _import_query_engine()
    result = query_engine.query("sample", "unknown topic?", projects_root=tmp_project.parent)

    assert result["pages_read"] == []
    assert result["citations"] == []
    assert result["confidence"] == pytest.approx(0.15)
    assert "could not find" in result["answer"].lower()


def test_query_raw_mode_skips_synthesizer_and_returns_pages_content(tmp_project, monkeypatch):
    _seed_query_project(tmp_project)

    captured_stages: list[str] = []

    def fake_invoke(*, stage_id: str, prompt: str, model_override: str | None = None):
        captured_stages.append(stage_id)
        if stage_id == "query.router":
            return {
                "response": {
                    "pages": ["wiki/systems/combat.md"],
                    "confidence": 0.82,
                    "reasoning": "combat domain",
                },
                "tokens_consumed": {"input_chars": 100, "output_chars": 20, "is_estimate": True},
            }
        raise AssertionError(f"synthesizer must not be called in raw mode, got {stage_id}")

    query_engine = _import_query_engine()
    monkeypatch.setattr(query_engine.llm_client, "invoke", fake_invoke)

    result = query_engine.query(
        "sample",
        "combat timing?",
        projects_root=tmp_project.parent,
        raw=True,
    )

    assert captured_stages == ["query.router"]
    assert result["answer"] == ""
    assert result["citations"] == ["wiki/systems/combat.md"]
    assert result["confidence"] == pytest.approx(0.82)
    assert result["pages_read"] == ["wiki/systems/combat.md"]
    assert result["synthesizer_model"] is None
    assert result["router_model"] == "codex/gpt-5.4-mini"
    assert result["pages_content"] == [
        {
            "page_path": "wiki/systems/combat.md",
            "content": "Combat system routes actions through the ATB loop.\n",
        }
    ]
    assert result["tokens_consumed"]["input_chars"] == 100
    assert result["tokens_consumed"]["output_chars"] == 20
    assert list(result.keys()) == [
        "confidence",
        "route_confidence",
        "pages_read",
        "pages_considered",
        "selected_pages",
        "freshness_warnings",
        "router_model",
        "synthesizer_model",
        "tokens_consumed",
        "citations",
        "pages_content",
        "answer",
    ]


def test_query_raw_mode_low_confidence_is_passed_through(tmp_project, monkeypatch):
    _seed_query_project(tmp_project)

    def fake_invoke(*, stage_id: str, prompt: str, model_override: str | None = None):
        assert stage_id == "query.router"
        return {
            "response": {
                "pages": [],
                "confidence": 0.15,
                "reasoning": "no match",
            },
            "tokens_consumed": {"input_chars": 30, "output_chars": 5, "is_estimate": True},
        }

    query_engine = _import_query_engine()
    monkeypatch.setattr(query_engine.llm_client, "invoke", fake_invoke)

    result = query_engine.query(
        "sample",
        "unknown topic?",
        projects_root=tmp_project.parent,
        raw=True,
    )

    assert result["pages_read"] == []
    assert result["pages_content"] == []
    assert result["confidence"] == pytest.approx(0.15)
    assert result["synthesizer_model"] is None


def test_query_still_uses_pages_json_when_metadata_products_are_absent(tmp_sample_project, monkeypatch):
    query_engine = _import_query_engine()

    for name in ("page-metadata.json", "tag-index.json", "alias-index.json"):
        path = tmp_sample_project / "state" / name
        if path.exists():
            path.unlink()

    def fake_invoke(*, stage_id: str, prompt: str, model_override: str | None = None):
        if stage_id == "query.router":
            return {
                "response": {"pages": ["index.md"], "confidence": 0.8},
                "tokens_consumed": {"input_chars": 1, "output_chars": 1},
            }
        return {
            "response": {"answer": "ok", "confidence": 0.8, "citations": ["index.md"]},
            "tokens_consumed": {"input_chars": 1, "output_chars": 1},
        }

    monkeypatch.setattr(query_engine.llm_client, "invoke", fake_invoke)

    result = query_engine.query(
        project_key="sample",
        question="what is this",
        projects_root=tmp_sample_project.parent,
    )

    assert result["answer"] == "ok"
    assert result["citations"] == ["index.md"]
    assert result["selected_pages"][0]["path"] == "index.md"
    assert result["route_confidence"] >= 0.0


def test_query_metadata_alias_routing_feeds_compact_candidates(tmp_project, monkeypatch):
    _seed_query_project(tmp_project)
    _write_query_metadata(tmp_project)
    captured_prompts: list[tuple[str, str]] = []

    def fake_invoke(*, stage_id: str, prompt: str, model_override: str | None = None):
        captured_prompts.append((stage_id, prompt))
        if stage_id == "query.router":
            return {
                "response": {"pages": ["wiki/systems/combat.md"], "confidence": 0.9},
                "tokens_consumed": {"input_chars": 1, "output_chars": 1},
            }
        return {
            "response": {"answer": "ATB answer", "confidence": 0.8, "citations": ["wiki/systems/combat.md"]},
            "tokens_consumed": {"input_chars": 1, "output_chars": 1},
        }

    query_engine = _import_query_engine()
    monkeypatch.setattr(query_engine.llm_client, "invoke", fake_invoke)

    result = query_engine.query("sample", "how does ATB work?", projects_root=tmp_project.parent)

    router_prompt = json.loads(captured_prompts[0][1])
    assert router_prompt["planner_candidates"][0]["path"] == "wiki/systems/combat.md"
    assert "alias match" in router_prompt["planner_candidates"][0]["selection_reason"]
    assert "alias match" in result["selected_pages"][0]["selection_reason"]
    assert result["pages_considered"] == 1


def test_query_metadata_stale_page_warning(tmp_project, monkeypatch):
    _seed_query_project(tmp_project)
    _write_query_metadata(tmp_project, combat_freshness="stale")

    def fake_invoke(*, stage_id: str, prompt: str, model_override: str | None = None):
        if stage_id == "query.router":
            return {
                "response": {"pages": ["wiki/systems/combat.md"], "confidence": 0.9},
                "tokens_consumed": {"input_chars": 1, "output_chars": 1},
            }
        return {
            "response": {"answer": "Combat answer", "confidence": 0.8, "citations": ["wiki/systems/combat.md"]},
            "tokens_consumed": {"input_chars": 1, "output_chars": 1},
        }

    query_engine = _import_query_engine()
    monkeypatch.setattr(query_engine.llm_client, "invoke", fake_invoke)

    result = query_engine.query("sample", "combat?", projects_root=tmp_project.parent)

    assert result["freshness_warnings"] == [
        {
            "path": "wiki/systems/combat.md",
            "freshness_status": "stale",
            "message": "wiki/systems/combat.md is marked stale",
        }
    ]
    assert result["selected_pages"][0]["freshness_status"] == "stale"


def test_query_metadata_one_hop_relationship_expansion(tmp_project, monkeypatch):
    _seed_query_project(tmp_project)
    _write_query_metadata(tmp_project)
    (tmp_project / "state" / "relationships.json").write_text(
        json.dumps(
            {
                "relationships": [
                    {
                        "from": "wiki/systems/combat.md",
                        "to": "wiki/runbooks/deploy.md",
                        "relationship_type": "references",
                        "confidence": "high",
                    }
                ]
            },
            indent=2,
        )
    )
    captured_prompts: list[tuple[str, str]] = []

    def fake_invoke(*, stage_id: str, prompt: str, model_override: str | None = None):
        captured_prompts.append((stage_id, prompt))
        if stage_id == "query.router":
            return {
                "response": {"pages": ["wiki/systems/combat.md", "wiki/runbooks/deploy.md"], "confidence": 0.9},
                "tokens_consumed": {"input_chars": 1, "output_chars": 1},
            }
        return {
            "response": {
                "answer": "Expanded answer",
                "confidence": 0.8,
                "citations": ["wiki/systems/combat.md", "wiki/runbooks/deploy.md"],
            },
            "tokens_consumed": {"input_chars": 1, "output_chars": 1},
        }

    query_engine = _import_query_engine()
    monkeypatch.setattr(query_engine.llm_client, "invoke", fake_invoke)

    result = query_engine.query("sample", "combat?", projects_root=tmp_project.parent)

    router_prompt = json.loads(captured_prompts[0][1])
    assert [page["path"] for page in router_prompt["planner_candidates"]] == [
        "wiki/systems/combat.md",
        "wiki/runbooks/deploy.md",
    ]
    assert router_prompt["relationship_hints"] == [
        {
            "from": "wiki/systems/combat.md",
            "to": "wiki/runbooks/deploy.md",
            "relationship_type": "references",
        }
    ]
    assert result["pages_read"] == ["wiki/systems/combat.md", "wiki/runbooks/deploy.md"]


def test_query_raw_mode_keeps_answer_last_and_skips_synthesizer_with_metadata(tmp_project, monkeypatch):
    _seed_query_project(tmp_project)
    _write_query_metadata(tmp_project)

    def fake_invoke(*, stage_id: str, prompt: str, model_override: str | None = None):
        assert stage_id == "query.router"
        return {
            "response": {"pages": ["wiki/systems/combat.md"], "confidence": 0.82},
            "tokens_consumed": {"input_chars": 1, "output_chars": 1},
        }

    query_engine = _import_query_engine()
    monkeypatch.setattr(query_engine.llm_client, "invoke", fake_invoke)

    result = query_engine.query("sample", "ATB?", projects_root=tmp_project.parent, raw=True)

    assert result["answer"] == ""
    assert result["synthesizer_model"] is None
    assert list(result.keys())[-1] == "answer"


@pytest.mark.parametrize(
    ("model_env", "expected"),
    [
        (None, "codex/gpt-5.4-mini"),
        ("codex", "codex/gpt-5.4-mini"),
        ("claude", "claude/claude-haiku-4-5"),
        ("codex/gpt-x", "codex/gpt-x"),
        ("claude/sonnet-x", "claude/sonnet-x"),
    ],
)
def test_resolve_weak_model(model_env, expected, monkeypatch):
    query_engine = _import_query_engine()
    if model_env is None:
        monkeypatch.delenv("MODEL", raising=False)
    else:
        monkeypatch.setenv("MODEL", model_env)

    assert query_engine._resolve_weak_model() == expected


def test_resolve_weak_model_uses_default_provider_claude_config(tmp_path, monkeypatch):
    config_path = tmp_path / "llm-wiki.config"
    config_path.write_text(
        "DEFAULT_PROVIDER=claude\n"
        "QUERY_CLAUDE_MODEL=claude-haiku-test\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("LLM_WIKI_CONFIG", str(config_path))
    monkeypatch.delenv("MODEL", raising=False)

    query_engine = _import_query_engine()

    assert query_engine._resolve_weak_model() == "claude/claude-haiku-test"
