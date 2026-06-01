# V2 Project-Rooted Agent Memory Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first V2 slice: a SQLite-backed, project-rooted memory substrate with deterministic capture, queue modes, project-scoped session continuity, and high-level MCP facades that preserve the existing wiki/query/update behavior.

**Architecture:** Add a new memory layer beside the current project wiki instead of rewriting the compiler. Deterministic scripts own event/candidate storage, project/session resolution, queue modes, and latest-session reads; agentic curation is limited to an explicit session-summary command and the existing correction-driven update loop. The MCP server exposes `query`, `how`, and `what` as semantic facades while retaining existing lower-level tools.

**Tech Stack:** Python 3.13, SQLite via stdlib `sqlite3`, existing Bash/Make orchestration, FastMCP wrapper, file-backed project wiki/state, pytest. Vector search and Gemini embeddings are deferred to a follow-up plan after the memory substrate is stable.

---

## Scope

This plan implements Phase 1-3 from the design:

- SQLite-backed memory database
- deterministic event and candidate capture
- `off | queue | auto` mode parsing
- project-scoped session records and latest-session pointer
- CLI commands for memory init, event capture, and session summary
- MCP `query`, `how`, and `what` facade tools with stable response metadata
- documentation of automation boundaries

This plan deliberately does not implement:

- Gemini embeddings
- sqlite-vec / Bun indexing
- automatic recipe promotion
- automatic personal preference promotion
- Codex hook installation
- full project-brain rewrite

Those are separate follow-up plans once this foundation proves useful.

## File Map

- Create: `agents/memory/__init__.py` - package marker for memory modules.
- Create: `agents/memory/schema.py` - SQLite schema creation and migration helpers.
- Create: `agents/memory/store.py` - deterministic persistence API for events, candidates, sessions, and latest-session reads.
- Create: `agents/memory/project_resolver.py` - resolve project keys from cwd/repo paths using existing project config.
- Create: `scripts/memory.py` - CLI entrypoint for init, record-event, session-summary, and latest-session.
- Modify: `.gitignore` - unignore new memory tests and ignore generated root memory DB state.
- Modify: `Makefile` - add `memory-init`, `memory-record-event`, `memory-session`, and `memory-latest-session` targets.
- Modify: `mcp/llm_wiki_mcp.py` - add `query`, `how`, and `what` facade tools without removing existing tools.
- Modify: `tests/test_mcp_server.py` - verify new tool registration and facade behavior.
- Create: `tests/test_memory_store.py` - verify SQLite schema and deterministic memory store behavior.
- Create: `tests/test_memory_cli.py` - verify CLI command behavior.
- Create: `tests/test_memory_project_resolver.py` - verify cwd/project resolution.
- Modify: `docs/superpowers/specs/2026-06-01-v2-project-rooted-agent-memory-design.md` only if implementation discoveries require clarifying the design.

## Data Contracts

The first slice uses one SQLite file per llm-wiki root:

```text
state/memory.db
```

The schema version is stored in `meta(key, value)`.

Tables:

```sql
CREATE TABLE IF NOT EXISTS memory_events (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  session_id TEXT,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  mode TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  cwd TEXT,
  tool_name TEXT,
  input_summary TEXT,
  output_summary TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_candidates (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  session_id TEXT,
  source TEXT NOT NULL,
  candidate_type TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source_event_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_sessions (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  title TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  next_actions_json TEXT NOT NULL,
  source_event_ids_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_memory_state (
  project_key TEXT PRIMARY KEY,
  latest_session_id TEXT,
  updated_at TEXT NOT NULL
);
```

Allowed modes:

```python
{"off", "queue", "auto"}
```

Allowed candidate statuses:

```python
{"pending", "processed", "needs-review"}
```

Allowed session statuses:

```python
{"open", "closed"}
```

## Task 0: Prepare Git Ignore Rules For Memory Tests And Generated DB

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Verify the current ignore behavior**

Run:

```bash
git check-ignore -v tests/test_memory_store.py tests/test_memory_cli.py tests/test_memory_project_resolver.py state/memory.db
```

Expected: the three test files are ignored by the existing `tests/*` rule, and `state/memory.db` is not ignored.

- [ ] **Step 2: Update `.gitignore`**

Add these lines near the existing test exceptions and generated-state ignores:

```gitignore
state/memory.db
!tests/test_memory_store.py
!tests/test_memory_cli.py
!tests/test_memory_project_resolver.py
```

- [ ] **Step 3: Verify the new ignore behavior**

Run:

```bash
git check-ignore -v tests/test_memory_store.py tests/test_memory_cli.py tests/test_memory_project_resolver.py state/memory.db
```

