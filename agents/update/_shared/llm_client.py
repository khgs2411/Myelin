"""LLM client with stub-aware invocation and real CLI backends.

Behavior:
- If LLM_STUB_RESPONSES_DIR is set, read a canned response from
  <stub-dir>/<stage_id>.json.
- Otherwise, shell out to the codex or claude CLI selected via MODEL.

Backend selection is by the MODEL env var only. There is no `model=` kwarg
on invoke(). Supported MODEL values:

    codex
    codex/<id>
    claude
    claude/<id>
    <anything-else>  -> treated as codex/<anything-else>

This wrapper is intentionally thinner than stage_runner.sh: update stages are
pure text-in/JSON-out calls, so they do not need sandbox flags, a working
directory, repo mounts, or summary-file side effects.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


CODEX_BIN = os.environ.get("CODEX_BIN", "codex")
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")
PROMPT_SIZE_LIMIT = 200_000
PIPELINE_STAGE_PREFIXES = {
    "01-sense",
    "02-impact",
    "03-propose",
    "05-acceptance",
    "06-validate",
    "07-reconcile",
    "08-ingest",
    "09-self-correct",
}
DEFAULT_PIPELINE_CODEX_MODEL = "codex/gpt-5.4"
DEFAULT_PIPELINE_REASONING_EFFORT = "high"
DEFAULT_QUERY_REASONING_EFFORT = "medium"


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _stage_instructions_path(stage_id: str) -> Path | None:
    """Map a stage_id to its instructions.md file, if one exists."""
    root = Path(__file__).resolve().parents[3]
    if stage_id == "query.router":
        path = root / "agents" / "query" / "router_instructions.md"
        return path if path.is_file() else None
    if stage_id == "query.synthesizer":
        path = root / "agents" / "query" / "synthesizer_instructions.md"
        return path if path.is_file() else None
    base = stage_id.split(".", 1)[0]
    path = root / "agents" / "update" / base / "instructions.md"
    return path if path.is_file() else None


def _build_combined_prompt(stage_id: str, user_prompt: str) -> str:
    """Prefix runtime input with the stage instructions when present."""
    instructions_path = _stage_instructions_path(stage_id)
    if instructions_path is None:
        return user_prompt
    system = instructions_path.read_text()
    return (
        f"# System instructions for stage {stage_id}\n\n"
        f"{system}\n\n"
        "---\n\n"
        "# Runtime input (JSON)\n\n"
        f"{user_prompt}\n"
    )


def _parse_codex_response(stdout: str) -> dict:
    text = stdout.strip()
    if not text:
        raise RuntimeError("codex returned empty output")
    try:
        return _parse_jsonish_text(text)
    except json.JSONDecodeError:
        pass

    recovered = _recover_from_referenced_file(text)
    if recovered is not None:
        return recovered

    try:
        return _parse_jsonish_text(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"response is not valid JSON: {exc}\n"
            f"first 500 chars: {text[:500]!r}"
        ) from exc


def _recover_from_referenced_file(text: str) -> dict | None:
    """Last-resort recovery: codex wrote its JSON to disk and narrated.

    When codex runs with a writable sandbox, it will sometimes "help" by writing
    the expected artifact to disk and replying with a markdown status message
    like: `Wrote [reconcile-proposal.json](/abs/path/reconcile-proposal.json)`.
    That stdout is un-parseable by itself, but the real payload is on disk. We
    scan the prose for markdown-link-style absolute JSON paths, try each, and
    return the first one that parses as a JSON object.

    This is defense-in-depth against drift in codex tooling or instructions; the
    primary fix is to run codex with `--sandbox read-only` so it cannot write
    in the first place.
    """
    # Match (/abs/path/to/file.json) or (/abs/path/to/file.json "title")
    pattern = re.compile(r"\((/[^)\s]+?\.json)(?:\s+\"[^\"]*\")?\)")
    seen: set[str] = set()
    for match in pattern.finditer(text):
        candidate = match.group(1)
        if candidate in seen:
            continue
        seen.add(candidate)
        path = Path(candidate)
        if not path.is_file():
            continue
        try:
            raw = path.read_text()
        except OSError:
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _parse_claude_response(stdout: str) -> dict:
    text = stdout.strip()
    if not text:
        raise RuntimeError("claude returned empty output")
    try:
        wrapper = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"claude wrapper is not valid JSON: {exc}\n"
            f"first 500 chars: {text[:500]!r}"
        ) from exc
    inner = wrapper.get("result") or wrapper.get("final_message") or ""
    if not inner:
        raise RuntimeError(
            "claude wrapper missing 'result'/'final_message' field: "
            f"{list(wrapper.keys())}"
        )
    try:
        return _parse_jsonish_text(inner)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"response is not valid JSON: {exc}\n"
            f"first 500 chars of result: {inner[:500]!r}"
        ) from exc


def _parse_jsonish_text(text: str) -> dict:
    """Parse direct JSON or recover a JSON payload from wrapper prose."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    for fenced in re.finditer(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.IGNORECASE | re.DOTALL):
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            continue

    for candidate in _iter_json_candidates(text):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    return json.loads(text)


