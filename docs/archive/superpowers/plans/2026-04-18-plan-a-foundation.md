# Plan A — Foundation Implementation Plan

**Status:** Ready for Development (revision 3, audit passed after 3 iterations)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the foundation layer of the unified update pipeline — sense and impact stages, shared helpers, state-migration tooling, test fixtures, and the `make update-v2` entry point — such that `make update-v2 PROJECT=sample` runs sense + impact and produces valid `sense-report.json`, `ranking-snapshot.json`, and `impact-report.json`.

**Architecture:** Two new agent stages (`01-sense`, `02-impact`) under `agents/update/`, each with `config.json`, `instructions.md`, and `run.sh`. Two shared Python helpers under `agents/update/_shared/`: `config.py` for config precedence and `llm_client.py` for stub-aware LLM invocation. A forward/reverse state migration script pair. A registered test project at `projects/sample/` backed by fixtures under `tests/fixtures/`. The `scripts/update.sh` pipeline entry wires the two stages; the Makefile exposes `update-v2` as the target.

**Tech Stack:** Bash scripts with embedded Python 3 heredocs (consistent with existing agent patterns), Python 3.13, pytest, JSON state files, Markdown artifacts. LLM invocation via existing `codex` / `claude` CLI patterns. Stub mechanism via `LLM_STUB_RESPONSES_DIR` environment variable.

**Source spec:** `docs/superpowers/specs/2026-04-18-unified-update-pipeline-design.md` (revision 4, audit-passed)

**Plan scope:** M1 of the migration plan. Plans B and C are separate documents.

---

## File Structure

### New files to create

**Test fixtures:**
- `tests/fixtures/sample_repo/README.md`
- `tests/fixtures/sample_repo/pyproject.toml`
- `tests/fixtures/sample_repo/src/auth.py`
- `tests/fixtures/sample_repo/src/db.py`
- `tests/fixtures/sample_repo/src/main.py`
- `tests/fixtures/sample_repo/docs/architecture.md`
- `tests/fixtures/sample_repo/.git/` — real git repo initialized with 3 commits
- `tests/fixtures/project_state/state/project.json`
- `tests/fixtures/project_state/state/pages.json`
- `tests/fixtures/project_state/state/sources.json`
- `tests/fixtures/project_state/state/relationships.json`
- `tests/fixtures/project_state/state/freshness.json`
- `tests/fixtures/project_state/state/update-state.json`
- `tests/fixtures/project_state/acceptance-questions.md`
- `tests/fixtures/stubs/01-sense.classifier.json`
- `tests/fixtures/stubs/02-impact.ranking.json`
- `tests/fixtures/stubs/02-impact.delta.json`

**Registered test project:**
- `projects/sample/state/project.json`
- `projects/sample/state/pages.json`
- `projects/sample/state/sources.json`
- `projects/sample/state/relationships.json`
- `projects/sample/state/freshness.json`
- `projects/sample/state/update-state.json`
- `projects/sample/state/latest/.gitkeep`
- `projects/sample/acceptance-questions.md`
- `projects/sample/index.md`
- `projects/sample/changelog.md`
- `projects/sample/inbox/.gitkeep`

**Shared Python helpers:**
- `agents/update/_shared/__init__.py`
- `agents/update/_shared/config.py`
- `agents/update/_shared/llm_client.py`

**Stage directories:**
- `agents/update/01-sense/config.json`
- `agents/update/01-sense/instructions.md`
- `agents/update/01-sense/run.sh`
- `agents/update/02-impact/config.json`
- `agents/update/02-impact/instructions.md`
- `agents/update/02-impact/run.sh`

**Pipeline entry:**
- `scripts/update.sh`
- `scripts/migrate_state_v1_to_v2.sh`
- `scripts/migrate_state_v2_to_v1.sh`
- `scripts/validate_stage_configs.py`

**Tests:**
- `tests/test_config_precedence.py`
- `tests/test_llm_client_stub.py`
- `tests/test_validate_stage_configs.py`
- `tests/test_update_sense.py`
- `tests/test_update_impact.py`
- `tests/test_state_migration.py`
- `tests/test_render_ranking.py`
- `tests/test_plan_a_acceptance.py`

### Files to modify

- `tests/conftest.py` — add `tmp_sample_project` fixture
- `scripts/stable_products.py` — add `render-ranking` subcommand
- `Makefile` — add `update-v2` target

---

## Task Sequence

Tasks are grouped by dependency. Each task follows TDD (test → fail → implement → pass → commit). Commit after each passing task.

---

### Task 1: Create `tests/fixtures/sample_repo/` with source files

**Files:**
- Create: `tests/fixtures/sample_repo/README.md`
- Create: `tests/fixtures/sample_repo/pyproject.toml`
- Create: `tests/fixtures/sample_repo/src/auth.py`
- Create: `tests/fixtures/sample_repo/src/db.py`
- Create: `tests/fixtures/sample_repo/src/main.py`
- Create: `tests/fixtures/sample_repo/docs/architecture.md`

**TDD note:** This task is pure test-infrastructure scaffolding (creating fixture source files with no logic). No failing test precedes it because its output has no behavior to assert against — the behavior checks arrive in Task 2 (git history) and Task 4 (fixture loading via conftest). This task is explicitly exempt from the failing-test-first rule.

- [ ] **Step 1: Create the sample repo source files**

Create `tests/fixtures/sample_repo/README.md`:

```markdown
# Sample Repo

A minimal Python application used as a test fixture for the llm-wiki unified update pipeline.

## Structure

- `src/auth.py` — login/logout session handling
- `src/db.py` — database access layer
- `src/main.py` — entry point

## Running

```
python -m src.main
```
```

Create `tests/fixtures/sample_repo/pyproject.toml`:

```toml
[project]
name = "sample"
version = "0.1.0"
requires-python = ">=3.11"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

Create `tests/fixtures/sample_repo/src/auth.py`:

```python
"""Session authentication helpers."""

import time

SESSIONS = {}


def login(username: str, token: str) -> str:
    """Create a session and return its id."""
    session_id = f"{username}-{int(time.time())}"
    SESSIONS[session_id] = {"username": username, "token": token}
    return session_id


def logout(session_id: str) -> bool:
    """Invalidate a session. Returns True if it existed."""
    return SESSIONS.pop(session_id, None) is not None


def whoami(session_id: str) -> str | None:
    """Return the username for a session, or None."""
    entry = SESSIONS.get(session_id)
    return entry["username"] if entry else None
```

Create `tests/fixtures/sample_repo/src/db.py`:

```python
"""Minimal in-memory DB layer."""

_STORE: dict[str, dict] = {}


def put(key: str, value: dict) -> None:
    _STORE[key] = value


def get(key: str) -> dict | None:
    return _STORE.get(key)


def delete(key: str) -> bool:
    return _STORE.pop(key, None) is not None
```

Create `tests/fixtures/sample_repo/src/main.py`:

```python
"""Sample app entry point."""

from src import auth, db


def main() -> None:
    session = auth.login("alice", "tok")
    db.put("hello", {"user": auth.whoami(session)})
    print(db.get("hello"))


if __name__ == "__main__":
    main()
```

Create `tests/fixtures/sample_repo/docs/architecture.md`:

```markdown
# Architecture

Two layers:

- `src/auth.py` — session layer, owns `SESSIONS` dict
- `src/db.py` — storage layer, owns `_STORE` dict

`src/main.py` wires them via simple imports.
```

- [ ] **Step 2: Verify files exist**

Run: `ls -R tests/fixtures/sample_repo/`
Expected: README.md, pyproject.toml, src/ (3 .py files), docs/ (architecture.md)

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/sample_repo/
git commit -m "test(fixtures): add sample_repo source files"
```

---

### Task 2: Initialize git history in `tests/fixtures/sample_repo/`

**Files:**
- Create: `tests/fixtures/sample_repo/.git/` (via git init)

- [ ] **Step 1: Write the failing test**

Create `tests/test_state_migration.py` stub for this task's assertion (we'll expand it in later tasks):

```python
import subprocess
from pathlib import Path


def test_sample_repo_has_git_history():
    """Sample fixture must be a real git repo with >= 3 commits."""
    repo_path = Path(__file__).parent / "fixtures" / "sample_repo"
    assert (repo_path / ".git").is_dir(), "sample_repo/.git missing"
    result = subprocess.run(
        ["git", "-C", str(repo_path), "log", "--oneline"],
        capture_output=True,
        text=True,
        check=True,
    )
    commits = [line for line in result.stdout.splitlines() if line.strip()]
    assert len(commits) >= 3, f"expected >=3 commits, got {len(commits)}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_state_migration.py::test_sample_repo_has_git_history -v`
Expected: FAIL with "sample_repo/.git missing"

- [ ] **Step 3: Initialize git history**

```bash
cd tests/fixtures/sample_repo
git init -q
git config user.email "test@fixture.local"
git config user.name "Fixture Author"

# Commit 1: README + pyproject
git add README.md pyproject.toml
git commit -q -m "chore: initialize project"

# Commit 2: src/
git add src/
git commit -q -m "feat: add auth, db, and main modules"

# Commit 3: docs/
git add docs/
git commit -q -m "docs: add architecture overview"

cd ../../..
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_state_migration.py::test_sample_repo_has_git_history -v`
Expected: PASS

- [ ] **Step 5: Commit (include .git/ contents)**

```bash
# We intentionally DO commit the .git dir as a fixture.
# .gitignore may block nested .git — force-add if needed.
git add -f tests/fixtures/sample_repo/.git
git add tests/test_state_migration.py
git commit -m "test(fixtures): initialize git history in sample_repo"
```

Note: if `.gitignore` blocks the nested `.git`, add an explicit negation rule in `.gitignore`: `!tests/fixtures/sample_repo/.git`. Verify the commit captured all `.git` content by running `git log -1 --stat | grep -c "tests/fixtures/sample_repo/.git"` and confirming the number is >10.

---

### Task 3: Create `tests/fixtures/project_state/` template

**Files:**
- Create: `tests/fixtures/project_state/state/project.json`
- Create: `tests/fixtures/project_state/state/pages.json`
- Create: `tests/fixtures/project_state/state/sources.json`
- Create: `tests/fixtures/project_state/state/relationships.json`
- Create: `tests/fixtures/project_state/state/freshness.json`
- Create: `tests/fixtures/project_state/state/update-state.json`
- Create: `tests/fixtures/project_state/acceptance-questions.md`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_state_migration.py`:

```python
import json