Expected:

- the three test paths are not reported as ignored
- `state/memory.db` is reported as ignored by the new `state/memory.db` rule

- [ ] **Step 4: Commit**

Run:

```bash
git add .gitignore
git commit -m "chore: prepare memory generated-state ignores"
```

## Task 1: Add Memory Schema Helper

**Files:**
- Create: `agents/memory/__init__.py`
- Create: `agents/memory/schema.py`
- Test: `tests/test_memory_store.py`

- [ ] **Step 1: Write the failing schema test**

Create `tests/test_memory_store.py` with:

```python
import sqlite3

import pytest

from agents.memory.schema import SCHEMA_VERSION, initialize_memory_db


def test_initialize_memory_db_creates_schema(tmp_path):
    db_path = tmp_path / "memory.db"

    initialize_memory_db(db_path)

    with sqlite3.connect(db_path) as conn:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        version = conn.execute(
            "SELECT value FROM meta WHERE key = 'schema_version'"
        ).fetchone()[0]
        event_columns = {
            row[1] for row in conn.execute("PRAGMA table_info(memory_events)")
        }
        candidate_columns = {
            row[1] for row in conn.execute("PRAGMA table_info(memory_candidates)")
        }

    assert version == str(SCHEMA_VERSION)
    assert {
        "meta",
        "memory_events",
        "memory_candidates",
        "memory_sessions",
        "project_memory_state",
    }.issubset(tables)
    assert "source" in event_columns
    assert "source" in candidate_columns
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
.venv/bin/pytest tests/test_memory_store.py::test_initialize_memory_db_creates_schema -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'agents.memory'`.

- [ ] **Step 3: Add the package marker**

Create `agents/memory/__init__.py`:

```python
"""Project-rooted memory substrate for llm-wiki V2."""
```

- [ ] **Step 4: Implement the schema helper**

Create `agents/memory/schema.py`:

```python
from __future__ import annotations

import sqlite3
from pathlib import Path


SCHEMA_VERSION = 1


def initialize_memory_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS memory_events (
              id TEXT PRIMARY KEY,
              project_key TEXT NOT NULL,
              session_id TEXT,
              source TEXT NOT NULL,
              event_type TEXT NOT NULL,
              mode TEXT NOT NULL,
              occurred_at TEXT NOT NULL,
              cwd TEXT,
              tool_name TEXT,
              input_summary TEXT,
              output_summary TEXT,
              payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS memory_candidates (
              id TEXT PRIMARY KEY,
              project_key TEXT NOT NULL,
              session_id TEXT,
              source TEXT NOT NULL,
              candidate_type TEXT NOT NULL,
              mode TEXT NOT NULL,
              status TEXT NOT NULL,
              created_at TEXT NOT NULL,
              source_event_id TEXT,
              title TEXT NOT NULL,
              summary TEXT NOT NULL,
              payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS memory_sessions (
              id TEXT PRIMARY KEY,
              project_key TEXT NOT NULL,
              title TEXT NOT NULL,
              started_at TEXT,
              ended_at TEXT,
              status TEXT NOT NULL,
              summary TEXT NOT NULL,
              next_actions_json TEXT NOT NULL,
              source_event_ids_json TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project_memory_state (
              project_key TEXT PRIMARY KEY,
              latest_session_id TEXT,
              updated_at TEXT NOT NULL
            );
            """
        )
        conn.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
            ("schema_version", str(SCHEMA_VERSION)),
        )
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
.venv/bin/pytest tests/test_memory_store.py::test_initialize_memory_db_creates_schema -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add agents/memory/__init__.py agents/memory/schema.py tests/test_memory_store.py
git commit -m "feat: add memory database schema"
```

## Task 2: Add Deterministic Memory Store

**Files:**
- Create: `agents/memory/store.py`
- Modify: `tests/test_memory_store.py`

- [ ] **Step 1: Add failing tests for event and candidate storage**

Append to `tests/test_memory_store.py`:

```python
from agents.memory.store import MemoryStore


def test_record_event_persists_json_payload(tmp_path):
    store = MemoryStore(tmp_path / "memory.db")

    event = store.record_event(
        project_key="wodnix",
        source="cli",
        event_type="codex.stop",
        mode="queue",
        session_id="session-1",
        cwd="/repo/wodnix",
        tool_name=None,
        input_summary="manual qa session ended",
        output_summary="ready for mobile testing",
        payload={"card": "C4ufaxDz"},
    )

    rows = store.list_events(project_key="wodnix")
    assert rows == [event]
    assert rows[0]["payload"]["card"] == "C4ufaxDz"


def test_queue_candidate_defaults_to_pending(tmp_path):
    store = MemoryStore(tmp_path / "memory.db")

    candidate = store.queue_candidate(
        project_key="wodnix",
        source="cli",
        candidate_type="session-summary",
        mode="queue",
        title="Manual QA next steps",
        summary="Coach web, coach mobile, then student mobile.",
        payload={"next": ["coach web", "coach mobile", "student mobile"]},
    )

    assert candidate["status"] == "pending"
    assert store.list_candidates(project_key="wodnix") == [candidate]


def test_invalid_mode_is_rejected(tmp_path):
    store = MemoryStore(tmp_path / "memory.db")

    with pytest.raises(ValueError, match="mode must be one of"):
        store.record_event(
            project_key="wodnix",
            source="cli",
            event_type="codex.stop",
            mode="immediate",
            payload={},
        )
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
.venv/bin/pytest tests/test_memory_store.py -q
```

Expected: FAIL because `agents.memory.store` does not exist.

- [ ] **Step 3: Implement `MemoryStore`**

Create `agents/memory/store.py` with methods:

```python
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agents.memory.schema import initialize_memory_db


ALLOWED_MODES = {"off", "queue", "auto"}
ALLOWED_CANDIDATE_STATUSES = {"pending", "processed", "needs-review"}
ALLOWED_SESSION_STATUSES = {"open", "closed"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def _json(data: dict[str, Any] | list[Any]) -> str:
    return json.dumps(data, sort_keys=True)


def _require_mode(mode: str) -> str:
    if mode not in ALLOWED_MODES:
        raise ValueError(f"mode must be one of {sorted(ALLOWED_MODES)}")
    return mode


class MemoryStore:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        initialize_memory_db(db_path)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
```

Then add `record_event`, `list_events`, `queue_candidate`, and `list_candidates`. `record_event` and `queue_candidate` must require a non-empty `source` string and persist it in the matching table. Deserialize `payload_json` to `payload` before returning records.

- [ ] **Step 4: Run the store tests**

Run:

```bash
.venv/bin/pytest tests/test_memory_store.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add agents/memory/store.py tests/test_memory_store.py
git commit -m "feat: add deterministic memory store"
```

## Task 3: Add Project Resolution For Memory Events

**Files:**
- Create: `agents/memory/project_resolver.py`
- Test: `tests/test_memory_project_resolver.py`

- [ ] **Step 1: Write failing resolver tests**

Create `tests/test_memory_project_resolver.py`:

```python
import json

from agents.memory.project_resolver import resolve_project_key


def test_resolve_project_key_from_registered_repo_path(tmp_path):
    projects_root = tmp_path / "projects"
    project_dir = projects_root / "wodnix"
    state_dir = project_dir / "state"
    state_dir.mkdir(parents=True)
    repo_dir = tmp_path / "repos" / "wodnix"
    repo_dir.mkdir(parents=True)
    (state_dir / "project.json").write_text(
        json.dumps({"key": "wodnix", "repo_paths": [str(repo_dir)]})
    )

    assert resolve_project_key(projects_root, repo_dir / "app") == "wodnix"


def test_resolve_project_key_returns_none_for_unknown_path(tmp_path):
    projects_root = tmp_path / "projects"
    projects_root.mkdir()

    assert resolve_project_key(projects_root, tmp_path / "elsewhere") is None
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
.venv/bin/pytest tests/test_memory_project_resolver.py -q
```

Expected: FAIL because the resolver module does not exist.

- [ ] **Step 3: Implement the resolver**

Create `agents/memory/project_resolver.py`:

```python
from __future__ import annotations

import json
from pathlib import Path


def resolve_project_key(projects_root: Path, cwd: Path) -> str | None:
    resolved_cwd = cwd.resolve()
    if not projects_root.is_dir():
        return None
    for project_json in sorted(projects_root.glob("*/state/project.json")):
        data = json.loads(project_json.read_text(encoding="utf-8"))
        key = str(data.get("key") or project_json.parents[1].name)
        for raw_repo_path in data.get("repo_paths") or []:
            repo_path = Path(str(raw_repo_path)).expanduser().resolve()
            try:
                resolved_cwd.relative_to(repo_path)
                return key
            except ValueError:
                continue
    return None
```

- [ ] **Step 4: Run resolver tests**

Run:

```bash
.venv/bin/pytest tests/test_memory_project_resolver.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add agents/memory/project_resolver.py tests/test_memory_project_resolver.py
git commit -m "feat: resolve memory project from cwd"
```

## Task 4: Add Session Storage And Latest-Session Pointer

**Files:**
- Modify: `agents/memory/store.py`
- Modify: `tests/test_memory_store.py`

