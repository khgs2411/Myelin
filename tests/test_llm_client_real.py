"""Tests for llm_client real-LLM path.

These tests DO NOT call a real LLM. They mock subprocess.run to verify the
client constructs the right CLI commands and parses responses correctly.
The actual live-LLM test is in the dry-run harness (Task 4), not pytest.
"""

import inspect
import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest


REPO_ROOT = Path(__file__).parent.parent


def _import_client():
    sys.path.insert(0, str(REPO_ROOT))
    from agents.update._shared import llm_client
    return llm_client


def test_codex_backend_command_shape(monkeypatch):
    """Default codex path: `codex exec --skip-git-repo-check -` with prompt via stdin."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.delenv("MODEL", raising=False)
    monkeypatch.delenv("MODEL_REASONING_EFFORT", raising=False)

    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["stdin"] = kwargs.get("input")
        result = MagicMock()
        result.returncode = 0
        result.stdout = '{"foo": "bar"}'
        result.stderr = ""
        return result

    monkeypatch.setattr(subprocess, "run", fake_run)
    out = llm_client.invoke(stage_id="03-propose", prompt="user-prompt-body")
    assert out["response"] == {"foo": "bar"}

    cmd = captured["cmd"]
    assert Path(cmd[0]).name == "codex"
    assert cmd[1] == "exec"
    assert "--skip-git-repo-check" in cmd
    assert cmd[-1] == "-"
    # Sandbox must be read-only: prevents codex from writing the JSON payload
    # to disk and replying with a markdown status message that can't be parsed.
    assert "--sandbox" in cmd
    assert cmd[cmd.index("--sandbox") + 1] == "read-only"
    assert "--model" in cmd
    assert cmd[cmd.index("--model") + 1] == "gpt-5.4"
    assert "-c" in cmd
    assert cmd[cmd.index("-c") + 1] == 'model_reasoning_effort="high"'
    assert "--add-dir" not in cmd
    assert "-o" not in cmd
    assert captured["stdin"] is not None
    assert "user-prompt-body" in captured["stdin"]


def test_codex_backend_model_override(monkeypatch):
    """MODEL=codex/o1 appends --model o1 after the subcommand."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.setenv("MODEL", "codex/o1")
    monkeypatch.delenv("MODEL_REASONING_EFFORT", raising=False)

    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return MagicMock(returncode=0, stdout="{}", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    llm_client.invoke(stage_id="03-propose", prompt="x")
    cmd = captured["cmd"]
    assert "--model" in cmd
    assert cmd[cmd.index("--model") + 1] == "o1"
    assert "-c" in cmd
    assert cmd[cmd.index("-c") + 1] == 'model_reasoning_effort="high"'


def test_non_pipeline_stage_keeps_codex_default_model_when_model_unset(monkeypatch):
    """Non-pipeline codex calls should not pin a model or reasoning effort."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.delenv("MODEL", raising=False)
    monkeypatch.delenv("MODEL_REASONING_EFFORT", raising=False)

    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return MagicMock(returncode=0, stdout="{}", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    llm_client.invoke(stage_id="measure.q1", prompt="x")
    cmd = captured["cmd"]
    assert "--model" not in cmd
    assert "-c" not in cmd


def test_codex_query_stage_uses_medium_reasoning(monkeypatch):
    """Query stages use the weak model with explicit medium reasoning."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.delenv("MODEL", raising=False)
    monkeypatch.delenv("MODEL_REASONING_EFFORT", raising=False)

    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return MagicMock(returncode=0, stdout="{}", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    llm_client.invoke(
        stage_id="query.router",
        prompt="x",
        model_override="codex/gpt-5.4-mini",
    )
    cmd = captured["cmd"]
    assert "--model" in cmd
    assert cmd[cmd.index("--model") + 1] == "gpt-5.4-mini"
    assert "-c" in cmd
    assert cmd[cmd.index("-c") + 1] == 'model_reasoning_effort="medium"'


def test_model_reasoning_effort_override_wins_for_pipeline_stage(monkeypatch):
    """Explicit reasoning override should replace the pinned high default."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.setenv("MODEL", "codex/gpt-5.5")
    monkeypatch.setenv("MODEL_REASONING_EFFORT", "medium")

    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return MagicMock(returncode=0, stdout="{}", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    llm_client.invoke(stage_id="08-ingest", prompt="x")
    cmd = captured["cmd"]
    assert "--model" in cmd
    assert cmd[cmd.index("--model") + 1] == "gpt-5.5"
    assert "-c" in cmd
    assert cmd[cmd.index("-c") + 1] == 'model_reasoning_effort="medium"'


def test_claude_backend_command_shape(monkeypatch):
    """MODEL=claude: `claude -p --output-format json <prompt-via-file>`."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.setenv("MODEL", "claude")

    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["stdin"] = kwargs.get("input")
        return MagicMock(
            returncode=0,
            stdout=json.dumps({"result": '{"foo": "bar"}'}),
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    out = llm_client.invoke(stage_id="03-propose", prompt="user-prompt")
    assert out["response"] == {"foo": "bar"}

    cmd = captured["cmd"]
    assert Path(cmd[0]).name == "claude"
    assert "-p" in cmd
    assert "--output-format" in cmd
    assert cmd[cmd.index("--output-format") + 1] == "json"
    assert captured.get("stdin") is None


def test_claude_final_message_fallback(monkeypatch):
    """If claude wrapper uses final_message instead of result, client still parses."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.setenv("MODEL", "claude")

    def fake_run(cmd, **kwargs):
        return MagicMock(
            returncode=0,
            stdout=json.dumps({"final_message": '{"x": 1}'}),
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    out = llm_client.invoke(stage_id="03-propose", prompt="y")
    assert out["response"] == {"x": 1}


def test_prompt_too_large_raises_before_subprocess(monkeypatch):
    """Prompts above PROMPT_SIZE_LIMIT raise a clear RuntimeError pre-spawn."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.setenv("MODEL", "claude")

    def fake_run(*a, **k):
        raise AssertionError("subprocess.run should not be called")

    monkeypatch.setattr(subprocess, "run", fake_run)
    huge = "x" * (llm_client.PROMPT_SIZE_LIMIT + 1)
    with pytest.raises(RuntimeError, match="prompt too large"):
        llm_client.invoke(stage_id="03-propose", prompt=huge)


def test_malformed_json_response_raises(monkeypatch):
    """If the LLM returns prose instead of JSON, the client raises a clear error."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.setenv("MODEL", "codex")

    def fake_run(cmd, **kwargs):
        return MagicMock(
            returncode=0,
            stdout="Sorry, I can't produce JSON for this request.",
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    with pytest.raises(RuntimeError, match="response is not valid JSON"):
        llm_client.invoke(stage_id="03-propose", prompt="x")


def test_codex_response_with_fenced_json_is_recovered(monkeypatch):
    """Codex sometimes wraps the JSON answer in prose plus a fenced json block."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.setenv("MODEL", "codex")

    def fake_run(cmd, **kwargs):
        return MagicMock(
            returncode=0,
            stdout=(
                "Semantic pass. Coverage looks good.\n\n"
                "```json\n"
                '{\n  "findings": []\n}\n'
                "```"
            ),
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    out = llm_client.invoke(stage_id="06-validate.semantic", prompt="x")
    assert out["response"] == {"findings": []}


def test_codex_response_with_markdown_link_before_json_is_recovered(monkeypatch):
    """A markdown link in prose must not be mistaken for a JSON array."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.setenv("MODEL", "codex")

    def fake_run(cmd, **kwargs):
        return MagicMock(
            returncode=0,
            stdout=(
                "Wrote the reconcile output to "
                "[reconcile-proposal.json](/tmp/reconcile-proposal.json).\n\n"
                '{\n  "summary": "reconcile: no autonomous fix possible",\n'
                '  "approved": false,\n'
                '  "units": []\n'
                "}\n"
            ),
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    out = llm_client.invoke(stage_id="07-reconcile", prompt="x")
    assert out["response"] == {
        "summary": "reconcile: no autonomous fix possible",
        "approved": False,
        "units": [],
    }


def test_codex_response_with_plain_fenced_json_is_recovered(monkeypatch):
    """A plain fenced block without a json language tag should still parse."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.setenv("MODEL", "codex")

    def fake_run(cmd, **kwargs):
        return MagicMock(
            returncode=0,
            stdout=(
                "Result follows.\n\n"
                "```\n"
                '{\n  "approved": false,\n  "units": []\n}\n'
                "```"
            ),
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    out = llm_client.invoke(stage_id="07-reconcile", prompt="x")
    assert out["response"] == {"approved": False, "units": []}


def test_non_zero_exit_raises(monkeypatch):
    """CLI non-zero exit surfaces as a clean RuntimeError with stderr context."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.setenv("MODEL", "codex")

    def fake_run(cmd, **kwargs):
        return MagicMock(returncode=1, stdout="", stderr="codex: authentication failed")

    monkeypatch.setattr(subprocess, "run", fake_run)
    with pytest.raises(RuntimeError, match="authentication failed"):
        llm_client.invoke(stage_id="03-propose", prompt="x")


def test_stub_path_still_works_when_env_set(tmp_path, monkeypatch):
    """Sanity: the pre-existing stub path must keep working after real-LLM wire-up."""
    llm_client = _import_client()
    stub_dir = tmp_path / "stubs"
    stub_dir.mkdir()
    (stub_dir / "03-propose.json").write_text(json.dumps({
        "stage": "03-propose",
        "response": {"from_stub": True},
        "tokens_consumed": {"input": 1, "output": 1},
    }))
    monkeypatch.setenv("LLM_STUB_RESPONSES_DIR", str(stub_dir))
    out = llm_client.invoke(stage_id="03-propose", prompt="x")
    assert out["response"] == {"from_stub": True}


def test_real_path_emits_normalized_tokens_consumed(monkeypatch):
    """Real path must return tokens_consumed with input_chars/output_chars/is_estimate keys."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.setenv("MODEL", "codex")

    def fake_run(cmd, **kwargs):
        return MagicMock(returncode=0, stdout='{"ok": true}', stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    out = llm_client.invoke(stage_id="03-propose", prompt="hello")
    tc = out["tokens_consumed"]
    assert set(tc.keys()) == {"input_chars", "output_chars", "is_estimate"}
    assert tc["input_chars"] > 0
    assert tc["is_estimate"] is True


def test_invoke_signature_allows_model_override_only(monkeypatch):
    """invoke() may accept model_override, but must not accept the deprecated model kwarg."""
    llm_client = _import_client()
    sig = inspect.signature(llm_client.invoke)
    assert "model" not in sig.parameters, (
        "invoke() must not accept a `model` kwarg; "
        "backend is selected by the MODEL env var only"
    )
    assert "model_override" in sig.parameters
