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
from pathlib import Path
from typing import Any


CODEX_BIN = os.environ.get("CODEX_BIN", "codex")
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")
PROMPT_SIZE_LIMIT = 200_000


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _stage_instructions_path(stage_id: str) -> Path | None:
    """Map a stage_id to its instructions.md file, if one exists."""
    root = Path(__file__).resolve().parents[3]
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


def _resolve_backend() -> tuple[str, str]:
    model = os.environ.get("MODEL", "codex")
    if model == "claude":
        return "claude", ""
    if model.startswith("claude/"):
        return "claude", model[len("claude/"):]
    if model == "codex":
        return "codex", ""
    if model.startswith("codex/"):
        return "codex", model[len("codex/"):]
    return "codex", model


def _normalize_tokens(raw: dict, is_estimate: bool = True) -> dict[str, Any]:
    """Normalize tokens_consumed to a stable char-count schema."""
    input_chars = raw.get("input_chars", raw.get("input", 0))
    output_chars = raw.get("output_chars", raw.get("output", 0))
    return {
        "input_chars": int(input_chars),
        "output_chars": int(output_chars),
        "is_estimate": bool(raw.get("is_estimate", is_estimate)),
    }


def _invoke_real(stage_id: str, prompt: str) -> dict[str, Any]:
    backend, model_id = _resolve_backend()
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
        cmd.append("-")
        result = subprocess.run(cmd, capture_output=True, text=True, input=combined)
        if result.returncode != 0:
            raise RuntimeError(
                f"{CODEX_BIN} exited {result.returncode}: {result.stderr.strip()}"
            )
        response = _parse_codex_response(result.stdout)

    return {
        "response": response,
        "tokens_consumed": _normalize_tokens(
            {"input_chars": len(combined), "output_chars": len(result.stdout)},
            is_estimate=True,
        ),
    }


def invoke(*, stage_id: str, prompt: str) -> dict[str, Any]:
    """Invoke LLM or return a stubbed response."""
    stub_dir = os.environ.get("LLM_STUB_RESPONSES_DIR")
    if stub_dir:
        stub_path = Path(stub_dir) / f"{stage_id}.json"
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
        return {
            "response": data["response"],
            "tokens_consumed": _normalize_tokens(data.get("tokens_consumed", {})),
        }

    return _invoke_real(stage_id, prompt)