def _iter_json_candidates(text: str):
    """Yield balanced JSON-looking object/array substrings from prose."""
    for idx, char in enumerate(text):
        if char not in "{[":
            continue
        candidate = _extract_balanced_json_value(text, idx)
        if candidate is not None:
            yield candidate


def _extract_balanced_json_value(text: str, start: int) -> str | None:
    """Return a balanced JSON object/array starting at `start`, if any."""
    if start < 0 or start >= len(text) or text[start] not in "{[":
        return None

    stack: list[str] = []
    in_string = False
    escape = False
    for idx in range(start, len(text)):
        char = text[idx]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue
        if char in "{[":
            stack.append(char)
            continue
        if char in "}]":
            if not stack:
                return None
            opener = stack.pop()
            if (opener, char) not in {("{", "}"), ("[", "]")}:
                return None
            if not stack:
                return text[start : idx + 1]

    return None


def _is_pipeline_stage(stage_id: str) -> bool:
    return stage_id.split(".", 1)[0] in PIPELINE_STAGE_PREFIXES


def _is_query_stage(stage_id: str) -> bool:
    return stage_id in {"query.router", "query.synthesizer"}


def _resolve_model(stage_id: str, model_override: str | None = None) -> str:
    if model_override:
        return model_override
    model = os.environ.get("MODEL")
    if model:
        return model
    if _is_pipeline_stage(stage_id):
        return DEFAULT_PIPELINE_CODEX_MODEL
    return "codex"


def _resolve_backend(stage_id: str, model_override: str | None = None) -> tuple[str, str]:
    model = _resolve_model(stage_id, model_override=model_override)
    if model == "claude":
        return "claude", ""
    if model.startswith("claude/"):
        return "claude", model[len("claude/"):]
    if model == "codex":
        return "codex", ""
    if model.startswith("codex/"):
        return "codex", model[len("codex/"):]
    return "codex", model


def _resolve_reasoning_effort(stage_id: str, backend: str) -> str:
    if backend != "codex":
        return ""
    configured = os.environ.get("MODEL_REASONING_EFFORT")
    if configured:
        return configured
    if _is_pipeline_stage(stage_id):
        return DEFAULT_PIPELINE_REASONING_EFFORT
    if _is_query_stage(stage_id):
        return DEFAULT_QUERY_REASONING_EFFORT
    return ""


def _normalize_tokens(raw: dict, is_estimate: bool = True) -> dict[str, Any]:
    """Normalize tokens_consumed to a stable char-count schema."""
    input_chars = raw.get("input_chars", raw.get("input", 0))
    output_chars = raw.get("output_chars", raw.get("output", 0))
    return {
        "input_chars": int(input_chars),
        "output_chars": int(output_chars),
        "is_estimate": bool(raw.get("is_estimate", is_estimate)),
    }


def _invocation_metadata(
    *,
    stage_id: str,
    prompt: str,
    model_override: str | None = None,
    output_chars: int | None = None,
) -> dict[str, Any]:
    backend, model_id = _resolve_backend(stage_id, model_override)
    reasoning_effort = _resolve_reasoning_effort(stage_id, backend)
    combined = _build_combined_prompt(stage_id, prompt)
    return {
        "backend": backend,
        "model": model_id or backend,
        "reasoning_effort": reasoning_effort or None,
        "runtime_prompt_chars": len(prompt),
        "combined_prompt_chars": len(combined),
        "output_chars": output_chars,
    }


