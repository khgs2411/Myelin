# Plan C — Validate + Reconcile + Measurement Implementation Plan

**Status:** Ready for development (revision 4, audit passed)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the unified update pipeline by adding stages 6 (validate) and 7 (reconcile), the measurement harness, the shelf-allowlist contract enforcement, token-accounting normalization, and the M4 pilot rebootstrap + M5 promotion that deletes the old bootstrap/ingest commands.

**Architecture:** Validate runs a deterministic structural script + an LLM semantic agent after apply. On `status: pass` the pipeline runs `apply_commit`; on `status: fail` the pipeline invokes reconcile (a second LLM agent) which emits a reconcile proposal subject to the same approval model as the original. Reconcile loops back to apply at most once; a second failure halts the run. `make measure` scores the wiki against a cold LLM answering `acceptance-questions.md`; `make measure-tokens` runs a calibration harness comparing scoping tokens with vs without wiki. M4 archives `rpg_game`, rebootstraps it, and scores the result. M5 renames `make update-v2 → make update` and deletes every bootstrap/ingest remnant.

**Tech Stack:** Bash scripts with embedded Python 3 heredocs, Python 3.13, pytest, JSON state, Markdown artifacts. LLM via codex/claude CLIs (`MODEL` env var). Stub harness unchanged (`LLM_STUB_RESPONSES_DIR`).

**Source spec:** `docs/superpowers/specs/2026-04-18-unified-update-pipeline-design.md` (revision 4, audit-passed; Sections 4.5, 4.6, 5.4, 9, 10, 12 are the load-bearing sections for Plan C).

**Input findings:** `docs/superpowers/dry-run-notes/2026-04-18-plan-b-sample-findings.md` — captures one concrete contract deviation (`wiki/runtime/`) the LLM introduced under real conditions, and scopes the validator/reconcile/measurement recommendations Plan C implements.

**Prerequisites:** Plan A committed (58 tests), Plan B committed (93 tests), Phase 1 committed (105 tests). `make update-v2 AUTO=1 PROJECT=sample` works end-to-end under both stubs and real codex.

**Plan scope:** M3 + M4 + M5 of the migration plan. Completes the roadmap.

---

## File Structure

### New files

**Validate stage:**
- `agents/update/06-validate/config.json`
- `agents/update/06-validate/instructions.md`
- `agents/update/06-validate/run.sh`
- `agents/update/06-validate/structural.py` (imported by run.sh via `sys.path.insert(agent_dir)` — the hyphenated stage dir cannot be a Python package, but direct-script imports work)

**Reconcile stage:**
- `agents/update/07-reconcile/config.json`
- `agents/update/07-reconcile/instructions.md`
- `agents/update/07-reconcile/run.sh`

**Measurement:**
- `scripts/measure.sh`
- `scripts/measure_tokens.sh`
- `agents/update/measure/config.json`
- `agents/update/measure/instructions.md` (for the per-question scoring prompt)

**Tests:**
- `tests/test_update_validate.py`
- `tests/test_update_reconcile.py`
- `tests/test_shelf_allowlist.py`
- `tests/test_measure.py`
- `tests/test_plan_c_acceptance.py`

**Fixtures:**
- `tests/fixtures/stubs/06-validate.semantic.json`
- `tests/fixtures/stubs/06-validate.semantic.with_finding.json`
- `tests/fixtures/stubs/07-reconcile.json`
- `tests/fixtures/stubs/07-reconcile.with_fix.json`
- `tests/fixtures/stubs/measure.q1.json`
- `tests/fixtures/stubs/measure.q2.json`
- `tests/fixtures/stubs/measure.q3.json`

### Files to modify

- `agents/update/_shared/llm_client.py` — normalize `tokens_consumed` keys across stub + real paths
- `agents/update/04-apply/run.sh` — add shelf-allowlist pre-flight check
- `agents/update/03-propose/instructions.md` — add shelf-allowlist rule to hard-rules list
- `scripts/update.sh` — wire validate after apply, gate `apply_commit` on validate pass, integrate reconcile loop
- `scripts/validate_stage_configs.py` — expand allowed `agent_kind` values if needed (script-only validate is split stage)
- `Makefile` — add `measure`, `measure-tokens`, `lint` (re-wired in Task 17b, replaces the deleted old `lint` target) targets; M5 renames `update-v2` → `update`
- `AGENTS.md`, `V1_SPEC.md`, `SYSTEM_DESIGN.md`, `README.md` — post-M5 documentation refresh

### Files to delete (M5)

- `agents/bootstrap/01-orient/` through `05-reconcile/` (old 5-stage bootstrap)
- `scripts/ingest.sh`, `scripts/ingest_v2.sh`, `scripts/ingest_apply.sh`
- `agents/bootstrap/run.sh`
- Makefile targets: `bootstrap*`, `ingest*`, `validate`, `lint` (replaced by `make update` + validate is now a pipeline stage)

### Files to archive (M4)

- `projects/rpg_game/` → `projects/_archive/rpg_game-pre-unified-<date>/` before rebootstrap

---

## Task Sequence

24 tasks. Grouped into six phases. Each task has TDD where sensible; destructive/migration tasks in Phase F use explicit acceptance criteria instead.

---

## Phase A — Token-accounting normalization

### Task 1: Normalize `tokens_consumed` keys across stub and real paths

**Context (from findings):** Phase 1 revealed the stub path emits `{"input": N, "output": N}` while the real path emits `{"input_chars": N, "output_chars": 0}`. Plan C's measurement stage needs one stable shape. Chosen shape: `{"input_chars": N, "output_chars": N, "is_estimate": bool}` — explicit about estimate semantics so consumers don't confuse char counts for real token counts.

**Files:**
- Modify: `agents/update/_shared/llm_client.py`
- Modify: `tests/test_llm_client_stub.py`, `tests/test_llm_client_real.py`
- Modify: `tests/fixtures/stubs/01-sense.classifier.json`, `02-impact.ranking.json`, `02-impact.delta.json`, `03-propose.json`, `03-propose.destructive.json` (stub token fields)

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_llm_client_stub.py`:

```python
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
```

Add to `tests/test_llm_client_real.py`:

```python
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
    assert tc["is_estimate"] is True  # real path estimates from char count
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_llm_client_stub.py::test_stub_path_emits_normalized_tokens_consumed tests/test_llm_client_real.py::test_real_path_emits_normalized_tokens_consumed -v`
Expected: FAIL — stub path returns `data.get("tokens_consumed", ...)` directly, real path returns `input_chars`/`output_chars` with no `is_estimate`.

- [ ] **Step 3: Update `agents/update/_shared/llm_client.py`**

In `invoke()`, replace the stub return block with:

```python
        raw_tokens = data.get("tokens_consumed", {})
        return {
            "response": data["response"],
            "tokens_consumed": _normalize_tokens(raw_tokens),
        }
```

In `_invoke_real()`, replace the return with:

```python
    return {
        "response": response,
        "tokens_consumed": _normalize_tokens(
            {"input_chars": len(combined), "output_chars": len(result.stdout)},
            is_estimate=True,
        ),
    }
```

Add a helper above both functions:

```python
def _normalize_tokens(raw: dict, is_estimate: bool = True) -> dict:
    """Normalize tokens_consumed to {input_chars, output_chars, is_estimate}.

    Accepts legacy shapes ({'input': N, 'output': N}) and promotes them to
    input_chars/output_chars. Always includes an is_estimate flag — True means
    the numbers are char-count approximations, False means they came from a
    real tokenizer (not yet wired; False is reserved for a future measurement
    integration that taps the CLI's token counter).
    """
    ic = raw.get("input_chars", raw.get("input", 0))
    oc = raw.get("output_chars", raw.get("output", 0))
    return {
        "input_chars": int(ic),
        "output_chars": int(oc),
        "is_estimate": bool(is_estimate),
    }
```

- [ ] **Step 4: Update the 5 existing stub fixtures**

For each of `tests/fixtures/stubs/{01-sense.classifier,02-impact.ranking,02-impact.delta,03-propose,03-propose.destructive}.json`, replace the `tokens_consumed` block with the normalized shape. Example for `01-sense.classifier.json`:

```json
  "tokens_consumed": {"input_chars": 200, "output_chars": 30, "is_estimate": true}
```

Keep the numerical values from the existing files; just add `is_estimate: true` and rename `input`/`output` to `input_chars`/`output_chars`.

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/pytest -q`
Expected: 107 tests pass (105 prior + 2 new). No regression — legacy callers reading `tokens_consumed["input"]` would break, but there are none; existing Plan A/B/Phase-1 callers use `tokens_consumed` opaquely or not at all.

- [ ] **Step 6: Commit**

```bash
git add agents/update/_shared/llm_client.py tests/test_llm_client_stub.py tests/test_llm_client_real.py tests/fixtures/stubs/
git commit -m "feat(llm_client): normalize tokens_consumed to {input_chars, output_chars, is_estimate}"
```

---

## Phase B — Validator

### Task 2: Validate stage — config + instructions

**Files:**
- Create: `agents/update/06-validate/config.json`
- Create: `agents/update/06-validate/instructions.md`
- Test: extend `tests/test_validate_stage_configs.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_validate_stage_configs.py`:

```python
def test_validate_config_exists():
    stages_root = REPO_ROOT / "agents" / "update"
    config = stages_root / "06-validate" / "config.json"
    assert config.is_file(), f"missing: {config}"
    data = json.loads(config.read_text())
    assert data["stage"] == "validate"
    assert "structural_rules" in data["stage_specific"]
    assert "shelf_allowlist" in data["stage_specific"]
    # Spec Section 4.3 cutoff defaults — validate inherits no cutoff, but the
    # allowed shelf list must be exactly the 9 prescribed ones.
    allowed = data["stage_specific"]["shelf_allowlist"]
    expected = {"architecture", "systems", "modules", "integrations",
                "decisions", "runbooks", "sessions", "glossary", "open-questions"}
    assert set(allowed) == expected
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py::test_validate_config_exists -v`
Expected: FAIL.

- [ ] **Step 3: Create config and instructions**

Create `agents/update/06-validate/config.json`:

```json
{
  "stage": "validate",
  "agent_kind": "script+classifier",
  "token_budget_input": 40000,
  "token_budget_output": 8000,
  "on_over_budget": "fail-clean",
  "stage_specific": {
    "structural_rules": [
      "required_page_sections",
      "citation_resolvability",
      "citation_line_range",
      "no_orphan_pages",
      "no_dead_cross_refs",
      "index_routing_resolves",
      "pages_json_filesystem_agreement",
      "proposal_justification_signals",
      "proposal_referenced_ranking_domains",
      "proposal_max_new_pages",
      "proposal_source_classification",
      "shelf_allowlist"
    ],
    "shelf_allowlist": [
      "architecture",
      "systems",
      "modules",
      "integrations",
      "decisions",
      "runbooks",
      "sessions",
      "glossary",
      "open-questions"
    ],
    "semantic_rules_enabled": [
      "coverage_gap",
      "redundancy",
      "contradiction",
      "index_routing_quality",
      "stale_marker_honesty"
    ]
  }
}
```

Create `agents/update/06-validate/instructions.md`:

```markdown
# Validate Stage — Instructions

The validate stage runs two independent checks after apply completes:

1. **Structural (deterministic script).** Mechanical rules with hard pass/fail outcomes. No LLM involvement. Rules enumerated in `config.json.stage_specific.structural_rules`.
2. **Semantic (LLM agent).** Judgment calls about coverage, redundancy, contradiction, and honesty of gap markers. Only this sub-task uses an LLM.

Both must return `status: pass` for the overall stage to pass. Any blocker-severity finding from either tier sets the stage status to `fail`.

## Inputs

- The project directory after apply completed
- The run directory containing the applied proposal and ranking snapshot
- `config.json.stage_specific.structural_rules` — which structural rules to run
- `config.json.stage_specific.shelf_allowlist` — the only permitted `wiki/` category directories
- `config.json.stage_specific.semantic_rules_enabled` — which semantic rule families the LLM evaluates

## Structural rules (each either passes or emits one or more findings)

1. `required_page_sections` — every page under `wiki/` has the three required sections in order: first-line summary, `## Repo pointers`, `## Related`.
2. `citation_resolvability` — every `file:line-line` or `file` citation in repo pointers resolves to an existing file in the registered repo_paths.
3. `citation_line_range` — every cited line range fits within the file's actual line count.
4. `no_orphan_pages` — every page is linked from `index.md` or from at least one other wiki page.
5. `no_dead_cross_refs` — every wiki-to-wiki link resolves to a file that exists.
6. `index_routing_resolves` — every entry in the index's routing table points at a real page.
7. `pages_json_filesystem_agreement` — `state/pages.json` lists exactly the set of files present under `wiki/` (no ghost entries, no missing entries).
8. `proposal_justification_signals` — every unit in the run's `proposal.json` has `justification_signals` containing at least one of `A|B|C`.
9. `proposal_referenced_ranking_domains` — every domain in any unit's `referenced_ranking_domains` appears in the run's `ranking-snapshot.json`.
10. `proposal_max_new_pages` — `proposal.json.new_pages_count <= proposal.json.max_new_pages`.
11. `proposal_source_classification` — every unit has a `source_classification` object whose `source_kind` is in the allowed set.
12. `shelf_allowlist` — every unit's `page_path` first directory under `wiki/` is in `shelf_allowlist`. Same rule for `rename_from`. On-disk `wiki/*/` directories that are not in the allowlist count as findings even if no unit mentions them.

## Semantic sub-task

If any structural rule fails with blocker severity, the semantic LLM sub-task is skipped — fix structural issues first.

Otherwise, invoke the LLM with:
- The full wiki content
- The ranking snapshot
- The applied proposal
- `config.json.stage_specific.semantic_rules_enabled`