- [ ] **Step 1: Add failing latest-session test**

Append:

```python
def test_upsert_session_sets_latest_session(tmp_path):
    store = MemoryStore(tmp_path / "memory.db")

    session = store.upsert_session(
        session_id="session-1",
        project_key="wodnix",
        title="S6 social friends visibility QA",
        status="open",
        summary="Prepared local Supabase reset and manual QA sequence.",
        next_actions=["reset db", "coach web", "coach mobile", "student mobile"],
        source_event_ids=["event_1"],
    )

    assert store.latest_session("wodnix") == session
    assert session["next_actions"] == [
        "reset db",
        "coach web",
        "coach mobile",
        "student mobile",
    ]


def test_invalid_session_status_is_rejected(tmp_path):
    store = MemoryStore(tmp_path / "memory.db")

    with pytest.raises(ValueError, match="status must be one of"):
        store.upsert_session(
            session_id="session-1",
            project_key="wodnix",
            title="Manual QA",
            status="paused",
            summary="Invalid status should fail.",
            next_actions=[],
            source_event_ids=[],
        )
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
.venv/bin/pytest tests/test_memory_store.py::test_upsert_session_sets_latest_session -q
```

Expected: FAIL because session methods do not exist.

- [ ] **Step 3: Implement `upsert_session` and `latest_session`**

Add methods to `MemoryStore` that:

- validate non-empty `project_key`, `session_id`, and `title`
- validate `status` is one of `open` or `closed`
- store `next_actions` as JSON
- store `source_event_ids` as JSON
- upsert `project_memory_state.latest_session_id`
- return deserialized session dictionaries

- [ ] **Step 4: Run store tests**

Run:

```bash
.venv/bin/pytest tests/test_memory_store.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add agents/memory/store.py tests/test_memory_store.py
git commit -m "feat: store project session continuity"
```

## Task 5: Add Memory CLI

**Files:**
- Create: `scripts/memory.py`
- Create: `tests/test_memory_cli.py`

- [ ] **Step 1: Write failing CLI tests**

Create `tests/test_memory_cli.py`:

```python
import json
import subprocess
import sys


def run_memory(tmp_path, *args):
    return subprocess.run(
        [
            sys.executable,
            "scripts/memory.py",
            "--db",
            str(tmp_path / "memory.db"),
            *args,
        ],
        check=True,
        text=True,
        capture_output=True,
    )


def test_memory_cli_records_event(tmp_path):
    result = run_memory(
        tmp_path,
        "record-event",
        "--project",
        "wodnix",
        "--source",
        "cli",
        "--event-type",
        "codex.stop",
        "--mode",
        "queue",
        "--input-summary",
        "qa stopped",
        "--payload-json",
        '{"card":"C4ufaxDz"}',
    )

    payload = json.loads(result.stdout)
    assert payload["project_key"] == "wodnix"
    assert payload["source"] == "cli"
    assert payload["payload"]["card"] == "C4ufaxDz"


def test_memory_cli_latest_session(tmp_path):
    run_memory(
        tmp_path,
        "session-summary",
        "--project",
        "wodnix",
        "--session-id",
        "session-1",
        "--title",
        "Manual QA",
        "--summary",
        "Ready for coach web testing.",
        "--next-action",
        "reset db",
    )

    result = run_memory(tmp_path, "latest-session", "--project", "wodnix")
    payload = json.loads(result.stdout)
    assert payload["title"] == "Manual QA"
    assert payload["next_actions"] == ["reset db"]
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
.venv/bin/pytest tests/test_memory_cli.py -q
```

Expected: FAIL because `scripts/memory.py` does not exist.

- [ ] **Step 3: Implement CLI commands**

Create `scripts/memory.py` with subcommands:

- `init`
- `record-event`
- `queue-candidate`
- `session-summary`
- `latest-session`

All commands print JSON to stdout. `--db` defaults to `state/memory.db`.
`record-event` and `queue-candidate` require `--source`; the Make target defaults it to `cli`.

- [ ] **Step 4: Run CLI tests**

Run:

```bash
.venv/bin/pytest tests/test_memory_cli.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/memory.py tests/test_memory_cli.py
git commit -m "feat: add memory cli"
```

## Task 6: Add Make Targets

**Files:**
- Modify: `Makefile`
- Test: `tests/test_memory_cli.py`

- [ ] **Step 1: Add a failing test for Makefile target presence**

Append to `tests/test_memory_cli.py`:

```python
def test_makefile_exposes_memory_targets():
    content = open("Makefile", encoding="utf-8").read()
    assert ".PHONY:" in content
    assert "memory-init:" in content
    assert "memory-record-event:" in content
    assert "memory-session:" in content
    assert "memory-latest-session:" in content
    assert "make memory-init" in content
    assert "make memory-latest-session PROJECT=<project-key>" in content
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
.venv/bin/pytest tests/test_memory_cli.py::test_makefile_exposes_memory_targets -q
```

Expected: FAIL until targets are added.

- [ ] **Step 3: Add Make targets and help text**

Modify the existing `Makefile`: add the memory targets to the existing `.PHONY` line, add the help `echo` lines inside the existing `help:` target, then add the concrete targets:

```make
# Add these names to the existing .PHONY line:
memory-init memory-record-event memory-session memory-latest-session

# Add these lines inside the existing help target:
	@echo "  make memory-init"
	@echo "      Initialize the repo-root SQLite memory database."
	@echo "  make memory-record-event PROJECT=<project-key> EVENT_TYPE=<type> [MODE=queue] [SOURCE=cli]"
	@echo "      Record a deterministic memory event."
	@echo "  make memory-session PROJECT=<project-key> SESSION_ID=<id> TITLE=<title> SUMMARY=<summary> [NEXT_ACTION=<action>]"
	@echo "      Store a project-scoped session summary and latest-session pointer."
	@echo "  make memory-latest-session PROJECT=<project-key>"
	@echo "      Print the latest project session memory as JSON."

memory-init:
	@python3 scripts/memory.py init

memory-record-event:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@test -n "$(EVENT_TYPE)" || (echo "EVENT_TYPE is required" && exit 1)
	@python3 scripts/memory.py record-event --project "$(PROJECT)" --source "$${SOURCE:-cli}" --event-type "$(EVENT_TYPE)" --mode "$${MODE:-queue}" --input-summary "$(INPUT_SUMMARY)" --output-summary "$(OUTPUT_SUMMARY)" --payload-json "$${PAYLOAD_JSON:-{}}"

memory-session:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@test -n "$(SESSION_ID)" || (echo "SESSION_ID is required" && exit 1)
	@test -n "$(TITLE)" || (echo "TITLE is required" && exit 1)
	@test -n "$(SUMMARY)" || (echo "SUMMARY is required" && exit 1)
	@python3 scripts/memory.py session-summary --project "$(PROJECT)" --session-id "$(SESSION_ID)" --title "$(TITLE)" --summary "$(SUMMARY)" $(if $(NEXT_ACTION),--next-action "$(NEXT_ACTION)",)

memory-latest-session:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@python3 scripts/memory.py latest-session --project "$(PROJECT)"
```

- [ ] **Step 4: Run CLI tests**

Run:

```bash
.venv/bin/pytest tests/test_memory_cli.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add Makefile tests/test_memory_cli.py
git commit -m "feat: expose memory cli through make"
```

## Task 7: Add MCP Facade Tools With Stable Response Metadata

**Files:**
- Modify: `mcp/llm_wiki_mcp.py`
- Modify: `tests/test_mcp_server.py`

- [ ] **Step 1: Write failing registration test**

Add or extend an MCP registration test:

```python
def test_v2_memory_facade_tools_are_registered(monkeypatch):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()

    for name in ("query", "how", "what"):
        assert name in module.TOOL_NAMES
```

Also add a response-shape test that monkeypatches `query_wiki` and proves the facade is not a raw alias:

```python
def test_query_facade_wraps_query_wiki_response(monkeypatch):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()

    monkeypatch.setattr(
        module,
        "query_wiki",
        lambda project_key=None, question="", raw=False: {
            "answer": "Known from wiki.",
            "confidence": 0.9,
            "citations": ["index.md"],
            "emitted_gap_id": None,
        },
    )

    response = module.query(project_key="llm-wiki", question="what is known")

    assert response["answer"] == "Known from wiki."
    assert response["confidence"] == 0.9
    assert response["memory_scope"] == "project_wiki"
    assert response["citations"] == ["index.md"]
    assert response["candidate_ids"] == []
    assert response["degraded"] is False
    assert response["degraded_reason"] is None
    assert response["source_tools"] == ["query_wiki"]


def test_query_facade_marks_unavailable_personal_memory_degraded(monkeypatch):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()

    monkeypatch.setattr(
        module,
        "query_wiki",
        lambda project_key=None, question="", raw=False: {
            "answer": "The project wiki does not yet have personal preference memory.",
            "confidence": 0.4,
            "citations": [],
            "emitted_gap_id": None,
        },
    )

    response = module.query(project_key="llm-wiki", question="What does Liad prefer for tests?")

    assert response["memory_scope"] == "project_wiki"
    assert response["degraded"] is True
    assert response["degraded_reason"] == "personal workflow memory is not implemented in this slice"
    assert response["source_tools"] == ["query_wiki"]
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
.venv/bin/pytest tests/test_mcp_server.py::test_v2_memory_facade_tools_are_registered -q
```