def _record_result(stage_id: str, result: dict[str, Any], metadata: dict[str, Any] | None = None) -> None:
    """Write run-local LLM metadata when an orchestrator asks for it."""
    result_dir = os.environ.get("LLM_WIKI_LLM_RESULTS_DIR")
    if not result_dir:
        return
    try:
        path = Path(result_dir)
        path.mkdir(parents=True, exist_ok=True)
        safe_stage_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", stage_id)
        index = 1
        while True:
            candidate = path / f"{safe_stage_id}.{index}.json"
            if not candidate.exists():
                break
            index += 1
        payload = {
            "stage_id": stage_id,
            "tokens_consumed": result.get("tokens_consumed", {}),
        }
        if metadata:
            payload["metadata"] = metadata
        candidate.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    except OSError as exc:
        print(f"warning: LLM result metadata write failed for {stage_id}: {exc}", file=sys.stderr)


def _invoke_real(
    stage_id: str,
    prompt: str,
    model_override: str | None = None,
) -> dict[str, Any]:
    backend, model_id = _resolve_backend(stage_id, model_override)
    reasoning_effort = _resolve_reasoning_effort(stage_id, backend)
    combined = _build_combined_prompt(stage_id, prompt)

    if len(combined) > PROMPT_SIZE_LIMIT:
        raise RuntimeError(
            f"prompt too large for CLI arg: {len(combined)} chars "
            f"exceeds PROMPT_SIZE_LIMIT={PROMPT_SIZE_LIMIT}. "
            "Trim the stage's instructions or the runtime input."
        )

    if backend == "claude":
        cmd = [CLAUDE_BIN, "-p", "--output-format", "json"]
        if model_id:
            cmd += ["--model", model_id]
        cmd.append(combined)
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(
                f"{CLAUDE_BIN} exited {result.returncode}: {result.stderr.strip()}"
            )
        response = _parse_claude_response(result.stdout)
    else:
        cmd = [
            CODEX_BIN,
            "exec",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
        ]
        if model_id:
            cmd += ["--model", model_id]
        if reasoning_effort:
            cmd += ["-c", f'model_reasoning_effort="{reasoning_effort}"']
        cmd.append("-")
        result = subprocess.run(cmd, capture_output=True, text=True, input=combined)
        if result.returncode != 0:
            raise RuntimeError(
                f"{CODEX_BIN} exited {result.returncode}: {result.stderr.strip()}"
            )
        response = _parse_codex_response(result.stdout)

    result_payload = {
        "response": response,
        "tokens_consumed": _normalize_tokens(
            {"input_chars": len(combined), "output_chars": len(result.stdout)},
            is_estimate=True,
        ),
    }
    _record_result(
        stage_id,
        result_payload,
        _invocation_metadata(
            stage_id=stage_id,
            prompt=prompt,
            model_override=model_override,
            output_chars=len(result.stdout),
        ),
    )
    return result_payload


def invoke(
    *,
    stage_id: str,
    prompt: str,
    model_override: str | None = None,
) -> dict[str, Any]:
    """Invoke LLM or return a stubbed response."""
    stub_dir = os.environ.get("LLM_STUB_RESPONSES_DIR")
    if stub_dir:
        stub_root = Path(stub_dir)
        counter_path = stub_root / f".{stage_id}.count"
        next_index = 1
        if counter_path.is_file():
            try:
                next_index = int(counter_path.read_text(encoding="utf-8").strip()) + 1
            except ValueError:
                next_index = 1
        sequenced_path = stub_root / f"{stage_id}.{next_index}.json"
        if sequenced_path.is_file():
            stub_path = sequenced_path
            counter_path.write_text(str(next_index), encoding="utf-8")
        else:
            stub_path = stub_root / f"{stage_id}.json"
        if not stub_path.is_file():
            raise FileNotFoundError(f"stub not found: {stub_path}")
        data = json.loads(stub_path.read_text())
        expected_hash = data.get("prompt_hash")
        if expected_hash:
            actual = _sha256(prompt)
            if actual != expected_hash:
                raise RuntimeError(
                    f"prompt_hash mismatch for {stage_id}: "
                    f"stub expects {expected_hash}, got {actual}"
                )
        result_payload = {
            "response": data["response"],
            "tokens_consumed": _normalize_tokens(data.get("tokens_consumed", {})),
        }
        _record_result(
            stage_id,
            result_payload,
            _invocation_metadata(
                stage_id=stage_id,
                prompt=prompt,
                model_override=model_override,
                output_chars=result_payload["tokens_consumed"]["output_chars"],
            ),
        )
        return result_payload

    return _invoke_real(stage_id, prompt, model_override)