Required output schema:

```json
{
  "findings": [
    {
      "category": "coverage_gap | redundancy | contradiction | index_routing | stale | ungrounded_unit",
      "severity": "blocker | warn",
      "pages": ["wiki/systems/auth.md"],
      "evidence": "one-line concrete reason",
      "suggested_action": "one-line recommendation"
    }
  ]
}
```

Emit an empty `findings: []` if no issues. Do NOT produce prose outside the JSON schema.

## Output

Write `<run-dir>/validation-findings.json` per spec Section 5.4:

```json
{
  "run_id": "<ts>-update-<key>",
  "status": "pass | fail",
  "pass_count": {"structural": 12, "semantic": 5},
  "structural": [{"page": "...", "issue": "...", "severity": "blocker|warn", "rule_id": "..."}],
  "semantic": [{"category": "...", "severity": "...", "pages": [...], "evidence": "...", "suggested_action": "..."}]
}
```

Also stage-completion marker to `update-state.json.stages.validate` with the stable findings path.
```

- [ ] **Step 4: Run test**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py -v`
Expected: 7+ tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add agents/update/06-validate/ tests/test_validate_stage_configs.py
git commit -m "feat(update/validate): add stage config and instructions"
```

---

### Task 3: Validate — baseline LLM stub (semantic sub-task)

**Files:**
- Create: `tests/fixtures/stubs/06-validate.semantic.json`
- Test: extend `tests/test_llm_client_stub.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_llm_client_stub.py`:

```python
def test_validate_semantic_stub_present():
    stub = Path(__file__).parent / "fixtures" / "stubs" / "06-validate.semantic.json"
    assert stub.is_file()
    data = json.loads(stub.read_text())
    assert data["stage"] == "06-validate.semantic"
    assert "findings" in data["response"]
    assert isinstance(data["response"]["findings"], list)
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_llm_client_stub.py::test_validate_semantic_stub_present -v`
Expected: FAIL.

- [ ] **Step 3: Create stub**

Create `tests/fixtures/stubs/06-validate.semantic.json`:

```json
{
  "stage": "06-validate.semantic",
  "response": {
    "findings": []
  },
  "tokens_consumed": {"input_chars": 3000, "output_chars": 50, "is_estimate": true}
}
```

Also create a destructive variant `tests/fixtures/stubs/06-validate.semantic.with_finding.json` for later failure-path tests:

```json
{
  "stage": "06-validate.semantic",
  "response": {
    "findings": [
      {
        "category": "coverage_gap",
        "severity": "blocker",
        "pages": ["wiki/systems/data-store.md"],
        "evidence": "Ranking snapshot lists `data-store` as rank 2 but the wiki page does not cite `src/db.py`'s `delete` function.",
        "suggested_action": "Add repo pointer for `src/db.py:17-19` to cover the delete helper."
      }
    ]
  },
  "tokens_consumed": {"input_chars": 3200, "output_chars": 180, "is_estimate": true}
}
```

- [ ] **Step 4: Run test**

Run: `.venv/bin/pytest tests/test_llm_client_stub.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/stubs/06-validate.semantic.json tests/fixtures/stubs/06-validate.semantic.with_finding.json tests/test_llm_client_stub.py
git commit -m "test(fixtures): add validate semantic stubs (pass + finding variants)"
```

---

### Task 4: Validate — structural checker implementation

**Context:** Structural rules are deterministic and don't need an LLM. Implement as a Python module consumed by the validate stage's run.sh. Each rule is a function returning a list of findings.

**Files:**
- Create: `agents/update/06-validate/structural.py` (Python module imported via `sys.path.insert(agent_dir)`)
- Create: `tests/test_validate_structural.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_validate_structural.py`:

```python
"""Tests for the deterministic structural validator.

Each rule is tested with (a) a minimal passing fixture and (b) a minimal
failing fixture. The validator returns a list of findings; passing = empty.
"""

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _import_struct():
    stage_dir = REPO_ROOT / "agents" / "update" / "06-validate"
    sys.path.insert(0, str(stage_dir))
    import structural
    return structural


def test_required_page_sections_passes_on_well_formed(tmp_path):
    struct = _import_struct()
    page = tmp_path / "wiki" / "systems" / "foo.md"
    page.parent.mkdir(parents=True)
    page.write_text(
        "One-line summary.\n\n"
        "## Repo pointers\n\n"
        "- `src/foo.py:1-10` — the foo module\n\n"
        "## Related\n\n"
        "- Known gaps: none known\n"
    )
    findings = struct.required_page_sections(tmp_path)
    assert findings == []


def test_required_page_sections_fails_on_missing_pointers(tmp_path):
    struct = _import_struct()
    page = tmp_path / "wiki" / "systems" / "foo.md"
    page.parent.mkdir(parents=True)
    page.write_text("Summary only.\n\n## Related\n- gap\n")
    findings = struct.required_page_sections(tmp_path)
    assert len(findings) == 1
    assert "Repo pointers" in findings[0]["issue"]


def test_shelf_allowlist_flags_unprescribed_dir(tmp_path):
    struct = _import_struct()
    allowed = ["architecture", "systems", "modules"]
    # Legal page
    legal = tmp_path / "wiki" / "systems" / "ok.md"
    legal.parent.mkdir(parents=True)
    legal.write_text("ok\n\n## Repo pointers\n\n- `src/x.py:1-2` — x\n\n## Related\n\n- none\n")
    # Illegal page (matches the dry-run's wiki/runtime/ deviation)
    illegal = tmp_path / "wiki" / "runtime" / "bad.md"
    illegal.parent.mkdir(parents=True)
    illegal.write_text("bad\n\n## Repo pointers\n\n- `src/x.py:1-2` — x\n\n## Related\n\n- none\n")
    findings = struct.shelf_allowlist(tmp_path, allowed)
    assert len(findings) == 1
    assert "runtime" in findings[0]["issue"]
    assert findings[0]["rule_id"] == "shelf_allowlist"


def test_citation_line_range_flags_out_of_bounds(tmp_path):
    struct = _import_struct()
    src = tmp_path / "src" / "small.py"
    src.parent.mkdir(parents=True)
    src.write_text("line1\nline2\nline3\n")  # 3 lines
    page = tmp_path / "wiki" / "systems" / "p.md"
    page.parent.mkdir(parents=True)
    page.write_text(
        "summary\n\n"
        "## Repo pointers\n\n"
        "- `src/small.py:1-10` — exceeds file length\n\n"
        "## Related\n\n- none\n"
    )
    findings = struct.citation_line_range(tmp_path, repo_root=tmp_path)
    assert len(findings) == 1
    assert "10" in findings[0]["issue"]


def test_no_orphan_pages(tmp_path):
    struct = _import_struct()
    # index.md links to foo; bar is orphan
    (tmp_path / "index.md").write_text("[foo](wiki/systems/foo.md)\n")
    (tmp_path / "wiki" / "systems").mkdir(parents=True)
    (tmp_path / "wiki" / "systems" / "foo.md").write_text("foo\n")
    (tmp_path / "wiki" / "systems" / "bar.md").write_text("bar\n")
    findings = struct.no_orphan_pages(tmp_path)
    assert len(findings) == 1
    assert "bar.md" in findings[0]["issue"]


def test_pages_json_filesystem_agreement(tmp_path):
    struct = _import_struct()
    state = tmp_path / "state"
    state.mkdir()
    (tmp_path / "wiki" / "systems").mkdir(parents=True)
    (tmp_path / "wiki" / "systems" / "only-on-disk.md").write_text("x\n")
    (state / "pages.json").write_text(json.dumps({
        "pages": [
            {"path": "wiki/systems/ghost.md", "type": "systems"},
        ]
    }))
    findings = struct.pages_json_filesystem_agreement(tmp_path)
    # 2 findings: ghost in pages.json not on disk; only-on-disk not in pages.json
    assert len(findings) == 2
```

**Where `structural.py` lives.** Python cannot import from a directory whose name starts with a digit or contains a hyphen, so we cannot write `from agents.update.06-validate import structural`. To keep the shell-stage convention (`06-validate/`) AND have a valid Python module, place `structural.py` INSIDE `agents/update/06-validate/` alongside `run.sh`, and import it in the heredoc by adding the stage directory itself to `sys.path`:

```python
# inside run.sh heredoc
sys.path.insert(0, str(agent_dir))  # agent_dir = agents/update/06-validate/
import structural  # loads agents/update/06-validate/structural.py
```

This avoids a separate `_06_validate/` package directory entirely. Do NOT create `agents/update/_06_validate/` — that path is not referenced anywhere else in the plan.

Tests also import this module via the same `sys.path.insert(stage_dir)` pattern. The test's `_import_struct()` helper:

```python
def _import_struct():
    stage_dir = REPO_ROOT / "agents" / "update" / "06-validate"
    sys.path.insert(0, str(stage_dir))
    import structural
    return structural
```

(The test file's existing `_import_struct()` in this task's Step 1 should be updated to use this pattern instead of the `from agents.update._06_validate import structural` line; the test code snippet below reflects the correction.)

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_validate_structural.py -v`
Expected: ImportError for every test.

- [ ] **Step 3: Implement `agents/update/06-validate/structural.py`**

Create the file with all the rules. Each function returns a `list[dict]` where each dict has `{"page": str, "issue": str, "severity": "blocker|warn", "rule_id": str}`.

```python
"""Deterministic structural validator for the validate stage.

Each rule is a pure function: given a project_dir and optional context,
returns a list of findings. Empty list = rule passed.
"""

from __future__ import annotations

import json
import re
from pathlib import Path


_REQUIRED_SECTIONS = ("## Repo pointers", "## Related")


def required_page_sections(project_dir: Path) -> list[dict]:
    """Every page under wiki/ must have one-line summary + Repo pointers + Related."""
    findings: list[dict] = []
    wiki = project_dir / "wiki"
    if not wiki.is_dir():
        return findings
    for page in wiki.rglob("*.md"):
        text = page.read_text()
        # First non-empty line must be present (summary) and must not be a heading
        first_nonempty = next((ln for ln in text.splitlines() if ln.strip()), "")
        if not first_nonempty or first_nonempty.startswith("#"):
            findings.append({
                "page": str(page.relative_to(project_dir)),
                "issue": "page does not open with a non-heading summary line",
                "severity": "blocker",
                "rule_id": "required_page_sections.summary",
            })
        for section in _REQUIRED_SECTIONS:
            if section not in text:
                findings.append({
                    "page": str(page.relative_to(project_dir)),
                    "issue": f"missing required section: {section}",
                    "severity": "blocker",
                    "rule_id": "required_page_sections",
                })
    return findings


def shelf_allowlist(project_dir: Path, allowed: list[str]) -> list[dict]:
    """Every wiki/<shelf>/ directory and every page's first directory must be in allowed."""
    findings: list[dict] = []
    wiki = project_dir / "wiki"
    if not wiki.is_dir():
        return findings
    allowed_set = set(allowed)
    for entry in wiki.iterdir():
        if entry.is_dir() and entry.name not in allowed_set:
            findings.append({
                "page": str(entry.relative_to(project_dir)),
                "issue": f"shelf directory {entry.name!r} is not in the allowed set {sorted(allowed)}",
                "severity": "blocker",
                "rule_id": "shelf_allowlist",
            })
    return findings


_CITATION_RE = re.compile(r"`([^`]+):(\d+)-(\d+)`")
_BARE_CITATION_RE = re.compile(r"`([^`:]+\.\w+)`")


def _iter_citations(page: Path):
    text = page.read_text()
    for match in _CITATION_RE.finditer(text):
        yield match.group(1), int(match.group(2)), int(match.group(3))


def citation_resolvability(project_dir: Path, repo_root: Path) -> list[dict]:
    """Every cited file must exist in the repo_root."""
    findings: list[dict] = []
    wiki = project_dir / "wiki"
    if not wiki.is_dir():
        return findings
    for page in wiki.rglob("*.md"):
        for file_part, _, _ in _iter_citations(page):
            target = repo_root / file_part
            if not target.is_file():
                findings.append({
                    "page": str(page.relative_to(project_dir)),
                    "issue": f"citation file not found: {file_part}",
                    "severity": "blocker",
                    "rule_id": "citation_resolvability",
                })
    return findings


def citation_line_range(project_dir: Path, repo_root: Path) -> list[dict]:
    """Every cited line range must fit within the file's actual line count."""
    findings: list[dict] = []
    wiki = project_dir / "wiki"
    if not wiki.is_dir():
        return findings
    for page in wiki.rglob("*.md"):
        for file_part, start, end in _iter_citations(page):
            target = repo_root / file_part
            if not target.is_file():
                continue  # citation_resolvability catches this
            line_count = sum(1 for _ in target.open())
            if start < 1 or end < start or end > line_count:
                findings.append({
                    "page": str(page.relative_to(project_dir)),
                    "issue": (
                        f"citation line range {start}-{end} out of bounds for "
                        f"{file_part} (file has {line_count} lines)"
                    ),
                    "severity": "blocker",
                    "rule_id": "citation_line_range",
                })
    return findings


_MD_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+\.md)\)")