def test_project_state_template_is_complete():
    template_dir = Path(__file__).parent / "fixtures" / "project_state"
    assert (template_dir / "state" / "project.json").is_file()
    assert (template_dir / "state" / "pages.json").is_file()
    assert (template_dir / "state" / "sources.json").is_file()
    assert (template_dir / "state" / "relationships.json").is_file()
    assert (template_dir / "state" / "freshness.json").is_file()
    assert (template_dir / "state" / "update-state.json").is_file()
    assert (template_dir / "acceptance-questions.md").is_file()

    # freshness.json must have all v2 fields
    freshness = json.loads((template_dir / "state" / "freshness.json").read_text())
    assert "last_seen_commit" in freshness
    assert "last_seen_commit_pending" in freshness
    assert "last_update_at" in freshness

    # project.json must have v2 fields and not bootstrap_focuses
    project = json.loads((template_dir / "state" / "project.json").read_text())
    assert "acceptance_questions_path" in project
    assert "ranking_cutoff" in project
    assert "bootstrap_focuses" not in project
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_state_migration.py::test_project_state_template_is_complete -v`
Expected: FAIL

- [ ] **Step 3: Create the template state files**

Create `tests/fixtures/project_state/state/project.json`:

```json
{
  "key": "__template__",
  "name": "Template",
  "repo_paths": [],
  "tags": [],
  "entry_pages": ["index.md"],
  "related_concepts": [],
  "ignored_paths": [],
  "acceptance_questions_path": "acceptance-questions.md",
  "ranking_cutoff": 20
}
```

Create `tests/fixtures/project_state/state/pages.json`:

```json
{"pages": []}
```

Create `tests/fixtures/project_state/state/sources.json`:

```json
{"sources": []}
```

Create `tests/fixtures/project_state/state/relationships.json`:

```json
{"relationships": []}
```

Create `tests/fixtures/project_state/state/freshness.json`:

```json
{
  "last_seen_commit": null,
  "last_seen_commit_pending": null,
  "last_update_at": null,
  "changed_paths": [],
  "impacted_pages": [],
  "status": "unknown",
  "updated_at": null
}
```

Create `tests/fixtures/project_state/state/update-state.json`:

```json
{
  "project": "__template__",
  "latest_run_dir": null,
  "last_completed_stage": null,
  "latest_validation_findings": null,
  "latest_lint_findings": null,
  "latest_ingest_findings": null,
  "stages": {
    "sense": {"status": "pending", "last_run_dir": null, "last_completed_at": null, "summary_file": null},
    "impact": {"status": "pending", "last_run_dir": null, "last_completed_at": null, "summary_file": null},
    "propose": {"status": "pending", "last_run_dir": null, "last_completed_at": null, "summary_file": null},
    "apply": {"status": "pending", "last_run_dir": null, "last_completed_at": null, "summary_file": null},
    "validate": {"status": "pending", "last_run_dir": null, "last_completed_at": null, "summary_file": null},
    "reconcile": {"status": "pending", "last_run_dir": null, "last_completed_at": null, "summary_file": null}
  }
}
```

Create `tests/fixtures/project_state/acceptance-questions.md`:

```markdown
# Acceptance Questions — Template

<!-- version: 0.1 -->

Questions a cold LLM session should be able to answer from the wiki alone.

1. [discipline] What is this project and what are its major surfaces?
2. [discipline] What should a new agent read first?
3. How does the auth module work?

## Scoring

- 2: full answer with citations from wiki alone
- 1: directional but incomplete or uncited
- 0: can't answer; wrong; wiki contradicts itself

## Acceptance bar

- Total ≥ 4/6
- No zero on [discipline]-tagged questions
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_state_migration.py::test_project_state_template_is_complete -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/project_state/ tests/test_state_migration.py
git commit -m "test(fixtures): add v2 project state template"
```

---

### Task 4: Update `conftest.py` with `tmp_sample_project` fixture

**Files:**
- Modify: `tests/conftest.py`
- Test: `tests/test_state_migration.py`

- [ ] **Step 1: Read the existing conftest.py to understand the existing fixture**

Run: `cat tests/conftest.py`
Note the existing `tmp_project` fixture so the new fixture can coexist.

- [ ] **Step 2: Write the failing test**

Add to `tests/test_state_migration.py`:

```python
def test_tmp_sample_project_fixture_clones_template(tmp_sample_project):
    """tmp_sample_project must clone fixtures into a writable tmp path with v2 state."""
    assert (tmp_sample_project / "state" / "project.json").is_file()
    assert (tmp_sample_project / "state" / "freshness.json").is_file()
    assert (tmp_sample_project / "acceptance-questions.md").is_file()
    project = json.loads((tmp_sample_project / "state" / "project.json").read_text())
    assert project["key"] == "sample"
    assert project["ranking_cutoff"] == 20
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_state_migration.py::test_tmp_sample_project_fixture_clones_template -v`
Expected: FAIL with "fixture 'tmp_sample_project' not found"

- [ ] **Step 4: Add fixture to conftest.py**

The existing `tests/conftest.py` already has `from __future__ import annotations`, `import json`, `from pathlib import Path`, `import pytest`, and a `tmp_project` fixture. Do **not** re-add those imports.

Insert ONLY one new import line — `import shutil` — after the existing `import json` line (line 3 of the current file).

Then append the two new fixtures at the end of the file (after the existing `tmp_project` fixture's closing line):

```python


FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def tmp_sample_project(tmp_path: Path) -> Path:
    """Clone project_state template into tmp and register it as 'sample'.

    Returns the project dir path. The sample_repo fixture is not copied here;
    tests that need a repo target should create it separately or use
    tmp_sample_project_with_repo.
    """
    proj = tmp_path / "projects" / "sample"
    shutil.copytree(FIXTURES / "project_state", proj)
    # Customize project.json to be the 'sample' project
    pj = json.loads((proj / "state" / "project.json").read_text())
    pj["key"] = "sample"
    pj["name"] = "Sample"
    (proj / "state" / "project.json").write_text(json.dumps(pj, indent=2))
    # Ensure the canonical project subtree exists (matches real project shape)
    (proj / "inbox").mkdir(exist_ok=True)
    (proj / "state" / "latest").mkdir(exist_ok=True)
    for shelf in ("architecture", "systems", "modules", "integrations",
                  "decisions", "runbooks", "sessions", "glossary", "open-questions"):
        (proj / "wiki" / shelf).mkdir(parents=True, exist_ok=True)
    return proj


@pytest.fixture
def tmp_sample_project_with_repo(tmp_sample_project: Path, tmp_path: Path) -> Path:
    """tmp_sample_project with sample_repo copied in and registered in repo_paths."""
    repo_src = FIXTURES / "sample_repo"
    repo_dst = tmp_path / "sample_repo"
    shutil.copytree(repo_src, repo_dst)
    pj = json.loads((tmp_sample_project / "state" / "project.json").read_text())
    pj["repo_paths"] = [str(repo_dst)]
    (tmp_sample_project / "state" / "project.json").write_text(json.dumps(pj, indent=2))
    return tmp_sample_project
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_state_migration.py -v`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/conftest.py tests/test_state_migration.py
git commit -m "test(conftest): add tmp_sample_project fixtures for v2 pipeline"
```

---

### Task 5: Implement `agents/update/_shared/config.py` (config precedence)

**Files:**
- Create: `agents/update/_shared/__init__.py`
- Create: `agents/update/_shared/config.py`
- Test: `tests/test_config_precedence.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_config_precedence.py`:

```python
"""Tests for agents/update/_shared/config.py precedence logic.

Precedence: env var > project.json override > config.json default.
"""

import json
import os
from pathlib import Path

import pytest


def _import_config():
    import sys
    repo_root = Path(__file__).parent.parent
    sys.path.insert(0, str(repo_root))
    from agents.update._shared import config as config_module
    return config_module


def test_default_from_config_json(tmp_path):
    config_module = _import_config()
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps({
        "stage": "impact",
        "agent_kind": "llm-agent",
        "token_budget_input": 40000,
        "token_budget_output": 8000,
        "on_over_budget": "fail-clean",
        "stage_specific": {"ranking_cutoff": 20}
    }))
    value = config_module.resolve(
        config_path=config_path,
        project_config_path=None,
        env_override_name=None,
        key_path="stage_specific.ranking_cutoff",
    )
    assert value == 20


def test_project_overrides_config(tmp_path):
    config_module = _import_config()
    config_path = tmp_path / "config.json"
    project_path = tmp_path / "project.json"
    config_path.write_text(json.dumps({"stage_specific": {"ranking_cutoff": 20}}))
    project_path.write_text(json.dumps({"ranking_cutoff": 5}))
    value = config_module.resolve(
        config_path=config_path,
        project_config_path=project_path,
        env_override_name=None,
        key_path="stage_specific.ranking_cutoff",
        project_key="ranking_cutoff",
    )
    assert value == 5


def test_env_overrides_project(tmp_path, monkeypatch):
    config_module = _import_config()
    config_path = tmp_path / "config.json"
    project_path = tmp_path / "project.json"
    config_path.write_text(json.dumps({"stage_specific": {"ranking_cutoff": 20}}))
    project_path.write_text(json.dumps({"ranking_cutoff": 5}))
    monkeypatch.setenv("RANKING_CUTOFF", "100")
    value = config_module.resolve(
        config_path=config_path,
        project_config_path=project_path,
        env_override_name="RANKING_CUTOFF",
        key_path="stage_specific.ranking_cutoff",
        project_key="ranking_cutoff",
        value_type=int,
    )
    assert value == 100


def test_missing_config_raises(tmp_path):
    config_module = _import_config()
    with pytest.raises(FileNotFoundError):
        config_module.resolve(
            config_path=tmp_path / "nope.json",
            project_config_path=None,
            env_override_name=None,
            key_path="stage_specific.x",
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_config_precedence.py -v`
Expected: FAIL with ModuleNotFoundError or ImportError.

- [ ] **Step 3: Implement config.py**

Create `agents/update/_shared/__init__.py`:

```python
"""Shared helpers for update pipeline stages."""
```

Create `agents/update/_shared/config.py`:

```python
"""Config precedence resolver for update pipeline stages.

Precedence (highest to lowest):
1. Environment variable override (if env_override_name is set)
2. Project-level override in project.json (if project_key is set)
3. Default in stage's config.json (at key_path)

Raises FileNotFoundError if config_path is missing.
Raises KeyError if key_path not found in config and no override provides a value.
"""

import json
import os
from pathlib import Path
from typing import Any


def _dig(data: dict, key_path: str) -> Any:
    """Walk a dotted key path into a nested dict. Raise KeyError on miss."""
    node = data
    for part in key_path.split("."):
        if not isinstance(node, dict) or part not in node:
            raise KeyError(f"key path '{key_path}' not in config")
        node = node[part]
    return node


def resolve(
    *,
    config_path: Path,
    project_config_path: Path | None,
    env_override_name: str | None,
    key_path: str,
    project_key: str | None = None,
    value_type: type = None,
) -> Any:
    """Resolve a config value honoring env > project > stage-default precedence."""
    if env_override_name:
        env_val = os.environ.get(env_override_name)
        if env_val is not None and env_val != "":
            return value_type(env_val) if value_type else env_val

    if project_config_path and project_key and project_config_path.is_file():
        project_data = json.loads(project_config_path.read_text())
        if project_key in project_data and project_data[project_key] is not None:
            return project_data[project_key]

    if not config_path.is_file():
        raise FileNotFoundError(f"stage config missing: {config_path}")
    config_data = json.loads(config_path.read_text())
    return _dig(config_data, key_path)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_config_precedence.py -v`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add agents/update/_shared/ tests/test_config_precedence.py
git commit -m "feat(update/_shared): add config precedence resolver"
```

---

### Task 6: Implement `agents/update/_shared/llm_client.py` (stub-aware LLM helper)

**Files:**
- Create: `agents/update/_shared/llm_client.py`
- Test: `tests/test_llm_client_stub.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_llm_client_stub.py`:

```python
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
        "response": {"source_kind_hint": "spec", "confidence": "high"},
        "tokens_consumed": {"input": 100, "output": 10}
    }))
    monkeypatch.setenv("LLM_STUB_RESPONSES_DIR", str(stub_dir))
    result = llm_client.invoke(
        stage_id="01-sense.classifier",
        prompt="anything",
    )
    assert result["response"] == {"source_kind_hint": "spec", "confidence": "high"}
    assert result["tokens_consumed"] == {"input": 100, "output": 10}


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_llm_client_stub.py -v`
Expected: FAIL (ImportError).

- [ ] **Step 3: Implement llm_client.py**

Create `agents/update/_shared/llm_client.py`:

```python
"""LLM client with stub-aware invocation.

When LLM_STUB_RESPONSES_DIR env var is set, returns canned responses from
<stub-dir>/<stage_id>.json. When unset, calls the real LLM endpoint.

Stub file schema:
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


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def invoke(*, stage_id: str, prompt: str, model: str = "codex") -> dict[str, Any]:
    """Invoke LLM (or return stub). Returns dict with response + tokens_consumed."""
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

    # Real LLM path. Minimal implementation — Plans B/C will expand.
    # For Plan A, this path is only taken in integration tests that explicitly
    # enable live LLM; unit tests always use stubs.
    raise NotImplementedError(
        f"Real LLM invocation for {stage_id} not yet wired; "
        "set LLM_STUB_RESPONSES_DIR for tests."
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_llm_client_stub.py -v`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add agents/update/_shared/llm_client.py tests/test_llm_client_stub.py
git commit -m "feat(update/_shared): add stub-aware LLM client"
```

---

### Task 7: Implement `scripts/validate_stage_configs.py`

**Files:**
- Create: `scripts/validate_stage_configs.py`
- Test: `tests/test_validate_stage_configs.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_validate_stage_configs.py`:

```python
"""Validates that every agents/update/<stage>/config.json has required fields."""

import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_all_present_configs_pass(tmp_path):
    """Run validator against a tmp dir with all-valid configs. Must exit 0."""
    stages_root = tmp_path / "agents" / "update"
    (stages_root / "01-sense").mkdir(parents=True)
    (stages_root / "01-sense" / "config.json").write_text(json.dumps({
        "stage": "sense",
        "agent_kind": "script+classifier",
        "token_budget_input": 4000,
        "token_budget_output": 500,
        "on_over_budget": "fail-clean",
        "stage_specific": {"inbox_filename_patterns": {}}
    }))
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "validate_stage_configs.py"),
         "--stages-root", str(stages_root)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"


def test_missing_required_field_fails(tmp_path):
    stages_root = tmp_path / "agents" / "update"
    (stages_root / "02-impact").mkdir(parents=True)
    (stages_root / "02-impact" / "config.json").write_text(json.dumps({
        "stage": "impact",
        "agent_kind": "llm-agent"
        # missing token_budget_*, on_over_budget, stage_specific
    }))
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "validate_stage_configs.py"),
         "--stages-root", str(stages_root)],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert "token_budget_input" in result.stderr or "token_budget_input" in result.stdout


def test_no_configs_found_fails(tmp_path):
    stages_root = tmp_path / "agents" / "update"
    stages_root.mkdir(parents=True)
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "validate_stage_configs.py"),
         "--stages-root", str(stages_root)],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py -v`
Expected: FAIL — scripts/validate_stage_configs.py doesn't exist.

- [ ] **Step 3: Implement validate_stage_configs.py**

Create `scripts/validate_stage_configs.py`:

```python
#!/usr/bin/env python3
"""Validate that every agents/update/<stage>/config.json has the required shape.

Exits 0 on success. On failure, prints offending stage + field to stderr and
exits non-zero.

