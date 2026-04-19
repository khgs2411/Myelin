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
    assert result["pages_considered"] == 2
    assert result["router_model"] == "codex/gpt-5.4-mini"
    assert result["synthesizer_model"] == "codex/gpt-5.4-mini"
    assert result["tokens_consumed"]["input_chars"] == 240
    assert result["tokens_consumed"]["output_chars"] == 60
    assert result["tokens_consumed"]["is_estimate"] is True


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


@pytest.mark.parametrize(
    ("model_env", "expected"),
    [
        (None, "codex/gpt-5.4-mini"),
        ("codex", "codex/gpt-5.4-mini"),
        ("codex/gpt-5.4", "codex/gpt-5.4-mini"),
        ("claude", "claude/claude-haiku-4-5"),
        ("claude/claude-sonnet-4-5", "claude/claude-haiku-4-5"),
    ],
)
def test_resolve_weak_model(model_env, expected, monkeypatch):
    query_engine = _import_query_engine()
    if model_env is None:
        monkeypatch.delenv("MODEL", raising=False)
    else:
        monkeypatch.setenv("MODEL", model_env)

    assert query_engine._resolve_weak_model() == expected
