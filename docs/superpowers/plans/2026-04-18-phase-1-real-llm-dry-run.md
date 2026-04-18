# Phase 1 — Real-LLM Dry Run Implementation Plan

**Status:** Ready for development (revision 2, audit passed)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the real-LLM path in `agents/update/_shared/llm_client.py` (currently raises `NotImplementedError`), harden each Plan B stage's prompt contract so a real LLM reliably returns valid JSON, then run `make update-v2 PROJECT=sample AUTO=1` end-to-end against a real codex or claude CLI — producing an actual wiki for the sample fixture. Capture output and write a findings doc that scopes Plan C.

**Architecture:** The stub harness (`LLM_STUB_RESPONSES_DIR`) remains the default test path. The real-LLM path shells out to either the `codex` or `claude` CLI following the pattern used by `agents/bootstrap/_shared/stage_runner.sh` (codex via stdin, claude via `-p` flag, both JSON-mode where supported). Each stage's `instructions.md` gains a concrete "Required output schema" section with an inline JSON example so the LLM can pattern-match on the contract. A standalone dry-run harness script exercises the full pipeline and writes a structured findings doc.

**Tech Stack:** Python 3.13 for `llm_client.py`. Bash for the dry-run harness. Markdown for findings. Codex or Claude CLI for the LLM backend (operator choice via `MODEL` env var).

**Source spec:** `docs/superpowers/specs/2026-04-18-unified-update-pipeline-design.md` (Sections 4.2–4.5, 5.3)
**Prerequisites:** Plans A + B shipped and committed. 93 tests passing. `make update-v2 AUTO=1 PROJECT=sample` works under stubs.

**Plan scope:** Phase 1 of the three-phase B→A→C sequence. Phase 2 (Plan C: validate + reconcile + measurement) and Phase 3 (rebootstrap rpg_game) are separate documents authored after each prior phase lands.

**Non-goals:**
- Production-hardening the LLM path (retries, exponential backoff, cost caps — deferred)
- Gating stages on token budgets (logged but not enforced in this phase)
- Rebootstrap of rpg_game (Phase 3)
- Validate or reconcile stages (Phase 2)

---

## File Structure

### New files
- `scripts/dry_run_sample.sh` — harness that runs the pipeline with a real LLM and captures artifacts
- `docs/superpowers/dry-run-notes/2026-04-18-plan-b-sample-findings.md` — structured findings doc (template filled by Task 5)

### Files to modify
- `agents/update/_shared/llm_client.py` — replace `NotImplementedError` with real CLI invocation supporting codex + claude
- `agents/update/01-sense/instructions.md` — add "Required output schema" section with inline example
- `agents/update/02-impact/instructions.md` — same, for ranking + delta sub-tasks
- `agents/update/03-propose/instructions.md` — same, for proposal + deferred_domains

### Files not touched in this phase
- Anything under `agents/update/04-apply/` — apply is script-only, no LLM involvement
- Any pipeline orchestration (`scripts/update.sh`) — the wire-up already works; only `llm_client` changes
- Existing stubs under `tests/fixtures/stubs/` — remain the test path

---

## Task Sequence

Tasks are grouped by dependency. Each task follows TDD where sensible. Tasks 5 and 6 are exploratory (the dry-run and its analysis) and do not follow TDD — they produce artifacts and findings instead.

---

### Task 1: Extend `llm_client.py` with a real-LLM path (codex + claude)

**Files:**
- Modify: `agents/update/_shared/llm_client.py`
- Test: `tests/test_llm_client_real.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_llm_client_real.py`:

```python
"""Tests for llm_client real-LLM path.

These tests DO NOT call a real LLM. They mock subprocess.run to verify the
client constructs the right CLI commands and parses responses correctly.
The actual live-LLM test is in the dry-run harness (Task 4), not pytest.
"""

import json
import os
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
    """Default codex path: `codex exec --skip-git-repo-check -` with prompt via stdin.

    Notes on flags we intentionally OMIT from stage_runner.sh's pattern:
    - No --sandbox: the update pipeline LLM client is a pure prompt-in/JSON-out
      function; it never needs to write files directly.
    - No -C / --add-dir: prompts are self-contained; the LLM is not an agent
      with filesystem access, so it doesn't need a working directory or a
      readable repo root.
    - No -o: we capture stdout directly; no summary-file side effect needed.
    """
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

    # Structural assertions — match stage_runner.sh's codex invocation shape.
    cmd = captured["cmd"]
    assert Path(cmd[0]).name == "codex"
    assert cmd[1] == "exec"
    assert "--skip-git-repo-check" in cmd
    # Trailing "-" tells codex to read the prompt from stdin.
    assert cmd[-1] == "-"
    # Flags we intentionally do NOT use (would pull in sandbox/filesystem):
    assert "--sandbox" not in cmd
    assert "--add-dir" not in cmd
    assert "-o" not in cmd
    # Prompt reached stdin
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
        return MagicMock(returncode=0, stdout='{}', stderr="")

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
    # Prompt is a positional CLI arg (NOT stdin) — the ARG_MAX guard in
    # _invoke_real is only meaningful under this shape. If a future change
    # moves claude to stdin, this assertion catches the regression.
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
    """Prompts above PROMPT_SIZE_LIMIT raise a clear RuntimeError pre-spawn.

    This protects against ARG_MAX overflow on the claude backend (which passes
    the prompt as a positional CLI argument).
    """
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


def test_invoke_signature_ignores_deprecated_model_kwarg(monkeypatch):
    """The invoke() signature accepts no `model` kwarg; MODEL env is the only control.

    This test guards against a caller silently depending on a parameter that was
    removed during Plan B/Phase 1 to eliminate the silent-override bug (see C3
    in rev 1 audit).
    """
    import inspect
    llm_client = _import_client()
    sig = inspect.signature(llm_client.invoke)
    assert "model" not in sig.parameters, (
        "invoke() must not accept a `model` kwarg; "
        "backend is selected by the MODEL env var only"
    )
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_llm_client_real.py -v`
Expected: all 9 tests FAIL (real path raises `NotImplementedError`; `invoke_signature_ignores_deprecated_model_kwarg` fails because the current signature still has `model=`).

- [ ] **Step 3: Implement the real-LLM path**

Replace the body of `agents/update/_shared/llm_client.py` with:

```python
"""LLM client with stub-aware invocation and real CLI backends.

Behavior:
- If LLM_STUB_RESPONSES_DIR is set, read a canned response from
  <stub-dir>/<stage_id>.json (unchanged from the prior stub-only path).
- Otherwise, shell out to the codex or claude CLI (selected via MODEL env var).

Backend selection is by the MODEL env var only. There is no `model=` kwarg
on invoke() — it was removed after rev 1 audit because callers passing it
silently had no effect (env var took priority). MODEL values:

    codex          codex CLI, default model
    codex/<id>     codex CLI, specific model id
    claude         claude CLI, default model
    claude/<id>    claude CLI, specific model id
    <anything>     treated as codex/<anything>

Why this is a thinner wrapper than agents/bootstrap/_shared/stage_runner.sh:
stage_runner.sh is an *agentic* runner that grants the LLM filesystem access
(--sandbox workspace-write, -C root, --add-dir repo, -o summary-file). The
update pipeline stages are pure text-in/JSON-out functions — the prompt
already contains everything the LLM needs, and the caller (run.sh) parses
the returned JSON. So we deliberately omit --sandbox, -C, --add-dir, and -o.

The real path expects the CLI to return a parseable JSON payload. For codex,
stdout IS the JSON. For claude's --output-format json, the client parses the
wrapper object and extracts the embedded JSON from `result` (or
`final_message` as a fallback to match stage_runner.sh's tolerance).

Stub file schema (unchanged):
{
    "stage": "<stage_id>",
    "prompt_hash": "<optional sha256 of prompt; if present, must match>",
    "response": { ... parsed JSON response ... },
    "tokens_consumed": {"input": N, "output": N}
}
"""

import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any


CODEX_BIN = os.environ.get("CODEX_BIN", "codex")
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")

# Hard ceiling on combined prompt size to protect against ARG_MAX overflow
# (the claude backend passes the prompt as a positional CLI argument). macOS
# ARG_MAX is ~256 KB; we keep a comfortable safety margin.
PROMPT_SIZE_LIMIT = 200_000


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _stage_instructions_path(stage_id: str) -> Path | None:
    """Map a stage_id like '03-propose' or '02-impact.ranking' to its instructions.md.

    Sub-task suffixes (e.g., '.ranking') share the parent stage's instructions.
    The '01-sense.classifier' sub-task also uses '01-sense/instructions.md' —
    the schema block added in Task 2 covers both the main stage and the
    classifier sub-task explicitly.
    """
    root = Path(__file__).resolve().parents[2]  # repo root
    base = stage_id.split(".", 1)[0]
    path = root / "agents" / "update" / base / "instructions.md"
    return path if path.is_file() else None


def _build_combined_prompt(stage_id: str, user_prompt: str) -> str:
    """Concatenate the stage's instructions.md (if any) with the user prompt."""
    instructions_path = _stage_instructions_path(stage_id)
    if instructions_path is not None:
        system = instructions_path.read_text()
        return (
            f"# System instructions for stage {stage_id}\n\n"
            f"{system}\n\n"
            f"---\n\n"
            f"# Runtime input (JSON)\n\n"
            f"{user_prompt}\n"
        )
    return user_prompt


def _parse_codex_response(stdout: str) -> dict:
    text = stdout.strip()
    if not text:
        raise RuntimeError("codex returned empty output")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"response is not valid JSON: {exc}\n"
            f"first 500 chars: {text[:500]!r}"
        ) from exc


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
            f"claude wrapper missing 'result'/'final_message' field: "
            f"{list(wrapper.keys())}"
        )
    try:
        return json.loads(inner)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"response is not valid JSON: {exc}\n"
            f"first 500 chars of result: {inner[:500]!r}"
        ) from exc


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


def _invoke_real(stage_id: str, prompt: str) -> dict[str, Any]:
    backend, model_id = _resolve_backend()
    combined = _build_combined_prompt(stage_id, prompt)

    if len(combined) > PROMPT_SIZE_LIMIT:
        raise RuntimeError(
            f"prompt too large for CLI arg: {len(combined)} chars "
            f"exceeds PROMPT_SIZE_LIMIT={PROMPT_SIZE_LIMIT}. "
            f"Trim the stage's instructions or the runtime input."
        )

    if backend == "claude":
        # claude takes prompt as positional CLI arg. ARG_MAX guard above.
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
        # codex reads prompt from stdin when invoked with a trailing '-'.
        # Matches stage_runner.sh's `${cmd[@]} - <"$prompt_file"` pattern.
        cmd = [CODEX_BIN, "exec", "--skip-git-repo-check"]
        if model_id:
            cmd += ["--model", model_id]
        cmd.append("-")
        result = subprocess.run(
            cmd, capture_output=True, text=True, input=combined
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"{CODEX_BIN} exited {result.returncode}: {result.stderr.strip()}"
            )
        response = _parse_codex_response(result.stdout)

    # tokens_consumed is best-effort. "input" is the character count of the
    # combined prompt (NOT a real token count — actual tokens are ~chars/4
    # for English text). "output" is not reported by either CLI in the
    # shapes we use. Phase 1's findings doc treats these as approximations.
    return {
        "response": response,
        "tokens_consumed": {"input_chars": len(combined), "output_chars": 0},
    }


def invoke(*, stage_id: str, prompt: str) -> dict[str, Any]:
    """Invoke LLM (or return stub). Returns dict with response + tokens_consumed.

    Backend is controlled by the MODEL env var (see module docstring).
    There is intentionally no `model=` kwarg; rev 1 audit flagged that any
    such kwarg would be silently overridden by the env var.
    """
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
            "tokens_consumed": data.get("tokens_consumed", {"input": 0, "output": 0}),
        }

    return _invoke_real(stage_id, prompt)
```