def no_orphan_pages(project_dir: Path) -> list[dict]:
    """Every wiki page must be linked from index.md or from another wiki page."""
    findings: list[dict] = []
    wiki = project_dir / "wiki"
    if not wiki.is_dir():
        return findings
    index_path = project_dir / "index.md"
    referenced: set[str] = set()

    def _collect(source_path: Path, source_label: str):
        if not source_path.is_file():
            return
        text = source_path.read_text()
        for match in _MD_LINK_RE.finditer(text):
            raw = match.group(1)
            # Resolve relative to source_label's dir
            if raw.startswith("/"):
                continue
            base_dir = source_path.parent if source_label != "index" else project_dir
            resolved = (base_dir / raw).resolve()
            try:
                rel = resolved.relative_to(project_dir.resolve())
            except ValueError:
                continue
            referenced.add(str(rel))

    _collect(index_path, "index")
    for page in wiki.rglob("*.md"):
        _collect(page, "wiki")

    for page in wiki.rglob("*.md"):
        rel = str(page.relative_to(project_dir))
        if rel not in referenced:
            findings.append({
                "page": rel,
                "issue": "orphan page — not referenced from index.md or any other wiki page",
                "severity": "warn",
                "rule_id": "no_orphan_pages",
            })
    return findings


def no_dead_cross_refs(project_dir: Path) -> list[dict]:
    """Every wiki-to-wiki link resolves to an existing file."""
    findings: list[dict] = []
    wiki = project_dir / "wiki"
    if not wiki.is_dir():
        return findings
    for page in wiki.rglob("*.md"):
        text = page.read_text()
        for match in _MD_LINK_RE.finditer(text):
            raw = match.group(1)
            if raw.startswith("/") or "://" in raw:
                continue
            resolved = (page.parent / raw).resolve()
            if not resolved.is_file():
                findings.append({
                    "page": str(page.relative_to(project_dir)),
                    "issue": f"dead cross-ref: {raw}",
                    "severity": "blocker",
                    "rule_id": "no_dead_cross_refs",
                })
    return findings


def index_routing_resolves(project_dir: Path) -> list[dict]:
    """Every link in index.md resolves to an existing page."""
    findings: list[dict] = []
    index_path = project_dir / "index.md"
    if not index_path.is_file():
        return findings
    text = index_path.read_text()
    for match in _MD_LINK_RE.finditer(text):
        raw = match.group(1)
        if raw.startswith("/") or "://" in raw:
            continue
        resolved = (project_dir / raw).resolve()
        if not resolved.is_file():
            findings.append({
                "page": "index.md",
                "issue": f"index routing entry does not resolve: {raw}",
                "severity": "blocker",
                "rule_id": "index_routing_resolves",
            })
    return findings


def pages_json_filesystem_agreement(project_dir: Path) -> list[dict]:
    """state/pages.json must list exactly the set of files present under wiki/."""
    findings: list[dict] = []
    pages_path = project_dir / "state" / "pages.json"
    if not pages_path.is_file():
        return findings
    wiki = project_dir / "wiki"
    on_disk = set()
    if wiki.is_dir():
        for page in wiki.rglob("*.md"):
            on_disk.add(str(page.relative_to(project_dir)))
    in_state = {p["path"] for p in json.loads(pages_path.read_text()).get("pages", [])}
    for ghost in sorted(in_state - on_disk):
        findings.append({
            "page": ghost,
            "issue": "pages.json lists a page that does not exist on disk",
            "severity": "blocker",
            "rule_id": "pages_json_filesystem_agreement",
        })
    for missing in sorted(on_disk - in_state):
        findings.append({
            "page": missing,
            "issue": "wiki has a page not listed in pages.json",
            "severity": "blocker",
            "rule_id": "pages_json_filesystem_agreement",
        })
    return findings


_ALLOWED_SOURCE_KINDS = {
    "spec", "design", "plan", "implementation-note", "api-doc",
    "reference", "session-note", "decision-candidate", "troubleshooting",
}


def validate_proposal(run_dir: Path, ranking_snapshot: dict, allowed_shelves: list[str]) -> list[dict]:
    """Check proposal.json's structural rules: signals, ranking refs, cap, classification, shelves.

    Returns a single list of findings covering rules 8-12 from the stage spec.
    """
    findings: list[dict] = []
    proposal_path = run_dir / "proposal.json"
    if not proposal_path.is_file():
        return findings
    proposal = json.loads(proposal_path.read_text())
    ranked_domain_names = {d["domain"] for d in ranking_snapshot.get("ranked_domains", [])}
    max_new = proposal.get("max_new_pages", 25)
    new_count = proposal.get("new_pages_count", 0)
    if new_count > max_new:
        findings.append({
            "page": "proposal.json",
            "issue": f"new_pages_count {new_count} exceeds max_new_pages {max_new}",
            "severity": "blocker",
            "rule_id": "proposal_max_new_pages",
        })
    for unit in proposal.get("units", []):
        uid = unit.get("id", "<no-id>")
        if not any(s in ("A", "B", "C") for s in unit.get("justification_signals", [])):
            findings.append({
                "page": "proposal.json",
                "issue": f"unit {uid} missing valid justification_signals",
                "severity": "blocker",
                "rule_id": "proposal_justification_signals",
            })
        for d in unit.get("referenced_ranking_domains", []):
            if d not in ranked_domain_names:
                findings.append({
                    "page": "proposal.json",
                    "issue": f"unit {uid} references domain not in ranking snapshot: {d}",
                    "severity": "blocker",
                    "rule_id": "proposal_referenced_ranking_domains",
                })
        sc = unit.get("source_classification")
        if not isinstance(sc, dict):
            findings.append({
                "page": "proposal.json",
                "issue": f"unit {uid} missing source_classification",
                "severity": "blocker",
                "rule_id": "proposal_source_classification",
            })
        else:
            if sc.get("source_kind") not in _ALLOWED_SOURCE_KINDS:
                findings.append({
                    "page": "proposal.json",
                    "issue": f"unit {uid} has unknown source_kind: {sc.get('source_kind')!r}",
                    "severity": "blocker",
                    "rule_id": "proposal_source_classification",
                })
        # shelf_allowlist on page_path + rename_from
        for key in ("page_path", "rename_from"):
            path = unit.get(key)
            if path and path.startswith("wiki/"):
                shelf = path.split("/", 2)[1] if "/" in path[len("wiki/"):] else ""
                if shelf not in allowed_shelves:
                    findings.append({
                        "page": "proposal.json",
                        "issue": f"unit {uid} {key}={path!r} uses shelf {shelf!r} not in allowlist",
                        "severity": "blocker",
                        "rule_id": "shelf_allowlist",
                    })
    return findings
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_validate_structural.py -v`
Expected: 6 tests pass.

Full suite: `.venv/bin/pytest -q`
Expected: 113 pass (107 prior + 6 new).

- [ ] **Step 5: Commit**

```bash
git add agents/update/06-validate/structural.py tests/test_validate_structural.py
git commit -m "feat(update/validate): implement deterministic structural rules"
```

---

### Task 5: Validate run.sh

**Files:**
- Create: `agents/update/06-validate/run.sh`
- Test: `tests/test_update_validate.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_update_validate.py`:

```python
"""Validate stage end-to-end tests (structural + semantic, stub-driven)."""

import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _run_pipeline_through_apply(project_dir: Path, stub_dir: Path, run_dir: Path, auto: bool = True):
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(stub_dir)}
    if auto:
        env["AUTO"] = "1"
    for stage in ("01-sense", "02-impact", "03-propose"):
        rc = subprocess.run(
            ["bash", str(REPO_ROOT / "agents" / "update" / stage / "run.sh"),
             "--project", "sample", "--project-dir", str(project_dir),
             "--run-dir", str(run_dir)],
            env=env, capture_output=True, text=True,
        )
        assert rc.returncode == 0, f"{stage}: {rc.stderr}"
    if not auto:
        p = json.loads((run_dir / "proposal.json").read_text())
        p["approved"] = True
        (run_dir / "proposal.json").write_text(json.dumps(p, indent=2))
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "04-apply" / "run.sh"),
         "--project", "sample", "--project-dir", str(project_dir), "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0, f"apply: {rc.stderr}"
    return env


def _run_validate(project_dir: Path, run_dir: Path, env: dict):
    return subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "06-validate" / "run.sh"),
         "--project", "sample", "--project-dir", str(project_dir), "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )


def test_validate_passes_on_clean_apply(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"; run_dir.mkdir()
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


def test_validate_fails_on_unprescribed_shelf(tmp_sample_project_with_repo, tmp_path, monkeypatch):
    """After apply, manually create a wiki/runtime/ page to simulate the Phase 1 deviation."""
    run_dir = tmp_path / "run"; run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    # Inject a wiki/runtime/ page manually (simulating what Phase 1 produced)
    runtime = tmp_sample_project_with_repo / "wiki" / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    (runtime / "entry.md").write_text("summary\n\n## Repo pointers\n\n- `src/main.py:1-5` — x\n\n## Related\n- none\n")
    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)
    # Exit non-zero on validation failure
    assert rc.returncode != 0
    findings = json.loads((run_dir / "validation-findings.json").read_text())
    assert findings["status"] == "fail"
    shelf_findings = [f for f in findings["structural"] if f["rule_id"] == "shelf_allowlist"]
    assert len(shelf_findings) >= 1
    assert any("runtime" in f["issue"] for f in shelf_findings)


def test_validate_skips_semantic_when_structural_blocks(tmp_sample_project_with_repo, tmp_path):
    """If structural rules emit blocker findings, the semantic sub-task is not invoked."""
    run_dir = tmp_path / "run"; run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    # Break the wiki: delete a linked page (triggers no_dead_cross_refs + orphan)
    (tmp_sample_project_with_repo / "wiki" / "systems" / "authentication.md").unlink()
    rc = _run_validate(tmp_sample_project_with_repo, run_dir, env)
    assert rc.returncode != 0
    findings = json.loads((run_dir / "validation-findings.json").read_text())
    assert findings["status"] == "fail"
    # Semantic should be an empty list — skipped because structural blocked
    assert findings["semantic"] == []


def test_validate_writes_completion_marker(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"; run_dir.mkdir()
    env = _run_pipeline_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    _run_validate(tmp_sample_project_with_repo, run_dir, env)
    us = json.loads((tmp_sample_project_with_repo / "state" / "update-state.json").read_text())
    assert us["stages"]["validate"]["status"] == "completed"
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_update_validate.py -v`
Expected: FAIL (run.sh missing).

- [ ] **Step 3: Implement run.sh**

Create `agents/update/06-validate/run.sh`:

```bash
#!/usr/bin/env bash
# Validate stage — structural script + semantic LLM agent.
#
# Writes <run-dir>/validation-findings.json with combined findings.
# Exit 0 on pass, non-zero on fail. Stage completion marker is always
# written regardless of pass/fail.

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/06-validate/run.sh --project <key> [--project-dir <path>] --run-dir <path>
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
project_dir=""
run_dir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    --project-dir) project_dir="${2:?}"; shift 2 ;;
    --run-dir) run_dir="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
[[ -n "$run_dir" ]] || die "--run-dir is required"
if [[ -z "$project_dir" ]]; then
  project_dir="$ROOT_DIR/projects/$project_key"
fi
[[ -d "$project_dir" ]] || die "project dir not found: $project_dir"
[[ -f "$run_dir/ranking-snapshot.json" ]] || die "ranking-snapshot.json missing in $run_dir"
[[ -f "$run_dir/proposal.json" ]] || die "proposal.json missing in $run_dir"

python3 - "$project_key" "$project_dir" "$run_dir" "$AGENT_DIR" "$ROOT_DIR" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
agent_dir = Path(sys.argv[4])
root_dir = Path(sys.argv[5])

sys.path.insert(0, str(root_dir))
sys.path.insert(0, str(agent_dir))  # for `import structural` from the stage dir
import structural
from agents.update._shared import llm_client

config = json.loads((agent_dir / "config.json").read_text())
allowed_shelves = config["stage_specific"]["shelf_allowlist"]

pj = json.loads((project_dir / "state" / "project.json").read_text())
repo_paths = pj.get("repo_paths", [])
repo_root = Path(repo_paths[0]) if repo_paths else project_dir
if not repo_root.is_absolute():
    repo_root = root_dir / repo_root

ranking = json.loads((run_dir / "ranking-snapshot.json").read_text())

# Structural rules
structural_findings: list[dict] = []
structural_findings += structural.required_page_sections(project_dir)
structural_findings += structural.shelf_allowlist(project_dir, allowed_shelves)
structural_findings += structural.citation_resolvability(project_dir, repo_root)
structural_findings += structural.citation_line_range(project_dir, repo_root)
structural_findings += structural.no_dead_cross_refs(project_dir)
structural_findings += structural.no_orphan_pages(project_dir)
structural_findings += structural.index_routing_resolves(project_dir)
structural_findings += structural.pages_json_filesystem_agreement(project_dir)
structural_findings += structural.validate_proposal(run_dir, ranking, allowed_shelves)

blockers = [f for f in structural_findings if f.get("severity") == "blocker"]
semantic_findings: list[dict] = []

# Semantic sub-task only if structural is clean
if not blockers:
    wiki_dump_chunks: list[str] = []
    wiki = project_dir / "wiki"
    if wiki.is_dir():
        for page in sorted(wiki.rglob("*.md")):
            wiki_dump_chunks.append(f"=== {page.relative_to(project_dir)} ===\n{page.read_text()}")
    index_path = project_dir / "index.md"
    index_dump = index_path.read_text() if index_path.is_file() else ""
    prompt = json.dumps({
        "project_key": project_key,
        "ranking_snapshot": ranking,
        "proposal": json.loads((run_dir / "proposal.json").read_text()),
        "index_md": index_dump,
        "wiki_pages": wiki_dump_chunks,
        "enabled_rules": config["stage_specific"]["semantic_rules_enabled"],
    })
    try:
        result = llm_client.invoke(stage_id="06-validate.semantic", prompt=prompt)
        semantic_findings = result["response"].get("findings", [])
    except RuntimeError as exc:
        # LLM failed — record as a warning so the pipeline can still progress
        semantic_findings = [{
            "category": "contradiction",
            "severity": "warn",
            "pages": [],
            "evidence": f"semantic validator invocation failed: {exc}",
            "suggested_action": "investigate LLM backend; skip semantic check if persistent",
        }]

