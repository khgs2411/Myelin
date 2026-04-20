# Phase 2d: `flag_stale_answer` MCP Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new MCP tool `flag_stale_answer` that lets an agent report a confidently-wrong `query_wiki` response and trigger a corrective `make update`, closing the learning loop for cases where the synthesizer is confidently wrong (confidence ≥ 0.66 but factually stale/incorrect).

**Architecture:** Phase 2d extends the existing auto-update machinery from Phase 2c. The agent calls `flag_stale_answer(project_key, question, correction_notes, citations=[...], auto_update=True)`. The MCP server writes a new gap-note to `projects/<key>/inbox/` with `source="agent-flagged"` (a 5th allowed source value) and the agent's correction in `enriched_notes`. If `auto_update` is on, it spawns `make update AUTO=1` via the same detached-subprocess + lockfile wrapper Phase 2c already built. The ingest pipeline (`08-ingest`) treats the note like any other inbox item — no ingest-side changes required since it doesn't discriminate by source value.

**Tech Stack:** FastMCP server (`mcp/llm_wiki_mcp.py`), shared inbox writer (`agents/_shared/inbox_writer.py`), pytest, uv.

---

## File Structure

- **Modify**: `agents/_shared/inbox_writer.py` — add `agent-flagged` to `ALLOWED_SOURCES`
- **Modify**: `mcp/llm_wiki_mcp.py` — add `flag_stale_answer` tool (~40 lines)
- **Modify**: `docs/inbox-item-schema.md` — document the new source value and its population rules
- **Modify**: `AGENTS.md` — add `agent-flagged` to allowed source values + inbox producers section
- **Modify**: `mcp/CLAUDE.md` — add gotcha entry for the new tool
- **Modify**: `mcp/pyproject.toml` — bump version 0.2.1 → 0.3.0 (new tool = minor bump)
- **Create**: `tests/test_mcp_flag_stale_answer.py` — new test file covering the tool end-to-end
- **Modify**: `tests/test_inbox_writer.py` (if present; otherwise add the test inside the new file) — confirm new source round-trips

Each task is self-contained: tests fail first, minimal implementation, tests pass, commit.

---

### Task 1: Allow `agent-flagged` as a valid inbox source

**Files:**
- Modify: `agents/_shared/inbox_writer.py:11`
- Test: `tests/test_mcp_flag_stale_answer.py` (new)

- [ ] **Step 1: Create the test file and write the first failing test**

Create `tests/test_mcp_flag_stale_answer.py`:

```python
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).parent.parent
MCP_ROOT = REPO_ROOT / "mcp"


def _load_module():
    spec = importlib.util.spec_from_file_location("llm_wiki_mcp", MCP_ROOT / "llm_wiki_mcp.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.path.insert(0, str(REPO_ROOT))
    spec.loader.exec_module(module)
    return module


def _seed_project(root: Path, project_key: str = "sample") -> Path:
    project_dir = root / "projects" / project_key
    (project_dir / "state").mkdir(parents=True)
    (project_dir / "state" / "project.json").write_text(
        json.dumps({"key": project_key, "name": "Sample"}, indent=2)
    )
    return project_dir


def test_inbox_writer_accepts_agent_flagged_source(tmp_path: Path):
    sys.path.insert(0, str(REPO_ROOT))
    from agents._shared import inbox_writer

    project_dir = _seed_project(tmp_path)

    item = inbox_writer.write_gap(
        project_dir,
        source="agent-flagged",
        question="How does auth refresh?",
        target_hint="wiki/systems/auth.md",
        confidence=0.85,
        enriched_notes="Actually refresh uses HS256 per Handlers/Auth.cs:42.",
        router_model="gpt-5.4-mini",
        synthesizer_model="gpt-5.4-mini",
    )

    assert item["source"] == "agent-flagged"
    assert item["enriched_notes"].startswith("Actually refresh")
    assert item["confidence"] == 0.85
    written = json.loads((project_dir / "inbox" / f"{item['id']}.json").read_text())
    assert written["source"] == "agent-flagged"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_mcp_flag_stale_answer.py::test_inbox_writer_accepts_agent_flagged_source -v`