**Caller audit:** removing the `model=` kwarg is a signature change. Before committing, `grep -rn "llm_client.invoke" agents/ scripts/ tests/` and verify no caller passes `model=`. The current Plan B callers (`agents/update/02-impact/run.sh`, `agents/update/03-propose/run.sh`) call `llm_client.invoke(stage_id=..., prompt=...)` without `model=`, so this is safe. If any caller does pass `model=`, update it to remove the kwarg and rely on `MODEL` env var instead.

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_llm_client_real.py -v`
Expected: 9 tests pass.

Full suite: `.venv/bin/pytest -q`
Expected: 102 pass (93 prior + 9 new).

- [ ] **Step 5: Commit**

```bash
git add agents/update/_shared/llm_client.py tests/test_llm_client_real.py
git commit -m "feat(llm_client): wire real codex/claude backends alongside stub path"
```

Update `.gitignore` if the new test file needs an allowlist entry (`!tests/test_llm_client_real.py`) before committing.

---

### Task 2: Add explicit "Required output schema" sections to stage instructions

**Files:**
- Modify: `agents/update/01-sense/instructions.md`
- Modify: `agents/update/02-impact/instructions.md`
- Modify: `agents/update/03-propose/instructions.md`
- Test: `tests/test_stage_instructions_schema.py`

Real LLMs reliably produce valid JSON only when the contract is shown, not just described. Add a concrete example to each instructions.md. This task is also TDD: a test asserts each instructions file has an explicit schema block.

- [ ] **Step 1: Write the failing test**

Create `tests/test_stage_instructions_schema.py`:

```python
"""Every stage's instructions.md must include a 'Required output schema' section
with an inline JSON example for the LLM to pattern-match on."""

from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _instructions(stage: str) -> str:
    return (REPO_ROOT / "agents" / "update" / stage / "instructions.md").read_text()


def _has_schema_section(text: str) -> bool:
    return "## Required output schema" in text


def _has_json_example(text: str) -> bool:
    return "```json" in text


def test_sense_instructions_have_schema():
    text = _instructions("01-sense")
    assert _has_schema_section(text), "sense instructions missing '## Required output schema'"
    assert _has_json_example(text), "sense instructions missing inline ```json example"