Expected: FAIL because the tools are not registered and response wrapping does not exist.

These tests must follow the existing `tests/test_mcp_server.py` import pattern: set `LLM_WIKI_ROOT`, call `_load_module()`, and patch attributes on the returned module.

- [ ] **Step 3: Register tool names**

Add `query`, `how`, and `what` to `TOOL_NAMES` without removing existing tools.

- [ ] **Step 4: Add facade response helpers**

In `mcp/llm_wiki_mcp.py`, add a helper equivalent to:

```python
def _query_degraded_reason(question: str) -> str | None:
    normalized = question.lower()
    if "liad" in normalized or "prefer" in normalized or "preference" in normalized:
        return "personal workflow memory is not implemented in this slice"
    if "recipe" in normalized or "how we do" in normalized or "how do we" in normalized:
        return "recipe memory is not implemented in this slice"
    if "vector" in normalized or "semantic search" in normalized:
        return "vector memory is not implemented in this slice"
    return None


def _facade_response(
    response: dict,
    *,
    memory_scope: str,
    source_tools: list[str],
    degraded: bool = False,
    degraded_reason: str | None = None,
) -> dict:
    candidate_ids = []
    emitted_gap_id = response.get("emitted_gap_id")
    if emitted_gap_id:
        candidate_ids.append(str(emitted_gap_id))
    return {
        **response,
        "answer": response.get("answer", ""),
        "confidence": response.get("confidence", 0.0),
        "memory_scope": memory_scope,
        "citations": response.get("citations") or [],
        "candidate_ids": candidate_ids,
        "degraded": degraded,
        "degraded_reason": degraded_reason,
        "source_tools": source_tools,
    }
```

- [ ] **Step 5: Add first-slice facade functions**

In `mcp/llm_wiki_mcp.py`, add:

```python
@mcp.tool()
def query(project_key: str | None = None, question: str = "", raw: bool = False) -> dict:
    """Ask what is true or known across project-rooted memory."""
    degraded_reason = _query_degraded_reason(question)
    return _facade_response(
        query_wiki(project_key=project_key, question=question, raw=raw),
        memory_scope="project_wiki",
        source_tools=["query_wiki"],
        degraded=degraded_reason is not None,
        degraded_reason=degraded_reason,
    )


@mcp.tool()
def how(project_key: str | None = None, question: str = "", raw: bool = False) -> dict:
    """Ask for operating guidance from project memory and future recipes."""
    return _facade_response(
        query_wiki(project_key=project_key, question=question, raw=raw),
        memory_scope="project_wiki",
        source_tools=["query_wiki"],
        degraded=True,
        degraded_reason="recipe and personal workflow routing are not implemented in this slice",
    )


@mcp.tool()
def what(project_key: str | None = None, question: str = "", raw: bool = False) -> dict:
    """Ask for current state or inventory from project memory."""
    return _facade_response(
        query_wiki(project_key=project_key, question=question, raw=raw),
        memory_scope="project_wiki",
        source_tools=["query_wiki"],
        degraded=True,
        degraded_reason="structured state routing is only implemented for latest-session queries in this slice",
    )
```

First-slice `query` may delegate to `query_wiki`, but it must expose the stable facade fields. First-slice `how` and fallback `what` must explicitly mark degraded routing until recipe, personal, and broader state routing exist.

Add focused tests for the degraded first-slice facades:

```python
def test_how_facade_marks_recipe_and_personal_routing_degraded(monkeypatch):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()
    monkeypatch.setattr(
        module,
        "query_wiki",
        lambda project_key=None, question="", raw=False: {
            "answer": "Use the project runbook.",
            "confidence": 0.8,
            "citations": ["wiki/runbooks/local.md"],
        },
    )

    response = module.how(project_key="sample", question="how do we run this")

    assert response["memory_scope"] == "project_wiki"
    assert response["degraded"] is True
    assert response["degraded_reason"] == "recipe and personal workflow routing are not implemented in this slice"
    assert response["source_tools"] == ["query_wiki"]


def test_what_fallback_marks_structured_state_routing_degraded(monkeypatch):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()
    monkeypatch.setattr(
        module,
        "query_wiki",
        lambda project_key=None, question="", raw=False: {
            "answer": "Known project state.",
            "confidence": 0.7,
            "citations": ["index.md"],
        },
    )

    response = module.what(project_key="sample", question="what features exist")

    assert response["memory_scope"] == "project_wiki"
    assert response["degraded"] is True
    assert response["degraded_reason"] == "structured state routing is only implemented for latest-session queries in this slice"
    assert response["source_tools"] == ["query_wiki"]
```