Expected: FAIL with `ValueError: invalid source: agent-flagged`.

- [ ] **Step 3: Add `agent-flagged` to ALLOWED_SOURCES**

In `agents/_shared/inbox_writer.py`, line 11:

```python
ALLOWED_SOURCES = {"mcp-auto", "agent-enriched", "agent-flagged", "measure-auto", "manual"}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_mcp_flag_stale_answer.py::test_inbox_writer_accepts_agent_flagged_source -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/_shared/inbox_writer.py tests/test_mcp_flag_stale_answer.py
git commit -m "feat(inbox): allow agent-flagged source value"
```

---

### Task 2: Document `agent-flagged` in the inbox schema

**Files:**
- Modify: `docs/inbox-item-schema.md`
- Modify: `AGENTS.md`

No test — this is doc-only. Commit goes with Task 3 to keep the history tight.

- [ ] **Step 1: Update `docs/inbox-item-schema.md`**

In the "Allowed `source` values" list, add a bullet:

```markdown
- `mcp-auto`
- `agent-enriched`
- `agent-flagged`
- `measure-auto`
- `manual`
```

In "Source-specific rules", add after the `agent-enriched` bullet:

```markdown
- `agent-flagged` populates `confidence` (the *original* wrong confidence score from the bad answer), `pages_read` (what the bad answer cited), `router_model`, `synthesizer_model`, and `enriched_notes` (the agent's correction, with file_path:line citations). Use when the wiki answered confidently but the agent verified the answer is wrong or stale against source.
```

In "`target_hint` guidance", add:

```markdown
- `agent-flagged`: use the first citation supplied by the flagging agent (normally the first citation of the bad response).
```

- [ ] **Step 2: Update `AGENTS.md`**

In the "Inbox item producers:" section (around the `mcp-auto` / `agent-enriched` / `measure-auto` / `manual` bullet list), add a new bullet after `agent-enriched`:

```markdown
- `agent-flagged`: an agent calls `flag_stale_answer` after reading a confidently-wrong `query_wiki` response; the correction is written directly into `enriched_notes` and a new gap-note is created (not appended to an existing one)
```

In the "Allowed `source` values:" list under "Inbox Item Contract", add `- agent-flagged` after `- agent-enriched`.

---

### Task 3: Add the `flag_stale_answer` MCP tool (failing test)

**Files:**
- Modify: `mcp/llm_wiki_mcp.py` (append new `@mcp.tool()` after `enrich_gap`)
- Test: `tests/test_mcp_flag_stale_answer.py`

- [ ] **Step 1: Append failing test for the happy path**

Add to `tests/test_mcp_flag_stale_answer.py`:

```python
def test_flag_stale_answer_writes_gap_with_correction(monkeypatch, tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    result = module.flag_stale_answer(
        project_key="sample",
        question="How does auth refresh work?",
        correction_notes="Refresh uses HS256 per server/Handlers/Auth.cs:42, not RS256 as the wiki claimed.",
        citations=["wiki/systems/auth.md"],
        original_confidence=0.87,
        router_model="gpt-5.4-mini",
        synthesizer_model="gpt-5.4-mini",
    )

    inbox_files = sorted((project_dir / "inbox").glob("*.json"))
    assert len(inbox_files) == 1
    item = json.loads(inbox_files[0].read_text())

    assert result["id"] == item["id"]
    assert item["source"] == "agent-flagged"
    assert item["question"] == "How does auth refresh work?"
    assert item["target_hint"] == "wiki/systems/auth.md"
    assert item["confidence"] == pytest.approx(0.87)
    assert item["pages_read"] == ["wiki/systems/auth.md"]
    assert item["router_model"] == "gpt-5.4-mini"
    assert item["synthesizer_model"] == "gpt-5.4-mini"
    assert item["enriched_notes"].startswith("Refresh uses HS256")
    assert result["auto_update_triggered"] is False
    assert result["auto_update_status"] == "disabled"
    assert result["auto_update_log_path"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_mcp_flag_stale_answer.py::test_flag_stale_answer_writes_gap_with_correction -v`

Expected: FAIL with `AttributeError: module 'llm_wiki_mcp' has no attribute 'flag_stale_answer'`.