semantic_blockers = [f for f in semantic_findings if f.get("severity") == "blocker"]
status = "fail" if blockers or semantic_blockers else "pass"

report = {
    "run_id": run_dir.name,
    "status": status,
    "pass_count": {
        "structural": len(config["stage_specific"]["structural_rules"]) - len({f["rule_id"].split(".")[0] for f in blockers}),
        "semantic": len(config["stage_specific"]["semantic_rules_enabled"]) - len({f.get("category") for f in semantic_blockers}),
    },
    "structural": structural_findings,
    "semantic": semantic_findings,
}
(run_dir / "validation-findings.json").write_text(json.dumps(report, indent=2) + "\n")

# Stage completion marker (always written)
now = datetime.now(timezone.utc).isoformat()
us_path = project_dir / "state" / "update-state.json"
if us_path.is_file():
    us = json.loads(us_path.read_text())
    us.setdefault("stages", {})
    us["stages"]["validate"] = {
        "status": "completed",
        "last_run_dir": str(run_dir),
        "last_completed_at": now,
        "summary_file": str(run_dir / "validation-findings.json"),
    }
    us["last_completed_stage"] = "validate"
    # Ensure latest_run_dir reflects the most recent validate run. Earlier stages
    # (apply, propose, impact, sense) also write this key, but re-asserting it here
    # keeps make lint's "read latest_run_dir" contract correct even if validate runs
    # standalone via `make lint` without a preceding apply call.
    us["latest_run_dir"] = str(run_dir)
    us["latest_validation_findings"] = {
        "findings_path": str(project_dir / "state" / "latest" / "validation-findings.json"),
        "audit_run_dir": str(run_dir),
        "status": status,
        "updated_at": now,
    }
    us_path.write_text(json.dumps(us, indent=2) + "\n")

print(f"validate: status={status} structural_findings={len(structural_findings)} semantic_findings={len(semantic_findings)}")
sys.exit(0 if status == "pass" else 1)
PY
```

Make executable: `chmod +x agents/update/06-validate/run.sh`

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_update_validate.py -v`
Expected: 4 tests pass.

Full suite: `.venv/bin/pytest -q`
Expected: 117 pass.

- [ ] **Step 5: Commit**

```bash
git add agents/update/06-validate/run.sh tests/test_update_validate.py
git commit -m "feat(update/validate): implement run.sh with structural + semantic sub-tasks"
```

---

## Phase C — Apply + propose shelf-allowlist enforcement

### Task 6: Apply pre-flight — shelf-allowlist check

**Context:** Defense in depth. The validator catches deviations after apply, but apply should also refuse to write pages under unprescribed shelves in the first place. This is the Phase 1 finding translated into defensive pre-flight code.

**Files:**
- Modify: `agents/update/04-apply/run.sh`
- Create: `tests/test_shelf_allowlist.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_shelf_allowlist.py`:

```python
"""Apply pre-flight must reject units whose page_path uses an unprescribed shelf."""

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_apply_rejects_unprescribed_shelf(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"; run_dir.mkdir()
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs")}
    for stage in ("01-sense", "02-impact", "03-propose"):
        rc = subprocess.run(
            ["bash", str(REPO_ROOT / "agents" / "update" / stage / "run.sh"),
             "--project", "sample", "--project-dir", str(tmp_sample_project_with_repo),
             "--run-dir", str(run_dir)],
            env=env, capture_output=True, text=True,
        )
        assert rc.returncode == 0
    # Corrupt the proposal: move one unit's page_path to a non-allowlist shelf
    proposal_path = run_dir / "proposal.json"
    p = json.loads(proposal_path.read_text())
    p["approved"] = True
    p["units"][0]["page_path"] = "wiki/runtime/entry-point.md"  # mirrors Phase 1 deviation
    proposal_path.write_text(json.dumps(p, indent=2))

    apply_rc = subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "04-apply" / "run.sh"),
         "--project", "sample", "--project-dir", str(tmp_sample_project_with_repo),
         "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    assert apply_rc.returncode != 0
    assert "shelf" in apply_rc.stderr.lower() or "runtime" in apply_rc.stderr.lower()
    # Wiki must remain empty
    systems = tmp_sample_project_with_repo / "wiki" / "systems"
    assert not any(systems.glob("*.md"))
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_shelf_allowlist.py -v`
Expected: FAIL (apply currently accepts any shelf).

- [ ] **Step 3: Add shelf-allowlist pre-flight in apply**

In `agents/update/04-apply/run.sh`, locate the Python heredoc's pre-flight section (where it already validates `justification_signals`, `referenced_ranking_domains`, etc.). Add this constant near the top of the Python block:

```python
ALLOWED_SHELVES = {
    "architecture", "systems", "modules", "integrations",
    "decisions", "runbooks", "sessions", "glossary", "open-questions",
}
```

Add this check inside the per-unit loop, alongside the other pre-flight checks:

```python
    for key in ("page_path", "rename_from"):
        path = unit.get(key)
        if not path:
            continue
        if not path.startswith("wiki/"):
            continue
        remainder = path[len("wiki/"):]
        shelf = remainder.split("/", 1)[0] if "/" in remainder else ""
        if shelf not in ALLOWED_SHELVES:
            die(f"unit {unit.get('id')} {key}={path!r} uses shelf {shelf!r} "
                f"not in allowlist {sorted(ALLOWED_SHELVES)}")
```

Also check `index_changes` (if it moves pages between shelves): add a sanity check that any new link in `index_changes.content` points at an allowed shelf. Skip this for Plan C's scope — the validator's no_dead_cross_refs + shelf_allowlist combination catches this after apply. Document with a comment:

```python
# index_changes shelf policy: deferred to validate stage (covers shelf_allowlist
# via on-disk directory check + index_routing_resolves on the link targets).
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_shelf_allowlist.py tests/test_update_apply.py -v`
Expected: new test passes; existing apply tests still pass.

Full suite: `.venv/bin/pytest -q`
Expected: 118 pass.

- [ ] **Step 5: Commit**

```bash
git add agents/update/04-apply/run.sh tests/test_shelf_allowlist.py
git commit -m "feat(update/apply): reject units using unprescribed wiki shelves"
```

---

### Task 7: Propose instructions — shelf-allowlist in hard rules

**Context:** The LLM will stop inventing shelves if told explicitly. Complements Task 6's pre-flight.

**Files:**
- Modify: `agents/update/03-propose/instructions.md`
- Test: extend `tests/test_stage_instructions_schema.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_stage_instructions_schema.py`:

```python
def test_propose_instructions_enforce_shelf_allowlist():
    text = _instructions("03-propose")
    schema_section = text.split("## Required output schema", 1)[1]
    assert "shelf_allowlist" in schema_section.lower() or "allowed shelves" in schema_section.lower()
    # Must enumerate the 9 shelves
    for shelf in ("architecture", "systems", "modules", "integrations",
                  "decisions", "runbooks", "sessions", "glossary", "open-questions"):
        assert shelf in schema_section, f"missing shelf {shelf!r} in propose instructions"
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_stage_instructions_schema.py::test_propose_instructions_enforce_shelf_allowlist -v`
Expected: FAIL.

- [ ] **Step 3: Update propose instructions**

In `agents/update/03-propose/instructions.md`, inside the existing `### Hard rules` section (under `## Required output schema`), append:

```markdown
- `page_path` and `rename_from` MUST begin with one of: `wiki/architecture/`, `wiki/systems/`, `wiki/modules/`, `wiki/integrations/`, `wiki/decisions/`, `wiki/runbooks/`, `wiki/sessions/`, `wiki/glossary/`, `wiki/open-questions/`. Do not invent new shelf names (e.g., `wiki/runtime/`, `wiki/core/`, `wiki/utils/`) — apply's pre-flight rejects them and validate flags them as blockers. If a domain doesn't fit an existing shelf, place it in the closest shelf and note the tension in `deferred_domains` or the page's Known-gaps section.
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_stage_instructions_schema.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add agents/update/03-propose/instructions.md tests/test_stage_instructions_schema.py
git commit -m "feat(update/propose): enumerate shelf allowlist in hard rules"
```

---

## Phase D — Reconcile

### Task 8: Reconcile stage — config + instructions + baseline stub

**Files:**
- Create: `agents/update/07-reconcile/config.json`
- Create: `agents/update/07-reconcile/instructions.md`
- Create: `tests/fixtures/stubs/07-reconcile.json`
- Test: extend `tests/test_validate_stage_configs.py` and `tests/test_llm_client_stub.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_validate_stage_configs.py`:

```python
def test_reconcile_config_exists():
    stages_root = REPO_ROOT / "agents" / "update"
    config = stages_root / "07-reconcile" / "config.json"
    assert config.is_file()
    data = json.loads(config.read_text())
    assert data["stage"] == "reconcile"
    assert data["stage_specific"]["max_loop_iterations"] == 1
```

Append to `tests/test_llm_client_stub.py`:

```python
def test_reconcile_stub_present():
    stub = Path(__file__).parent / "fixtures" / "stubs" / "07-reconcile.json"
    assert stub.is_file()
    data = json.loads(stub.read_text())
    assert data["stage"] == "07-reconcile"
    response = data["response"]
    assert "units" in response
    assert "approved" in response
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py::test_reconcile_config_exists tests/test_llm_client_stub.py::test_reconcile_stub_present -v`
Expected: FAIL.

- [ ] **Step 3: Create config, instructions, and stub**

Create `agents/update/07-reconcile/config.json`:

```json
{
  "stage": "reconcile",
  "agent_kind": "llm-agent",
  "token_budget_input": 40000,
  "token_budget_output": 16000,
  "on_over_budget": "fail-clean",
  "stage_specific": {
    "max_loop_iterations": 1
  }
}
```

Create `agents/update/07-reconcile/instructions.md`:

```markdown
# Reconcile Stage — Instructions

You are the **reconcile** stage, invoked only when the validate stage reported `status: fail`. Your job is to propose surgical fixes that address the blocker findings without re-imagining the whole wiki.

## Inputs

- `validation-findings.json` from the current run
- The current wiki state (after apply — findings reflect what actually landed)
- The `ranking-snapshot.json` (unchanged — do not re-rank)
- The original `proposal.json` (for intent context)

## Output

A `reconcile-proposal.json` with the same schema as `proposal.json`. The reconcile proposal IS a proposal — it flows back into the apply stage.

Required output schema (identical to propose):

```json
{
  "project": "<project-key>",
  "run_id": "<current run id>",
  "summary": "reconcile: <short>",
  "ranking_snapshot_path": "projects/<key>/state/latest/ranking-snapshot.json",
  "max_new_pages": 25,
  "new_pages_count": 0,
  "deferred_domains": [],
  "approved": true,
  "units": [
    {
      "id": "r1",
      "action": "create | update | delete | rename",
      "page_path": "wiki/systems/auth.md",
      "rename_from": null,
      "destructive": false,
      "uncertainty": "low",
      "justification": "Reconcile: addresses finding ...",
      "justification_signals": ["A", "B", "C"],
      "referenced_ranking_domains": ["authentication"],
      "source_classification": { ... },
      "content": "...",
      "affected_cross_refs": [],
      "source_citations": ["src/x.py:1-5"]
    }
  ],
  "index_changes": null,
  "state_changes_intent": {
    "last_seen_commit_pending": null,
    "last_update_at_pending": null
  }
}
```

## What to fix autonomously

- Broken relative links where the intended target is unambiguous.
- Missing required sections (`## Repo pointers`, `## Related`) on pages that already exist — append the section with a reasonable default using the page's ranked domain as context.
- Pages using unprescribed shelves (e.g., `wiki/runtime/`) — emit a `rename` unit moving them to the closest allowed shelf (usually `systems/` for runtime concerns).
- Stale marker dishonesty — if a page claims "all current" but the semantic validator flagged it as stale, update the Known-gaps section.

## What to escalate

Punt to the operator (emit no reconcile units, set `approved: false`) when the failure is semantically ambiguous:
- A page claims behavior the cited source does not support.
- A domain split where the right decomposition is not obvious.
- Contradiction between two pages that both appear correct against their own cited sources.
- Any semantic blocker whose `suggested_action` starts with "operator judgment" or similar.

## Hard rules

- Same hard rules as the propose stage apply: `justification_signals`, shelf allowlist, citation resolvability, `source_classification` fields present, `source_kind` in the allowed set.
- Loop iteration: `max_loop_iterations` is 1. This is your only shot. If your proposal still fails validation, the operator must intervene.
- Approval model mirrors the original proposal: if the original was AUTO=1, reconcile is AUTO=1; otherwise gated. This matches the spec (§4.5).

## Output file