- [ ] **Step 6: Run MCP tests**

Run:

```bash
.venv/bin/pytest tests/test_mcp_server.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add mcp/llm_wiki_mcp.py tests/test_mcp_server.py
git commit -m "feat: add memory facade mcp tools"
```

## Task 8: Route `what` Latest-Session Queries To SQLite

**Files:**
- Modify: `mcp/llm_wiki_mcp.py`
- Modify: `tests/test_mcp_server.py`

- [ ] **Step 1: Write failing test for latest-session answer**

Add a test that prepares a temporary memory database with a latest session and patches the server memory db path if needed. The assertion should prove that `what(project_key="wodnix", question="what did we work on last session")` returns the stored session without calling the weak-model query path.

Expected response fields:

```python
from agents.memory.store import MemoryStore


def test_what_latest_session_uses_memory_without_query_wiki(monkeypatch, tmp_path):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()
    monkeypatch.setattr(module, "_memory_db_path", lambda: tmp_path / "memory.db")
    monkeypatch.setattr(
        module,
        "query_wiki",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("query_wiki should not be called")),
    )
    MemoryStore(tmp_path / "memory.db").upsert_session(
        session_id="session-1",
        project_key="wodnix",
        title="S6 social friends visibility QA",
        status="open",
        summary="Prepared local Supabase reset and manual QA sequence.",
        next_actions=["reset db", "coach web", "coach mobile", "student mobile"],
        source_event_ids=[],
    )

    response = module.what(project_key="wodnix", question="what did we work on last session")

    assert response["answer"].startswith("Last session:")
    assert response["memory_scope"] == "project_session"
    assert response["confidence"] == 1.0
    assert response["citations"] == ["memory_sessions:session-1"]
    assert response["candidate_ids"] == []
    assert response["degraded"] is False
    assert response["degraded_reason"] is None
    assert response["source_tools"] == ["memory_sessions"]
```

Add a second test for the empty-state behavior:

```python
def test_what_latest_session_returns_degraded_when_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("LLM_WIKI_ROOT", str(REPO_ROOT))
    module = _load_module()

    monkeypatch.setattr(module, "_memory_db_path", lambda: tmp_path / "memory.db")
    monkeypatch.setattr(
        module,
        "query_wiki",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("query_wiki should not be called")),
    )

    response = module.what(project_key="wodnix", question="what did we work on last session")

    assert response["confidence"] == 0.0
    assert response["memory_scope"] == "project_session"
    assert response["citations"] == []
    assert response["candidate_ids"] == []
    assert response["degraded"] is True
    assert response["degraded_reason"] == "no latest session memory exists for this project"
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
.venv/bin/pytest tests/test_mcp_server.py -q
```

Expected: FAIL because `what` delegates to `query_wiki`.

- [ ] **Step 3: Add deterministic latest-session routing**

Implement a helper in `mcp/llm_wiki_mcp.py`:

```python
def _memory_db_path() -> Path:
    return _root() / "state" / "memory.db"


def _is_latest_session_question(question: str) -> bool:
    normalized = question.lower()
    return "last session" in normalized or "worked on last session" in normalized
```

If matched, read from `MemoryStore(_memory_db_path()).latest_session(resolved_project_key)`. Return a structured facade response when found; otherwise return a low-confidence response with `memory_scope: "project_session"`, `degraded: true`, and `degraded_reason: "no latest session memory exists for this project"`. Do not fall through to `query_wiki` for latest-session misses.

- [ ] **Step 4: Run MCP tests**

Run:

```bash
.venv/bin/pytest tests/test_mcp_server.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add mcp/llm_wiki_mcp.py tests/test_mcp_server.py
git commit -m "feat: answer latest-session queries from memory"
```

## Task 9: Document Automation Boundaries In Capabilities

**Files:**
- Modify: `mcp/llm_wiki_mcp.py`
- Modify: `tests/test_mcp_server.py`

- [ ] **Step 1: Add failing capabilities assertion**

Add an assertion that `capabilities_resource()` includes:

```python
automation = capabilities["automation_policy"]
assert automation["hooks_call_llms"] is False
assert automation["hooks_mutate_curated_memory"] is False
assert automation["curated_memory_modes"] == ["off", "queue", "auto"]
assert automation["recipe_promotion_default"] == "queue"
assert automation["preference_promotion_default"] == "queue"
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
.venv/bin/pytest tests/test_mcp_server.py -q
```

