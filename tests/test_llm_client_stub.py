"""Tests for LLM client stub mechanism.

The client must honor LLM_STUB_RESPONSES_DIR env var and return canned
responses keyed by stage name when set.
"""

import hashlib
import json
import sys
from pathlib import Path

import pytest


def _import_client():
    repo_root = Path(__file__).parent.parent
    sys.path.insert(0, str(repo_root))
    from agents.update._shared import llm_client
    return llm_client


def test_stub_returns_canned_response(tmp_path, monkeypatch):
    llm_client = _import_client()
    stub_dir = tmp_path / "stubs"
    stub_dir.mkdir()
    stub_file = stub_dir / "01-sense.classifier.json"
    stub_file.write_text(json.dumps({
        "stage": "01-sense.classifier",
        "response": {"source_kind_hint": "spec", "confidence": "medium"},
        "tokens_consumed": {"input": 100, "output": 10}
    }))
    monkeypatch.setenv("LLM_STUB_RESPONSES_DIR", str(stub_dir))
    result = llm_client.invoke(
        stage_id="01-sense.classifier",
        prompt="anything",
    )
    assert result["response"] == {"source_kind_hint": "spec", "confidence": "medium"}
    assert result["tokens_consumed"] == {
        "input_chars": 100,
        "output_chars": 10,
        "is_estimate": True,
    }


def test_stub_prompt_hash_mismatch_fails(tmp_path, monkeypatch):
    llm_client = _import_client()
    stub_dir = tmp_path / "stubs"
    stub_dir.mkdir()
    stub_file = stub_dir / "02-impact.ranking.json"
    stub_file.write_text(json.dumps({
        "stage": "02-impact.ranking",
        "prompt_hash": "0000deadbeef",
        "response": {"ranked_domains": []},
        "tokens_consumed": {"input": 100, "output": 10}
    }))
    monkeypatch.setenv("LLM_STUB_RESPONSES_DIR", str(stub_dir))
    with pytest.raises(RuntimeError, match="prompt_hash mismatch"):
        llm_client.invoke(stage_id="02-impact.ranking", prompt="real prompt")


def test_missing_stub_file_fails(tmp_path, monkeypatch):
    llm_client = _import_client()
    stub_dir = tmp_path / "stubs"
    stub_dir.mkdir()
    monkeypatch.setenv("LLM_STUB_RESPONSES_DIR", str(stub_dir))
    with pytest.raises(FileNotFoundError):
        llm_client.invoke(stage_id="01-sense.classifier", prompt="x")


def test_indexed_stub_lookup(tmp_path, monkeypatch):
    """Multi-call stages use .q1, .q2, etc. suffixes."""
    llm_client = _import_client()
    stub_dir = tmp_path / "stubs"
    stub_dir.mkdir()
    (stub_dir / "measure.q1.json").write_text(json.dumps({
        "stage": "measure.q1",
        "response": {"score": 2, "answer": "yes"},
        "tokens_consumed": {"input": 50, "output": 5}
    }))
    monkeypatch.setenv("LLM_STUB_RESPONSES_DIR", str(stub_dir))
    result = llm_client.invoke(stage_id="measure.q1", prompt="ignored")
    assert result["response"]["score"] == 2


def test_sequenced_stub_lookup_across_repeated_stage_calls(tmp_path, monkeypatch):
    llm_client = _import_client()
    stub_dir = tmp_path / "stubs"
    stub_dir.mkdir()
    (stub_dir / "06-validate.semantic.1.json").write_text(json.dumps({
        "stage": "06-validate.semantic",
        "response": {"findings": [{"category": "coverage_gap"}]},
        "tokens_consumed": {"input": 50, "output": 5}
    }))
    (stub_dir / "06-validate.semantic.2.json").write_text(json.dumps({
        "stage": "06-validate.semantic",
        "response": {"findings": []},
        "tokens_consumed": {"input": 60, "output": 6}
    }))
    monkeypatch.setenv("LLM_STUB_RESPONSES_DIR", str(stub_dir))

    first = llm_client.invoke(stage_id="06-validate.semantic", prompt="ignored")
    second = llm_client.invoke(stage_id="06-validate.semantic", prompt="ignored")

    assert first["response"]["findings"] == [{"category": "coverage_gap"}]
    assert second["response"]["findings"] == []