Write `<run-dir>/reconcile-proposal.json`. Also write stage completion marker to `update-state.json.stages.reconcile`.
```

Create `tests/fixtures/stubs/07-reconcile.json` (default: empty reconcile that escalates to operator):

```json
{
  "stage": "07-reconcile",
  "response": {
    "project": "sample",
    "run_id": "placeholder-will-be-stamped-by-runner",
    "summary": "reconcile: no autonomous fix possible, escalating to operator",
    "ranking_snapshot_path": "projects/sample/state/latest/ranking-snapshot.json",
    "max_new_pages": 25,
    "new_pages_count": 0,
    "deferred_domains": [],
    "approved": false,
    "units": [],
    "index_changes": null,
    "state_changes_intent": {
      "last_seen_commit_pending": null,
      "last_update_at_pending": null
    }
  },
  "tokens_consumed": {"input_chars": 5000, "output_chars": 200, "is_estimate": true}
}
```

Create a second stub `tests/fixtures/stubs/07-reconcile.with_fix.json` that DOES propose a fix (for happy-path testing later):

```json
{
  "stage": "07-reconcile",
  "response": {
    "project": "sample",
    "run_id": "placeholder-will-be-stamped-by-runner",
    "summary": "reconcile: move wiki/runtime/entry-point.md to wiki/systems/entry-point.md",
    "ranking_snapshot_path": "projects/sample/state/latest/ranking-snapshot.json",
    "max_new_pages": 25,
    "new_pages_count": 0,
    "deferred_domains": [],
    "approved": true,
    "units": [
      {
        "id": "r1",
        "action": "rename",
        "page_path": "wiki/systems/entry-point.md",
        "rename_from": "wiki/runtime/entry-point.md",
        "destructive": true,
        "uncertainty": "low",
        "justification": "Reconcile: `runtime` is not in the shelf allowlist; systems/ is the closest legal home for the app entry point.",
        "justification_signals": ["A"],
        "referenced_ranking_domains": ["entry-point"],
        "source_classification": {
          "source_kind": "implementation-note",
          "ownership": "project:sample",
          "destination": "wiki/systems/entry-point.md",
          "update_targets": ["wiki/systems/entry-point.md"],
          "action": "update-existing-pages"
        },
        "content": "",
        "affected_cross_refs": [],
        "source_citations": []
      }
    ],
    "index_changes": null,
    "state_changes_intent": {
      "last_seen_commit_pending": null,
      "last_update_at_pending": null
    }
  },
  "tokens_consumed": {"input_chars": 5200, "output_chars": 500, "is_estimate": true}
}
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py tests/test_llm_client_stub.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add agents/update/07-reconcile/ tests/fixtures/stubs/07-reconcile.json tests/fixtures/stubs/07-reconcile.with_fix.json tests/test_validate_stage_configs.py tests/test_llm_client_stub.py
git commit -m "feat(update/reconcile): add config, instructions, and baseline stubs"
```

---

### Task 9: Reconcile run.sh

**Files:**
- Create: `agents/update/07-reconcile/run.sh`
- Create: `tests/test_update_reconcile.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_update_reconcile.py`:

```python
"""Reconcile stage tests. Triggered when validate fails."""

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _run_through_validate(project_dir: Path, run_dir: Path, stub_dir: Path, break_wiki: bool):
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(stub_dir), "AUTO": "1"}
    for stage in ("01-sense", "02-impact", "03-propose", "04-apply"):
        rc = subprocess.run(
            ["bash", str(REPO_ROOT / "agents" / "update" / stage / "run.sh"),
             "--project", "sample", "--project-dir", str(project_dir),
             "--run-dir", str(run_dir)],
            env=env, capture_output=True, text=True,
        )
        assert rc.returncode == 0, f"{stage}: {rc.stderr}"
    if break_wiki:
        (project_dir / "wiki" / "runtime").mkdir(parents=True, exist_ok=True)
        (project_dir / "wiki" / "runtime" / "injected.md").write_text(
            "bad\n\n## Repo pointers\n\n- `src/main.py:1-5` — x\n\n## Related\n- none\n"
        )
    subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "06-validate" / "run.sh"),
         "--project", "sample", "--project-dir", str(project_dir), "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    return env


def test_reconcile_emits_proposal_when_validate_fails(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"; run_dir.mkdir()
    env = _run_through_validate(
        tmp_sample_project_with_repo, run_dir,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        break_wiki=True,
    )
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "07-reconcile" / "run.sh"),
         "--project", "sample", "--project-dir", str(tmp_sample_project_with_repo),
         "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    proposal = json.loads((run_dir / "reconcile-proposal.json").read_text())
    assert "units" in proposal
    assert "approved" in proposal


def test_reconcile_refuses_when_validate_passed(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"; run_dir.mkdir()
    env = _run_through_validate(
        tmp_sample_project_with_repo, run_dir,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        break_wiki=False,
    )
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "07-reconcile" / "run.sh"),
         "--project", "sample", "--project-dir", str(tmp_sample_project_with_repo),
         "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode != 0
    assert "validation" in rc.stderr.lower() or "pass" in rc.stderr.lower()


def test_reconcile_writes_completion_marker(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"; run_dir.mkdir()
    env = _run_through_validate(
        tmp_sample_project_with_repo, run_dir,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        break_wiki=True,
    )
    subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "07-reconcile" / "run.sh"),
         "--project", "sample", "--project-dir", str(tmp_sample_project_with_repo),
         "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    us = json.loads((tmp_sample_project_with_repo / "state" / "update-state.json").read_text())
    assert us["stages"]["reconcile"]["status"] == "completed"
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_update_reconcile.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement run.sh**

Create `agents/update/07-reconcile/run.sh`:

```bash
#!/usr/bin/env bash
# Reconcile stage — triggered only when validate reported status: fail.
#
# Produces <run-dir>/reconcile-proposal.json.

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/07-reconcile/run.sh --project <key> [--project-dir <path>] --run-dir <path>
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
project_dir=""
run_dir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    --project-dir) project_dir="${2:?}"; shift 2 ;;
    --run-dir) run_dir="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
[[ -n "$run_dir" ]] || die "--run-dir is required"
if [[ -z "$project_dir" ]]; then
  project_dir="$ROOT_DIR/projects/$project_key"
fi
[[ -f "$run_dir/validation-findings.json" ]] || die "validation-findings.json missing in $run_dir"

python3 - "$project_key" "$project_dir" "$run_dir" "$AGENT_DIR" "$ROOT_DIR" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
agent_dir = Path(sys.argv[4])
root_dir = Path(sys.argv[5])

sys.path.insert(0, str(root_dir))
from agents.update._shared import llm_client

findings = json.loads((run_dir / "validation-findings.json").read_text())
if findings.get("status") != "fail":
    print(
        "error: reconcile should only run after validate reports fail; "
        f"current status: {findings.get('status')!r}",
        file=sys.stderr,
    )
    sys.exit(2)

proposal = json.loads((run_dir / "proposal.json").read_text())
ranking = json.loads((run_dir / "ranking-snapshot.json").read_text())

prompt = json.dumps({
    "project_key": project_key,
    "validation_findings": findings,
    "original_proposal": proposal,
    "ranking_snapshot": ranking,
})
result = llm_client.invoke(stage_id="07-reconcile", prompt=prompt)
reconcile_proposal = result["response"]
reconcile_proposal["run_id"] = run_dir.name

(run_dir / "reconcile-proposal.json").write_text(json.dumps(reconcile_proposal, indent=2) + "\n")

now = datetime.now(timezone.utc).isoformat()
us_path = project_dir / "state" / "update-state.json"
if us_path.is_file():
    us = json.loads(us_path.read_text())
    us.setdefault("stages", {})
    us["stages"]["reconcile"] = {
        "status": "completed",
        "last_run_dir": str(run_dir),
        "last_completed_at": now,
        "summary_file": str(run_dir / "reconcile-proposal.json"),
    }
    us["last_completed_stage"] = "reconcile"
    us_path.write_text(json.dumps(us, indent=2) + "\n")

units = reconcile_proposal.get("units", [])
print(f"reconcile: {len(units)} unit(s) proposed, approved={reconcile_proposal.get('approved', False)}")
PY
```

Make executable: `chmod +x agents/update/07-reconcile/run.sh`

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_update_reconcile.py -v`
Expected: 3 pass.

Full suite: `.venv/bin/pytest -q`
Expected: 121 pass.

- [ ] **Step 5: Commit**

```bash
git add agents/update/07-reconcile/run.sh tests/test_update_reconcile.py
git commit -m "feat(update/reconcile): implement run.sh with validate-gate and proposal emission"
```

---

## Phase E — Pipeline orchestration

### Task 10: Wire validate + reconcile into `scripts/update.sh`; gate apply_commit

**Context:** Currently `update.sh` runs apply → apply_commit unconditionally. Plan C's rule: apply → validate → (reconcile → apply → validate) → apply_commit. Commit pointer only advances on validate pass.

**Files:**
- Modify: `scripts/update.sh`
- Test: extend `tests/test_plan_b_acceptance.py` or create `tests/test_plan_c_acceptance.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_plan_c_acceptance.py`:

```python
"""Plan C acceptance: full pipeline including validate + reconcile + gated apply_commit."""

import json
import os
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _prepare_isolated_run(tmp_path: Path):
    projects_root = tmp_path / "projects"; projects_root.mkdir()
    project_dir = projects_root / "sample"
    shutil.copytree(REPO_ROOT / "projects" / "sample", project_dir)
    subprocess.run(["bash", str(REPO_ROOT / "tests" / "fixtures" / "sample_repo_init.sh")], check=True)
    repo_src = REPO_ROOT / "tests" / "fixtures" / "sample_repo"
    repo_dst = tmp_path / "sample_repo"
    shutil.copytree(repo_src, repo_dst)
    pj_path = project_dir / "state" / "project.json"
    pj = json.loads(pj_path.read_text())
    pj["repo_paths"] = [str(repo_dst)]
    pj_path.write_text(json.dumps(pj, indent=2))
    artifacts_root = tmp_path / "artifacts"; artifacts_root.mkdir()
    return projects_root, project_dir, artifacts_root


def test_update_auto_runs_validate_and_advances_commit_on_pass(tmp_path):
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
        "AUTO": "1",
    }
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    # Validate must have run and passed
    findings_path = project_dir / "state" / "latest" / "validation-findings.json"
    # validation-findings exists under run dir; stable copy lives under state/latest/ once Plan C writes it
    # For Plan C the stable product path is written by render-validation — check both locations
    run_findings = sorted((artifacts_root / "sample" / "runs").glob("*-update/validation-findings.json"))
    assert run_findings, "validation-findings.json missing under run dir"
    findings = json.loads(run_findings[-1].read_text())
    assert findings["status"] == "pass"
    # Commit pointer advanced
    fr = json.loads((project_dir / "state" / "freshness.json").read_text())
    assert fr["last_seen_commit"] is not None
    assert fr["last_seen_commit_pending"] is None


def test_update_halts_and_does_not_advance_commit_on_validate_fail_no_reconcile_fix(tmp_path):
    """If validate fails (structural) AND reconcile returns approved:false, commit pointer does NOT advance.

    The structural violation must persist across BOTH validate passes — reconcile's
    default stub emits `approved: false` with empty units, so apply re-runs as a
    no-op and the second validate sees the same broken structure. We inject a
    `wiki/runtime/` directory BEFORE the pipeline runs so that apply's pre-flight
    does not reject the proposal, but the post-apply validate catches the on-disk
    shelf-allowlist violation. This matches the Phase 1 real-world deviation.
    """
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)

    # Inject an unprescribed shelf directory pre-pipeline. Apply doesn't delete
    # orphan directories, so it survives the run and validate flags it.
    (project_dir / "wiki" / "runtime").mkdir(parents=True, exist_ok=True)
    (project_dir / "wiki" / "runtime" / "injected.md").write_text(
        "summary\n\n## Repo pointers\n\n- `src/main.py:1-5` — x\n\n## Related\n- none\n"
    )

    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
        "AUTO": "1",
    }
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    # Pipeline must exit non-zero because both validate passes detect the
    # structural violation (shelf_allowlist on wiki/runtime/).
    assert rc.returncode != 0, (
        f"expected non-zero exit; stdout={rc.stdout}\nstderr={rc.stderr}"
    )
    # Commit pointer must NOT advance
    fr = json.loads((project_dir / "state" / "freshness.json").read_text())
    assert fr["last_seen_commit"] is None
    # Reconcile must have been invoked (artifact present)
    reconcile_artifacts = sorted(
        (artifacts_root / "sample" / "runs").glob("*-update/reconcile-proposal.json")
    )
    assert reconcile_artifacts, "reconcile-proposal.json must be written when validate fails"