def test_impact_instructions_have_schema():
    text = _instructions("02-impact")
    assert _has_schema_section(text)
    assert _has_json_example(text)
    # Impact has two sub-task stage_ids; both must be documented in the schema block
    schema_section = text.split("## Required output schema", 1)[1]
    assert "02-impact.ranking" in schema_section, \
        "impact schema must document the 02-impact.ranking sub-task stage_id"
    assert "02-impact.delta" in schema_section, \
        "impact schema must document the 02-impact.delta sub-task stage_id"
    # Required fields referenced
    assert "ranked_domains" in schema_section
    assert "signal_c_reasoning" in schema_section
    assert "affected_pages" in schema_section
    assert "new_domains" in schema_section


def test_propose_instructions_have_schema():
    text = _instructions("03-propose")
    assert _has_schema_section(text)
    assert _has_json_example(text)
    # Propose schema must mention the destructive + uncertainty flags
    assert "justification_signals" in text
    assert "destructive" in text
    assert "uncertainty" in text
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_stage_instructions_schema.py -v`
Expected: 3 tests FAIL (no schema sections exist).

- [ ] **Step 3: Append schema block to `agents/update/01-sense/instructions.md`**

Append this section at the end of the file:

````markdown
## Required output schema

**Note:** the Plan A `01-sense/run.sh` performs classification via mechanical regex matching and does not invoke the LLM. This schema applies to the `01-sense.classifier` sub-task, which is a future LLM-driven replacement for the regex path. The schema is documented here so that (a) an operator can swap the regex for an LLM call without redesigning the contract, and (b) future impact/propose prompts that reference sense output can rely on a stable shape.

When invoked, return ONLY this JSON object. No prose, no markdown fences around it, no explanation.

```json
{
  "classifications": [
    {
      "path": "projects/<project-key>/inbox/source.md",
      "source_kind_hint": "spec | design | plan | implementation-note | api-doc | reference | session-note | decision-candidate | troubleshooting | unknown",
      "confidence": "low | medium | high",
      "classification_reasoning": "one mechanical sentence — which pattern or extension matched"
    }
  ]
}
```

Every inbox source in the input must appear exactly once in `classifications`. The `path` field must match the inbox path exactly. If no pattern matches, emit `"source_kind_hint": "unknown"` with `"confidence": "low"`.
````

- [ ] **Step 4: Append schema block to `agents/update/02-impact/instructions.md`**

Append this section at the end:

````markdown
## Required output schema

This stage produces TWO distinct JSON outputs — one for each sub-task. The runner invokes you twice: once with a "ranking" stage_id and once with a "delta" stage_id.

### Sub-task 1: Ranking (`stage_id: 02-impact.ranking`)

Return ONLY this JSON object:

```json
{
  "cutoff": 20,
  "ranked_domains": [
    {
      "rank": 1,
      "domain": "authentication",
      "score": 0.85,
      "signals": ["A", "B", "C"],
      "signal_a_evidence": ["README.md:6-14"],
      "signal_b_evidence": ["src/auth.py"],
      "signal_c_reasoning": "Owns session lifecycle; referenced from entry point."
    }
  ]
}
```

Emit exactly `cutoff` entries unless fewer domains exist. `signal_c_reasoning` must either cite concrete A/B evidence or explicitly state `"no A/B signal; promoted on structural fan-in"`.

### Sub-task 2: Delta (`stage_id: 02-impact.delta`)

Return ONLY this JSON object:

```json
{
  "affected_pages": [
    {"path": "wiki/systems/auth.md", "reason": "src/auth.py modified", "source": "git diff"}
  ],
  "new_domains": [
    {
      "name": "authentication",
      "evidence": ["src/auth.py"],
      "signal_sources": ["A", "B"],
      "ranking_inclusion": "top-20 | below-cutoff"
    }
  ],
  "stale_pages": [
    {"path": "wiki/modules/legacy.md", "reason": "feature removed per diff"}
  ]
}
```

All three arrays may be empty on a clean first run. `ranking_inclusion` must be `"top-20"` for domains within the ranking cutoff and `"below-cutoff"` otherwise.
````

- [ ] **Step 5: Append schema block to `agents/update/03-propose/instructions.md`**

Append this section at the end:

````markdown
## Required output schema

Return ONLY this JSON object:

```json
{
  "project": "<project-key>",
  "summary": "one-paragraph plain-text summary",
  "ranking_snapshot_path": "projects/<project-key>/state/latest/ranking-snapshot.json",
  "max_new_pages": 25,
  "max_new_pages_config_source": "agents/update/03-propose/config.json:stage_specific.max_new_pages",
  "new_pages_count": 3,
  "deferred_domains": [
    {"rank": 21, "domain": "logging", "reason": "below cutoff"}
  ],
  "units": [
    {
      "id": "u1",
      "action": "create | update | delete | rename",
      "page_path": "wiki/systems/auth.md",
      "rename_from": null,
      "destructive": false,
      "uncertainty": "low | medium | high",
      "justification": "Why this unit belongs in the wiki; must cite at least one of A, B, C.",
      "justification_signals": ["A", "B", "C"],
      "referenced_ranking_domains": ["authentication"],
      "source_classification": {
        "source_kind": "implementation-note",
        "ownership": "project:<project-key>",
        "destination": "wiki/systems/auth.md",
        "update_targets": ["wiki/systems/auth.md"],
        "action": "create-new-page-and-update-index"
      },
      "content": "Full new page content as a single string (null only for action=delete).",
      "affected_cross_refs": ["wiki/systems/data-store.md"],
      "source_citations": ["src/auth.py:1-23"]
    }
  ],
  "index_changes": {
    "action": "update",
    "destructive": false,
    "content": "Full new index.md content as a single string.",
    "categories_reshuffled": 0
  },
  "state_changes_intent": {
    "last_seen_commit_pending": "<stamped-by-apply>",
    "last_update_at_pending": "<stamped-by-apply>"
  }
}
```

### Hard rules

- `justification_signals` must include at least one of `A`, `B`, `C`.
- `referenced_ranking_domains` must all appear in the `ranking_snapshot.json` you are given.
- `new_pages_count <= max_new_pages`. Excess domains go to `deferred_domains` with a reason.
- `destructive: true` on any unit (delete, rename, major restructure) requires explicit operator approval even under AUTO=1 — flag them honestly; do not downgrade them to avoid the gate.
- `uncertainty: high` triggers the same gate — use it when you genuinely can't justify the change confidently.
- `source_citations` must be real file paths with valid line ranges. The apply stage re-validates; citations that don't resolve will reject the whole proposal.
- `action: "delete"` requires `content: null`.
- Do not include prose, apologies, or markdown fences around the JSON.
````

- [ ] **Step 6: Run tests**

Run: `.venv/bin/pytest tests/test_stage_instructions_schema.py -v`
Expected: 3 tests pass.

Full suite: `.venv/bin/pytest -q`
Expected: 105 pass (102 prior + 3 new).

- [ ] **Step 7: Commit**

Update `.gitignore` if the new test file needs an allowlist entry (mirror the Task 1 step 5 note). `tests/*` is denied by default and the repo uses an explicit allowlist. Add `!tests/test_stage_instructions_schema.py` alongside the other test-file exceptions before committing. Verify with `git check-ignore -v tests/test_stage_instructions_schema.py` — expected: no output (not ignored).

```bash
git add .gitignore agents/update/01-sense/instructions.md agents/update/02-impact/instructions.md agents/update/03-propose/instructions.md tests/test_stage_instructions_schema.py
git commit -m "feat(update): add explicit output schemas to stage instructions"
```

---

### Task 3: Dry-run harness script

**Files:**
- Create: `scripts/dry_run_sample.sh`

Build a harness that prepares an isolated environment, runs `make update-v2` with a real LLM, and captures artifacts + the final wiki state in a timestamped directory under `docs/superpowers/dry-run-notes/artifacts/`. Non-TDD: this is a one-shot observability harness.

- [ ] **Step 1: Create `scripts/dry_run_sample.sh`**

Content:

```bash
#!/usr/bin/env bash
# Dry-run harness: execute the full Plan B pipeline against projects/sample
# using a real LLM backend (codex or claude), capture all outputs, and write
# a structured findings bundle under docs/superpowers/dry-run-notes/artifacts/.
#
# This is an observability harness, not a test. It intentionally does NOT
# unset LLM_STUB_RESPONSES_DIR silently — if the env var is set at invocation,
# the script refuses to run (we want real-LLM output, not stubs).
#
# Usage:
#   scripts/dry_run_sample.sh                     # default: codex backend
#   MODEL=claude scripts/dry_run_sample.sh        # claude backend
#   MODEL=codex/o1 scripts/dry_run_sample.sh      # codex with specific model
#
# Produces:
#   docs/superpowers/dry-run-notes/artifacts/<ts>-dry-run/
#     ├── project-copy/         (tmp copy of projects/sample post-run)
#     ├── artifacts/            (tmp artifacts root with run dir + stage outputs)
#     ├── env.json              (env vars + model + start/end time)
#     ├── stdout.log            (full stdout of make update-v2)
#     ├── stderr.log            (full stderr)
#     └── exit-code             (single integer)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

die() { echo "error: $*" >&2; exit 1; }

if [[ -n "${LLM_STUB_RESPONSES_DIR:-}" ]]; then
  die "LLM_STUB_RESPONSES_DIR is set; this harness runs the real LLM. Unset it and retry."
fi

MODEL="${MODEL:-codex}"

# Verify the chosen CLI exists
case "$MODEL" in
  claude|claude/*)
    command -v "${CLAUDE_BIN:-claude}" >/dev/null 2>&1 || die "claude CLI not on PATH"
    ;;
  *)
    command -v "${CODEX_BIN:-codex}" >/dev/null 2>&1 || die "codex CLI not on PATH"
    ;;
esac

# Ensure sample_repo has git history (pipeline depends on it)
bash "$ROOT_DIR/tests/fixtures/sample_repo_init.sh"

# Prepare isolated run directory
ts="$(date -u +%Y%m%d-%H%M%S)"
bundle="$ROOT_DIR/docs/superpowers/dry-run-notes/artifacts/${ts}-dry-run"
mkdir -p "$bundle"/{project-copy,artifacts}

# Copy sample project + fixture repo into the bundle's scratch space
cp -R "$ROOT_DIR/projects/sample" "$bundle/project-copy/sample"
cp -R "$ROOT_DIR/tests/fixtures/sample_repo" "$bundle/sample_repo"

# Rewrite repo_paths to the absolute bundle-local copy so the pipeline
# uses this isolated tree rather than the main working directory
python3 - "$bundle/project-copy/sample/state/project.json" "$bundle/sample_repo" <<'PY'
import json, sys
from pathlib import Path
pj_path = Path(sys.argv[1])
repo_abs = sys.argv[2]
pj = json.loads(pj_path.read_text())
pj["repo_paths"] = [repo_abs]
pj_path.write_text(json.dumps(pj, indent=2))
PY

# Capture env snapshot
python3 - "$bundle/env.json" "$MODEL" "$ts" <<'PY'
import json, os, sys
from datetime import datetime, timezone
out = sys.argv[1]
model = sys.argv[2]
ts = sys.argv[3]
payload = {
    "started_at": datetime.now(timezone.utc).isoformat(),
    "MODEL": model,
    "CODEX_BIN": os.environ.get("CODEX_BIN", "codex"),
    "CLAUDE_BIN": os.environ.get("CLAUDE_BIN", "claude"),
    "run_id": ts,
}
open(out, "w").write(json.dumps(payload, indent=2))
PY

echo "[dry-run] bundle: $bundle"
echo "[dry-run] MODEL: $MODEL"
echo "[dry-run] starting pipeline..."

set +e
MODEL="$MODEL" \
UPDATE_PROJECTS_ROOT="$bundle/project-copy" \
UPDATE_ARTIFACTS_ROOT="$bundle/artifacts" \
AUTO=1 \
make -C "$ROOT_DIR" update-v2 PROJECT=sample \
  >"$bundle/stdout.log" 2>"$bundle/stderr.log"
exit_code=$?
set -e

echo "$exit_code" >"$bundle/exit-code"

# Append end time to env.json
python3 - "$bundle/env.json" <<'PY'
import json, sys
from datetime import datetime, timezone
p = sys.argv[1]
d = json.loads(open(p).read())
d["ended_at"] = datetime.now(timezone.utc).isoformat()
open(p, "w").write(json.dumps(d, indent=2))
PY

echo "[dry-run] exit: $exit_code"
echo "[dry-run] stdout: $bundle/stdout.log"
echo "[dry-run] stderr: $bundle/stderr.log"
echo "[dry-run] wiki:   $bundle/project-copy/sample/wiki/"
if [[ "$exit_code" -ne 0 ]]; then
  echo "[dry-run] FAILED — tail of stderr:"
  tail -n 30 "$bundle/stderr.log" >&2
  exit "$exit_code"
fi
echo "[dry-run] OK"
```

- [ ] **Step 2: Make it executable and register the artifacts directory**

```bash
chmod +x scripts/dry_run_sample.sh
mkdir -p docs/superpowers/dry-run-notes/artifacts
```

Add `docs/superpowers/dry-run-notes/artifacts/` to `.gitignore` so live-run bundles don't pollute git (they can be huge and contain LLM outputs that are noisy). Also add `!docs/superpowers/dry-run-notes/` (negated to unblock parent) if the existing `docs/*` rule masks it. Check with `git check-ignore -v docs/superpowers/dry-run-notes/artifacts/foo` — if ignored, update `.gitignore` accordingly.

- [ ] **Step 3: Smoke-test the harness without invoking the LLM**

With `LLM_STUB_RESPONSES_DIR` set (so the harness refuses to run):

```bash
LLM_STUB_RESPONSES_DIR=tests/fixtures/stubs bash scripts/dry_run_sample.sh
```

Expected: exits 1 with `"LLM_STUB_RESPONSES_DIR is set; this harness runs the real LLM. Unset it and retry."`

- [ ] **Step 4: Commit**

```bash
git add scripts/dry_run_sample.sh .gitignore
git commit -m "feat(scripts): add dry_run_sample harness for real-LLM pipeline runs"
```

---

### Task 4: Execute the dry run

**Files:** (none created directly — artifacts land under `docs/superpowers/dry-run-notes/artifacts/<ts>-dry-run/`)

**Non-TDD task.** Run the harness and observe. Do not commit any artifacts. The findings in Task 5 summarize what you saw.

- [ ] **Step 1: Confirm real CLI is available and authenticated**

```bash
codex --version    # or claude --version for MODEL=claude
```

If the CLI is not installed or not logged in, fix that first.

- [ ] **Step 2: Run the harness (codex backend)**

```bash
bash scripts/dry_run_sample.sh
```

Expected outcome: one of three shapes, each of which is a valid finding —

- **Green:** exit 0, wiki pages written under `bundle/project-copy/sample/wiki/`, `state/latest/ranking-snapshot.md` populated with non-stub content.
- **Stage-level failure:** one stage crashes with a clear error (e.g., malformed JSON, budget exceeded, citation not resolvable). This is information.
- **Silent wrong:** exit 0 but output is nonsensical (e.g., propose returns three pages about the wrong thing, ranking is incoherent). Also information.

Note the exit code, read `stdout.log` and `stderr.log` end-to-end, inspect the produced wiki and state artifacts.

- [ ] **Step 3 (optional): Run with claude backend**

If codex produced issues, run the same harness with `MODEL=claude` for comparison:

```bash
MODEL=claude bash scripts/dry_run_sample.sh
```

Compare the two bundles. Cross-backend differences are useful findings for Plan C's validator design.

- [ ] **Step 4: Record outcomes**

Note each of the following for each backend run:

- Exit code
- Bundle path
- Which stages completed successfully (sense / impact.ranking / impact.delta / propose / apply / apply_commit)
- Any JSON-parse failures and which stage they came from
- Any apply pre-flight rejections (which unit, which rule)
- Final wiki page count + whether pages pass a quick eyeball check (do they match the source code?)
- Approximate wall-clock time per stage
- Any cost signals (from `tokens_consumed` in artifacts)

These notes feed Task 5 directly.

---

### Task 5: Write the findings doc

**Files:**
- Create: `docs/superpowers/dry-run-notes/2026-04-18-plan-b-sample-findings.md`

This doc is the actual deliverable of Phase 1. Plan C (Phase 2) is written against it.

- [ ] **Step 1: Draft the findings doc from the bundle evidence**

Use this exact structure. Fill every section from the real run. If a section has no content, write "None observed" — do not leave placeholders.

Create `docs/superpowers/dry-run-notes/2026-04-18-plan-b-sample-findings.md`:

```markdown
# Plan B Dry-Run Findings — Sample Project

**Date:** <ISO date of the run>
**Backend(s):** <codex / claude / both>
**Bundle(s):** `docs/superpowers/dry-run-notes/artifacts/<ts>-dry-run/` [and the second if both]

## Outcome

Fill ALL of these fields. No vibe-check prose.

- Pipeline exit code:
- Total wall-clock time (seconds):
- Last stage reached: `sense | impact.ranking | impact.delta | propose | apply | apply_commit`
- Wiki pages produced (count):
- Wiki pages expected (count, from the ranking or manual estimate):
- Pipeline outcome in one sentence (factual, not impressionistic):

## Per-stage results

For every stage below: if the stage did not run (pipeline failed earlier), fill `Stage reached: no` and skip the rest of that stage's subsections.

### Sense
- Stage reached: yes/no
- Exit status:
- `sense-report.json` written? yes/no
- inbox_sources count / expected:
- changed_paths count:
- mode (`first-run | incremental | no-git`):
- Issues observed:

### Impact — Ranking sub-task
- Stage reached: yes/no
- `ranking-snapshot.json` written? yes/no
- ranked_domains count / cutoff:
- Top 5 domain names:
- Quote one `signal_c_reasoning` entry verbatim:
- Signals distribution (how many A-only, A+B, A+B+C):
- Issues:

### Impact — Delta sub-task
- Stage reached: yes/no
- `impact-report.json` written? yes/no
- affected_pages count:
- new_domains count:
- stale_pages count:
- Issues:

### Propose
- Stage reached: yes/no
- `proposal.json` written? yes/no
- Units by action (create N, update M, delete K, rename J):
- Pre-flight pass/fail (if fail, which rule):
- Any units with missing/invalid fields (how many, which fields):
- new_pages_count vs max_new_pages:
- deferred_domains count:
- Quote one `justification` entry verbatim:

### Apply
- Stage reached: yes/no
- Units applied (count):
- Units deferred to pending-approvals (count):
- `index.md` regenerated? yes/no
- Do wiki pages exist on disk? Name them:

### apply_commit
- Stage reached: yes/no
- Exit status:
- `last_seen_commit` advanced? From what to what (short shas):
- Changelog entry appended? yes/no

## Wiki quality (eyeball check)

<For each wiki page produced, one sentence: does it match the source file it cites? Are the repo pointers accurate? Is the summary informative?>

## JSON-contract issues

<List each instance of the LLM violating the output schema: malformed JSON, missing required fields, prose leaking in, fences around the JSON, etc. Include which stage and what was wrong.>

## Validator needs for Plan C

Based on what broke or looked fragile, what should Plan C's validator catch? List them. Examples:
- Structural: pages without the required sections; orphan pages; unresolved cross-refs
- Semantic: repo pointers that cite the wrong line range; cross-refs that disagree with the actual dependency direction; pages that duplicate content already covered elsewhere
- Coverage: domains in the ranking that didn't get a page

## Reconcile needs for Plan C

What classes of failure should reconcile be able to fix autonomously vs punt to the operator?

## Measurement needs for Plan C

Given the actual runtime / token-cost signal, is the 30% reduction goal credible on this sample? Does it need re-baselining?

## Non-goals / out of scope

<What did you notice that you are deliberately NOT going to fix in Plan C?>

## Recommendations for Plan C scope

<2-4 bullet points: what Plan C must cover based on what this run surfaced, in priority order.>
```

- [ ] **Step 2: Commit the findings doc**

```bash
git add docs/superpowers/dry-run-notes/2026-04-18-plan-b-sample-findings.md
git commit -m "docs(dry-run): capture Plan B real-LLM findings on sample"
```

---

### Task 6: Triage hot fixes (optional, scoped)

**Files:** depends on findings

If Task 5's findings identify a small number of clearly-wrong behaviors that block ever getting a clean dry run (e.g., the LLM always returns fences around JSON and Task 1's parser can't handle it, or instructions don't adequately describe a specific constraint), land surgical fixes HERE — not a second plan.

**Hard rules for this task:**

1. If the fix is more than ~50 lines across ≤3 files, it is not a hot fix. Stop and open a new mini-plan instead.
2. Every hot fix must reference the finding it addresses: commit message should cite `findings.md` directly.
3. After a hot fix, re-run the harness (Task 4) and update the findings doc (Task 5) with a "Re-run after hot fix" section.
4. If three hot fixes don't produce a green run, stop. The remaining issues are Plan C scope.

Budget: at most 3 hot fixes before stopping. The goal is to unblock Plan C authoring, not to finish the whole redesign inside Phase 1.

- [ ] **Step 1: Decide whether any hot fixes are in scope**

Read the findings doc. If the answer is "no" — nothing blocks Plan C authoring — skip this task entirely.

- [ ] **Step 2: Land each hot fix as its own micro-commit**

Example structure for a hot fix:

1. Modify the minimum set of files
2. Add a regression test if one is cheap
3. Re-run `scripts/dry_run_sample.sh`
4. Update the findings doc's "Re-run" section with the new outcome
5. Commit: `fix(update/<stage>): <one-line>\n\nAddresses finding: <quoted bullet from findings.md>`

- [ ] **Step 3: Stop once Phase 1 has met its goal**

Phase 1 is done when either:
- The dry run produces a usable wiki that passes an eyeball check, OR
- The remaining issues are substantive enough that Plan C is the right venue, and the findings doc has enumerated them.

Commit an explicit close marker:

```bash
git commit --allow-empty -m "chore: Phase 1 dry-run complete — findings doc ready for Plan C authoring"
```

---

## Phase 1 Acceptance

Phase 1 is complete when **all** of the following are true:

- `agents/update/_shared/llm_client.py` supports both stub (`LLM_STUB_RESPONSES_DIR`) and real-LLM (codex + claude via `MODEL` env) paths. All pytest tests pass including the new `test_llm_client_real.py`.
- All three stage instructions files (`01-sense/instructions.md`, `02-impact/instructions.md`, `03-propose/instructions.md`) contain a `## Required output schema` section with inline JSON examples. `test_stage_instructions_schema.py` passes.
- `scripts/dry_run_sample.sh` exists, is executable, and refuses to run when `LLM_STUB_RESPONSES_DIR` is set.
- At least one real-LLM run has been executed and its bundle captured under `docs/superpowers/dry-run-notes/artifacts/`.
- `docs/superpowers/dry-run-notes/2026-04-18-plan-b-sample-findings.md` is written and committed, with every section filled from real evidence.
- The `## Recommendations for Plan C scope` section in the findings doc names 2-4 concrete scope items.

## Non-goals for Phase 1

- Green dry run is not required. A run that exposes failures is equally valuable as a run that produces a clean wiki — both feed Plan C.
- Cost optimization, retry logic, streaming output, structured-output mode, or tool-use integrations are out of scope.
- Validator, reconcile, and measurement stages are Phase 2.
- Rebootstrapping rpg_game is Phase 3.

## Next

After Phase 1 closes, we author Plan C (Phase 2) directly against the findings doc.
