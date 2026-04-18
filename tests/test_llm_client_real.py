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
    monkeypatch.setenv("MODEL", "codex")

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
    assert "--sandbox" not in cmd
    assert "--add-dir" not in cmd
    assert "-o" not in cmd
    assert captured["stdin"] is not None
    assert "user-prompt-body" in captured["stdin"]


def test_codex_backend_model_override(monkeypatch):
    """MODEL=codex/o1 appends --model o1 after the subcommand."""
    llm_client = _import_client()
    monkeypatch.delenv("LLM_STUB_RESPONSES_DIR", raising=False)
    monkeypatch.setenv("MODEL", "codex/o1")

    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return MagicMock(returncode=0, stdout="{}", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    llm_client.invoke(stage_id="03-propose", prompt="x")
    cmd = captured["cmd"]
    assert "--model" in cmd
    assert cmd[cmd.index("--model") + 1] == "o1"


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


def test_invoke_signature_ignores_deprecated_model_kwarg(monkeypatch):
    """The invoke() signature accepts no `model` kwarg; MODEL env is the only control."""
    llm_client = _import_client()
    sig = inspect.signature(llm_client.invoke)
    assert "model" not in sig.parameters, (
        "invoke() must not accept a `model` kwarg; "
        "backend is selected by the MODEL env var only"
    )