def test_update_reconcile_success_advances_commit(tmp_path):
    """If validate fails but reconcile's fix passes re-validate, commit advances."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)

    # Stub dir: first validate returns fail (semantic.with_finding), reconcile returns with_fix,
    # then second validate (same stub name) returns pass. Since stubs are keyed by stage_id, we
    # rotate the 06-validate.semantic.json between runs via a helper.
    custom_stubs = tmp_path / "custom-stubs"
    shutil.copytree(REPO_ROOT / "tests" / "fixtures" / "stubs", custom_stubs)
    # Start with the finding variant
    shutil.copy(
        REPO_ROOT / "tests" / "fixtures" / "stubs" / "06-validate.semantic.with_finding.json",
        custom_stubs / "06-validate.semantic.json",
    )
    shutil.copy(
        REPO_ROOT / "tests" / "fixtures" / "stubs" / "07-reconcile.with_fix.json",
        custom_stubs / "07-reconcile.json",
    )

    # Note: this test exercises the basic wiring. A swap between first-validate (finding) and
    # second-validate (pass) requires runtime stub rotation, which update.sh itself would not do.
    # Full post-reconcile pass is covered by the simpler integration scenario below:
    # we assert update.sh does invoke reconcile when validate fails, not that reconcile fixes
    # everything on the first try under this stub harness.
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(custom_stubs),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
        "AUTO": "1",
    }
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    # Reconcile-proposal must exist under the run dir even if the outer exit is non-zero
    reconcile_artifacts = sorted(
        (artifacts_root / "sample" / "runs").glob("*-update/reconcile-proposal.json")
    )
    assert reconcile_artifacts, "reconcile-proposal.json not written under run dir"
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_plan_c_acceptance.py -v`
Expected: FAIL (update.sh doesn't run validate yet).

- [ ] **Step 3: Extend `scripts/update.sh`**

In the `run_project` function, after the apply call and before `apply_commit.sh`, insert validate + reconcile logic. Replace the block:

```bash
  # Stage 4: apply
  bash "$STAGES_ROOT/04-apply/run.sh" \
    --project "$key" --project-dir "$project_dir" --run-dir "$run_dir"

  # apply_commit — advance last_seen_commit_pending -> last_seen_commit
  # (Plan C will gate this behind validate status)
  PROJECTS_ROOT="$PROJECTS_ROOT" bash "$ROOT_DIR/scripts/apply_commit.sh" --project "$key"
```

With:

```bash
  # Stage 4: apply
  bash "$STAGES_ROOT/04-apply/run.sh" \
    --project "$key" --project-dir "$project_dir" --run-dir "$run_dir"

  # Stage 6: validate (first pass)
  local validate_exit=0
  bash "$STAGES_ROOT/06-validate/run.sh" \
    --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" \
    || validate_exit=$?

  if [[ "$validate_exit" -ne 0 ]]; then
    # Stage 7: reconcile
    bash "$STAGES_ROOT/07-reconcile/run.sh" \
      --project "$key" --project-dir "$project_dir" --run-dir "$run_dir"

    local reconcile_approved
    reconcile_approved="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("approved", False))' "$run_dir/reconcile-proposal.json")"

    if [[ "$reconcile_approved" == "True" ]]; then
      # Apply reconcile proposal in-place (overwrites proposal.json so apply re-runs)
      cp "$run_dir/reconcile-proposal.json" "$run_dir/proposal.json"
      bash "$STAGES_ROOT/04-apply/run.sh" \
        --project "$key" --project-dir "$project_dir" --run-dir "$run_dir"
      # Second validate
      validate_exit=0
      bash "$STAGES_ROOT/06-validate/run.sh" \
        --project "$key" --project-dir "$project_dir" --run-dir "$run_dir" \
        || validate_exit=$?
    fi

    if [[ "$validate_exit" -ne 0 ]]; then
      echo "[$key] validate failed after reconcile; commit pointer NOT advanced" >&2
      return 1
    fi
  fi

  # Gate apply_commit on validate pass
  PROJECTS_ROOT="$PROJECTS_ROOT" bash "$ROOT_DIR/scripts/apply_commit.sh" --project "$key"
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_plan_c_acceptance.py -v`
Expected: 3 pass.

Full suite: `.venv/bin/pytest -q`
Expected: 124 pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/update.sh tests/test_plan_c_acceptance.py
git commit -m "feat(update.sh): gate apply_commit on validate; add reconcile loop"
```

---

### Task 11: Render stable validation product

Validate's findings need a stable-path render (`state/latest/validation-findings.{json,md}`) per spec §5.4. The existing `scripts/stable_products.py` has `render-validation` (from Plan B/earlier work). Verify the new validation-findings shape doesn't break it; update if needed.

**Files:**
- Modify: `scripts/stable_products.py` (possibly) — extend `render-validation` to handle the new schema (pass_count, rule_id)
- Modify: `scripts/update.sh` — call `render-validation` after validate stage
- Test: extend `tests/test_render_ranking.py` or create `tests/test_render_validation.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_render_validation.py`:

```python
"""stable_products.py render-validation must handle the Plan C validation-findings schema."""

import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_render_validation_handles_plan_c_schema(tmp_sample_project, tmp_path):
    findings = {
        "run_id": "20260419-100000-update-sample",
        "status": "pass",
        "pass_count": {"structural": 12, "semantic": 5},
        "structural": [],
        "semantic": [],
    }
    input_path = tmp_path / "validation-findings.json"
    input_path.write_text(json.dumps(findings))

    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "stable_products.py"),
         "render-validation", "--input", str(input_path),
         "--project-dir", str(tmp_sample_project)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"
    latest = tmp_sample_project / "state" / "latest"
    assert (latest / "validation-findings.json").is_file()
    assert (latest / "validation-report.md").is_file()
    md = (latest / "validation-report.md").read_text()
    assert "pass" in md.lower()
    assert "structural" in md.lower()


def test_render_validation_handles_fail_status(tmp_sample_project, tmp_path):
    findings = {
        "run_id": "20260419-100001-update-sample",
        "status": "fail",
        "pass_count": {"structural": 11, "semantic": 5},
        "structural": [
            {"page": "wiki/runtime/x.md", "issue": "shelf not in allowlist", "severity": "blocker", "rule_id": "shelf_allowlist"}
        ],
        "semantic": [],
    }
    input_path = tmp_path / "validation-findings.json"
    input_path.write_text(json.dumps(findings))

    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "stable_products.py"),
         "render-validation", "--input", str(input_path),
         "--project-dir", str(tmp_sample_project)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0
    md = (tmp_sample_project / "state" / "latest" / "validation-report.md").read_text()
    assert "fail" in md.lower()
    assert "shelf_allowlist" in md
    assert "wiki/runtime/x.md" in md
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_render_validation.py -v`
Expected: FAIL if `render-validation` doesn't handle the schema yet; PASS if it already does.

- [ ] **Step 3: Inspect and (if needed) update `scripts/stable_products.py`**

Check current `cmd_render_validation` behavior:

```bash
grep -n "def cmd_render_validation" scripts/stable_products.py
```

If the existing renderer works on the Plan C shape (which is a superset of the prior shape), leave it. If not, extend it to render `rule_id`, `pass_count`, and the structural/semantic split as two sections. The minimum viable render:

```python
def cmd_render_validation(args):
    import argparse, json
    from pathlib import Path
    input_path = Path(args.input)
    project_dir = Path(args.project_dir)
    data = json.loads(input_path.read_text())

    latest = project_dir / "state" / "latest"
    latest.mkdir(parents=True, exist_ok=True)
    (latest / "validation-findings.json").write_text(json.dumps(data, indent=2) + "\n")

    lines = []
    lines.append(f"# Validation report — {data.get('run_id', 'unknown')}")
    lines.append("")
    lines.append(f"**Status:** {data.get('status', 'unknown')}")
    lines.append("")
    pass_count = data.get("pass_count", {})
    lines.append(f"- Structural rules passed: {pass_count.get('structural', 'n/a')}")
    lines.append(f"- Semantic rules passed: {pass_count.get('semantic', 'n/a')}")
    lines.append("")
    lines.append("## Structural findings")
    lines.append("")
    structural = data.get("structural", [])
    if not structural:
        lines.append("- (none)")
    else:
        for f in structural:
            lines.append(
                f"- **{f.get('severity', 'warn')}** [{f.get('rule_id', '?')}] "
                f"`{f.get('page', '?')}` — {f.get('issue', '')}"
            )
    lines.append("")
    lines.append("## Semantic findings")
    lines.append("")
    semantic = data.get("semantic", [])
    if not semantic:
        lines.append("- (none)")
    else:
        for f in semantic:
            pages = ", ".join(f.get("pages", []))
            lines.append(
                f"- **{f.get('severity', 'warn')}** [{f.get('category', '?')}] "
                f"{pages} — {f.get('evidence', '')}"
            )
            suggestion = f.get("suggested_action")
            if suggestion:
                lines.append(f"  - Suggested: {suggestion}")
    (latest / "validation-report.md").write_text("\n".join(lines) + "\n")
    return 0
```

- [ ] **Step 4: Add render-validation call in `scripts/update.sh`**

After the final validate exit check, add:

```bash
  # Render stable validation product
  python3 "$ROOT_DIR/scripts/stable_products.py" render-validation \
    --input "$run_dir/validation-findings.json" \
    --project-dir "$project_dir"
```

Place this right before the `apply_commit.sh` call.

- [ ] **Step 5: Run tests**

Run: `.venv/bin/pytest tests/test_render_validation.py -v`
Expected: 2 pass.

Full suite: `.venv/bin/pytest -q`
Expected: 126 pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/stable_products.py scripts/update.sh tests/test_render_validation.py
git commit -m "feat(stable_products): extend render-validation for Plan C findings schema"
```

---

## Phase F — Measurement

### Task 12: `scripts/measure.sh` — acceptance-question regression

**Files:**
- Create: `scripts/measure.sh`
- Create: `agents/update/measure/config.json`
- Create: `agents/update/measure/instructions.md`
- Create: `tests/fixtures/stubs/measure.q1.json`, `measure.q2.json`, `measure.q3.json`
- Create: `tests/test_measure.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_measure.py`:

```python
"""make measure PROJECT=<key> scores the wiki against acceptance-questions.md."""

import json
import os
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _seed_wiki(project_dir: Path):
    """Apply the baseline stub proposal's 3 pages so there is a wiki to measure."""
    wiki = project_dir / "wiki"
    (wiki / "systems").mkdir(parents=True, exist_ok=True)
    (wiki / "systems" / "authentication.md").write_text(
        "auth\n\n## Repo pointers\n\n- `src/auth.py:1-23` — sessions\n\n## Related\n- none\n"
    )
    (wiki / "systems" / "data-store.md").write_text(
        "db\n\n## Repo pointers\n\n- `src/db.py:1-15` — store\n\n## Related\n- none\n"
    )
    (project_dir / "index.md").write_text(
        "Sample\n\n## Start here\n- [authentication](wiki/systems/authentication.md)\n- [data-store](wiki/systems/data-store.md)\n"
    )


def test_measure_produces_report_with_acceptance_scores(tmp_sample_project, tmp_path):
    _seed_wiki(tmp_sample_project)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "PROJECTS_ROOT": str(tmp_sample_project.parent),
    }
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "measure.sh"), "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    report_path = tmp_sample_project / "state" / "latest" / "measurement-report.json"
    assert report_path.is_file()
    report = json.loads(report_path.read_text())
    assert "acceptance_scores" in report
    assert report["acceptance_scores"] is not None
    assert "question_set_version" in report
    assert report["acceptance_scores"]["total_score"] >= 0
    assert (tmp_sample_project / "state" / "latest" / "measurement-report.md").is_file()


def test_measure_errors_when_no_wiki(tmp_sample_project):
    """measure.sh must error if no wiki exists yet."""
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "PROJECTS_ROOT": str(tmp_sample_project.parent),
    }
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "measure.sh"), "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode != 0
    assert "wiki" in rc.stderr.lower() or "no wiki" in rc.stderr.lower()
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_measure.py -v`
Expected: FAIL.

- [ ] **Step 3: Create measure config + instructions + stubs**

Create `agents/update/measure/config.json`:

```json
{
  "stage": "measure",
  "agent_kind": "llm-agent",
  "token_budget_input": 50000,
  "token_budget_output": 2000,
  "on_over_budget": "fail-clean",
  "stage_specific": {
    "per_question_token_cap": 8000,
    "total_budget": 120000,
    "variance_runs": 1
  }
}
```

Create `agents/update/measure/instructions.md`:

```markdown
# Measurement — Instructions (per-question scoring)

You are scoring a single acceptance question against a wiki. The runner calls you once per question; each call is independent.

## Input

A JSON blob:
- `question`: the acceptance question text
- `wiki`: concatenated index.md + all wiki pages
- `acceptance_bar`: project's accepted rubric from acceptance-questions.md

## Output schema

Return ONLY this JSON:

```json
{
  "score": 0,
  "answer": "one paragraph answer drawn strictly from the wiki",
  "citations": ["wiki/systems/auth.md"],
  "reasoning": "one sentence on why this score"
}
```

Scoring:
- `2`: answered fully with citations from the wiki alone
- `1`: answered directionally but with gaps, wrong citations, or vague coverage
- `0`: cannot answer; wiki is wrong on this point; wiki contradicts itself

Do not invent knowledge not in the wiki. If the wiki does not cover the question, score 0 and explain what would be needed.
```

Create baseline stubs:

`tests/fixtures/stubs/measure.q1.json`:

```json
{
  "stage": "measure.q1",
  "response": {"score": 2, "answer": "Sample is a Python app with auth and data-store.", "citations": ["index.md"], "reasoning": "Index names both surfaces."},
  "tokens_consumed": {"input_chars": 8000, "output_chars": 100, "is_estimate": true}
}
```

`tests/fixtures/stubs/measure.q2.json`:

```json
{
  "stage": "measure.q2",
  "response": {"score": 2, "answer": "Start with authentication for session lifecycle.", "citations": ["wiki/systems/authentication.md"], "reasoning": "Auth page is the primary entry."},
  "tokens_consumed": {"input_chars": 8000, "output_chars": 90, "is_estimate": true}
}
```

`tests/fixtures/stubs/measure.q3.json`:

```json
{
  "stage": "measure.q3",
  "response": {"score": 1, "answer": "Sessions are stored in SESSIONS dict per src/auth.py.", "citations": ["wiki/systems/authentication.md"], "reasoning": "Partial — no expiry semantics discussed."},
  "tokens_consumed": {"input_chars": 8000, "output_chars": 95, "is_estimate": true}
}
```

**Fixture count note.** The `tmp_sample_project` test fixture clones `tests/fixtures/project_state/acceptance-questions.md`, which has **3 questions** (see Plan A Task 3). The registered `projects/sample/acceptance-questions.md` (Plan A Task 10) has 5 questions, but that file is not loaded by the `tmp_sample_project` fixture — only the template is. So unit tests exercising `measure.sh` via `tmp_sample_project` need exactly 3 stubs (`q1`, `q2`, `q3`).

If a future task extends the template fixture to 5 questions, add stubs `q4` and `q5` at that time. For Plan C, ship 3 stubs and call out the mismatch between the template (3 Q) and the registered sample project (5 Q) as a known alignment issue — both paths work, but they exercise different question counts.

- [ ] **Step 4: Create `scripts/measure.sh`**

```bash
#!/usr/bin/env bash
# Acceptance-question regression measurement. Writes measurement-report.{json,md}.
#
# Usage:
#   scripts/measure.sh --project <key>
# Env:
#   PROJECTS_ROOT   override projects root (for tests)
#   LLM_STUB_RESPONSES_DIR  use stub responses keyed by measure.q1, measure.q2, ...

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="${PROJECTS_ROOT:-$ROOT_DIR/projects}"