Called by scripts/update.sh at pipeline entry (before invoking any stage).
"""

import argparse
import json
import sys
from pathlib import Path


REQUIRED_KEYS = {
    "stage",
    "agent_kind",
    "token_budget_input",
    "token_budget_output",
    "on_over_budget",
    "stage_specific",
}

VALID_AGENT_KINDS = {"script-only", "script+classifier", "llm-agent"}
VALID_OVER_BUDGET = {"fail-clean"}


def validate_config(path: Path) -> list[str]:
    """Return list of error strings for this config. Empty list = valid."""
    errors: list[str] = []
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        return [f"{path}: invalid JSON: {exc}"]

    for key in REQUIRED_KEYS:
        if key not in data:
            errors.append(f"{path}: missing required field '{key}'")

    if "agent_kind" in data and data["agent_kind"] not in VALID_AGENT_KINDS:
        errors.append(
            f"{path}: agent_kind '{data['agent_kind']}' "
            f"not in {sorted(VALID_AGENT_KINDS)}"
        )

    if "on_over_budget" in data and data["on_over_budget"] not in VALID_OVER_BUDGET:
        errors.append(
            f"{path}: on_over_budget '{data['on_over_budget']}' "
            f"not in {sorted(VALID_OVER_BUDGET)}"
        )

    for budget in ("token_budget_input", "token_budget_output"):
        if budget in data and not isinstance(data[budget], int):
            errors.append(f"{path}: {budget} must be an integer")

    if "stage_specific" in data and not isinstance(data["stage_specific"], dict):
        errors.append(f"{path}: stage_specific must be an object")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stages-root", required=True)
    args = parser.parse_args()
    root = Path(args.stages_root)
    configs = sorted(root.glob("*/config.json"))
    if not configs:
        print(f"error: no configs found under {root}", file=sys.stderr)
        return 2

    all_errors: list[str] = []
    for config in configs:
        all_errors.extend(validate_config(config))

    if all_errors:
        for err in all_errors:
            print(err, file=sys.stderr)
        return 1

    print(f"validated {len(configs)} stage config(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Make executable:

```bash
chmod +x scripts/validate_stage_configs.py
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py -v`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/validate_stage_configs.py tests/test_validate_stage_configs.py
git commit -m "feat(scripts): add validate_stage_configs.py"
```

---

### Task 8: Implement `scripts/migrate_state_v1_to_v2.sh` (forward migration)

**Files:**
- Create: `scripts/migrate_state_v1_to_v2.sh`
- Test: `tests/test_state_migration.py` (extend)

- [ ] **Step 1: Write the failing test**

Add to `tests/test_state_migration.py`:

```python
import os
import subprocess


REPO_ROOT = Path(__file__).parent.parent


def test_migrate_v1_to_v2_renames_bootstrap_state(tmp_path):
    """Given a v1 project with bootstrap-state.json, migrate creates update-state.json."""
    proj = tmp_path / "projects" / "mini"
    (proj / "state").mkdir(parents=True)
    (proj / "state" / "bootstrap-state.json").write_text(json.dumps({
        "project": "mini",
        "stages": {"orient": {"status": "completed"}},
    }))
    (proj / "state" / "project.json").write_text(json.dumps({
        "key": "mini",
        "name": "Mini",
        "repo_paths": [],
        "bootstrap_focuses": ["auth", "combat"],
        "entry_pages": ["index.md"],
    }))
    (proj / "state" / "freshness.json").write_text(json.dumps({
        "status": "unknown"
    }))

    result = subprocess.run(
        [str(REPO_ROOT / "scripts" / "migrate_state_v1_to_v2.sh")],
        env={**os.environ, "PROJECTS_ROOT": str(tmp_path / "projects"), "PROJECT": "mini"},
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"

    assert (proj / "state" / "update-state.json").is_file()
    assert not (proj / "state" / "bootstrap-state.json").is_file()

    # project.json updated: new fields added, bootstrap_focuses removed
    pj = json.loads((proj / "state" / "project.json").read_text())
    assert "bootstrap_focuses" not in pj
    assert pj["acceptance_questions_path"] == "acceptance-questions.md"
    assert pj["ranking_cutoff"] == 20

    # Archived focuses
    archive = proj / ".migration-hints" / "bootstrap-focuses-archive.md"
    assert archive.is_file()
    assert "auth" in archive.read_text()
    assert "combat" in archive.read_text()

    # freshness.json has new fields
    f = json.loads((proj / "state" / "freshness.json").read_text())
    assert "last_seen_commit" in f
    assert "last_seen_commit_pending" in f
    assert "last_update_at" in f
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_state_migration.py::test_migrate_v1_to_v2_renames_bootstrap_state -v`
Expected: FAIL (script missing).

- [ ] **Step 3: Implement migrate_state_v1_to_v2.sh**

Create `scripts/migrate_state_v1_to_v2.sh`:

```bash
#!/usr/bin/env bash
# Forward migration: v1 state -> v2 state.
#
# Operations:
#   - bootstrap-state.json -> update-state.json (rename + schema update)
#   - project.json: remove bootstrap_focuses, add acceptance_questions_path + ranking_cutoff
#   - freshness.json: add last_seen_commit, last_seen_commit_pending, last_update_at fields
#   - bootstrap_focuses values archived to .migration-hints/bootstrap-focuses-archive.md
#
# Usage:
#   PROJECT=<key> scripts/migrate_state_v1_to_v2.sh
#   (optional) PROJECTS_ROOT=<path>  defaults to $ROOT_DIR/projects

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="${PROJECTS_ROOT:-$ROOT_DIR/projects}"
PROJECT="${PROJECT:?PROJECT is required}"

PROJ_DIR="$PROJECTS_ROOT/$PROJECT"
[[ -d "$PROJ_DIR" ]] || { echo "error: project not found: $PROJ_DIR" >&2; exit 1; }

python3 - "$PROJ_DIR" <<'PY'
import json
import sys
from pathlib import Path
from datetime import datetime, timezone

proj = Path(sys.argv[1])
state = proj / "state"

# --- bootstrap-state.json -> update-state.json ---
bs = state / "bootstrap-state.json"
us = state / "update-state.json"
if bs.is_file():
    data = json.loads(bs.read_text())
    # Ensure new v2 shape: stages dict with all six stages
    required_stages = ["sense", "impact", "propose", "apply", "validate", "reconcile"]
    stages = {}
    for s in required_stages:
        stages[s] = {
            "status": "pending",
            "last_run_dir": None,
            "last_completed_at": None,
            "summary_file": None,
        }
    data["stages"] = stages
    data.setdefault("latest_run_dir", None)
    data.setdefault("last_completed_stage", None)
    data.setdefault("latest_validation_findings", None)
    data.setdefault("latest_lint_findings", None)
    data.setdefault("latest_ingest_findings", None)
    us.write_text(json.dumps(data, indent=2) + "\n")
    bs.unlink()
    print(f"migrated: {bs.name} -> {us.name}", file=sys.stderr)

# --- project.json: drop bootstrap_focuses, add new fields ---
pj_path = state / "project.json"
if pj_path.is_file():
    pj = json.loads(pj_path.read_text())
    focuses = pj.pop("bootstrap_focuses", None)
    pj.setdefault("acceptance_questions_path", "acceptance-questions.md")
    pj.setdefault("ranking_cutoff", 20)
    pj_path.write_text(json.dumps(pj, indent=2) + "\n")

    if focuses:
        hints_dir = proj / ".migration-hints"
        hints_dir.mkdir(exist_ok=True)
        archive = hints_dir / "bootstrap-focuses-archive.md"
        archive.write_text(
            "# Archived bootstrap_focuses\n\n"
            "These values were present in the v1 project.json and were archived\n"
            "when the project migrated to v2 state. Consider re-expressing any that\n"
            "still matter as entries in `acceptance-questions.md`.\n\n"
            + "\n".join(f"- {f}" for f in focuses) + "\n"
        )
        print(
            f"warning: {len(focuses)} bootstrap_focuses entries archived; "
            f"review {archive.relative_to(proj)} and port to acceptance-questions.md as needed.",
            file=sys.stderr,
        )

# --- freshness.json: ensure new fields ---
fp = state / "freshness.json"
if fp.is_file():
    f = json.loads(fp.read_text())
    f.setdefault("last_seen_commit", None)
    f.setdefault("last_seen_commit_pending", None)
    f.setdefault("last_update_at", None)
    f.setdefault("changed_paths", [])
    f.setdefault("impacted_pages", [])
    fp.write_text(json.dumps(f, indent=2) + "\n")

print("v1 -> v2 migration complete")
PY
```

Make executable:

```bash
chmod +x scripts/migrate_state_v1_to_v2.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_state_migration.py -v`
Expected: All state migration tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate_state_v1_to_v2.sh tests/test_state_migration.py
git commit -m "feat(scripts): add v1 to v2 state migration"
```

---

### Task 9: Implement `scripts/migrate_state_v2_to_v1.sh` (reverse migration)

**Files:**
- Create: `scripts/migrate_state_v2_to_v1.sh`
- Test: extend `tests/test_state_migration.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_state_migration.py`:

```python
def test_migrate_v2_to_v1_is_reverse(tmp_path):
    """Reverse migration restores v1 shape: rename file, restore bootstrap_focuses."""
    proj = tmp_path / "projects" / "mini2"
    (proj / "state").mkdir(parents=True)
    (proj / ".migration-hints").mkdir()
    (proj / "state" / "update-state.json").write_text(json.dumps({
        "project": "mini2",
        "stages": {"sense": {"status": "pending"}}
    }))
    (proj / "state" / "project.json").write_text(json.dumps({
        "key": "mini2",
        "acceptance_questions_path": "acceptance-questions.md",
        "ranking_cutoff": 20,
        "entry_pages": ["index.md"],
    }))
    (proj / "state" / "freshness.json").write_text(json.dumps({
        "last_seen_commit": "abc",
        "last_seen_commit_pending": None,
        "last_update_at": "2026-04-18T00:00:00Z",
    }))
    (proj / ".migration-hints" / "bootstrap-focuses-archive.md").write_text(
        "# Archived bootstrap_focuses\n\n- auth\n- combat\n"
    )

    result = subprocess.run(
        [str(REPO_ROOT / "scripts" / "migrate_state_v2_to_v1.sh")],
        env={**os.environ, "PROJECTS_ROOT": str(tmp_path / "projects"), "PROJECT": "mini2"},
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"
    assert (proj / "state" / "bootstrap-state.json").is_file()
    assert not (proj / "state" / "update-state.json").is_file()
    pj = json.loads((proj / "state" / "project.json").read_text())
    assert pj["bootstrap_focuses"] == ["auth", "combat"]
    assert "acceptance_questions_path" not in pj
    assert "ranking_cutoff" not in pj
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_state_migration.py::test_migrate_v2_to_v1_is_reverse -v`
Expected: FAIL.

- [ ] **Step 3: Implement migrate_state_v2_to_v1.sh**

Create `scripts/migrate_state_v2_to_v1.sh`:

```bash
#!/usr/bin/env bash
# Reverse migration: v2 state -> v1 state. Used for rollback.
#
# Operations:
#   - update-state.json -> bootstrap-state.json (rename only; schema unchanged)
#   - project.json: restore bootstrap_focuses from .migration-hints/ if present,
#     remove acceptance_questions_path and ranking_cutoff
#   - freshness.json: remove v2-only fields (keep best-effort legacy shape)
#
# Usage:
#   PROJECT=<key> scripts/migrate_state_v2_to_v1.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="${PROJECTS_ROOT:-$ROOT_DIR/projects}"
PROJECT="${PROJECT:?PROJECT is required}"

PROJ_DIR="$PROJECTS_ROOT/$PROJECT"
[[ -d "$PROJ_DIR" ]] || { echo "error: project not found: $PROJ_DIR" >&2; exit 1; }

python3 - "$PROJ_DIR" <<'PY'
import json
import sys
import re
from pathlib import Path

proj = Path(sys.argv[1])
state = proj / "state"

us = state / "update-state.json"
bs = state / "bootstrap-state.json"
if us.is_file():
    data = json.loads(us.read_text())
    bs.write_text(json.dumps(data, indent=2) + "\n")
    us.unlink()

pj_path = state / "project.json"
if pj_path.is_file():
    pj = json.loads(pj_path.read_text())
    pj.pop("acceptance_questions_path", None)
    pj.pop("ranking_cutoff", None)
    archive = proj / ".migration-hints" / "bootstrap-focuses-archive.md"
    if archive.is_file():
        focuses = [m.group(1) for m in re.finditer(r"^- (.+)$", archive.read_text(), re.M)]
        if focuses:
            pj["bootstrap_focuses"] = focuses
    pj_path.write_text(json.dumps(pj, indent=2) + "\n")

fp = state / "freshness.json"
if fp.is_file():
    f = json.loads(fp.read_text())
    f.pop("last_seen_commit_pending", None)
    fp.write_text(json.dumps(f, indent=2) + "\n")

print("v2 -> v1 reverse migration complete")
PY
```

Make executable:

```bash
chmod +x scripts/migrate_state_v2_to_v1.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_state_migration.py -v`
Expected: All state migration tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate_state_v2_to_v1.sh tests/test_state_migration.py
git commit -m "feat(scripts): add v2 to v1 reverse migration"
```

---

### Task 10: Register `projects/sample/` as a canonical test project

**Files:**
- Create: `projects/sample/state/project.json`
- Create: `projects/sample/state/pages.json`
- Create: `projects/sample/state/sources.json`
- Create: `projects/sample/state/relationships.json`
- Create: `projects/sample/state/freshness.json`
- Create: `projects/sample/state/update-state.json`
- Create: `projects/sample/state/latest/.gitkeep`
- Create: `projects/sample/acceptance-questions.md`
- Create: `projects/sample/index.md`
- Create: `projects/sample/changelog.md`
- Create: `projects/sample/inbox/.gitkeep`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_state_migration.py`:

```python
def test_sample_project_registered():
    """projects/sample/ must exist with v2 state and point to fixture repo."""
    sample = REPO_ROOT / "projects" / "sample"
    assert (sample / "state" / "project.json").is_file()
    assert (sample / "state" / "update-state.json").is_file()
    assert (sample / "state" / "freshness.json").is_file()
    assert (sample / "acceptance-questions.md").is_file()
    assert (sample / "inbox").is_dir()

    pj = json.loads((sample / "state" / "project.json").read_text())
    assert pj["key"] == "sample"
    assert pj["ranking_cutoff"] == 20
    assert pj["repo_paths"], "repo_paths must be non-empty"
    # repo_paths should point at the fixture
    assert any("tests/fixtures/sample_repo" in p for p in pj["repo_paths"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_state_migration.py::test_sample_project_registered -v`
Expected: FAIL.

- [ ] **Step 3: Create the sample project files**

Create `projects/sample/state/project.json`:

```json
{
  "key": "sample",
  "name": "Sample",
  "repo_paths": ["tests/fixtures/sample_repo"],
  "tags": ["test-fixture"],
  "entry_pages": ["index.md"],
  "related_concepts": [],
  "ignored_paths": [".git", "__pycache__"],
  "acceptance_questions_path": "acceptance-questions.md",
  "ranking_cutoff": 20
}
```

Create `projects/sample/state/pages.json`:

```json
{"pages": []}
```

Create `projects/sample/state/sources.json`:

```json
{"sources": []}
```

Create `projects/sample/state/relationships.json`:

```json
{"relationships": []}
```

Create `projects/sample/state/freshness.json`:

```json
{
  "last_seen_commit": null,
  "last_seen_commit_pending": null,
  "last_update_at": null,
  "changed_paths": [],
  "impacted_pages": [],
  "status": "unknown",
  "updated_at": null
}
```

Create `projects/sample/state/update-state.json`:

```json
{
  "project": "sample",
  "latest_run_dir": null,
  "last_completed_stage": null,
  "latest_validation_findings": null,
  "latest_lint_findings": null,
  "latest_ingest_findings": null,
  "stages": {
    "sense": {"status": "pending", "last_run_dir": null, "last_completed_at": null, "summary_file": null},
    "impact": {"status": "pending", "last_run_dir": null, "last_completed_at": null, "summary_file": null},
    "propose": {"status": "pending", "last_run_dir": null, "last_completed_at": null, "summary_file": null},
    "apply": {"status": "pending", "last_run_dir": null, "last_completed_at": null, "summary_file": null},
    "validate": {"status": "pending", "last_run_dir": null, "last_completed_at": null, "summary_file": null},
    "reconcile": {"status": "pending", "last_run_dir": null, "last_completed_at": null, "summary_file": null}
  }
}
```

Create `projects/sample/state/latest/.gitkeep`: (empty file)

Create `projects/sample/acceptance-questions.md`:

```markdown
# Acceptance Questions — Sample

<!-- version: 0.1 -->

Questions a cold LLM session should be able to answer from the wiki alone.

1. [discipline] What is this project and what are its major modules?
2. [discipline] Where should a new agent start reading?
3. How does session authentication work?
4. Where is data stored?
5. What is the entry point of the application?

## Scoring

- 2: full answer with citations from wiki alone
- 1: directional but incomplete or uncited
- 0: can't answer; wrong; wiki contradicts itself

## Acceptance bar

- Total ≥ 8/10
- No zero on [discipline]-tagged questions
```

Create `projects/sample/index.md`:

```markdown
Sample project — placeholder index awaiting first make update-v2 run.
```

Create `projects/sample/changelog.md`:

```markdown
# Changelog — Sample

## [2026-04-18] init — Plan A sample project registration
```

Create `projects/sample/inbox/.gitkeep`: (empty file)

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_state_migration.py::test_sample_project_registered -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add projects/sample/
git commit -m "test(projects): register sample project with v2 state"
```

---

### Task 11: Create `tests/fixtures/stubs/` baseline LLM stub responses

**Files:**
- Create: `tests/fixtures/stubs/01-sense.classifier.json`
- Create: `tests/fixtures/stubs/02-impact.ranking.json`
- Create: `tests/fixtures/stubs/02-impact.delta.json`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_llm_client_stub.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_llm_client_stub.py::test_baseline_stubs_present_and_valid -v`
Expected: FAIL.

- [ ] **Step 3: Create baseline stubs**

Create `tests/fixtures/stubs/01-sense.classifier.json`:

```json
{
  "stage": "01-sense.classifier",
  "response": {
    "classifications": [
      {"path": "projects/sample/inbox/note.md", "source_kind_hint": "session-note", "confidence": "medium", "classification_reasoning": "file extension .md in inbox; no strong signal"}
    ]
  },
  "tokens_consumed": {"input": 200, "output": 30}
}
```

Create `tests/fixtures/stubs/02-impact.ranking.json`:

```json
{
  "stage": "02-impact.ranking",
  "response": {
    "cutoff": 20,
    "ranked_domains": [
      {
        "rank": 1,
        "domain": "authentication",
        "score": 0.85,
        "signals": ["A", "B", "C"],
        "signal_a_evidence": ["README.md:6-14", "docs/architecture.md:3-5"],
        "signal_b_evidence": ["src/auth.py", "src/main.py:6-10"],
        "signal_c_reasoning": "Owns session lifecycle; referenced from main.py entry point"
      },
      {
        "rank": 2,
        "domain": "data-store",
        "score": 0.70,
        "signals": ["A", "B"],
        "signal_a_evidence": ["docs/architecture.md:5-6"],
        "signal_b_evidence": ["src/db.py"],
        "signal_c_reasoning": "Distinct storage layer consumed by entry point"
      },
      {
        "rank": 3,
        "domain": "entry-point",
        "score": 0.60,
        "signals": ["A", "B"],
        "signal_a_evidence": ["README.md:14-16"],
        "signal_b_evidence": ["src/main.py"],
        "signal_c_reasoning": "Application entry; wires auth + db"
      }
    ]
  },
  "tokens_consumed": {"input": 4500, "output": 600}
}
```

Create `tests/fixtures/stubs/02-impact.delta.json`:

```json
{
  "stage": "02-impact.delta",
  "response": {
    "affected_pages": [],
    "new_domains": [
      {"name": "authentication", "evidence": ["src/auth.py"], "signal_sources": ["A", "B"], "ranking_inclusion": "top-20"},
      {"name": "data-store", "evidence": ["src/db.py"], "signal_sources": ["A", "B"], "ranking_inclusion": "top-20"},
      {"name": "entry-point", "evidence": ["src/main.py"], "signal_sources": ["A", "B"], "ranking_inclusion": "top-20"}
    ],
    "stale_pages": []
  },
  "tokens_consumed": {"input": 3000, "output": 400}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_llm_client_stub.py -v`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/stubs/ tests/test_llm_client_stub.py
git commit -m "test(fixtures): add baseline LLM stubs for sense and impact"
```

---

### Task 12: Implement `agents/update/01-sense/config.json` + `instructions.md`

**Files:**
- Create: `agents/update/01-sense/config.json`
- Create: `agents/update/01-sense/instructions.md`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_validate_stage_configs.py`:

```python
def test_real_sense_config_validates():
    """The real sense config must pass validation."""
    stages_root = REPO_ROOT / "agents" / "update"
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "validate_stage_configs.py"),
         "--stages-root", str(stages_root)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py::test_real_sense_config_validates -v`
Expected: FAIL (no configs yet under agents/update/).

- [ ] **Step 3: Create sense config + instructions**

Create `agents/update/01-sense/config.json`:

```json
{
  "stage": "sense",
  "agent_kind": "script+classifier",
  "token_budget_input": 4000,
  "token_budget_output": 500,
  "on_over_budget": "fail-clean",
  "stage_specific": {
    "inbox_filename_patterns": {
      "\\.md$": "session-note",
      "-spec\\.md$": "spec",
      "-design\\.md$": "design",
      "-plan\\.md$": "plan"
    },
    "commit_message_ambiguity_heuristic": {
      "enabled": true,
      "whitespace_only_threshold": 0.9
    }
  }
}
```

Create `agents/update/01-sense/instructions.md`:

```markdown
# Sense Stage — Instructions

You are the **sense** stage of the unified update pipeline. Your only job: classify inbox files mechanically and produce a minimal `sense-report.json`. You do not reason about domains, rank, or plan page changes. That is the impact stage's job.

## Contract

**Inputs provided by the runner:**
- `project.json` — the project config
- `projects/<key>/inbox/` — inbox directory listing (may be empty)
- `projects/<key>/state/freshness.json` — current freshness (for `last_seen_commit`)
- Git diff output since `last_seen_commit` (may be empty; empty implies first-run mode)

**Output:** a single `sense-report.json` at the run artifact directory, matching the schema in spec Section 5.4.

## Classification rules (mechanical, not semantic)

For each inbox source file:

1. Match the file path against patterns from `config.json.stage_specific.inbox_filename_patterns` in longest-pattern-first order.
2. Record the matched `source_kind_hint` and set `confidence`:
   - `high` if the filename has a domain suffix (e.g. `-spec.md`, `-design.md`)
   - `medium` if only the extension matched
   - `low` if no pattern matched (emit `source_kind_hint: "unknown"`)
3. Single-line `classification_reasoning`. Only describe the mechanical evidence: "matched pattern X", "extension Y only".

**Do not** produce prose reasoning. Do not read the file's content to classify. The impact stage does semantic work.

## Commit message reading

Read commit messages selectively:
- If an inbox source mentions `fix(...)`, `feat(...)`, `commit abc123`, or similar: read the referenced commit message.
- If the diff's changed files are ≥ the `whitespace_only_threshold` fraction of whitespace/formatting changes: read commit messages for that range.
- Otherwise: skip. Record nothing in `commit_messages_read`.

## Mode detection

- `last_seen_commit` absent AND git repo present: mode = `first-run`. Treat whole repo as diff.
- `last_seen_commit` present: mode = `incremental`. Produce diff file list.
- No git at all: mode = `no-git`. `changed_paths` empty; `commit_messages_read` empty.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py -v`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add agents/update/01-sense/
git commit -m "feat(update/sense): add config.json and instructions.md"
```

---

### Task 13: Implement `agents/update/01-sense/run.sh`

**Files:**
- Create: `agents/update/01-sense/run.sh`
- Test: `tests/test_update_sense.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_update_sense.py`:

```python
"""Sense stage tests. Uses LLM_STUB_RESPONSES_DIR for the mechanical classifier."""

import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _run_sense(project_dir: Path, stub_dir: Path, run_dir: Path) -> subprocess.CompletedProcess:
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(stub_dir),
    }
    return subprocess.run(
        [
            "bash",
            str(REPO_ROOT / "agents" / "update" / "01-sense" / "run.sh"),
            "--project", "sample",
            "--project-dir", str(project_dir),
            "--run-dir", str(run_dir),
        ],
        env=env,
        capture_output=True,
        text=True,
    )


def test_sense_first_run_mode(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    result = _run_sense(tmp_sample_project_with_repo, stub_dir, run_dir)
    assert result.returncode == 0, f"stderr={result.stderr}"
    report = json.loads((run_dir / "sense-report.json").read_text())
    assert report["project"] == "sample"
    assert report["mode"] == "first-run"
    assert report["last_seen_commit"] is None
    assert isinstance(report["changed_paths"], list)


def test_sense_incremental_mode(tmp_sample_project_with_repo, tmp_path):
    # Simulate a previously-seen commit by writing its SHA
    freshness = tmp_sample_project_with_repo / "state" / "freshness.json"
    data = json.loads(freshness.read_text())
    # Look up first commit of sample_repo fixture
    repo_path = REPO_ROOT / "tests" / "fixtures" / "sample_repo"
    first_sha = subprocess.run(
        ["git", "-C", str(repo_path), "rev-list", "--max-parents=0", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    data["last_seen_commit"] = first_sha
    freshness.write_text(json.dumps(data))

    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    result = _run_sense(tmp_sample_project_with_repo, stub_dir, run_dir)
    assert result.returncode == 0, f"stderr={result.stderr}"
    report = json.loads((run_dir / "sense-report.json").read_text())
    assert report["mode"] == "incremental"
    assert len(report["changed_paths"]) > 0


def test_sense_inbox_classification(tmp_sample_project_with_repo, tmp_path):
    inbox = tmp_sample_project_with_repo / "inbox"
    (inbox / "feature-spec.md").write_text("# Feature spec")
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    result = _run_sense(tmp_sample_project_with_repo, stub_dir, run_dir)
    assert result.returncode == 0, f"stderr={result.stderr}"
    report = json.loads((run_dir / "sense-report.json").read_text())
    assert len(report["inbox_sources"]) == 1
    src = report["inbox_sources"][0]
    assert src["source_kind_hint"] == "spec"
    assert src["classification_confidence"] == "high"
    # Inbox source path is relative to the llm-wiki root, not project_dir.parent
    assert src["path"].startswith("projects/"), f"unexpected path: {src['path']}"


def test_sense_report_has_all_required_fields(tmp_sample_project_with_repo, tmp_path):
    """sense-report.json must contain every field from spec Section 5.4."""
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    result = _run_sense(tmp_sample_project_with_repo, stub_dir, run_dir)
    assert result.returncode == 0, f"stderr={result.stderr}"
    report = json.loads((run_dir / "sense-report.json").read_text())
    for required in ("project", "run_id", "mode", "last_seen_commit",
                     "current_head", "inbox_sources", "changed_paths",
                     "commit_messages_read"):
        assert required in report, f"missing required field: {required}"


def test_sense_writes_stage_completion_marker(tmp_sample_project_with_repo, tmp_path):
    """After sense completes, update-state.json.stages.sense.status == completed."""
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    result = _run_sense(tmp_sample_project_with_repo, stub_dir, run_dir)
    assert result.returncode == 0
    us = json.loads((tmp_sample_project_with_repo / "state" / "update-state.json").read_text())
    assert us["stages"]["sense"]["status"] == "completed"
    assert us["stages"]["sense"]["summary_file"].endswith("sense-report.json")
    assert us["last_completed_stage"] == "sense"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_update_sense.py -v`
Expected: FAIL (run.sh missing).

- [ ] **Step 3: Implement run.sh**

Create `agents/update/01-sense/run.sh`:

```bash
#!/usr/bin/env bash
# Sense stage — mechanical enumeration + classification.
#
# Produces: <run-dir>/sense-report.json per spec Section 5.4.

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/01-sense/run.sh --project <project-key> [--project-dir <project-dir>] --run-dir <artifact-dir>
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
mkdir -p "$run_dir"

python3 - "$project_key" "$project_dir" "$run_dir" "$AGENT_DIR" "$ROOT_DIR" <<'PY'
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key, project_dir, run_dir, agent_dir, root_dir = map(Path, sys.argv[1:6])
project_key = sys.argv[1]  # keep as string

project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
agent_dir = Path(sys.argv[4])
root_dir = Path(sys.argv[5])

config = json.loads((agent_dir / "config.json").read_text())
patterns = config["stage_specific"]["inbox_filename_patterns"]

# Resolve repo
project_json = json.loads((project_dir / "state" / "project.json").read_text())
repo_paths = [str(root_dir / p) if not Path(p).is_absolute() else p for p in project_json.get("repo_paths", [])]
repo = Path(repo_paths[0]) if repo_paths else None

# Freshness for last_seen_commit
freshness = project_dir / "state" / "freshness.json"
last_seen = None
if freshness.is_file():
    last_seen = json.loads(freshness.read_text()).get("last_seen_commit")

# Detect git + mode
mode = "no-git"
current_head = None
changed_paths = []
if repo and (repo / ".git").is_dir():
    head = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    )
    current_head = head.stdout.strip()
    if last_seen:
        mode = "incremental"
        diff = subprocess.run(
            ["git", "-C", str(repo), "diff", "--name-status", f"{last_seen}..HEAD"],
            capture_output=True, text=True, check=True,
        )
        for line in diff.stdout.splitlines():
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            code = parts[0]
            path = parts[1]
            change_type = {"A": "added", "M": "modified", "D": "deleted", "R": "renamed"}.get(code[0], "modified")
            changed_paths.append({"path": path, "change_type": change_type})
    else:
        mode = "first-run"
        ls = subprocess.run(
            ["git", "-C", str(repo), "ls-files"],
            capture_output=True, text=True, check=True,
        )
        for path in ls.stdout.splitlines():
            if path.strip():
                changed_paths.append({"path": path, "change_type": "added"})

# Inbox classification (mechanical)
inbox_dir = project_dir / "inbox"
inbox_sources = []
if inbox_dir.is_dir():
    for source in sorted(inbox_dir.iterdir()):
        if not source.is_file() or source.name == ".gitkeep":
            continue
        rel_path = str(source.relative_to(project_dir.parent.parent if source.is_absolute() else project_dir))
        # Pattern match, longest first
        matched = None
        for pattern, kind in sorted(patterns.items(), key=lambda kv: -len(kv[0])):
            if re.search(pattern, source.name):
                matched = (pattern, kind)
                break
        if matched is None:
            kind_hint = "unknown"
            confidence = "low"
            reasoning = "no pattern matched"
        else:
            pattern, kind_hint = matched
            if "-" in pattern:
                confidence = "high"
                reasoning = f"matched domain-suffix pattern {pattern}"
            else:
                confidence = "medium"
                reasoning = f"matched extension-only pattern {pattern}"
        # Spec §5.4: inbox path is "projects/<key>/inbox/<filename>" regardless
        # of where project_dir actually lives on disk (may be a tmp path in tests).
        inbox_sources.append({
            "path": f"projects/{project_key}/inbox/{source.name}",
            "source_kind_hint": kind_hint,
            "classification_confidence": confidence,
            "classification_reasoning": reasoning,
        })

# run_id from run_dir basename
run_id = run_dir.name

report = {
    "project": project_key,
    "run_id": run_id,
    "mode": mode,
    "last_seen_commit": last_seen,
    "current_head": current_head,
    "inbox_sources": inbox_sources,
    "changed_paths": changed_paths,
    "commit_messages_read": [],
}

(run_dir / "sense-report.json").write_text(json.dumps(report, indent=2) + "\n")

# Stage completion marker in update-state.json (spec §6.4)
us_path = project_dir / "state" / "update-state.json"
if us_path.is_file():
    us = json.loads(us_path.read_text())
    us.setdefault("stages", {})
    us["stages"]["sense"] = {
        "status": "completed",
        "last_run_dir": str(run_dir),
        "last_completed_at": datetime.now(timezone.utc).isoformat(),
        "summary_file": str(run_dir / "sense-report.json"),
    }
    us["last_completed_stage"] = "sense"
    us["latest_run_dir"] = str(run_dir)
    us_path.write_text(json.dumps(us, indent=2) + "\n")

print(f"sense report written: {run_dir / 'sense-report.json'}")
PY
```

Make executable:

```bash
chmod +x agents/update/01-sense/run.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_update_sense.py -v`
Expected: 5 tests pass (first-run mode, incremental mode, inbox classification, required-fields schema, stage completion marker).

- [ ] **Step 5: Commit**

```bash
git add agents/update/01-sense/run.sh tests/test_update_sense.py
git commit -m "feat(update/sense): implement run.sh with mechanical classification"
```

---

### Task 14: Implement `agents/update/02-impact/config.json` + `instructions.md`

**Files:**
- Create: `agents/update/02-impact/config.json`
- Create: `agents/update/02-impact/instructions.md`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_validate_stage_configs.py`:

```python
def test_impact_config_exists_and_validates():
    """Impact stage config must exist, load, and declare the ranking_cutoff key."""
    stages_root = REPO_ROOT / "agents" / "update"
    impact_config = stages_root / "02-impact" / "config.json"
    assert impact_config.is_file(), f"missing: {impact_config}"
    data = json.loads(impact_config.read_text())
    assert data["stage"] == "impact"
    assert "ranking_cutoff" in data["stage_specific"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py::test_impact_config_exists_and_validates -v`
Expected: FAIL (impact config does not yet exist).

- [ ] **Step 3: Create impact config + instructions**

Create `agents/update/02-impact/config.json`:

```json
{
  "stage": "impact",
  "agent_kind": "llm-agent",
  "token_budget_input": 60000,
  "token_budget_output": 8000,
  "on_over_budget": "fail-clean",
  "stage_specific": {
    "ranking_cutoff": 20,
    "entry_point_patterns": [
      "**/main.py",
      "**/__main__.py",
      "**/app.py",
      "**/index.ts",
      "**/index.js",
      "**/Program.cs",
      "**/main.go",
      "**/main.rs"
    ],
    "meta_doc_patterns": [
      "README*",
      "docs/**/*.md",
      "pyproject.toml",
      "package.json",
      "Cargo.toml",
      "go.mod"
    ]
  }
}
```

Create `agents/update/02-impact/instructions.md`:

```markdown
# Impact Stage — Instructions

You are the **impact** stage of the unified update pipeline. You have two sub-tasks:

1. **Ranking (Sub-task 1)** — compute the access-pattern ranking (Signals A+B+C) and emit `ranking-snapshot.json`.
2. **Delta (Sub-task 2)** — given sense-report + ranking, emit `impact-report.json` identifying affected/new/stale content.

Both sub-tasks run in the same stage invocation but produce two distinct artifacts.

## Inputs

- `sense-report.json` from the sense stage
- Current `projects/<key>/state/pages.json` (may be empty on first run)
- Repo files accessible under `project.json.repo_paths`
- `config.json.stage_specific.ranking_cutoff` and `entry_point_patterns`

## Sub-task 1: Ranking

Produce `<run-dir>/ranking-snapshot.json` per spec Section 4.3.

Steps:
1. Signal A — collect meta-docs matching `meta_doc_patterns`. Record paths.
2. Signal B — collect entry-point candidates matching `entry_point_patterns`. Record paths.
3. Signal C — rank the domains. For each candidate domain, produce:
   - `rank` (1-indexed position)
   - `domain` (short identifier, e.g. "authentication")
   - `score` (float 0-1; your subjective ranking)
   - `signals` (subset of ["A","B","C"] that contribute)
   - `signal_a_evidence`, `signal_b_evidence` (arrays of `path:line-line` or just `path` when no line range applies)
   - `signal_c_reasoning` (one sentence explaining why this is load-bearing; or "no A/B signal; promoted on structural fan-in" when no hard evidence)

Emit exactly `cutoff` entries unless fewer domains exist. Entries beyond cutoff are NOT included here — propose stage reads `ranking-snapshot.json.ranked_domains` only.

Output must be strict JSON (no prose outside schema).

## Sub-task 2: Delta

Produce `<run-dir>/impact-report.json` per spec Section 5.4.

Steps:
1. For each `changed_paths` entry in sense-report: map to affected wiki pages via `pages.json`. Emit `affected_pages[]` with reason + source.
2. For each ranked domain not already covered by a wiki page: emit `new_domains[]` with `ranking_inclusion: "top-20"` or `"below-cutoff"`.
3. For each existing page whose repo citations no longer resolve or whose domain has disappeared: emit `stale_pages[]`.
4. Include `ranking_snapshot_ref` pointing at the stable path `projects/<key>/state/latest/ranking-snapshot.json`.

## Budget

Token budget is enforced at 60000 input / 8000 output. On exceed: stage fails clean, no artifacts written.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/update/02-impact/config.json agents/update/02-impact/instructions.md tests/test_validate_stage_configs.py
git commit -m "feat(update/impact): add config.json and instructions.md"
```

---

### Task 15: Implement `agents/update/02-impact/run.sh`

**Files:**
- Create: `agents/update/02-impact/run.sh`
- Test: `tests/test_update_impact.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_update_impact.py`:

```python
"""Impact stage tests. Uses LLM_STUB_RESPONSES_DIR for ranking + delta sub-tasks."""

import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _run_sense_then_impact(project_dir: Path, stub_dir: Path, run_dir: Path):
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(stub_dir)}
    sense_rc = subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "01-sense" / "run.sh"),
         "--project", "sample", "--project-dir", str(project_dir), "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    assert sense_rc.returncode == 0, f"sense: {sense_rc.stderr}"
    impact_rc = subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "02-impact" / "run.sh"),
         "--project", "sample", "--project-dir", str(project_dir), "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    return impact_rc


def test_impact_first_run_produces_ranking_and_delta(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stub_dir = REPO_ROOT / "tests" / "fixtures" / "stubs"
    rc = _run_sense_then_impact(tmp_sample_project_with_repo, stub_dir, run_dir)
    assert rc.returncode == 0, f"stderr={rc.stderr}"

    ranking = json.loads((run_dir / "ranking-snapshot.json").read_text())
    assert ranking["cutoff"] == 20
    assert len(ranking["ranked_domains"]) >= 3

    impact = json.loads((run_dir / "impact-report.json").read_text())
    assert impact["run_id"] == run_dir.name
    assert "affected_pages" in impact
    assert "new_domains" in impact
    assert "stale_pages" in impact
    assert impact["ranking_snapshot_ref"].endswith("ranking-snapshot.json")


def test_impact_fails_without_sense_report(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()  # empty, no sense-report.json
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs")}
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "02-impact" / "run.sh"),
         "--project", "sample", "--project-dir", str(tmp_sample_project_with_repo),
         "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode != 0
    assert "sense-report" in rc.stderr
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_update_impact.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement run.sh**

Create `agents/update/02-impact/run.sh`:

```bash
#!/usr/bin/env bash
# Impact stage — ranking (Sub-task 1) + delta (Sub-task 2).
#
# Produces:
#   <run-dir>/ranking-snapshot.json
#   <run-dir>/impact-report.json
#
# In Plan A we use LLM_STUB_RESPONSES_DIR for both sub-tasks. Plan B/C wires real LLM calls.

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/02-impact/run.sh --project <project-key> [--project-dir <project-dir>] --run-dir <artifact-dir>
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
[[ -f "$run_dir/sense-report.json" ]] || die "sense-report.json missing in $run_dir"

python3 - "$project_key" "$project_dir" "$run_dir" "$AGENT_DIR" "$ROOT_DIR" <<'PY'
import json
import os
import sys
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
agent_dir = Path(sys.argv[4])
root_dir = Path(sys.argv[5])

sys.path.insert(0, str(root_dir))
from agents.update._shared import llm_client  # noqa: E402

config = json.loads((agent_dir / "config.json").read_text())
cutoff = config["stage_specific"]["ranking_cutoff"]

# Per-project override
pj = json.loads((project_dir / "state" / "project.json").read_text())
if pj.get("ranking_cutoff") is not None:
    cutoff = pj["ranking_cutoff"]

# --- Sub-task 1: Ranking ---
sense_report = json.loads((run_dir / "sense-report.json").read_text())
ranking_prompt = json.dumps({
    "sense_report": sense_report,
    "cutoff": cutoff,
    "project_key": project_key,
})
ranking_result = llm_client.invoke(stage_id="02-impact.ranking", prompt=ranking_prompt)
ranking = ranking_result["response"]
# Stamp run_id and cutoff_config_source
ranking["run_id"] = run_dir.name
ranking["cutoff"] = cutoff
ranking["cutoff_config_source"] = "agents/update/02-impact/config.json:stage_specific.ranking_cutoff"
ranking.setdefault("signal_a_sources", [])
ranking.setdefault("signal_b_entry_points", [])
(run_dir / "ranking-snapshot.json").write_text(json.dumps(ranking, indent=2) + "\n")

# --- Sub-task 2: Delta ---
delta_prompt = json.dumps({
    "sense_report": sense_report,
    "ranking": ranking,
    "project_key": project_key,
})
delta_result = llm_client.invoke(stage_id="02-impact.delta", prompt=delta_prompt)
delta = delta_result["response"]
delta["run_id"] = run_dir.name
delta["ranking_snapshot_ref"] = f"projects/{project_key}/state/latest/ranking-snapshot.json"
(run_dir / "impact-report.json").write_text(json.dumps(delta, indent=2) + "\n")

# Stage completion marker in update-state.json (spec §6.4)
from datetime import datetime, timezone
us_path = project_dir / "state" / "update-state.json"
if us_path.is_file():
    us = json.loads(us_path.read_text())
    us.setdefault("stages", {})
    us["stages"]["impact"] = {
        "status": "completed",
        "last_run_dir": str(run_dir),
        "last_completed_at": datetime.now(timezone.utc).isoformat(),
        "summary_file": str(run_dir / "impact-report.json"),
    }
    us["last_completed_stage"] = "impact"
    us["latest_run_dir"] = str(run_dir)
    us_path.write_text(json.dumps(us, indent=2) + "\n")

print(f"ranking-snapshot.json + impact-report.json written to {run_dir}")
PY
```

Make executable:

```bash
chmod +x agents/update/02-impact/run.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_update_impact.py -v`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add agents/update/02-impact/run.sh tests/test_update_impact.py
git commit -m "feat(update/impact): implement run.sh with ranking + delta sub-tasks"
```

---

### Task 16: Extend `scripts/stable_products.py` with `render-ranking` subcommand

**Files:**
- Modify: `scripts/stable_products.py`
- Test: `tests/test_render_ranking.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_render_ranking.py`:

```python
"""Tests for stable_products.py render-ranking subcommand."""

import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_render_ranking_writes_json_and_md(tmp_sample_project, tmp_path):
    ranking = {
        "run_id": "20260418-100000-update-sample",
        "cutoff": 20,
        "cutoff_config_source": "agents/update/02-impact/config.json:stage_specific.ranking_cutoff",
        "signal_a_sources": ["README.md"],
        "signal_b_entry_points": ["src/main.py"],
        "ranked_domains": [
            {
                "rank": 1, "domain": "authentication", "score": 0.85,
                "signals": ["A", "B", "C"],
                "signal_a_evidence": ["README.md:6-14"],
                "signal_b_evidence": ["src/auth.py"],
                "signal_c_reasoning": "session owner"
            }
        ]
    }
    input_path = tmp_path / "ranking-snapshot.json"
    input_path.write_text(json.dumps(ranking))

    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "stable_products.py"),
         "render-ranking", "--input", str(input_path),
         "--project-dir", str(tmp_sample_project)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"

    latest = tmp_sample_project / "state" / "latest"
    assert (latest / "ranking-snapshot.json").is_file()
    assert (latest / "ranking-snapshot.md").is_file()

    md = (latest / "ranking-snapshot.md").read_text()
    assert "# Ranking" in md or "## Ranked domains" in md
    assert "authentication" in md
    assert "session owner" in md
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_render_ranking.py -v`
Expected: FAIL (no such subcommand).

- [ ] **Step 3: Read the existing stable_products.py structure**

Run: `grep -n "def cmd_\|def build_parser\|def main" scripts/stable_products.py`

You will see (in this order): `cmd_render_lint`, `cmd_render_validation`, `cmd_render_ingest`, `build_parser()`, `main()`. Subparsers are defined inside `build_parser()` using the variable `sub` (not `subparsers`). The new code follows this convention.

- [ ] **Step 4: Add render-ranking subcommand**

Add the following function to `scripts/stable_products.py`, immediately after `cmd_render_ingest` and before `build_parser`:

```python
def cmd_render_ranking(args: argparse.Namespace) -> int:
    """Render ranking-snapshot.json → state/latest/ranking-snapshot.{json,md}."""
    input_path = Path(args.input)
    project_dir = Path(args.project_dir)
    data = json.loads(input_path.read_text())

    latest = project_dir / "state" / "latest"
    latest.mkdir(parents=True, exist_ok=True)

    (latest / "ranking-snapshot.json").write_text(json.dumps(data, indent=2) + "\n")

    lines: list[str] = []
    lines.append(f"# Ranking snapshot — {data.get('run_id', 'unknown')}")
    lines.append("")
    lines.append("## Cutoff")
    lines.append("")
    lines.append(f"- Cutoff: `{data.get('cutoff', 'n/a')}`")
    if data.get("cutoff_config_source"):
        lines.append(f"- Source: `{data['cutoff_config_source']}`")
    lines.append("")
    lines.append("## Ranked domains")
    lines.append("")
    lines.append("| Rank | Domain | Score | Signals | Reasoning |")
    lines.append("|------|--------|-------|---------|-----------|")
    for entry in data.get("ranked_domains", []):
        signals = ",".join(entry.get("signals", []))
        reasoning = entry.get("signal_c_reasoning", "").replace("|", "\\|")
        lines.append(
            f"| {entry.get('rank', '?')} | {entry.get('domain', '?')} | "
            f"{entry.get('score', '?')} | {signals} | {reasoning} |"
        )
    lines.append("")
    lines.append("## Signal A evidence")
    lines.append("")
    for src in data.get("signal_a_sources", []):
        lines.append(f"- {src}")
    if not data.get("signal_a_sources"):
        lines.append("- (none)")
    lines.append("")
    lines.append("## Signal B evidence")
    lines.append("")
    for ep in data.get("signal_b_entry_points", []):
        lines.append(f"- {ep}")
    if not data.get("signal_b_entry_points"):
        lines.append("- (none)")
    lines.append("")
    (latest / "ranking-snapshot.md").write_text("\n".join(lines) + "\n")
    return 0
```

Wire up the subparser by adding to `build_parser()`, immediately before its `return parser` line. The existing code uses the variable name `sub` for the subparsers collection; reuse it (do not rename):

```python
    ranking = sub.add_parser("render-ranking")
    ranking.add_argument("--input", required=True)
    ranking.add_argument("--project-dir", required=True)
    ranking.set_defaults(func=cmd_render_ranking)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_render_ranking.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/stable_products.py tests/test_render_ranking.py
git commit -m "feat(stable_products): add render-ranking subcommand"
```

---

### Task 17: Implement `scripts/update.sh` (pipeline entry, sense + impact only)

**Files:**
- Create: `scripts/update.sh`

- [ ] **Step 1: Write the failing test**

Create `tests/test_plan_a_acceptance.py`:

```python
"""Plan A acceptance: scripts/update.sh orchestrates sense + impact end-to-end.