- [ ] **Step 3: Implement the tool**

In `mcp/llm_wiki_mcp.py`, append after the `enrich_gap` function (after line 392):

```python
@mcp.tool()
def flag_stale_answer(
    project_key: str,
    question: str,
    correction_notes: str,
    citations: list[str] | None = None,
    original_confidence: float | None = None,
    router_model: str | None = None,
    synthesizer_model: str | None = None,
    auto_update: bool | None = None,
) -> dict:
    """Flag a confidently-wrong `query_wiki` answer and optionally trigger
    a corrective wiki update. Use this when `query_wiki` returned
    `confidence >= 0.66` (so no gap-note was auto-emitted) BUT you
    verified the answer against source and found it wrong or stale.

    This is the symmetric complement to the auto gap-emission in
    `query_wiki`: that path handles "the wiki correctly admitted it didn't
    know," this path handles "the wiki confidently lied." Both funnel into
    the same inbox for the next `make update` to reconcile.

    What to put in `correction_notes`: the specific factual correction,
    with repo-relative `file_path:line_number` citations proving the wiki
    was wrong (e.g., `server/Handlers/Auth.cs:42` shows HS256, not
    RS256 as the wiki claimed). Do NOT use basename shorthand - the
    apply stage rejects it.

    `citations` should be the citations from the bad response (what the
    wiki pointed at) so ingest can inspect and rewrite the right pages.
    The first citation becomes `target_hint`.

    `original_confidence`, `router_model`, `synthesizer_model` are
    optional telemetry capturing which model got it wrong and how
    confidently - preserved in the gap-note for later quality analysis.

    `auto_update` honors the same three-way semantics as `enrich_gap`:
      - `True`  -> always spawn (unless lockfile blocks)
      - `False` -> never spawn (overrides env)
      - `None`  -> honor `LLM_WIKI_AUTO_UPDATE` env

    Returns the written inbox item plus `auto_update_triggered`,
    `auto_update_status`, and `auto_update_log_path` (same shape as
    `enrich_gap`).
    """
    project_dir = _project_dir(project_key)

    citations_list = list(citations or [])
    target_hint = citations_list[0] if citations_list else ""

    item = inbox_writer.write_gap(
        project_dir,
        source="agent-flagged",
        question=question,
        target_hint=target_hint,
        confidence=original_confidence,
        pages_read=citations_list or None,
        router_model=router_model,
        synthesizer_model=synthesizer_model,
        enriched_notes=correction_notes,
    )

    should_update, disabled_status = _auto_update_requested(auto_update)
    if not should_update:
        return _with_auto_update_meta(
            item,
            triggered=False,
            status=disabled_status,
            log_path=None,
        )

    triggered, status, log_path = _trigger_auto_update(project_dir, project_key)
    return _with_auto_update_meta(
        item,
        triggered=triggered,
        status=status,
        log_path=log_path,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_mcp_flag_stale_answer.py::test_flag_stale_answer_writes_gap_with_correction -v`

Expected: PASS.

- [ ] **Step 5: Commit with schema/docs from Task 2**

```bash
git add mcp/llm_wiki_mcp.py tests/test_mcp_flag_stale_answer.py docs/inbox-item-schema.md AGENTS.md
git commit -m "feat(mcp): add flag_stale_answer tool for confidently-wrong wiki answers"
```

---

### Task 4: Auto-update semantics match `enrich_gap`

**Files:**
- Test: `tests/test_mcp_flag_stale_answer.py`

- [ ] **Step 1: Write failing test for `auto_update=True` triggering a detached spawn**

Append to `tests/test_mcp_flag_stale_answer.py`:

```python
def test_flag_stale_answer_auto_update_true_triggers_spawn(monkeypatch, tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    calls: list[tuple[str, Path]] = []

    def fake_trigger(project_dir_arg: Path, project_key_arg: str):
        calls.append((project_key_arg, project_dir_arg))
        return True, "triggered", "projects/sample/logs/fake.log"

    monkeypatch.setattr(module, "_trigger_auto_update", fake_trigger)

    result = module.flag_stale_answer(
        project_key="sample",
        question="q?",
        correction_notes="see Handlers/Auth.cs:42",
        citations=["wiki/systems/auth.md"],
        auto_update=True,
    )

    assert len(calls) == 1
    assert calls[0][0] == "sample"
    assert result["auto_update_triggered"] is True
    assert result["auto_update_status"] == "triggered"
    assert result["auto_update_log_path"] == "projects/sample/logs/fake.log"


def test_flag_stale_answer_auto_update_false_overrides_env(monkeypatch, tmp_path: Path):
    _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    monkeypatch.setenv("LLM_WIKI_AUTO_UPDATE", "1")
    module = _load_module()

    triggered_calls = []
    monkeypatch.setattr(
        module,
        "_trigger_auto_update",
        lambda *a, **kw: (triggered_calls.append(a) or (True, "triggered", "x")),
    )

    result = module.flag_stale_answer(
        project_key="sample",
        question="q?",
        correction_notes="note",
        citations=["wiki/x.md"],
        auto_update=False,
    )

    assert triggered_calls == []
    assert result["auto_update_triggered"] is False
    assert result["auto_update_status"] == "skipped:override"


def test_flag_stale_answer_env_fallback_honored(monkeypatch, tmp_path: Path):
    _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    monkeypatch.setenv("LLM_WIKI_AUTO_UPDATE", "1")
    module = _load_module()

    monkeypatch.setattr(
        module,
        "_trigger_auto_update",
        lambda *a, **kw: (True, "triggered", "projects/sample/logs/fake.log"),
    )

    result = module.flag_stale_answer(
        project_key="sample",
        question="q?",
        correction_notes="note",
        citations=["wiki/x.md"],
    )

    assert result["auto_update_triggered"] is True
    assert result["auto_update_status"] == "triggered"
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_mcp_flag_stale_answer.py -v`

Expected: all 5 tests (3 new + 2 from Tasks 1 & 3) PASS. No implementation change needed — these verify the auto_update wiring added in Task 3 behaves the same as `enrich_gap`.

If any auto_update test fails, the bug is almost certainly in the Task 3 implementation (wrong order of `_auto_update_requested` / `_trigger_auto_update` / `_with_auto_update_meta` calls).

- [ ] **Step 3: Commit**

```bash
git add tests/test_mcp_flag_stale_answer.py
git commit -m "test(mcp): cover auto_update semantics for flag_stale_answer"
```

---

### Task 5: Empty-citations edge case

**Files:**
- Test: `tests/test_mcp_flag_stale_answer.py`
- Verify no code change needed

- [ ] **Step 1: Add test for empty citations**

Append to `tests/test_mcp_flag_stale_answer.py`:

```python
def test_flag_stale_answer_without_citations_uses_empty_target_hint(monkeypatch, tmp_path: Path):
    project_dir = _seed_project(tmp_path)
    monkeypatch.setenv("LLM_WIKI_ROOT", str(tmp_path))
    module = _load_module()

    result = module.flag_stale_answer(
        project_key="sample",
        question="general question?",
        correction_notes="see Handlers/Auth.cs:42",
    )

    inbox_files = sorted((project_dir / "inbox").glob("*.json"))
    assert len(inbox_files) == 1
    item = json.loads(inbox_files[0].read_text())
    assert item["target_hint"] == ""
    assert item["pages_read"] is None
    assert result["id"] == item["id"]
```

- [ ] **Step 2: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_mcp_flag_stale_answer.py::test_flag_stale_answer_without_citations_uses_empty_target_hint -v`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/test_mcp_flag_stale_answer.py
git commit -m "test(mcp): flag_stale_answer handles missing citations"
```

---

### Task 6: Document the tool in `mcp/CLAUDE.md`

**Files:**
- Modify: `mcp/CLAUDE.md`

- [ ] **Step 1: Append a gotcha entry**

In `mcp/CLAUDE.md`, under the "Gotchas" section, append a new bullet after the `LLM_WIKI_AUTO_UPDATE` bullet:

```markdown
- `flag_stale_answer` is the symmetric complement to `query_wiki`'s auto-emit: that path catches "wiki admitted IDK" (confidence < 0.66), this path catches "wiki confidently lied" (confidence >= 0.66 but verified wrong). Both produce inbox gap-notes ingested by `make update`. Source values distinguish them: `mcp-auto` vs `agent-flagged`. Use `agent-flagged` telemetry to measure "confidently wrong" rate — a much scarier quality signal than "IDK" rate.
```