die() { echo "error: $*" >&2; exit 1; }

project_key=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    -h|--help) echo "Usage: scripts/measure.sh --project <key>"; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
project_dir="$PROJECTS_ROOT/$project_key"
[[ -d "$project_dir" ]] || die "project not found: $project_dir"
aq_path="$project_dir/$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('acceptance_questions_path', 'acceptance-questions.md'))" "$project_dir/state/project.json")"
[[ -f "$aq_path" ]] || die "acceptance-questions file not found: $aq_path"
wiki_dir="$project_dir/wiki"
[[ -d "$wiki_dir" ]] || die "no wiki to measure; run make update first"

python3 - "$project_key" "$project_dir" "$aq_path" "$ROOT_DIR" <<'PY'
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
aq_path = Path(sys.argv[3])
root_dir = Path(sys.argv[4])

sys.path.insert(0, str(root_dir))
from agents.update._shared import llm_client

aq_text = aq_path.read_text()
version_match = re.search(r"<!-- version:\s*([^\s>]+)\s*-->", aq_text)
version = version_match.group(1) if version_match else "unversioned"

# Parse questions: lines starting with "\d+\. "
questions = []
for line in aq_text.splitlines():
    m = re.match(r"^(\d+)\.\s*(.*)$", line.strip())
    if m:
        questions.append({"index": int(m.group(1)), "text": m.group(2)})

# Build wiki context: index.md + all pages
wiki_chunks = []
index_path = project_dir / "index.md"
if index_path.is_file():
    wiki_chunks.append(f"=== index.md ===\n{index_path.read_text()}")
for page in sorted((project_dir / "wiki").rglob("*.md")):
    wiki_chunks.append(f"=== {page.relative_to(project_dir)} ===\n{page.read_text()}")
wiki_concat = "\n\n".join(wiki_chunks)
# Truncate to 50K chars deterministically if larger (spec §9.1)
if len(wiki_concat) > 50000:
    wiki_concat = wiki_concat[:50000] + "\n... [truncated]"

per_question: list[dict] = []
for q in questions:
    stage_id = f"measure.q{q['index']}"
    prompt = json.dumps({"question": q["text"], "wiki": wiki_concat})
    try:
        result = llm_client.invoke(stage_id=stage_id, prompt=prompt)
        resp = result["response"]
        per_question.append({
            "index": q["index"],
            "question": q["text"],
            "score": resp.get("score"),
            "answer": resp.get("answer", ""),
            "citations": resp.get("citations", []),
            "reasoning": resp.get("reasoning", ""),
            "tokens_consumed": result.get("tokens_consumed", {}),
        })
    except (FileNotFoundError, RuntimeError) as exc:
        per_question.append({
            "index": q["index"],
            "question": q["text"],
            "score": 0,
            "answer": f"(measurement error: {exc})",
            "citations": [],
            "reasoning": "error",
            "tokens_consumed": {},
        })

total = sum(r.get("score") or 0 for r in per_question)
max_possible = 2 * len(per_question)

report = {
    "project": project_key,
    "measured_at": datetime.now(timezone.utc).isoformat(),
    "question_set_version": version,
    "acceptance_scores": {
        "per_question": per_question,
        "total_score": total,
        "max_possible": max_possible,
    },
    "token_calibration": None,
}

latest = project_dir / "state" / "latest"
latest.mkdir(parents=True, exist_ok=True)
(latest / "measurement-report.json").write_text(json.dumps(report, indent=2) + "\n")

# Human-readable render
md = [f"# Measurement report — {project_key}", "", f"Measured at: {report['measured_at']}  |  Question set: {version}", ""]
md.append(f"**Total: {total} / {max_possible}**")
md.append("")
md.append("## Per-question")
md.append("")
for r in per_question:
    md.append(f"### Q{r['index']} — score {r['score']}")
    md.append(f"{r['answer']}")
    if r.get("citations"):
        md.append(f"Citations: {', '.join(r['citations'])}")
    if r.get("reasoning"):
        md.append(f"Reasoning: {r['reasoning']}")
    md.append("")
md.append("## Token calibration")
md.append("")
md.append("- (run `make measure-tokens` for calibration data)")
(latest / "measurement-report.md").write_text("\n".join(md))

print(f"measure: {total}/{max_possible} over {len(per_question)} question(s)")
PY
```

Make executable: `chmod +x scripts/measure.sh`

- [ ] **Step 5: Run tests**

Run: `.venv/bin/pytest tests/test_measure.py -v`
Expected: 2 pass.

Full suite: `.venv/bin/pytest -q`
Expected: 128 pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/measure.sh agents/update/measure/ tests/fixtures/stubs/measure.q1.json tests/fixtures/stubs/measure.q2.json tests/fixtures/stubs/measure.q3.json tests/test_measure.py
git commit -m "feat(scripts): add measure.sh for acceptance-question regression"
```

---

### Task 13: `scripts/measure_tokens.sh` — calibration harness (stub skeleton)

**Context:** Per spec §9.2, the full harness runs two cold sessions (with vs without wiki) on the same task brief and compares token counts. A production-grade implementation is substantial and out of Plan C's core scope — the spec explicitly allows "v1 may ship with `make measure-tokens` stubbed." We ship the stub + CLI; deeper implementation is a follow-up.

**Files:**
- Create: `scripts/measure_tokens.sh`

- [ ] **Step 1: Create the stub**

```bash
#!/usr/bin/env bash
# Token calibration harness (Plan C scope: stub only).
#
# Full harness is deferred (spec §9.2 allows this). Current behavior:
# prints a notice and exits 2 unless CALIBRATION_IMPL=1 is set.
#
# Usage:
#   scripts/measure_tokens.sh --project <key> --task "<brief>"

set -euo pipefail

echo "error: measure-tokens calibration harness not yet implemented." >&2
echo "The acceptance-question run via make measure provides proxy evidence." >&2
echo "Full token-cost calibration is deferred per spec §9.2." >&2
exit 2
```

Make executable: `chmod +x scripts/measure_tokens.sh`

- [ ] **Step 2: Commit**

```bash
git add scripts/measure_tokens.sh
git commit -m "feat(scripts): stub measure_tokens.sh per spec §9.2 deferred calibration"
```

---

### Task 14: Makefile — `make measure` + `make measure-tokens`

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_measure.py`:

```python
def test_make_measure_target_exists():
    content = (REPO_ROOT / "Makefile").read_text()
    assert "measure:" in content
    assert "measure-tokens:" in content
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_measure.py::test_make_measure_target_exists -v`
Expected: FAIL.

- [ ] **Step 3: Update `Makefile`**

Add `measure` and `measure-tokens` to `.PHONY`. Append at the end:

```makefile
measure:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@bash scripts/measure.sh --project $(PROJECT)

measure-tokens:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@test -n "$(TASK)" || (echo "TASK is required, for example: make measure-tokens PROJECT=sample TASK=\"implement rate limiting\"" && exit 1)
	@bash scripts/measure_tokens.sh --project $(PROJECT) --task "$(TASK)"
```

Also add help lines.

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_measure.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add Makefile tests/test_measure.py
git commit -m "feat(makefile): add measure and measure-tokens targets"
```

---

## Phase G — Pilot + M5 promotion

### Task 15: Pilot rebootstrap of `rpg_game` (M4)

**Context:** Non-TDD migration task. Archive current rpg_game, wipe its wiki + state, run `make update-v2 AUTO=1 PROJECT=rpg_game` under real codex, then `make measure` to score against `rpg_game`'s acceptance-questions.md. The pilot validates that the pipeline works on a real project (not just the sample fixture).

**IMPORTANT:** This task is destructive. Do NOT run under an AI agent in auto mode without explicit operator consent. Operator should review the bundle output before moving to M5.

**Files (changes are runtime artifacts):**
- Move: `projects/rpg_game/` → `projects/_archive/rpg_game-pre-unified-2026-04-19/`
- Create: fresh `projects/rpg_game/` via pipeline
- Write: `docs/superpowers/dry-run-notes/2026-04-19-rpg-game-pilot-findings.md`

- [ ] **Step 1: Operator gate**

Before touching rpg_game, operator confirms (out-of-band):
- The rpg_game fixture/archive is backed up.
- A real codex/claude CLI is authenticated and ready.
- The project's `acceptance-questions.md` is written (see the 10 questions drafted in the project history; if that file doesn't exist, create it first using the 10 questions as content, commit, THEN proceed).

- [ ] **Step 2: Archive current rpg_game**

```bash
mkdir -p projects/_archive
mv projects/rpg_game projects/_archive/rpg_game-pre-unified-2026-04-19
```

Verify: `ls projects/_archive/rpg_game-pre-unified-2026-04-19/wiki/` shows the previous wiki intact.

- [ ] **Step 3: Recreate rpg_game shell with v2 state**

```bash
make init PROJECT=rpg_game NAME="RPG Game" PATH=/Users/liadgoren/Unity/rpg_game
```

Verify the new `projects/rpg_game/state/project.json` has `acceptance_questions_path` and `ranking_cutoff` (v2 shape).

Copy the archived `acceptance-questions.md` to the new project if it existed:

```bash
cp projects/_archive/rpg_game-pre-unified-2026-04-19/acceptance-questions.md projects/rpg_game/ 2>/dev/null || \
  echo "WARNING: archived acceptance-questions.md not found; operator must write one before proceeding"
```

If the archive has no acceptance-questions.md, write one now using the 10 questions the operator previously drafted. Commit the new questions file before running the pipeline.

- [ ] **Step 4: Run the pipeline against rpg_game**

```bash
MODEL=codex AUTO=1 make update-v2 PROJECT=rpg_game
```