Uses an isolated tmp copy of projects/sample so the test does not mutate the
working tree. Also supports overriding the artifacts root via UPDATE_ARTIFACTS_ROOT.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _prepare_isolated_run(tmp_path: Path) -> tuple[Path, Path, Path]:
    """Create tmp copies of projects/sample + artifacts root, return (projects_root, project_dir, artifacts_root)."""
    projects_root = tmp_path / "projects"
    projects_root.mkdir()
    project_dir = projects_root / "sample"
    shutil.copytree(REPO_ROOT / "projects" / "sample", project_dir)
    artifacts_root = tmp_path / "artifacts"
    artifacts_root.mkdir()
    return projects_root, project_dir, artifacts_root


def test_update_script_runs_sense_and_impact(tmp_path):
    """update.sh must orchestrate sense -> impact end-to-end without touching the real working tree."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"

    runs = sorted((artifacts_root / "sample" / "runs").glob("*-update"))
    assert runs, "no run dirs under isolated artifacts root"
    latest_run = runs[-1]

    assert (latest_run / "sense-report.json").is_file()
    assert (latest_run / "ranking-snapshot.json").is_file()
    assert (latest_run / "impact-report.json").is_file()

    latest_state = project_dir / "state" / "latest"
    assert (latest_state / "ranking-snapshot.json").is_file()
    assert (latest_state / "ranking-snapshot.md").is_file()


def test_update_script_fails_when_stage_configs_invalid(tmp_path):
    """If agents/update/*/config.json is broken, update.sh aborts before stages run."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    bad_stages = tmp_path / "agents-update"
    (bad_stages / "01-sense").mkdir(parents=True)
    (bad_stages / "01-sense" / "config.json").write_text('{"bogus": true}')
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_STAGES_ROOT": str(bad_stages),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    assert result.returncode != 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_plan_a_acceptance.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement update.sh**

Create `scripts/update.sh`:

```bash
#!/usr/bin/env bash
# Unified update pipeline entry. Plan A scope: sense + impact only.
# Plans B/C add propose, apply, validate, reconcile.
#
# Usage:
#   scripts/update.sh --project <project-key>
#   scripts/update.sh                            # all registered projects
#
# Env:
#   LLM_STUB_RESPONSES_DIR  if set, agents use canned stub responses
#   UPDATE_STAGES_ROOT       override stages root (for testing)
#   UPDATE_PROJECTS_ROOT     override projects root (for testing)
#   UPDATE_ARTIFACTS_ROOT    override artifacts root (for testing)
#   RANKING_CUTOFF           override ranking cutoff

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STAGES_ROOT="${UPDATE_STAGES_ROOT:-$ROOT_DIR/agents/update}"
PROJECTS_ROOT="${UPDATE_PROJECTS_ROOT:-$ROOT_DIR/projects}"
ARTIFACTS_ROOT="${UPDATE_ARTIFACTS_ROOT:-$ROOT_DIR/artifacts}"

usage() {
  cat <<'EOF'
Usage:
  scripts/update.sh --project <project-key>
  scripts/update.sh                           # iterate all registered projects
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

# Validate all stage configs FIRST (pipeline-entry check)
python3 "$ROOT_DIR/scripts/validate_stage_configs.py" --stages-root "$STAGES_ROOT" \
  || die "stage config validation failed; fix config.json files before running"

# Determine project list
projects=()
if [[ -n "$project_key" ]]; then
  projects+=("$project_key")
else
  while IFS= read -r dir; do
    [[ -f "$dir/state/project.json" ]] && projects+=("$(basename "$dir")")
  done < <(find "$PROJECTS_ROOT" -maxdepth 1 -mindepth 1 -type d)
fi

run_project() {
  local key="$1"
  local project_dir="$PROJECTS_ROOT/$key"
  [[ -d "$project_dir" ]] || { echo "warn: project not found: $key" >&2; return 1; }

  local run_id
  run_id="$(date -u +%Y%m%d-%H%M%S)-update"
  local run_dir="$ARTIFACTS_ROOT/$key/runs/$run_id"
  mkdir -p "$run_dir"
  echo "[$key] run_dir: $run_dir"

  # Stage 1: sense
  bash "$STAGES_ROOT/01-sense/run.sh" \
    --project "$key" --project-dir "$project_dir" --run-dir "$run_dir"

  # Stage 2: impact
  bash "$STAGES_ROOT/02-impact/run.sh" \
    --project "$key" --project-dir "$project_dir" --run-dir "$run_dir"

  # Render stable product: ranking-snapshot
  python3 "$ROOT_DIR/scripts/stable_products.py" render-ranking \
    --input "$run_dir/ranking-snapshot.json" \
    --project-dir "$project_dir"

  echo "[$key] sense + impact complete"
}

rc=0
for key in "${projects[@]}"; do
  if ! run_project "$key"; then
    echo "warn: [$key] failed; continuing" >&2
    rc=1
  fi
done

exit $rc
```

Make executable:

```bash
chmod +x scripts/update.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_plan_a_acceptance.py -v`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/update.sh tests/test_plan_a_acceptance.py
git commit -m "feat(scripts): add update.sh pipeline entry (sense + impact scope)"
```

---

### Task 18: Add `make update-v2` Makefile target

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_plan_a_acceptance.py`:

```python
def test_make_update_v2_target_exists():
    """Makefile must define update-v2 target."""
    makefile = REPO_ROOT / "Makefile"
    content = makefile.read_text()
    assert "update-v2:" in content or "update-v2 " in content


def test_make_update_v2_invokes_update_sh(tmp_path):
    """make update-v2 PROJECT=sample succeeds end-to-end against an isolated project copy.

    Uses the same isolation pattern as test_update_script_runs_sense_and_impact
    so the test never mutates the real working tree.
    """
    projects_root = tmp_path / "projects"
    projects_root.mkdir()
    shutil.copytree(REPO_ROOT / "projects" / "sample", projects_root / "sample")
    artifacts_root = tmp_path / "artifacts"
    artifacts_root.mkdir()
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    result = subprocess.run(
        ["make", "update-v2", "PROJECT=sample"],
        cwd=str(REPO_ROOT), env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"
    assert (projects_root / "sample" / "state" / "latest" / "ranking-snapshot.md").is_file()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_plan_a_acceptance.py::test_make_update_v2_target_exists -v`
Expected: FAIL.

- [ ] **Step 3: Add update-v2 target to Makefile**

Read the current Makefile structure:

```bash
grep -n "^\." Makefile | head -5
```

Locate the `.PHONY:` line and the last existing target. Append the new target after the existing targets, and add `update-v2` to `.PHONY`.

Add to `.PHONY` list:

```makefile
.PHONY: init init-project bootstrap bootstrap-orient bootstrap-domains bootstrap-expand bootstrap-validate bootstrap-reconcile validate lint ingest ingest-v2 ingest-apply ingest-global status status-all prune help update-v2
```

Append at the end of the Makefile:

```makefile
update-v2:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make update-v2 PROJECT=sample" && exit 1)
	@bash scripts/update.sh --project $(PROJECT)
```

Also add a help line. Find the existing help target block and insert before the MODEL selector section:

```makefile
	@echo "  make update-v2 PROJECT=<project-key>  # Plan A scope: sense + impact only (transitional name; becomes 'make update' at M5)"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_plan_a_acceptance.py -v`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add Makefile tests/test_plan_a_acceptance.py
git commit -m "feat(makefile): add update-v2 target"
```

---

### Task 19: Final sweep — run entire test suite

**Files:** none (verification only)

- [ ] **Step 1: Run the entire suite**

Run: `.venv/bin/pytest -q`
Expected: all tests pass (existing + newly added); no regressions.

- [ ] **Step 2: Verify make update-v2 end-to-end against the real sample project**

All automated tests use isolated tmp copies, so `projects/sample/` should be clean. Confirm before running:

```bash
git status projects/sample/ artifacts/sample/ 2>&1 | grep -c modified || true
```

If anything is modified unexpectedly, investigate before proceeding (isolation may have regressed).

Run the real command — this is the only step in Plan A that intentionally mutates the live sample project:

```bash
LLM_STUB_RESPONSES_DIR=tests/fixtures/stubs make update-v2 PROJECT=sample
```

Expected output:
```
[sample] run_dir: artifacts/sample/runs/<timestamp>-update
sense report written: ...
ranking-snapshot.json + impact-report.json written to ...
[sample] sense + impact complete
```

Verify files:
```bash
ls artifacts/sample/runs/*-update/
# Expect: sense-report.json, ranking-snapshot.json, impact-report.json

ls projects/sample/state/latest/
# Expect: ranking-snapshot.json, ranking-snapshot.md (plus .gitkeep)
```

- [ ] **Step 3: Self-review checklist**

- [ ] All files in the Plan A scope exist on disk
- [ ] No TODO / TBD strings in any Plan A file (`grep -rn "TODO\|TBD\|FIXME" agents/update/ scripts/update.sh scripts/migrate_state_v1_to_v2.sh scripts/migrate_state_v2_to_v1.sh scripts/validate_stage_configs.py projects/sample/`)
- [ ] Test count increased appropriately (~20 new tests)
- [ ] `pytest -q` shows green
- [ ] `make update-v2 PROJECT=sample` exit code is 0

- [ ] **Step 4: Commit final sweep marker**

```bash
git commit --allow-empty -m "chore: Plan A complete — sense + impact + state migration + fixtures landed"
```

---

## Plan A Deliverables Summary

- Sense stage (`agents/update/01-sense/`) with mechanical classifier
- Impact stage (`agents/update/02-impact/`) with ranking + delta sub-tasks
- Shared helpers: `config.py`, `llm_client.py` (stub-aware)
- Stage config validator: `scripts/validate_stage_configs.py`
- State migration scripts: forward + reverse
- Pipeline entry: `scripts/update.sh` (sense + impact scope)
- Makefile target: `make update-v2`
- `scripts/stable_products.py render-ranking` subcommand
- Registered `projects/sample/` test project
- Fixtures: `tests/fixtures/sample_repo/`, `tests/fixtures/project_state/`, `tests/fixtures/stubs/`
- Test modules: config precedence, LLM stub, stage config validation, sense, impact, state migration, render-ranking, Plan A acceptance

## Acceptance

After all Plan A deliverables land:

```bash
LLM_STUB_RESPONSES_DIR=tests/fixtures/stubs make update-v2 PROJECT=sample
```

Produces well-formed `sense-report.json`, `ranking-snapshot.json`, `impact-report.json` in the run dir and `ranking-snapshot.{json,md}` under `projects/sample/state/latest/`. All tests pass.

## Next

Plans B and C are separate documents (to be authored after Plan A is reviewed and executed).