- [ ] **Step 2: Commit**

```bash
git add mcp/CLAUDE.md
git commit -m "docs(mcp): document flag_stale_answer gotcha"
```

---

### Task 7: Bump version to 0.3.0

**Files:**
- Modify: `mcp/pyproject.toml:3`

- [ ] **Step 1: Edit version**

Change `mcp/pyproject.toml` line 3 from:

```toml
version = "0.2.1"
```

to:

```toml
version = "0.3.0"
```

Rationale: adding a new public tool to the MCP surface is a minor bump, not a patch.

- [ ] **Step 2: Run full test suite to confirm nothing else broke**

Run: `.venv/bin/pytest tests/ -q`

Expected: pre-existing failures (`test_plan_a_acceptance`, `test_plan_b_acceptance`, `test_state_migration::test_sample_project_registered`) remain; all new tests pass; no previously-green tests go red.

- [ ] **Step 3: Commit**

```bash
git add mcp/pyproject.toml
git commit -m "chore(mcp): bump to 0.3.0 for flag_stale_answer tool"
```

---

### Task 8: End-to-end sanity check (no code change)

**Files:** none — this is a manual verification step before handoff.

- [ ] **Step 1: Dry run the tool locally against an existing project**

From repo root with MCP server pointed at a real project (e.g., `senshi`):

```bash
export LLM_WIKI_ROOT=$(pwd)
.venv/bin/python -c "
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('m', 'mcp/llm_wiki_mcp.py')
m = importlib.util.module_from_spec(spec)
sys.path.insert(0, '.')
spec.loader.exec_module(m)
print(json.dumps(m.flag_stale_answer(
    project_key='senshi',
    question='test-only, please delete',
    correction_notes='dry-run validation of flag_stale_answer tool',
    citations=['wiki/architecture/overview.md'],
    original_confidence=0.9,
    auto_update=False,
), indent=2))
"
```

Expected: JSON response with `source: agent-flagged`, `auto_update_triggered: false`, and a new inbox file under `projects/senshi/inbox/<id>.json`. Delete the test file manually after verifying:

```bash
rm projects/senshi/inbox/<the-generated-id>.json
```

- [ ] **Step 2: Final build + publish**

```bash
./mcp/build.sh
```

(Requires `PYPI_TOKEN` in `mcp/.env` — see `mcp/build.sh:11`.)

Expected: fresh wheel uploaded as `topsyde-llm-wiki-mcp-0.3.0`.

- [ ] **Step 3: Verify the new tool is discoverable from a fresh Claude Code session**

Start a new session; run `/mcp` and confirm `llm-wiki.flag_stale_answer` appears in the tool list. Test with a throwaway call against a dev project.

---

## Definition of Done

- All 6 tests in `tests/test_mcp_flag_stale_answer.py` pass.
- `agents/_shared/inbox_writer.py` accepts `"agent-flagged"` as a source.
- `docs/inbox-item-schema.md` and `AGENTS.md` list `agent-flagged` under allowed source values with its population rules.
- `mcp/llm_wiki_mcp.py` exposes `flag_stale_answer` with the docstring from Task 3.
- `mcp/pyproject.toml` version is `0.3.0`.
- PyPI has `topsyde-llm-wiki-mcp==0.3.0`.
- No pre-existing green test goes red.

## Out of Scope (explicitly)

- **No changes to `08-ingest` or any update-pipeline stage.** Ingest doesn't discriminate by source value — it treats `agent-flagged` identically to `agent-enriched`. Prompt engineering (telling the ingest stage "trust the human correction more than the existing page") is a separate Phase 3 concern.
- **No `unflag` / `cancel` tool.** If an agent flags incorrectly, the operator removes the inbox file manually. Unlikely to happen often enough to warrant a tool.
- **No confidence threshold for flagging.** The agent decides when to flag; we don't gate it on the wiki's own score.
- **No new `source` value in `measure-auto` territory.** Measurement-driven gap-notes stay separate.