Expected: FAIL because the policy is not exposed.

- [ ] **Step 3: Update capabilities resource**

Add:

```python
"automation_policy": {
    "hooks_call_llms": False,
    "hooks_mutate_curated_memory": False,
    "curated_memory_modes": ["off", "queue", "auto"],
    "project_update_default": "auto",
    "recipe_promotion_default": "queue",
    "preference_promotion_default": "queue",
}
```

- [ ] **Step 4: Run MCP tests**

Run:

```bash
.venv/bin/pytest tests/test_mcp_server.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add mcp/llm_wiki_mcp.py tests/test_mcp_server.py
git commit -m "docs: expose memory automation policy"
```

## Task 10: Add Operator Documentation

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Test: `tests/test_memory_cli.py`

- [ ] **Step 1: Add failing documentation smoke test**

Append:

```python
def test_memory_operator_docs_exist():
    readme = open("README.md", encoding="utf-8").read()
    agents = open("AGENTS.md", encoding="utf-8").read()
    assert "Project docs capture what code does not cheaply reveal" in readme
    assert "Hooks must never call LLMs directly" in agents
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
.venv/bin/pytest tests/test_memory_cli.py::test_memory_operator_docs_exist -q
```

Expected: FAIL until docs are added.

- [ ] **Step 3: Update README**

Add a concise V2 memory section near the product overview:

```markdown
## V2 Memory Direction

Project docs capture what code does not cheaply reveal: product behavior, workflows, decisions, setup gotchas, manual QA flows, and current work state. SQLite-backed memory stores raw events, candidates, and session continuity so agents can start warm without turning every hook into an LLM call.
```

- [ ] **Step 4: Update AGENTS.md**

Add an operational rule section:

```markdown
## V2 Memory Automation Boundary

Hooks must never call LLMs directly. Hooks append raw events and enqueue candidates only. Deterministic workers may update indexes and session pointers. Agentic workers require an explicit `off`, `queue`, or `auto` mode plus locks and budgets. Recipe and personal-preference promotion default to queue/manual until proven safe.
```

- [ ] **Step 5: Run docs smoke test**

Run:

```bash
.venv/bin/pytest tests/test_memory_cli.py::test_memory_operator_docs_exist -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add README.md AGENTS.md tests/test_memory_cli.py
git commit -m "docs: document v2 memory boundaries"
```

## Task 11: Final Verification

**Files:**
- All files touched by this plan.

- [ ] **Step 1: Run focused tests**

Run:

```bash
.venv/bin/pytest tests/test_memory_store.py tests/test_memory_project_resolver.py tests/test_memory_cli.py tests/test_mcp_server.py -q
```

Expected: PASS.

- [ ] **Step 2: Run broader tests**

Run:

```bash
.venv/bin/pytest tests/ -q
```

Expected: PASS except for documented pre-existing sample-fixture failures if `projects/sample/` is absent:

- `test_plan_a_acceptance`
- `test_plan_b_acceptance`
- `test_state_migration.py::test_sample_project_registered`

- [ ] **Step 3: Inspect working tree**

Run:

```bash
rtk git status --short --untracked-files=all
```

Expected: only intentional changes remain.

- [ ] **Step 4: Run a smoke command**

Run:

```bash
make memory-init
```

Expected: command exits 0 and initializes `state/memory.db`.

- [ ] **Step 5: Record follow-up work**

Create follow-up issues or plan files for:

- Codex hook event capture
- Gemini embedding provider
- sqlite-vec/Bun indexer
- recipe candidate collection
- preference candidate collection
- behavior-focused project compiler changes

## Self-Review

Spec coverage:

- Project-rooted memory substrate: Tasks 1-4.
- Repo ignore rules for new tests and generated SQLite state: Task 0.
- Deterministic capture and queue modes: Tasks 2, 5, 9.
- Project-scoped session continuity: Tasks 4, 5, 8.
- High-level MCP surface: Tasks 7-9.
- Operator control and no hook-side LLM calls: Tasks 9-10.
- Vector/embedding and promotion boundaries: explicitly deferred in Scope and Task 11 follow-ups.

Placeholder scan:

- The plan contains no implementation placeholder tokens from the writing-plans checklist.
- Large future subsystems are explicitly out of scope, not left undefined inside this plan.

Type consistency:

- `mode` values are consistently `off`, `queue`, and `auto`.
- Candidate statuses are consistently `pending`, `processed`, and `needs-review`.
- Session statuses are consistently `open` and `closed`.
- Session APIs consistently use `project_key`, `session_id`, `next_actions`, and `source_event_ids`.
- Event and candidate APIs consistently include `source`.