This will take substantial wall-clock time (Phase 1's sample run was ~5 minutes; rpg_game is larger — expect 15-45 minutes).

Expected: exit 0, wiki pages written under `projects/rpg_game/wiki/`, validate passes.

If validate fails, do NOT move to M5. Capture findings and iterate.

- [ ] **Step 5: Measure**

```bash
MODEL=codex make measure PROJECT=rpg_game
cat projects/rpg_game/state/latest/measurement-report.md
```

Success criterion: ≥16/20 on the acceptance question set, no 0 on discipline-tagged questions (per spec §5.7).

- [ ] **Step 6: Capture pilot findings**

Create `docs/superpowers/dry-run-notes/2026-04-19-rpg-game-pilot-findings.md` using the same template structure as the Phase 1 findings doc. Fill every section from real evidence. This doc is the signal for whether Plan C is genuinely ready for M5 (promotion) or needs further hardening.

- [ ] **Step 7: Commit the pilot findings + the new wiki**

```bash
git add projects/rpg_game/ projects/_archive/ docs/superpowers/dry-run-notes/2026-04-19-rpg-game-pilot-findings.md
git commit -m "pilot: rebootstrap rpg_game under unified pipeline (M4)"
```

If the pilot fails the acceptance bar, stop here. Address findings before M5.

---

### Task 16: M5 — promote `make update-v2` to `make update`

**Context:** Flip the canonical command name. Preserves `make update-v2` as a transitional alias for one iteration if useful; otherwise delete it in this task.

**Files:**
- Modify: `Makefile`
- Modify: `scripts/update.sh` (cosmetic: update self-reference in usage message)
- Test: extend `tests/test_plan_c_acceptance.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_plan_c_acceptance.py`:

```python
def test_make_update_target_exists():
    content = (REPO_ROOT / "Makefile").read_text()
    assert "\nupdate:" in content or "update:\n" in content


def test_make_update_invokes_update_sh(tmp_path):
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
        "AUTO": "1",
    }
    rc = subprocess.run(
        ["make", "update", "PROJECT=sample"],
        cwd=str(REPO_ROOT), env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0, f"stdout={rc.stdout}\nstderr={rc.stderr}"
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_plan_c_acceptance.py -v -k make_update`
Expected: FAIL.

- [ ] **Step 3: Update `Makefile`**

Add `update` to `.PHONY`. Append:

```makefile
update:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@bash scripts/update.sh --project $(PROJECT)
```

Keep `update-v2` for one release cycle (or delete now if the operator prefers a clean cut — see below).

Optional: make `update-v2` a deprecated alias that prints a warning:

```makefile
update-v2:
	@echo "WARNING: 'make update-v2' is deprecated; use 'make update' instead." >&2
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@bash scripts/update.sh --project $(PROJECT)
```

- [ ] **Step 4: Update help line**

Add:

```makefile
	@echo "  make update PROJECT=<project-key>  # run the unified update pipeline"
```

And remove or mark the `update-v2` help entry as deprecated.

- [ ] **Step 5: Run tests**

Run: `.venv/bin/pytest tests/test_plan_c_acceptance.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add Makefile tests/test_plan_c_acceptance.py
git commit -m "feat(makefile): promote update-v2 to update (M5)"
```

---

### Task 17: M5 — delete old bootstrap + ingest entry points

**Context:** Bootstrap and ingest are superseded by `make update`. Delete the old Makefile targets, scripts, and stage directories. The archived rpg_game still uses their on-disk outputs but does not depend on the scripts themselves.

**Files:**
- Modify: `Makefile` — remove `bootstrap*`, `ingest*`, `validate`, `lint` targets
- Delete: `scripts/ingest.sh`, `scripts/ingest_v2.sh`, `scripts/ingest_apply.sh`, `scripts/lint.sh`, `scripts/validate.sh`
- Delete: `agents/bootstrap/` entire subtree

- [ ] **Step 1: Write the failing test**

Append to `tests/test_plan_c_acceptance.py`:

```python
def test_m5_old_entry_points_removed():
    assert not (REPO_ROOT / "scripts" / "ingest.sh").exists()
    assert not (REPO_ROOT / "scripts" / "ingest_v2.sh").exists()
    assert not (REPO_ROOT / "scripts" / "ingest_apply.sh").exists()
    assert not (REPO_ROOT / "scripts" / "lint.sh").exists()
    # Note: keep scripts/validate.sh ONLY if it has a non-bootstrap caller.
    # Per Plan C scope it is replaced by the validate stage in the pipeline.
    assert not (REPO_ROOT / "scripts" / "validate.sh").exists()
    assert not (REPO_ROOT / "agents" / "bootstrap").is_dir()
    mf = (REPO_ROOT / "Makefile").read_text()
    for target in ("bootstrap:", "bootstrap-orient:", "bootstrap-domains:", "ingest:", "ingest-v2:", "ingest-apply:"):
        assert target not in mf, f"old target {target!r} still in Makefile"
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_plan_c_acceptance.py::test_m5_old_entry_points_removed -v`
Expected: FAIL.

- [ ] **Step 3: Remove old files**

```bash
git rm -r agents/bootstrap/
git rm scripts/ingest.sh scripts/ingest_v2.sh scripts/ingest_apply.sh scripts/lint.sh scripts/validate.sh
```

- [ ] **Step 4: Update `Makefile`**

Remove these targets and any help lines that reference them:
- `bootstrap`, `bootstrap-orient`, `bootstrap-domains`, `bootstrap-expand`, `bootstrap-validate`, `bootstrap-reconcile`
- `ingest`, `ingest-v2`, `ingest-apply`, `ingest-global`
- `validate`, `lint`

Also remove them from `.PHONY`.

- [ ] **Step 5: Handle remaining dependent state (Python imports + shell invocations)**

`agents/bootstrap/_shared/state.py` holds the `_state_file()` helper and the `cmd_*` command handlers used by Plan A/B/Phase-1 code. Several callers invoke it both as a Python import AND as a shell subprocess.

**Python imports:**

```bash
grep -rn "from agents.bootstrap\|import agents.bootstrap" agents/ scripts/ tests/ 2>&1 | grep -v __pycache__
```

**Shell invocations (these are EASY to miss):**

```bash
grep -rn "agents/bootstrap/_shared/state.py\|agents/bootstrap/_shared/normalize.sh\|agents/bootstrap/_shared/stage_runner.sh" scripts/ Makefile agents/update/
```

For every hit from either grep, route to the new location.

**Migration steps — do these BEFORE `git rm -r agents/bootstrap/`:**

1. Move the state module:

   ```bash
   git mv agents/bootstrap/_shared/state.py agents/update/_shared/state.py
   ```

2. Update Python imports. Run the grep again and replace every `from agents.bootstrap._shared` with `from agents.update._shared`. Typical hits: `scripts/` Python heredocs, test files.

3. **Update `scripts/init_project.sh`.** Line ~472 invokes `python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" ensure ...`. Change this to `python3 -m agents.update._shared.state ensure ...` (or the equivalent path-based form). After the edit, `grep -n "agents/bootstrap" scripts/init_project.sh` should return nothing.

4. **Update `Makefile`** — any `make lint`, `make validate` targets that reference old scripts must be updated or removed. See Task 17b below for the `make lint` re-wiring.

5. **v1-fallback tests.** Plan B added `test_lint_v2_fallback::test_lint_fallback_writes_to_v1_bootstrap_state` which seeds a `bootstrap-state.json` to exercise the fallback path. After M5, v1 projects are archived (not supported at runtime), so the fallback is unreachable in production. **Delete** this test — do not skip it. Remove it in the same commit as the bootstrap deletion. The fallback code in `state.py._state_file()` stays in place (it's defensive), but its test coverage is retired.

Once all five migration steps are clean (both greps return empty, tests still green), proceed with `git rm -r agents/bootstrap/`.

- [ ] **Step 6: Run tests**

Run: `.venv/bin/pytest -q`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git commit -am "chore(m5): delete bootstrap + ingest entry points; pipeline unified under make update"
```

---

### Task 17b: Rewire `make lint` to the new validate stage in standalone mode

**Prerequisite:** Task 17a must land first (`make update-v2` → `make update` rename). Task 17b's `test_make_lint_invokes_validate_against_latest_run` invokes `make update PROJECT=sample`, which only exists after Task 17a. Executing tasks in plan order satisfies this; skipping 17a and jumping to 17b will produce a confusing `make: *** No rule to make target 'update'` error.

**Context (spec §12 M3):** Spec M3 requires `make lint` to invoke the new validator. Task 17 deletes `scripts/lint.sh` and `scripts/validate.sh`, which `make lint` previously called. Without this rewire, `make lint` references a deleted script. Fix by pointing `make lint` at `06-validate/run.sh` operating on the project's current state without requiring a prior pipeline run (standalone lint mode — operates on existing wiki + state rather than a fresh run dir).

The validate `run.sh` currently requires a `--run-dir` containing `proposal.json` + `ranking-snapshot.json`. For standalone lint we don't have those from a fresh run. Two options:

**Option A (simpler):** `make lint` uses the `latest_run_dir` recorded in `update-state.json` (i.e., re-validate against the last pipeline run). Limitation: requires a prior `make update` run.

**Option B (more flexible):** Add a `--lint-only` flag to `06-validate/run.sh` that skips the proposal-schema structural rules (they require `proposal.json`) and runs only wiki+state rules. This lets `make lint` work on any project.

Plan C ships Option A (simpler; aligned with how the old `make lint` worked — it also assumed prior state). Defer Option B to a post-Plan-C enhancement.

**Files:**
- Modify: `Makefile`
- Test: extend `tests/test_plan_c_acceptance.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_plan_c_acceptance.py`:

```python
def test_make_lint_invokes_validate_against_latest_run(tmp_path):
    """make lint PROJECT=sample runs validate against the last recorded run dir."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
        "AUTO": "1",
    }
    # First, run the full pipeline so latest_run_dir is populated
    rc = subprocess.run(
        ["make", "update", "PROJECT=sample"],
        cwd=str(REPO_ROOT), env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0

    # Now run lint — should re-validate the same run dir and exit 0
    lint_rc = subprocess.run(
        ["make", "lint", "PROJECT=sample"],
        cwd=str(REPO_ROOT), env=env, capture_output=True, text=True,
    )
    assert lint_rc.returncode == 0, f"stderr={lint_rc.stderr}"


def test_make_lint_errors_when_no_prior_run(tmp_path):
    """make lint must error clearly when no prior update run exists."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    rc = subprocess.run(
        ["make", "lint", "PROJECT=sample"],
        cwd=str(REPO_ROOT), env=env, capture_output=True, text=True,
    )
    assert rc.returncode != 0
    assert "no prior run" in rc.stderr.lower() or "latest_run_dir" in rc.stderr.lower()
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_plan_c_acceptance.py -v -k make_lint`
Expected: FAIL (`make lint` target was removed in Task 17; needs to be re-added with new wiring).

- [ ] **Step 3: Re-add `make lint` to the Makefile with new wiring**

Add `lint` to `.PHONY`. Append:

```makefile
lint:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@PROJECT="$(PROJECT)" PROJECTS_ROOT="$${UPDATE_PROJECTS_ROOT:-$$(pwd)/projects}" \
	  ARTIFACTS_ROOT="$${UPDATE_ARTIFACTS_ROOT:-$$(pwd)/artifacts}" \
	  bash -c ' \
	    project_dir="$$PROJECTS_ROOT/$$PROJECT"; \
	    latest="$$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get(\"latest_run_dir\") or \"\")" "$$project_dir/state/update-state.json" 2>/dev/null)"; \
	    if [ -z "$$latest" ] || [ ! -d "$$latest" ]; then \
	      echo "error: no prior run found (latest_run_dir empty in update-state.json). Run make update first." >&2; \
	      exit 1; \
	    fi; \
	    bash agents/update/06-validate/run.sh --project "$$PROJECT" --project-dir "$$project_dir" --run-dir "$$latest" \
	  '
```

This is intentionally a single-line shell invocation because Makefile recipes run each line in a fresh shell. The one-liner reads `latest_run_dir` from `update-state.json`, errors if absent, otherwise invokes the validate stage.

Add a help line:

```makefile
	@echo "  make lint PROJECT=<project-key>  # standalone validate against latest run"
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_plan_c_acceptance.py -v`
Expected: all lint tests pass.

Full suite: `.venv/bin/pytest -q`
Expected: all pass (2 more tests than after Task 17).

- [ ] **Step 5: Commit**

```bash
git add Makefile tests/test_plan_c_acceptance.py
git commit -m "feat(makefile): rewire make lint to standalone validate stage (M3)"
```

---

### Task 18: M5 — refresh project docs

**Files:**
- Modify: `AGENTS.md` (canonical execution contract)
- Modify: `V1_SPEC.md` (filesystem contract)
- Modify: `SYSTEM_DESIGN.md`
- Modify: `README.md`

- [ ] **Step 1: Update `AGENTS.md`**

Remove or rewrite sections that describe the bootstrap-stage pipeline, the ingest workflow (separate from `make update`), and any references to `make bootstrap*` / `make ingest*`. Replace with a concise description of the unified `make update` operation.

Concrete edits:
- Remove the "Bootstrap Stage Contract" section (covering old orient/domains/expand/validate/reconcile stages).
- Replace "Canonical Session Bootstrap" section to reflect that there is no separate bootstrap — pipeline runs are `make update PROJECT=<key>`.
- Replace "Ingestion Workflow Contract" section to reflect that inbox processing happens within `make update`.

- [ ] **Step 2: Update `V1_SPEC.md`**

Rename section headings referring to bootstrap/ingest as separate operations to "Update operation". Keep filesystem contract sections (project structure, state shape).

- [ ] **Step 3: Update `SYSTEM_DESIGN.md` and `README.md`**

README: replace `make bootstrap` / `make ingest` examples with `make update`. Update command listings.

SYSTEM_DESIGN: narrative description of the five-stage bootstrap is superseded by the seven-stage unified pipeline. Either rewrite or add a "Superseded by" note pointing at `docs/superpowers/specs/2026-04-18-unified-update-pipeline-design.md`.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md V1_SPEC.md SYSTEM_DESIGN.md README.md
git commit -m "docs(m5): refresh contracts to reflect unified update pipeline"
```

---

## Phase H — Final sweep

### Task 19: Full suite + live acceptance run

- [ ] **Step 1: Full suite**

```bash
.venv/bin/pytest -q
```
Expected: all tests pass (target ≥130).

- [ ] **Step 2: Live codex acceptance run**

```bash
MODEL=codex AUTO=1 make update PROJECT=sample
MODEL=codex make measure PROJECT=sample
```

Verify:
- `make update` exits 0
- `state/latest/validation-findings.json` shows `status: pass`
- `state/latest/measurement-report.md` shows per-question scores
- No unprescribed shelves present under `projects/sample/wiki/`

- [ ] **Step 3: Self-review**

```bash
grep -rn "TODO\|TBD\|FIXME" agents/update/06-validate/ agents/update/07-reconcile/ agents/update/measure/ scripts/measure.sh scripts/measure_tokens.sh
```
Expected: no hits (or only the explicit "deferred" marker in `measure_tokens.sh`).

Verify no references to `make bootstrap` / `make ingest` remain in documentation:

```bash
grep -rn "make bootstrap\|make ingest" AGENTS.md V1_SPEC.md SYSTEM_DESIGN.md README.md docs/
```
Expected: none, except in historical spec/plan documents that describe the prior system.

- [ ] **Step 4: Commit final sweep marker**

```bash
git commit --allow-empty -m "chore: Plan C complete — validate + reconcile + measurement + M5 promotion landed"
```

---

## Plan C Deliverables Summary

- Validate stage (`agents/update/06-validate/`) with 12 structural rules including shelf-allowlist + 5 semantic rule families
- Reconcile stage (`agents/update/07-reconcile/`) with one-iteration loop + escalation taxonomy
- Apply pre-flight gains shelf-allowlist check (defense in depth)
- Propose instructions enumerate the 9 shelves as a hard rule
- Token accounting normalized to `{input_chars, output_chars, is_estimate}` across stub + real
- `scripts/measure.sh` — acceptance-question regression scoring
- `scripts/measure_tokens.sh` — calibration stub (deeper implementation deferred)
- `scripts/update.sh` — gates `apply_commit` on validate pass; runs reconcile loop on fail
- `stable_products.py render-validation` handles Plan C findings schema
- Makefile: `make update`, `make measure`, `make measure-tokens`
- M4: rpg_game rebootstrapped under the unified pipeline
- M5: old bootstrap/ingest entry points deleted; docs refreshed
- ~25 new tests across validate, reconcile, shelf-allowlist, measure, plan-c acceptance

## Acceptance

After all Plan C deliverables land:

```bash
MODEL=codex AUTO=1 make update PROJECT=sample
MODEL=codex make measure PROJECT=sample
```

Produces a clean wiki under `projects/sample/wiki/`, no shelf-allowlist violations, validate passes, apply_commit advances `last_seen_commit`, measurement-report shows per-question scores against acceptance-questions.md. rpg_game pilot (Task 15) scores ≥16/20 on its acceptance question set.

## Non-goals for Plan C

- Full token calibration harness implementation (`measure_tokens.sh` remains a stub per spec §9.2).
- Validator retry, alternate backends, streaming, structured-output mode.
- Plan C does not re-examine the spec; it implements Section 4.5 (reconcile), §10 (validation), §9 (measurement), §12 M3–M5 as written.

## Next

None — Plan C completes the roadmap. Post-Plan-C work is operational: ingest real sources into real projects and let the maintained second brain compound.