def test_stub_path_emits_normalized_tokens_consumed(tmp_path, monkeypatch):
    """Stub path must return tokens_consumed with input_chars/output_chars/is_estimate keys."""
    llm_client = _import_client()
    stub_dir = tmp_path / "stubs"
    stub_dir.mkdir()
    (stub_dir / "01-sense.classifier.json").write_text(json.dumps({
        "stage": "01-sense.classifier",
        "response": {},
        "tokens_consumed": {"input_chars": 1000, "output_chars": 200, "is_estimate": True},
    }))
    monkeypatch.setenv("LLM_STUB_RESPONSES_DIR", str(stub_dir))
    out = llm_client.invoke(stage_id="01-sense.classifier", prompt="x")
    tc = out["tokens_consumed"]
    assert set(tc.keys()) == {"input_chars", "output_chars", "is_estimate"}
    assert tc["input_chars"] == 1000
    assert tc["is_estimate"] is True


def test_stub_path_records_invocation_metadata(tmp_path, monkeypatch):
    llm_client = _import_client()
    stub_dir = tmp_path / "stubs"
    result_dir = tmp_path / "llm-results"
    stub_dir.mkdir()
    (stub_dir / "08-ingest.json").write_text(json.dumps({
        "stage": "08-ingest",
        "response": {},
        "tokens_consumed": {"input_chars": 1000, "output_chars": 200, "is_estimate": True},
    }))
    monkeypatch.setenv("LLM_STUB_RESPONSES_DIR", str(stub_dir))
    monkeypatch.setenv("LLM_WIKI_LLM_RESULTS_DIR", str(result_dir))
    monkeypatch.delenv("MODEL", raising=False)
    monkeypatch.delenv("MODEL_REASONING_EFFORT", raising=False)

    llm_client.invoke(stage_id="08-ingest", prompt="runtime-prompt")

    record = json.loads((result_dir / "08-ingest.1.json").read_text())
    assert record["stage_id"] == "08-ingest"
    assert record["metadata"]["backend"] == "codex"
    assert record["metadata"]["model"] == "gpt-5.5"
    assert record["metadata"]["reasoning_effort"] == "medium"
    assert record["metadata"]["runtime_prompt_chars"] == len("runtime-prompt")
    assert record["metadata"]["combined_prompt_chars"] >= len("runtime-prompt")


def test_baseline_stubs_present_and_valid():
    """Baseline stubs under tests/fixtures/stubs/ must load and parse."""
    stub_dir = Path(__file__).parent / "fixtures" / "stubs"
    for name in ("01-sense.classifier.json", "02-impact.ranking.json", "02-impact.delta.json"):
        path = stub_dir / name
        assert path.is_file(), f"missing baseline stub: {path}"
        data = json.loads(path.read_text())
        assert "stage" in data
        assert "response" in data
        assert "tokens_consumed" in data


def test_propose_baseline_stub_present_and_valid():
    """Propose baseline stub must exist, load, and produce a well-formed proposal."""
    stub_path = Path(__file__).parent / "fixtures" / "stubs" / "03-propose.json"
    assert stub_path.is_file(), f"missing: {stub_path}"
    data = json.loads(stub_path.read_text())
    assert data["stage"] == "03-propose"
    assert "response" in data
    proposal = data["response"]
    assert proposal["project"] == "sample"
    assert "units" in proposal
    assert len(proposal["units"]) >= 1
    for unit in proposal["units"]:
        assert "justification_signals" in unit
        assert len(unit["justification_signals"]) >= 1
        assert "action" in unit
        assert unit["action"] in ("create", "update", "delete", "rename")


def test_validate_semantic_stub_present():
    stub = Path(__file__).parent / "fixtures" / "stubs" / "06-validate.semantic.json"
    assert stub.is_file()
    data = json.loads(stub.read_text())
    assert data["stage"] == "06-validate.semantic"
    assert "findings" in data["response"]
    assert isinstance(data["response"]["findings"], list)


def test_reconcile_stub_present():
    stub = Path(__file__).parent / "fixtures" / "stubs" / "07-reconcile.json"
    assert stub.is_file()
    data = json.loads(stub.read_text())
    assert data["stage"] == "07-reconcile"
    response = data["response"]
    assert "units" in response
    assert "approved" in response
