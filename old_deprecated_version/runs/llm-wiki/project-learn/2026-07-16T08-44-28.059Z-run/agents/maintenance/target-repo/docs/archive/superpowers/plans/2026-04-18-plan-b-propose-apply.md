# Plan B — Propose + Apply + Safety Ladder Implementation Plan

**Status:** Ready for development (revision 5, audit passed)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete stages 3-5 of the unified update pipeline (propose + approve + apply) plus the safety ladder, commit-pointer pending/committed semantics, pending-approvals flow, and the legacy-state fallbacks so `make update-v2 PROJECT=sample` runs end-to-end from "no wiki" to "written wiki" under both gated and `AUTO=1` modes.

**Architecture:** Propose is an LLM agent stage that writes a structured `proposal.json` + human-readable `proposal.md`. Approve is operator action — the operator adds `"approved": true` at the top of `proposal.json` (or propose does this directly under `AUTO=1`). Apply is a script-only stage that pre-flight-validates the proposal, classifies units as additive vs. destructive, splits destructive/high-uncertainty units to `state/pending-approvals/<proposal-id>/` under AUTO=1, applies the additive portion, regenerates `index.md`, and writes stage completion markers. `scripts/apply_commit.sh` advances `last_seen_commit_pending` → `last_seen_commit` at pipeline end. Existing `scripts/status.sh` and `scripts/lint.sh` gain v2 state schema support with fallback to v1 for unmigrated projects.

**Tech Stack:** Bash scripts with embedded Python 3 heredocs (consistent with Plan A's patterns), Python 3.13, pytest, JSON state files, Markdown artifacts. LLM invocation via existing `codex`/`claude` CLI patterns. Stub mechanism via `LLM_STUB_RESPONSES_DIR` (same harness as Plan A).

**Source spec:** `docs/superpowers/specs/2026-04-18-unified-update-pipeline-design.md` (revision 4, audit-passed)
**Prerequisite:** Plan A complete (`docs/superpowers/plans/2026-04-18-plan-a-foundation.md`) — all 19 tasks landed, 58 tests passing.

**Plan scope:** M2 of the migration plan. Plan C (validate + reconcile + measurement + pilot rebootstrap) is a separate document.

---

## File Structure

### New files to create

**Stage 3 — Propose:**
- `agents/update/03-propose/config.json`
- `agents/update/03-propose/instructions.md`
- `agents/update/03-propose/run.sh`

**Stage 4 — Apply:**
- `agents/update/04-apply/config.json`
- `agents/update/04-apply/instructions.md`
- `agents/update/04-apply/run.sh`

**Scripts:**
- `scripts/apply_commit.sh` (commit pointer pending → committed)
- `scripts/apply_pending.sh` (apply deferred units from pending-approvals)
- `scripts/reject_pending.sh` (archive deferred units without applying)

**Fixtures:**
- `tests/fixtures/stubs/03-propose.json` (baseline propose LLM stub)

**Tests:**
- `tests/test_update_propose.py`
- `tests/test_update_apply.py`
- `tests/test_apply_commit.py`
- `tests/test_pending_approvals.py`
- `tests/test_status_v2_fallback.py`
- `tests/test_init_project_v2.py`
- `tests/test_plan_b_acceptance.py`

**Templates:**
- `templates/state/update-state.template.json` (new v2 template; replaces `bootstrap-state.template.json` in M5, coexists for now)

### Files to modify

- `scripts/update.sh` — extend to call propose + apply + apply_commit; support `APPROVED=<run-dir>` or `CONTINUE=1` for resuming after gated approval
- `scripts/status.sh` — read `update-state.json` with fallback to `bootstrap-state.json`, print new fields
- `scripts/lint.sh` — write to `update-state.json.latest_lint_findings` with fallback
- `scripts/init_project.sh` — produce v2 `project.json` (adds `acceptance_questions_path`, `ranking_cutoff`; removes `bootstrap_focuses`)
- `templates/state/project.template.json` — v2 shape
- `Makefile` — add `update-v2-continue`, `apply-pending`, `reject-pending` targets
- `AGENTS.md` — add `index.md`'s `## Status` block exemption to writing rules

---

## Task Sequence

Tasks are grouped by dependency. Each task follows TDD (test → fail → implement → pass → commit). Commit after each passing task.

---

### Task 0: Extend Plan A freshness fixtures with v2 pending fields

**Files:**
- Modify: `tests/fixtures/project_state/state/freshness.json`
- Modify: `projects/sample/state/freshness.json`

Plan A shipped these files with `last_seen_commit_pending` but without `last_update_at_pending`. Plan B's apply stage writes both fields, and a later test (`test_apply_writes_freshness_pending` in Task 5) asserts `last_update_at_pending is not None`. This task extends the fixtures before any code that depends on them.

**TDD exemption:** Pure fixture data change with no logic; the behavioral test that exercises the field lives in Task 5.

- [ ] **Step 1: Update both freshness files to the complete v2 shape**

Overwrite `tests/fixtures/project_state/state/freshness.json` with exactly:

```json
{
  "last_seen_commit": null,
  "last_seen_commit_pending": null,
  "last_update_at": null,
  "last_update_at_pending": null,
  "changed_paths": [],
  "impacted_pages": [],
  "status": "unknown",
  "updated_at": null
}
```

Overwrite `projects/sample/state/freshness.json` with the same content.

- [ ] **Step 2: Verify existing Plan A tests still pass**

Run: `.venv/bin/pytest -q`
Expected: 58 tests pass (no new tests yet; no regression from the schema addition).

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/project_state/state/freshness.json projects/sample/state/freshness.json
git commit -m "test(fixtures): add last_update_at_pending to v2 freshness schema"
```

---

### Task 1: Propose stage — config + instructions

**Files:**
- Create: `agents/update/03-propose/config.json`
- Create: `agents/update/03-propose/instructions.md`
- Test: `tests/test_validate_stage_configs.py` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_validate_stage_configs.py`:

```python
def test_propose_config_exists_and_validates():
    """Propose stage config must exist, load, and declare max_new_pages."""
    stages_root = REPO_ROOT / "agents" / "update"
    propose_config = stages_root / "03-propose" / "config.json"
    assert propose_config.is_file(), f"missing: {propose_config}"
    data = json.loads(propose_config.read_text())
    assert data["stage"] == "propose"
    assert "max_new_pages" in data["stage_specific"]
    assert data["stage_specific"]["max_new_pages"] == 25
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py::test_propose_config_exists_and_validates -v`
Expected: FAIL.

- [ ] **Step 3: Create config.json and instructions.md**

Create `agents/update/03-propose/config.json`:

```json
{
  "stage": "propose",
  "agent_kind": "llm-agent",
  "token_budget_input": 80000,
  "token_budget_output": 20000,
  "on_over_budget": "fail-clean",
  "stage_specific": {
    "max_new_pages": 25,
    "max_units_per_proposal": 50,
    "destructive_actions": ["delete", "rename"]
  }
}
```

Create `agents/update/03-propose/instructions.md`:

```markdown
# Propose Stage — Instructions

You are the **propose** stage of the unified update pipeline. You draft a full changeset (page creates, updates, deletes, renames) plus `index.md` edits, with every unit justified against the ranking produced by the impact stage.

## Inputs

- `impact-report.json` — affected pages, new domains, stale pages
- `ranking-snapshot.json` — authoritative ranked domain list (Signal A+B+C)
- Current wiki state under `projects/<key>/wiki/`
- Current repo files under `project.json.repo_paths`
- `config.json.stage_specific.max_new_pages` (cap on new-page count)

## Output

Write two paired artifacts to the run directory:
- `proposal.json` — machine payload per spec Section 5.3
- `proposal.md` — human render grouped by action, destructive units visibly separated

## Rules (mechanically enforced by the apply stage's pre-flight)

1. Every unit must have `justification_signals` containing at least one of `A`, `B`, `C`.
2. Every `referenced_ranking_domains` entry must appear in `ranking-snapshot.json.ranked_domains`.
3. `new_pages_count` must not exceed `max_new_pages`. Excess domains go to `deferred_domains` with a reason.
4. Every unit must include `source_classification` with the five required fields (`source_kind`, `ownership`, `destination`, `update_targets`, `action`) — preserved from the 2026-04-17 ingest contract.
5. Every `source_citations` entry must resolve to a real file and line range in the repo.
6. `destructive: true` on any unit OR `index_changes.destructive: true` forces approval even under `AUTO=1`.
7. `uncertainty: high` on any unit forces approval even under `AUTO=1`.

## Approval gate

- If invoked under gated mode (default), write `proposal.json` with `"approved": false` at top level. The operator reviews and edits `approved: true` to bless the proposal.
- If invoked under `AUTO=1`, write `"approved": true` directly. The apply stage's safety ladder still splits destructive/high-uncertainty units to `pending-approvals/`.

## Budget

Token budget: 80000 input / 20000 output. Over budget = clean failure, no artifacts written.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py -v`
Expected: 6 tests pass (5 prior + new).

Full suite: `.venv/bin/pytest -q`
Expected: 59 total pass.

- [ ] **Step 5: Commit**

```bash
git add agents/update/03-propose/ tests/test_validate_stage_configs.py
git commit -m "feat(update/propose): add config.json and instructions.md"
```

---

### Task 2: Propose baseline LLM stub

**Files:**
- Create: `tests/fixtures/stubs/03-propose.json`
- Test: `tests/test_llm_client_stub.py` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_llm_client_stub.py`:

```python
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
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_llm_client_stub.py::test_propose_baseline_stub_present_and_valid -v`
Expected: FAIL.

- [ ] **Step 3: Create the stub**

Create `tests/fixtures/stubs/03-propose.json`:

```json
{
  "stage": "03-propose",
  "response": {
    "project": "sample",
    "run_id": "placeholder-will-be-stamped-by-runner",
    "summary": "Initial bootstrap: 3 domain pages + index.",
    "ranking_snapshot_path": "projects/sample/state/latest/ranking-snapshot.json",
    "max_new_pages": 25,
    "max_new_pages_config_source": "agents/update/03-propose/config.json:stage_specific.max_new_pages",
    "new_pages_count": 3,
    "deferred_domains": [],
    "approved": false,
    "units": [
      {
        "id": "u1",
        "action": "create",
        "page_path": "wiki/systems/authentication.md",
        "rename_from": null,
        "destructive": false,
        "uncertainty": "low",
        "justification": "Top-ranked domain per ranking-snapshot.json (rank 1). Cites src/auth.py and README.md.",
        "justification_signals": ["A", "B", "C"],
        "referenced_ranking_domains": ["authentication"],
        "source_classification": {
          "source_kind": "implementation-note",
          "ownership": "project:sample",
          "destination": "wiki/systems/authentication.md",
          "update_targets": ["wiki/systems/authentication.md"],
          "action": "create-new-page-and-update-index"
        },
        "content": "Session authentication for the sample app. Owns the SESSIONS dict.\n\n## Repo pointers\n\n- `src/auth.py:1-23` — login/logout/whoami functions and SESSIONS dict\n\nThe auth module issues an opaque session id on login and tracks it in the in-memory `SESSIONS` dictionary. `logout` removes the entry; `whoami` returns the username. No persistence.\n\n## Related\n\n- [data-store](../systems/data-store.md) — where session-authenticated users write data\n- [entry-point](../systems/entry-point.md) — how the app wires auth in\n- Known gaps: no persistence, no token expiry\n",
        "affected_cross_refs": ["wiki/systems/data-store.md", "wiki/systems/entry-point.md"],
        "source_citations": ["src/auth.py:1-23"]
      },
      {
        "id": "u2",
        "action": "create",
        "page_path": "wiki/systems/data-store.md",
        "rename_from": null,
        "destructive": false,
        "uncertainty": "low",
        "justification": "Rank 2 domain. Cites src/db.py.",
        "justification_signals": ["A", "B"],
        "referenced_ranking_domains": ["data-store"],
        "source_classification": {
          "source_kind": "implementation-note",
          "ownership": "project:sample",
          "destination": "wiki/systems/data-store.md",
          "update_targets": ["wiki/systems/data-store.md"],
          "action": "create-new-page-and-update-index"
        },
        "content": "In-memory key-value store for the sample app.\n\n## Repo pointers\n\n- `src/db.py:1-15` — put/get/delete on the _STORE dict\n\n`_STORE` is a module-level dictionary. No locking, no persistence.\n\n## Related\n\n- [authentication](../systems/authentication.md) — session ids are not stored here\n- Known gaps: no persistence layer; data is lost on restart\n",
        "affected_cross_refs": ["wiki/systems/authentication.md"],
        "source_citations": ["src/db.py:1-15"]
      },
      {
        "id": "u3",
        "action": "create",
        "page_path": "wiki/systems/entry-point.md",
        "rename_from": null,
        "destructive": false,
        "uncertainty": "low",
        "justification": "Rank 3 domain. Cites src/main.py.",
        "justification_signals": ["A", "B"],
        "referenced_ranking_domains": ["entry-point"],
        "source_classification": {
          "source_kind": "implementation-note",
          "ownership": "project:sample",
          "destination": "wiki/systems/entry-point.md",
          "update_targets": ["wiki/systems/entry-point.md"],
          "action": "create-new-page-and-update-index"
        },
        "content": "Sample app entry point. Wires auth and db together.\n\n## Repo pointers\n\n- `src/main.py:1-13` — main() orchestrates login → put → get\n\nOn invocation, creates an alice session, writes a record to the store, prints it back.\n\n## Related\n\n- [authentication](../systems/authentication.md) — provides the session\n- [data-store](../systems/data-store.md) — target of the write\n",
        "affected_cross_refs": ["wiki/systems/authentication.md", "wiki/systems/data-store.md"],
        "source_citations": ["src/main.py:1-13"]
      }
    ],
    "index_changes": {
      "action": "update",
      "destructive": false,
      "content": "Sample project — a minimal Python application used as a test fixture.\n\n## Start here\n\n- [authentication](wiki/systems/authentication.md) — session lifecycle\n- [data-store](wiki/systems/data-store.md) — where data lives\n- [entry-point](wiki/systems/entry-point.md) — how the app runs\n\n## Routing\n\n### Systems\n\n- [authentication](wiki/systems/authentication.md) — session auth\n- [data-store](wiki/systems/data-store.md) — in-memory KV store\n- [entry-point](wiki/systems/entry-point.md) — app entry\n\n## Gaps and deferred\n\n- No tests are described yet; add a runbook if test automation grows\n\n## Status\n\n- Last update: <stamped-by-apply>\n- Freshness: see `state/latest/validation-report.md`\n- Measurement: see `state/latest/measurement-report.md`\n",
      "categories_reshuffled": 0
    },
    "state_changes_intent": {
      "last_seen_commit_pending": "<stamped-by-apply>",
      "last_update_at_pending": "<stamped-by-apply>"
    }
  },
  "tokens_consumed": {"input": 30000, "output": 6000}
}
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_llm_client_stub.py -v`
Expected: 6 tests pass (5 prior + 1 new).

Full suite: `.venv/bin/pytest -q`
Expected: 60 pass.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/stubs/03-propose.json tests/test_llm_client_stub.py
git commit -m "test(fixtures): add baseline LLM stub for propose"
```

---

### Task 3: Propose run.sh

**Files:**
- Create: `agents/update/03-propose/run.sh`
- Test: `tests/test_update_propose.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_update_propose.py`:

```python
"""Propose stage tests. Uses LLM_STUB_RESPONSES_DIR for the LLM call."""

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _run_through_propose(project_dir: Path, stub_dir: Path, run_dir: Path, auto: bool = False):
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(stub_dir)}
    if auto:
        env["AUTO"] = "1"
    for stage in ("01-sense", "02-impact", "03-propose"):
        rc = subprocess.run(
            ["bash", str(REPO_ROOT / "agents" / "update" / stage / "run.sh"),
             "--project", "sample", "--project-dir", str(project_dir), "--run-dir", str(run_dir)],
            env=env, capture_output=True, text=True,
        )
        if rc.returncode != 0:
            return rc
    return rc


def test_propose_writes_proposal_json_and_md(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_propose(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    assert (run_dir / "proposal.json").is_file()
    assert (run_dir / "proposal.md").is_file()
    proposal = json.loads((run_dir / "proposal.json").read_text())
    assert proposal["project"] == "sample"
    assert proposal["run_id"] == run_dir.name
    assert proposal["approved"] is False
    assert len(proposal["units"]) >= 1


def test_propose_auto_mode_marks_approved(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_propose(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
        auto=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    proposal = json.loads((run_dir / "proposal.json").read_text())
    assert proposal["approved"] is True


def test_propose_writes_completion_marker(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_propose(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0
    us = json.loads((tmp_sample_project_with_repo / "state" / "update-state.json").read_text())
    assert us["stages"]["propose"]["status"] == "completed"
    assert us["last_completed_stage"] == "propose"
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_update_propose.py -v`
Expected: FAIL (run.sh doesn't exist).

- [ ] **Step 3: Implement run.sh**

Create `agents/update/03-propose/run.sh`:

```bash
#!/usr/bin/env bash
# Propose stage — drafts changeset (proposal.json + proposal.md).
#
# Produces: <run-dir>/proposal.json, <run-dir>/proposal.md.
# Under AUTO=1, writes approved=true directly. Otherwise approved=false
# and the operator must edit proposal.json to bless it.

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/03-propose/run.sh --project <project-key> [--project-dir <project-dir>] --run-dir <artifact-dir>
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
[[ -f "$run_dir/impact-report.json" ]] || die "impact-report.json missing in $run_dir"
[[ -f "$run_dir/ranking-snapshot.json" ]] || die "ranking-snapshot.json missing in $run_dir"

auto="${AUTO:-}"

python3 - "$project_key" "$project_dir" "$run_dir" "$AGENT_DIR" "$ROOT_DIR" "$auto" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
agent_dir = Path(sys.argv[4])
root_dir = Path(sys.argv[5])
auto = sys.argv[6] == "1"

sys.path.insert(0, str(root_dir))
from agents.update._shared import llm_client  # noqa: E402

impact = json.loads((run_dir / "impact-report.json").read_text())
ranking = json.loads((run_dir / "ranking-snapshot.json").read_text())

prompt = json.dumps({
    "project_key": project_key,
    "impact": impact,
    "ranking": ranking,
})
result = llm_client.invoke(stage_id="03-propose", prompt=prompt)
proposal = result["response"]

# Stamp runtime fields
proposal["run_id"] = run_dir.name
proposal["approved"] = True if auto else False

# Stamp state_changes_intent with real values. The stub may contain a
# sentinel like "<stamped-by-apply>"; we always resolve it here and fall
# back to None rather than letting the sentinel leak into persisted state.
sci = proposal.get("state_changes_intent", {})
now = datetime.now(timezone.utc).isoformat()
sci["last_update_at_pending"] = now
sci["last_seen_commit_pending"] = None  # default — overridden below if a repo is discoverable
pj = json.loads((project_dir / "state" / "project.json").read_text())
import subprocess as sp
repo_paths = pj.get("repo_paths", [])
if repo_paths:
    repo = Path(repo_paths[0])
    if not repo.is_absolute():
        repo = root_dir / repo
    if (repo / ".git").is_dir():
        head = sp.run(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            capture_output=True, text=True,
        )
        if head.returncode == 0:
            sci["last_seen_commit_pending"] = head.stdout.strip()
proposal["state_changes_intent"] = sci

# Update index_changes Status block if present with placeholder
ic = proposal.get("index_changes", {})
if ic.get("content") and "<stamped-by-apply>" in ic["content"]:
    ic["content"] = ic["content"].replace("<stamped-by-apply>", now)
proposal["index_changes"] = ic

(run_dir / "proposal.json").write_text(json.dumps(proposal, indent=2) + "\n")

# Human-readable proposal.md
md_lines: list[str] = []
md_lines.append(f"# Proposal — {proposal['run_id']}")
md_lines.append("")
md_lines.append(f"**Project:** {proposal['project']}")
md_lines.append(f"**Approved:** {proposal['approved']}")
md_lines.append(f"**Summary:** {proposal.get('summary', '(none)')}")
md_lines.append("")
destructive_units = [u for u in proposal.get("units", []) if u.get("destructive")]
if destructive_units:
    md_lines.append("## ⚠ Destructive units (require approval even under AUTO=1)")
    md_lines.append("")
    for u in destructive_units:
        md_lines.append(f"- `{u['action']}` **{u['page_path']}** — {u.get('justification', '')}")
    md_lines.append("")
md_lines.append("## Additive units")
md_lines.append("")
for u in proposal.get("units", []):
    if u.get("destructive"):
        continue
    md_lines.append(f"- `{u['action']}` **{u['page_path']}** — {u.get('justification', '')}")
md_lines.append("")
deferred = proposal.get("deferred_domains", [])
if deferred:
    md_lines.append("## Deferred domains (below max_new_pages cap)")
    md_lines.append("")
    for d in deferred:
        md_lines.append(f"- rank {d.get('rank')}: **{d.get('domain')}** — {d.get('reason', '')}")
    md_lines.append("")
if not proposal["approved"]:
    md_lines.append("---")
    md_lines.append("")
    md_lines.append("**To approve:** edit `proposal.json` and set `\"approved\": true`, then run `make update-v2-continue PROJECT=<key>`.")
(run_dir / "proposal.md").write_text("\n".join(md_lines) + "\n")

# Stage completion marker
us_path = project_dir / "state" / "update-state.json"
if us_path.is_file():
    us = json.loads(us_path.read_text())
    us.setdefault("stages", {})
    us["stages"]["propose"] = {
        "status": "completed",
        "last_run_dir": str(run_dir),
        "last_completed_at": now,
        "summary_file": str(run_dir / "proposal.json"),
    }
    us["last_completed_stage"] = "propose"
    us["latest_run_dir"] = str(run_dir)
    us_path.write_text(json.dumps(us, indent=2) + "\n")

print(f"proposal.json + proposal.md written to {run_dir}")
PY
```

Make executable: `chmod +x agents/update/03-propose/run.sh`

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_update_propose.py -v`
Expected: 3 tests pass.

Full suite: `.venv/bin/pytest -q`
Expected: 63 pass.

- [ ] **Step 5: Commit**

```bash
git add agents/update/03-propose/run.sh tests/test_update_propose.py
git commit -m "feat(update/propose): implement run.sh with gated and AUTO modes"
```

---

### Task 4: Apply stage — config + instructions

**Files:**
- Create: `agents/update/04-apply/config.json`
- Create: `agents/update/04-apply/instructions.md`
- Test: `tests/test_validate_stage_configs.py` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_validate_stage_configs.py`:

```python
def test_apply_config_exists_and_validates():
    """Apply stage config must exist and validate (script-only stage)."""
    stages_root = REPO_ROOT / "agents" / "update"
    apply_config = stages_root / "04-apply" / "config.json"
    assert apply_config.is_file(), f"missing: {apply_config}"
    data = json.loads(apply_config.read_text())
    assert data["stage"] == "apply"
    assert data["agent_kind"] == "script-only"
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py::test_apply_config_exists_and_validates -v`
Expected: FAIL.

- [ ] **Step 3: Create config.json and instructions.md**

Create `agents/update/04-apply/config.json`:

```json
{
  "stage": "apply",
  "agent_kind": "script-only",
  "token_budget_input": 0,
  "token_budget_output": 0,
  "on_over_budget": "fail-clean",
  "stage_specific": {
    "destructive_actions": ["delete", "rename"],
    "high_uncertainty_value": "high"
  }
}
```

Create `agents/update/04-apply/instructions.md`:

```markdown
# Apply Stage — Instructions

Script-only stage. No LLM invocation. Reads an approved `proposal.json` from the run directory and mechanically applies the changes to the wiki, state files, and artifacts.

## Inputs

- `<run-dir>/proposal.json` with `approved: true`
- Current `projects/<key>/wiki/` and `projects/<key>/state/`
- `config.json.stage_specific.destructive_actions` — which action values are destructive
- `AUTO` env var — if `1`, split destructive/high-uncertainty units to `state/pending-approvals/<proposal-id>/` before applying the additive portion

## Output

- Wiki pages written/updated/deleted per proposal units
- `projects/<key>/index.md` regenerated from `proposal.json.index_changes.content`
- `projects/<key>/state/pages.json` updated to reflect current page set
- `projects/<key>/state/relationships.json` updated with cross-refs
- `projects/<key>/state/sources.json` appended with source-citation entries
- `projects/<key>/state/freshness.json` updated: `last_seen_commit_pending` and `last_update_at_pending` set from proposal's `state_changes_intent`
- Under AUTO=1 with destructives/high-uncertainty present: `projects/<key>/state/pending-approvals/<proposal-id>/proposal-slice.json` + `.md` written
- `update-state.json.stages.apply` marked completed

## Pre-flight (fail-clean if any check fails)

1. Proposal must have `approved: true` at top level.
2. Every unit's `justification_signals` must include at least one of `A|B|C`.
3. Every unit's `referenced_ranking_domains` must appear in `ranking-snapshot.json.ranked_domains` in the same run dir.
4. `new_pages_count ≤ max_new_pages`.
5. Every `source_citation` must resolve (file exists, line range valid).

## Never

- Never write to the wiki if pre-flight fails. Exit non-zero, leave wiki untouched.
- Never advance `last_seen_commit` directly. That is `apply_commit.sh`'s job, and it only runs after validation in Plan C (for Plan B, `scripts/update.sh` calls `apply_commit.sh` unconditionally at end of pipeline; Plan C will gate it on validate status).
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_validate_stage_configs.py -v`
Expected: 7 tests pass (6 prior + new).

Full suite: `.venv/bin/pytest -q`
Expected: 64 pass.

- [ ] **Step 5: Commit**

```bash
git add agents/update/04-apply/ tests/test_validate_stage_configs.py
git commit -m "feat(update/apply): add config.json and instructions.md"
```

---

### Task 5: Apply run.sh — pre-flight + additive path

**Files:**
- Create: `agents/update/04-apply/run.sh`
- Test: `tests/test_update_apply.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_update_apply.py`:

```python
"""Apply stage tests. Script-only; no LLM calls needed."""

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _run_through_apply(project_dir: Path, stub_dir: Path, run_dir: Path, auto: bool = False):
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(stub_dir)}
    if auto:
        env["AUTO"] = "1"
    for stage in ("01-sense", "02-impact", "03-propose"):
        rc = subprocess.run(
            ["bash", str(REPO_ROOT / "agents" / "update" / stage / "run.sh"),
             "--project", "sample", "--project-dir", str(project_dir), "--run-dir", str(run_dir)],
            env=env, capture_output=True, text=True,
        )
        assert rc.returncode == 0, f"{stage}: {rc.stderr}"

    # For gated test, mark proposal approved manually
    if not auto:
        proposal_path = run_dir / "proposal.json"
        p = json.loads(proposal_path.read_text())
        p["approved"] = True
        proposal_path.write_text(json.dumps(p, indent=2) + "\n")

    apply_rc = subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "04-apply" / "run.sh"),
         "--project", "sample", "--project-dir", str(project_dir), "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    return apply_rc


def test_apply_writes_wiki_pages(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    wiki = tmp_sample_project_with_repo / "wiki"
    assert (wiki / "systems" / "authentication.md").is_file()
    assert (wiki / "systems" / "data-store.md").is_file()
    assert (wiki / "systems" / "entry-point.md").is_file()


def test_apply_regenerates_index(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0
    index = (tmp_sample_project_with_repo / "index.md").read_text()
    assert "Start here" in index
    assert "authentication" in index


def test_apply_rejects_unapproved_proposal(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    env = {**os.environ, "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs")}
    for stage in ("01-sense", "02-impact", "03-propose"):
        rc = subprocess.run(
            ["bash", str(REPO_ROOT / "agents" / "update" / stage / "run.sh"),
             "--project", "sample", "--project-dir", str(tmp_sample_project_with_repo), "--run-dir", str(run_dir)],
            env=env, capture_output=True, text=True,
        )
        assert rc.returncode == 0
    # Do NOT approve the proposal
    apply_rc = subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "04-apply" / "run.sh"),
         "--project", "sample", "--project-dir", str(tmp_sample_project_with_repo), "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    assert apply_rc.returncode != 0
    assert "approved" in apply_rc.stderr.lower()
    # Wiki must remain empty
    wiki = tmp_sample_project_with_repo / "wiki" / "systems"
    assert not any(wiki.glob("*.md")), "wiki was modified despite unapproved proposal"


def test_apply_updates_pages_json(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0
    pages = json.loads((tmp_sample_project_with_repo / "state" / "pages.json").read_text())
    paths = [p["path"] for p in pages["pages"]]
    assert "wiki/systems/authentication.md" in paths
    assert "wiki/systems/data-store.md" in paths
    assert "wiki/systems/entry-point.md" in paths


def test_apply_writes_freshness_pending(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0
    f = json.loads((tmp_sample_project_with_repo / "state" / "freshness.json").read_text())
    assert f["last_seen_commit_pending"] is not None
    assert f["last_update_at_pending"] is not None
    # last_seen_commit itself must NOT be advanced — that is apply_commit.sh's job
    assert f["last_seen_commit"] is None


def test_apply_writes_completion_marker(tmp_sample_project_with_repo, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    rc = _run_through_apply(
        tmp_sample_project_with_repo,
        REPO_ROOT / "tests" / "fixtures" / "stubs",
        run_dir,
    )
    assert rc.returncode == 0
    us = json.loads((tmp_sample_project_with_repo / "state" / "update-state.json").read_text())
    assert us["stages"]["apply"]["status"] == "completed"
    assert us["last_completed_stage"] == "apply"
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_update_apply.py -v`
Expected: FAIL (run.sh missing).

- [ ] **Step 3: Implement run.sh**

Create `agents/update/04-apply/run.sh`:

```bash
#!/usr/bin/env bash
# Apply stage — script-only. Reads approved proposal, writes wiki + state.
#
# Preserves these invariants:
#   - Never writes to wiki if pre-flight fails
#   - Never advances last_seen_commit (apply_commit.sh does that)
#   - Under AUTO=1, destructive/high-uncertainty units go to pending-approvals

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/04-apply/run.sh --project <project-key> [--project-dir <project-dir>] --run-dir <artifact-dir>
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
[[ -f "$run_dir/proposal.json" ]] || die "proposal.json missing in $run_dir"
[[ -f "$run_dir/ranking-snapshot.json" ]] || die "ranking-snapshot.json missing in $run_dir"

auto="${AUTO:-}"

python3 - "$project_key" "$project_dir" "$run_dir" "$AGENT_DIR" "$ROOT_DIR" "$auto" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
agent_dir = Path(sys.argv[4])
root_dir = Path(sys.argv[5])
auto = sys.argv[6] == "1"

proposal_path = run_dir / "proposal.json"
proposal = json.loads(proposal_path.read_text())
ranking = json.loads((run_dir / "ranking-snapshot.json").read_text())
config = json.loads((agent_dir / "config.json").read_text())
destructive_actions = set(config["stage_specific"]["destructive_actions"])
high_uncertainty_value = config["stage_specific"]["high_uncertainty_value"]


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


# --- Pre-flight ---
if not proposal.get("approved"):
    die("proposal is not approved (set top-level approved=true)")

ranked_domain_names = {d["domain"] for d in ranking.get("ranked_domains", [])}
max_new = proposal.get("max_new_pages", 25)
new_pages_count = proposal.get("new_pages_count", 0)
if new_pages_count > max_new:
    die(f"new_pages_count {new_pages_count} exceeds max_new_pages {max_new}")

units = proposal.get("units", [])
for unit in units:
    signals = unit.get("justification_signals", [])
    if not any(s in ("A", "B", "C") for s in signals):
        die(f"unit {unit.get('id')} missing justification_signals")
    refs = unit.get("referenced_ranking_domains", [])
    for r in refs:
        if r not in ranked_domain_names:
            die(f"unit {unit.get('id')} references domain '{r}' not in ranking-snapshot.json")
    for citation in unit.get("source_citations", []):
        # "path:start-end" or "path"
        if ":" in citation:
            path_part, line_part = citation.split(":", 1)
        else:
            path_part, line_part = citation, None
        pj = json.loads((project_dir / "state" / "project.json").read_text())
        repo_paths = pj.get("repo_paths", [])
        if not repo_paths:
            continue
        repo = Path(repo_paths[0])
        if not repo.is_absolute():
            repo = root_dir / repo
        resolved = repo / path_part
        if not resolved.is_file():
            die(f"unit {unit.get('id')} cites non-existent file: {path_part}")
        # Validate line range (spec §5.3: source_citations must resolve)
        if line_part and "-" in line_part:
            try:
                start_s, end_s = line_part.split("-", 1)
                start, end = int(start_s), int(end_s)
            except ValueError:
                die(f"unit {unit.get('id')} has malformed line range: {citation}")
            line_count = sum(1 for _ in resolved.open())
            if start < 1 or end < start or end > line_count:
                die(
                    f"unit {unit.get('id')} cites out-of-bounds line range "
                    f"{line_part} (file has {line_count} lines): {citation}"
                )

# --- Classify units: additive vs destructive ---
additive_units = []
destructive_units = []
for unit in units:
    is_destructive = (
        unit.get("action") in destructive_actions
        or unit.get("destructive") is True
        or unit.get("uncertainty") == high_uncertainty_value
    )
    if is_destructive:
        destructive_units.append(unit)
    else:
        additive_units.append(unit)

# --- AUTO=1 safety ladder: split destructive/high-uncertainty to pending-approvals ---
if auto and destructive_units:
    pending_dir = project_dir / "state" / "pending-approvals" / proposal["run_id"]
    pending_dir.mkdir(parents=True, exist_ok=True)
    slice_reason = "mixed" if len([u for u in destructive_units if u.get("action") in destructive_actions]) and len([u for u in destructive_units if u.get("uncertainty") == high_uncertainty_value]) else (
        "destructive" if any(u.get("action") in destructive_actions for u in destructive_units) else "high-uncertainty"
    )
    slice_data = {
        "origin_run_id": proposal["run_id"],
        "origin_proposal_path": str(proposal_path),
        "project": project_key,
        "summary": proposal.get("summary", ""),
        "ranking_snapshot_path": proposal.get("ranking_snapshot_path"),
        "max_new_pages": proposal.get("max_new_pages", 25),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "slice_reason": slice_reason,
        "units": destructive_units,
        "index_changes": None,
        "state_changes_intent": {
            "last_seen_commit_pending": None,
            "last_update_at_pending": None,
            "note": "Commit pointer advancement was handled by the origin run's applied portion. Applying this slice does not advance the pointer. A fresh make update-v2 run is required.",
        },
    }
    (pending_dir / "proposal-slice.json").write_text(json.dumps(slice_data, indent=2) + "\n")
    slice_md = f"# Pending approval slice — {proposal['run_id']}\n\nReason: {slice_reason}\n\n"
    for u in destructive_units:
        slice_md += f"- `{u['action']}` **{u['page_path']}** — {u.get('justification', '')}\n"
    (pending_dir / "proposal-slice.md").write_text(slice_md)

# --- Apply additive units ---
wiki_root = project_dir / "wiki"
applied_paths = []
for unit in additive_units:
    page_path = project_dir / unit["page_path"]
    action = unit["action"]
    if action == "create" or action == "update":
        page_path.parent.mkdir(parents=True, exist_ok=True)
        page_path.write_text(unit["content"] or "")
        applied_paths.append(unit["page_path"])

# --- Regenerate index.md (spec §5.3: destructive index changes require approval even under AUTO) ---
ic = proposal.get("index_changes", {})
if ic.get("action") == "update" and ic.get("content"):
    if auto and ic.get("destructive"):
        # Route the destructive index change to the pending slice instead of applying it.
        pending_dir = project_dir / "state" / "pending-approvals" / proposal["run_id"]
        pending_dir.mkdir(parents=True, exist_ok=True)
        (pending_dir / "index-changes.json").write_text(json.dumps(ic, indent=2) + "\n")
        print(f"apply: deferred destructive index change to {pending_dir}/index-changes.json", file=sys.stderr)
    else:
        (project_dir / "index.md").write_text(ic["content"])

# --- Update pages.json ---
pages_path = project_dir / "state" / "pages.json"
existing = json.loads(pages_path.read_text()).get("pages", [])
existing_by_path = {p["path"]: p for p in existing}
for unit in additive_units:
    path = unit["page_path"]
    existing_by_path[path] = {
        "path": path,
        "type": path.split("/")[1] if "/" in path else "other",
        "summary": (unit.get("content") or "").split("\n", 1)[0][:200],
        "linked_sources": unit.get("source_citations", []),
        "linked_topics": unit.get("affected_cross_refs", []),
        "last_reviewed_at": datetime.now(timezone.utc).isoformat(),
        "freshness_status": "fresh",
    }
pages_path.write_text(json.dumps({"pages": list(existing_by_path.values())}, indent=2) + "\n")

# --- Update relationships.json ---
rel_path = project_dir / "state" / "relationships.json"
existing_rel = json.loads(rel_path.read_text()).get("relationships", [])
rel_set = {(r["from"], r["to"], r["relationship_type"]) for r in existing_rel}
for unit in additive_units:
    src = unit["page_path"]
    for dst in unit.get("affected_cross_refs", []):
        key = (src, dst, "references")
        if key not in rel_set:
            existing_rel.append({
                "from": src,
                "to": dst,
                "relationship_type": "references",
                "confidence": "high",
            })
            rel_set.add(key)
rel_path.write_text(json.dumps({"relationships": existing_rel}, indent=2) + "\n")

# --- Update sources.json ---
src_path = project_dir / "state" / "sources.json"
existing_src = json.loads(src_path.read_text()).get("sources", [])
src_set = {s.get("source_id") for s in existing_src}
now = datetime.now(timezone.utc).isoformat()
for unit in additive_units:
    sc = unit.get("source_classification", {})
    src_id = f"{unit['page_path']}:{unit['id']}"
    if src_id in src_set:
        continue
    existing_src.append({
        "source_id": src_id,
        "original_path": ";".join(unit.get("source_citations", [])),
        "source_kind": sc.get("source_kind", "unknown"),
        "project_key": project_key,
        "status": "integrated",
        "derived_pages": [unit["page_path"]],
        "ingested_at": now,
    })
    src_set.add(src_id)
src_path.write_text(json.dumps({"sources": existing_src}, indent=2) + "\n")

# --- Update freshness.json: pending pointers only ---
fp = project_dir / "state" / "freshness.json"
f = json.loads(fp.read_text())
sci = proposal.get("state_changes_intent", {})
f["last_seen_commit_pending"] = sci.get("last_seen_commit_pending")
f["last_update_at_pending"] = sci.get("last_update_at_pending")
fp.write_text(json.dumps(f, indent=2) + "\n")

# --- Append to changelog.md ---
changelog = project_dir / "changelog.md"
if changelog.is_file():
    entry = f"\n## [{now}] apply — {len(additive_units)} unit(s), run {proposal['run_id']}\n"
    if destructive_units and auto:
        entry += f"- Deferred {len(destructive_units)} destructive/high-uncertainty unit(s) to pending-approvals/\n"
    changelog.write_text(changelog.read_text() + entry)

# --- Stage completion marker ---
us_path = project_dir / "state" / "update-state.json"
us = json.loads(us_path.read_text())
us.setdefault("stages", {})
us["stages"]["apply"] = {
    "status": "completed",
    "last_run_dir": str(run_dir),
    "last_completed_at": now,
    "summary_file": str(run_dir / "proposal.json"),
}
us["last_completed_stage"] = "apply"
us["latest_run_dir"] = str(run_dir)
us_path.write_text(json.dumps(us, indent=2) + "\n")

print(f"apply: wrote {len(additive_units)} additive unit(s)"
      + (f"; deferred {len(destructive_units)} to pending-approvals" if auto and destructive_units else ""))
PY
```

Make executable: `chmod +x agents/update/04-apply/run.sh`

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_update_apply.py -v`
Expected: 6 tests pass.

Full suite: `.venv/bin/pytest -q`
Expected: 70 pass.

- [ ] **Step 5: Commit**

```bash
git add agents/update/04-apply/run.sh tests/test_update_apply.py
git commit -m "feat(update/apply): implement run.sh with pre-flight + additive path"
```

---

### Task 5b: AUTO=1 destructive safety ladder — stub + test

**Files:**
- Create: `tests/fixtures/stubs/03-propose.destructive.json` (variant with a delete unit)
- Test: `tests/test_update_apply.py` (extend)

Apply already implements the split logic (Task 5). This task verifies it works end-to-end under AUTO=1.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_update_apply.py`:

```python
def test_apply_auto_mode_destructive_split(tmp_sample_project_with_repo, tmp_path, monkeypatch):
    """AUTO=1 with a destructive unit must split it to pending-approvals, not apply."""
    # Seed an existing page that the destructive unit will try to delete
    target = tmp_sample_project_with_repo / "wiki" / "systems" / "obsolete-legacy.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("# Obsolete\n")

    run_dir = tmp_path / "run"
    run_dir.mkdir()

    # Use the destructive stub variant for the propose call only
    destructive_stub_dir = tmp_path / "stubs"
    destructive_stub_dir.mkdir()
    import shutil as _shutil
    for name in ("01-sense.classifier.json", "02-impact.ranking.json", "02-impact.delta.json"):
        _shutil.copy(REPO_ROOT / "tests" / "fixtures" / "stubs" / name, destructive_stub_dir / name)
    _shutil.copy(
        REPO_ROOT / "tests" / "fixtures" / "stubs" / "03-propose.destructive.json",
        destructive_stub_dir / "03-propose.json",
    )

    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(destructive_stub_dir),
        "AUTO": "1",
    }
    for stage in ("01-sense", "02-impact", "03-propose"):
        rc = subprocess.run(
            ["bash", str(REPO_ROOT / "agents" / "update" / stage / "run.sh"),
             "--project", "sample", "--project-dir", str(tmp_sample_project_with_repo),
             "--run-dir", str(run_dir)],
            env=env, capture_output=True, text=True,
        )
        assert rc.returncode == 0, f"{stage}: {rc.stderr}"

    apply_rc = subprocess.run(
        ["bash", str(REPO_ROOT / "agents" / "update" / "04-apply" / "run.sh"),
         "--project", "sample", "--project-dir", str(tmp_sample_project_with_repo),
         "--run-dir", str(run_dir)],
        env=env, capture_output=True, text=True,
    )
    assert apply_rc.returncode == 0, f"stderr={apply_rc.stderr}"

    # Destructive unit MUST NOT have been applied — target page still exists
    assert target.is_file(), "destructive delete should be deferred, not applied under AUTO=1"

    # Pending-approvals directory must exist with a slice
    pending_root = tmp_sample_project_with_repo / "state" / "pending-approvals"
    assert pending_root.is_dir()
    slices = list(pending_root.iterdir())
    assert len(slices) == 1, f"expected 1 pending slice, got {len(slices)}"
    slice_data = json.loads((slices[0] / "proposal-slice.json").read_text())
    assert slice_data["slice_reason"] in ("destructive", "mixed")
    assert any(u["action"] == "delete" for u in slice_data["units"])
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_update_apply.py::test_apply_auto_mode_destructive_split -v`
Expected: FAIL (destructive stub does not exist).

- [ ] **Step 3: Create the destructive stub variant**

Create `tests/fixtures/stubs/03-propose.destructive.json`:

```json
{
  "stage": "03-propose",
  "response": {
    "project": "sample",
    "run_id": "placeholder-will-be-stamped-by-runner",
    "summary": "Clean up obsolete legacy page.",
    "ranking_snapshot_path": "projects/sample/state/latest/ranking-snapshot.json",
    "max_new_pages": 25,
    "max_new_pages_config_source": "agents/update/03-propose/config.json:stage_specific.max_new_pages",
    "new_pages_count": 0,
    "deferred_domains": [],
    "approved": false,
    "units": [
      {
        "id": "u1",
        "action": "delete",
        "page_path": "wiki/systems/obsolete-legacy.md",
        "rename_from": null,
        "destructive": true,
        "uncertainty": "low",
        "justification": "Domain no longer present in repo; ranked #N/A; auth module replaced legacy path.",
        "justification_signals": ["A"],
        "referenced_ranking_domains": [],
        "source_classification": {
          "source_kind": "decision-candidate",
          "ownership": "project:sample",
          "destination": "wiki/systems/obsolete-legacy.md",
          "update_targets": ["wiki/systems/obsolete-legacy.md"],
          "action": "reject"
        },
        "content": null,
        "affected_cross_refs": [],
        "source_citations": []
      }
    ],
    "index_changes": {
      "action": "update",
      "destructive": false,
      "content": "Sample project — a minimal Python application used as a test fixture.\n",
      "categories_reshuffled": 0
    },
    "state_changes_intent": {
      "last_seen_commit_pending": "<stamped-by-apply>",
      "last_update_at_pending": "<stamped-by-apply>"
    }
  },
  "tokens_consumed": {"input": 20000, "output": 3000}
}
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_update_apply.py -v`
Expected: 7 tests pass (6 prior + new destructive split).

Full suite: `.venv/bin/pytest -q`
Expected: 71 pass.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/stubs/03-propose.destructive.json tests/test_update_apply.py
git commit -m "test(update/apply): cover AUTO=1 destructive split to pending-approvals"
```

---

### Task 6: Pending-approvals flow — `scripts/apply_pending.sh` + `reject_pending.sh`

**Files:**
- Create: `scripts/apply_pending.sh`
- Create: `scripts/reject_pending.sh`
- Test: `tests/test_pending_approvals.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_pending_approvals.py`:

```python
"""Tests for pending-approvals apply and reject scripts."""

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _seed_pending_slice(project_dir: Path, proposal_id: str) -> Path:
    """Create a minimal pending slice for testing."""
    pending = project_dir / "state" / "pending-approvals" / proposal_id
    pending.mkdir(parents=True, exist_ok=True)
    slice_data = {
        "origin_run_id": proposal_id,
        "project": "sample",
        "summary": "test slice",
        "ranking_snapshot_path": "n/a",
        "max_new_pages": 25,
        "created_at": "2026-04-18T00:00:00+00:00",
        "slice_reason": "destructive",
        "units": [
            {
                "id": "u1",
                "action": "delete",
                "page_path": "wiki/systems/obsolete.md",
                "destructive": True,
                "uncertainty": "low",
                "justification": "feature removed",
                "justification_signals": ["A"],
                "referenced_ranking_domains": [],
                "content": None,
                "source_citations": [],
                "affected_cross_refs": [],
                "source_classification": {
                    "source_kind": "implementation-note",
                    "ownership": "project:sample",
                    "destination": "wiki/systems/obsolete.md",
                    "update_targets": ["wiki/systems/obsolete.md"],
                    "action": "delete"
                }
            }
        ],
        "index_changes": None,
        "state_changes_intent": {
            "last_seen_commit_pending": None,
            "last_update_at_pending": None,
            "note": "slice from test"
        }
    }
    (pending / "proposal-slice.json").write_text(json.dumps(slice_data, indent=2))
    (pending / "proposal-slice.md").write_text("# test slice\n")
    return pending


def test_apply_pending_deletes_target_page(tmp_sample_project, tmp_path):
    """apply_pending runs the delete unit and removes the page."""
    target = tmp_sample_project / "wiki" / "systems" / "obsolete.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("# Obsolete\n")
    _seed_pending_slice(tmp_sample_project, "20260418-000000-update")
    env = {
        **os.environ,
        "PROJECTS_ROOT": str(tmp_sample_project.parent),
    }
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "apply_pending.sh"),
         "--project", "sample", "--proposal", "20260418-000000-update"],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    assert not target.is_file(), "target page should be deleted"
    assert not (tmp_sample_project / "state" / "pending-approvals" / "20260418-000000-update").is_dir()


def test_reject_pending_archives_slice(tmp_sample_project, tmp_path):
    """reject_pending moves the slice to artifacts/<project>/rejected/ and does not apply."""
    target = tmp_sample_project / "wiki" / "systems" / "obsolete.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("# Obsolete\n")
    _seed_pending_slice(tmp_sample_project, "20260418-000000-update")
    artifacts_root = tmp_path / "artifacts"
    artifacts_root.mkdir()
    env = {
        **os.environ,
        "PROJECTS_ROOT": str(tmp_sample_project.parent),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "reject_pending.sh"),
         "--project", "sample", "--proposal", "20260418-000000-update"],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    # Target page must remain (reject = don't apply the destructive action)
    assert target.is_file(), "target page should NOT be deleted (reject = don't apply)"
    # Pending slice must be gone from pending-approvals
    assert not (tmp_sample_project / "state" / "pending-approvals" / "20260418-000000-update").is_dir()
    # Rejected slice must have landed under the isolated artifacts root
    archived = artifacts_root / "sample" / "rejected" / "20260418-000000-update"
    assert archived.is_dir(), f"rejected slice not archived at {archived}"
    assert (archived / "proposal-slice.json").is_file()


def test_apply_pending_missing_proposal_fails(tmp_sample_project, tmp_path):
    env = {**os.environ, "PROJECTS_ROOT": str(tmp_sample_project.parent)}
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "apply_pending.sh"),
         "--project", "sample", "--proposal", "nonexistent"],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode != 0
    assert "not found" in rc.stderr.lower() or "missing" in rc.stderr.lower()
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_pending_approvals.py -v`
Expected: FAIL (scripts don't exist).

- [ ] **Step 3: Implement both scripts**

Create `scripts/apply_pending.sh`:

```bash
#!/usr/bin/env bash
# Apply a pending-approval slice: execute deferred units + clean up.
#
# Usage:
#   scripts/apply_pending.sh --project <key> --proposal <proposal-id>
# Env:
#   PROJECTS_ROOT  override projects dir (for tests)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="${PROJECTS_ROOT:-$ROOT_DIR/projects}"

usage() {
  cat <<'EOF'
Usage:
  scripts/apply_pending.sh --project <key> --proposal <proposal-id>
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
proposal_id=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    --proposal) proposal_id="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
[[ -n "$proposal_id" ]] || die "--proposal is required"

project_dir="$PROJECTS_ROOT/$project_key"
pending_dir="$project_dir/state/pending-approvals/$proposal_id"
[[ -d "$pending_dir" ]] || die "pending slice not found: $pending_dir"
[[ -f "$pending_dir/proposal-slice.json" ]] || die "proposal-slice.json missing in $pending_dir"

python3 - "$project_key" "$project_dir" "$pending_dir" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
pending_dir = Path(sys.argv[3])

# For relative repo_paths, treat project_dir.parent.parent as the repo root anchor.
# When PROJECTS_ROOT is overridden (tests), this resolves to tmp; when running
# against the real projects/ dir, it resolves to the llm-wiki repo root. Either
# way, the anchor matches how repo_paths were written at init time.
root_dir = project_dir.parent.parent

slice_data = json.loads((pending_dir / "proposal-slice.json").read_text())
units = slice_data.get("units", [])
now = datetime.now(timezone.utc).isoformat()


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


# Re-validate any source_citations (spec §5.6: "re-validates citations").
# Repo state may have drifted since the slice was created.
pj = json.loads((project_dir / "state" / "project.json").read_text())
repo_paths = pj.get("repo_paths", [])
repo = None
if repo_paths:
    repo = Path(repo_paths[0])
    if not repo.is_absolute():
        repo = root_dir / repo

for unit in units:
    for citation in unit.get("source_citations", []) or []:
        if not repo:
            continue
        path_part = citation.split(":", 1)[0] if ":" in citation else citation
        resolved = repo / path_part
        if not resolved.is_file():
            die(f"slice unit {unit.get('id')} cites non-existent file: {path_part}")

# Note: post-hoc validate invocation is a Plan C deliverable (validate stage does
# not exist yet). Plan B applies the slice directly after citation re-validation.

applied = []
for unit in units:
    action = unit.get("action")
    path = project_dir / unit["page_path"]
    if action == "delete":
        if path.is_file():
            path.unlink()
            applied.append(unit["page_path"])
    elif action == "rename":
        src = project_dir / unit.get("rename_from", "")
        if src.is_file():
            path.parent.mkdir(parents=True, exist_ok=True)
            src.rename(path)
            applied.append(f"{unit.get('rename_from')} -> {unit['page_path']}")

# Update pages.json: remove deleted
pages_path = project_dir / "state" / "pages.json"
if pages_path.is_file():
    pages = json.loads(pages_path.read_text()).get("pages", [])
    deleted = {u["page_path"] for u in units if u.get("action") == "delete"}
    pages = [p for p in pages if p["path"] not in deleted]
    pages_path.write_text(json.dumps({"pages": pages}, indent=2) + "\n")

# Append changelog entry
changelog = project_dir / "changelog.md"
if changelog.is_file():
    entry = f"\n## [{now}] apply-pending — {len(applied)} unit(s), slice {slice_data['origin_run_id']}\n"
    changelog.write_text(changelog.read_text() + entry)

# Clean up slice
import shutil
shutil.rmtree(pending_dir)

print(f"applied {len(applied)} deferred unit(s); slice cleaned up")
PY
```

Create `scripts/reject_pending.sh`:

```bash
#!/usr/bin/env bash
# Reject a pending-approval slice: archive without applying.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="${PROJECTS_ROOT:-$ROOT_DIR/projects}"
ARTIFACTS_ROOT="${UPDATE_ARTIFACTS_ROOT:-$ROOT_DIR/artifacts}"

usage() {
  cat <<'EOF'
Usage:
  scripts/reject_pending.sh --project <key> --proposal <proposal-id>
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
proposal_id=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    --proposal) proposal_id="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
[[ -n "$proposal_id" ]] || die "--proposal is required"

project_dir="$PROJECTS_ROOT/$project_key"
pending_dir="$project_dir/state/pending-approvals/$proposal_id"
[[ -d "$pending_dir" ]] || die "pending slice not found: $pending_dir"

archive_dir="$ARTIFACTS_ROOT/$project_key/rejected/$proposal_id"
mkdir -p "$(dirname "$archive_dir")"
mv "$pending_dir" "$archive_dir"

# Append changelog entry
python3 - "$project_dir" "$proposal_id" <<'PY'
import sys
from datetime import datetime, timezone
from pathlib import Path

project_dir = Path(sys.argv[1])
proposal_id = sys.argv[2]
now = datetime.now(timezone.utc).isoformat()

changelog = project_dir / "changelog.md"
if changelog.is_file():
    entry = f"\n## [{now}] reject-pending — slice {proposal_id} archived without applying\n"
    changelog.write_text(changelog.read_text() + entry)
PY

echo "rejected slice $proposal_id; archived to $archive_dir"
```

Make both executable: `chmod +x scripts/apply_pending.sh scripts/reject_pending.sh`

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_pending_approvals.py -v`
Expected: 3 tests pass.

Full suite: `.venv/bin/pytest -q`
Expected: 73 pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/apply_pending.sh scripts/reject_pending.sh tests/test_pending_approvals.py
git commit -m "feat(scripts): add apply_pending and reject_pending"
```

---

### Task 7: `scripts/apply_commit.sh` — commit pointer advancement

**Files:**
- Create: `scripts/apply_commit.sh`
- Test: `tests/test_apply_commit.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_apply_commit.py`:

```python
"""Tests for apply_commit.sh — advances last_seen_commit_pending to last_seen_commit."""

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_apply_commit_advances_pointer(tmp_sample_project):
    """apply_commit moves _pending to committed and clears _pending."""
    freshness = tmp_sample_project / "state" / "freshness.json"
    data = json.loads(freshness.read_text())
    data["last_seen_commit_pending"] = "abc123"
    data["last_update_at_pending"] = "2026-04-18T00:00:00Z"
    data["last_seen_commit"] = None
    data["last_update_at"] = None
    freshness.write_text(json.dumps(data))

    env = {**os.environ, "PROJECTS_ROOT": str(tmp_sample_project.parent)}
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "apply_commit.sh"),
         "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    after = json.loads(freshness.read_text())
    assert after["last_seen_commit"] == "abc123"
    assert after["last_update_at"] == "2026-04-18T00:00:00Z"
    assert after["last_seen_commit_pending"] is None
    assert after["last_update_at_pending"] is None


def test_apply_commit_noop_when_no_pending(tmp_sample_project):
    """apply_commit is a no-op when no _pending values are set."""
    freshness = tmp_sample_project / "state" / "freshness.json"
    data = json.loads(freshness.read_text())
    data["last_seen_commit"] = "old-sha"
    data["last_seen_commit_pending"] = None
    freshness.write_text(json.dumps(data))

    env = {**os.environ, "PROJECTS_ROOT": str(tmp_sample_project.parent)}
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "apply_commit.sh"),
         "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0
    after = json.loads(freshness.read_text())
    assert after["last_seen_commit"] == "old-sha"  # unchanged


def test_apply_commit_appends_changelog(tmp_sample_project):
    """apply_commit must append a changelog entry when it advances the pointer."""
    freshness = tmp_sample_project / "state" / "freshness.json"
    data = json.loads(freshness.read_text())
    data["last_seen_commit_pending"] = "xyz789"
    data["last_update_at_pending"] = "2026-04-18T01:00:00Z"
    freshness.write_text(json.dumps(data))

    # The fixture template does not ship a changelog.md; seed one so the
    # conditional append in apply_commit.sh has a file to grow.
    changelog = tmp_sample_project / "changelog.md"
    original_body = "# Changelog — Sample\n"
    changelog.write_text(original_body)

    env = {**os.environ, "PROJECTS_ROOT": str(tmp_sample_project.parent)}
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "apply_commit.sh"),
         "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0
    new = changelog.read_text()
    assert len(new) > len(original_body)
    assert "apply-commit" in new
    assert "xyz789" in new


def test_apply_commit_leaves_no_tmp_file(tmp_sample_project):
    """Atomic write must not leave a .tmp file on disk."""
    freshness = tmp_sample_project / "state" / "freshness.json"
    data = json.loads(freshness.read_text())
    data["last_seen_commit_pending"] = "def456"
    data["last_update_at_pending"] = "2026-04-18T02:00:00Z"
    freshness.write_text(json.dumps(data))

    env = {**os.environ, "PROJECTS_ROOT": str(tmp_sample_project.parent)}
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "apply_commit.sh"),
         "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0
    assert not (tmp_sample_project / "state" / "freshness.json.tmp").exists()
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_apply_commit.py -v`
Expected: FAIL (script missing).

- [ ] **Step 3: Implement the script**

Create `scripts/apply_commit.sh`:

```bash
#!/usr/bin/env bash
# apply_commit — atomically move last_seen_commit_pending to last_seen_commit.
#
# Called by scripts/update.sh at pipeline end once apply + validate (Plan C)
# pass. For Plan B, update.sh calls this unconditionally after apply.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECTS_ROOT="${PROJECTS_ROOT:-$ROOT_DIR/projects}"

usage() {
  cat <<'EOF'
Usage:
  scripts/apply_commit.sh --project <project-key>
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

[[ -n "$project_key" ]] || die "--project is required"
project_dir="$PROJECTS_ROOT/$project_key"
[[ -d "$project_dir" ]] || die "project not found: $project_dir"
fp="$project_dir/state/freshness.json"
[[ -f "$fp" ]] || die "freshness.json not found"
export project_dir fp

python3 - "$fp" "$project_dir" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

fp = Path(sys.argv[1])
project_dir = Path(sys.argv[2])

data = json.loads(fp.read_text())
pending_commit = data.get("last_seen_commit_pending")
pending_update = data.get("last_update_at_pending")

if pending_commit is None and pending_update is None:
    print("apply_commit: no pending values; no-op")
    sys.exit(0)

if pending_commit is not None:
    data["last_seen_commit"] = pending_commit
if pending_update is not None:
    data["last_update_at"] = pending_update
data["last_seen_commit_pending"] = None
data["last_update_at_pending"] = None

# Atomic write: temp file + os.replace (spec §4.6 requires temp-file-and-rename).
tmp = fp.with_suffix(fp.suffix + ".tmp")
tmp.write_text(json.dumps(data, indent=2) + "\n")
os.replace(tmp, fp)

# Changelog entry (spec §4.6 requires logging the commit advancement).
changelog = project_dir / "changelog.md"
if changelog.is_file():
    now = datetime.now(timezone.utc).isoformat()
    entry = f"\n## [{now}] apply-commit — last_seen_commit advanced to {pending_commit}\n"
    changelog.write_text(changelog.read_text() + entry)

print(f"apply_commit: advanced last_seen_commit -> {pending_commit}")
PY
```

Make executable: `chmod +x scripts/apply_commit.sh`

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_apply_commit.py -v`
Expected: 4 tests pass (advance, noop, changelog, atomic).

Full suite: `.venv/bin/pytest -q`
Expected: 77 pass (cumulative after Tasks 1-7 with 5b).

- [ ] **Step 5: Commit**

```bash
git add scripts/apply_commit.sh tests/test_apply_commit.py
git commit -m "feat(scripts): add apply_commit.sh for commit pointer advancement"
```

---

### Task 8: Extend `scripts/update.sh` — wire propose + apply + apply_commit, support continue mode

**Files:**
- Modify: `scripts/update.sh`
- Test: `tests/test_plan_a_acceptance.py` (extend) — or new `tests/test_plan_b_acceptance.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_plan_b_acceptance.py`:

```python
"""Plan B acceptance: make update-v2 runs sense -> impact -> propose.

Under AUTO=1, also runs apply + apply_commit and produces a wiki.
Without AUTO=1, stops at propose and prompts operator to continue.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _prepare_isolated_run(tmp_path: Path) -> tuple[Path, Path, Path]:
    """Seed an isolated sample project with a working sample_repo copy + git history.

    Copying the live projects/sample/ leaves repo_paths as the repo-relative
    string 'tests/fixtures/sample_repo'. We also copy the sample_repo fixture
    into tmp and rewrite repo_paths to the absolute tmp path so the pipeline
    does not depend on ROOT_DIR resolution during tests.
    """
    projects_root = tmp_path / "projects"
    projects_root.mkdir()
    project_dir = projects_root / "sample"
    shutil.copytree(REPO_ROOT / "projects" / "sample", project_dir)

    # Ensure the source fixture's git history exists, then copy into tmp.
    subprocess.run(
        ["bash", str(REPO_ROOT / "tests" / "fixtures" / "sample_repo_init.sh")],
        check=True,
    )
    repo_src = REPO_ROOT / "tests" / "fixtures" / "sample_repo"
    repo_dst = tmp_path / "sample_repo"
    shutil.copytree(repo_src, repo_dst)

    # Rewrite repo_paths to the absolute tmp path so the pipeline uses the copy.
    pj_path = project_dir / "state" / "project.json"
    pj = json.loads(pj_path.read_text())
    pj["repo_paths"] = [str(repo_dst)]
    pj_path.write_text(json.dumps(pj, indent=2))

    artifacts_root = tmp_path / "artifacts"
    artifacts_root.mkdir()
    return projects_root, project_dir, artifacts_root


def test_update_auto_mode_produces_wiki(tmp_path):
    """make update-v2 AUTO=1 runs end-to-end and writes a wiki."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
        "AUTO": "1",
    }
    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"

    assert (project_dir / "wiki" / "systems" / "authentication.md").is_file()
    assert (project_dir / "wiki" / "systems" / "data-store.md").is_file()
    assert (project_dir / "wiki" / "systems" / "entry-point.md").is_file()
    assert (project_dir / "index.md").read_text().strip().startswith("Sample project")

    # Commit pointer advanced
    f = json.loads((project_dir / "state" / "freshness.json").read_text())
    assert f["last_seen_commit"] is not None
    assert f["last_seen_commit_pending"] is None


def test_update_gated_mode_stops_at_propose(tmp_path):
    """Without AUTO, make update-v2 runs propose and stops, does not write wiki."""
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
    assert result.returncode == 0, f"stderr={result.stderr}"

    runs = sorted((artifacts_root / "sample" / "runs").glob("*-update"))
    assert runs, "expected a run dir"
    assert (runs[-1] / "proposal.json").is_file()

    # Wiki should NOT be written yet
    assert not any((project_dir / "wiki" / "systems").glob("*.md")), "wiki should be untouched"
    assert "make update-v2-continue" in result.stdout + result.stderr


def test_update_continue_after_gated_approval(tmp_path):
    """After gated propose, operator approves and re-runs with CONTINUE=1 to apply."""
    projects_root, project_dir, artifacts_root = _prepare_isolated_run(tmp_path)
    env = {
        **os.environ,
        "LLM_STUB_RESPONSES_DIR": str(REPO_ROOT / "tests" / "fixtures" / "stubs"),
        "UPDATE_PROJECTS_ROOT": str(projects_root),
        "UPDATE_ARTIFACTS_ROOT": str(artifacts_root),
    }
    # First run (gated)
    r1 = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env, capture_output=True, text=True,
    )
    assert r1.returncode == 0

    # Operator approves
    runs = sorted((artifacts_root / "sample" / "runs").glob("*-update"))
    latest = runs[-1]
    p = json.loads((latest / "proposal.json").read_text())
    p["approved"] = True
    (latest / "proposal.json").write_text(json.dumps(p, indent=2))

    # Continue
    env2 = {**env, "CONTINUE": "1"}
    r2 = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "update.sh"), "--project", "sample"],
        env=env2, capture_output=True, text=True,
    )
    assert r2.returncode == 0, f"stderr={r2.stderr}"
    assert (project_dir / "wiki" / "systems" / "authentication.md").is_file()
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_plan_b_acceptance.py -v`
Expected: FAIL.

- [ ] **Step 3: Update `scripts/update.sh`**

Open `scripts/update.sh`. Replace the full `run_project` function with this extended version (keep the arg parsing and validate_stage_configs call above it unchanged):

```bash
run_project() {
  local key="$1"
  local project_dir="$PROJECTS_ROOT/$key"
  [[ -d "$project_dir" ]] || { echo "warn: project not found: $key" >&2; return 1; }

  local run_id
  local run_dir

  if [[ "${CONTINUE:-}" == "1" ]]; then
    # Resume from latest run that has a proposal
    local latest
    latest="$(find "$ARTIFACTS_ROOT/$key/runs" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort | tail -n 1)"
    [[ -n "$latest" ]] || die "CONTINUE=1 set but no prior run found under $ARTIFACTS_ROOT/$key/runs"
    [[ -f "$latest/proposal.json" ]] || die "CONTINUE=1 set but $latest has no proposal.json"
    run_dir="$latest"
    run_id="$(basename "$run_dir")"
    echo "[$key] CONTINUE=1; using existing run_dir: $run_dir"
  else
    run_id="$(date -u +%Y%m%d-%H%M%S)-update"
    run_dir="$ARTIFACTS_ROOT/$key/runs/$run_id"
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

    # Stage 3: propose
    bash "$STAGES_ROOT/03-propose/run.sh" \
      --project "$key" --project-dir "$project_dir" --run-dir "$run_dir"
  fi

  # Decide whether to apply: requires approved=true in proposal.json
  local proposal_path="$run_dir/proposal.json"
  [[ -f "$proposal_path" ]] || die "proposal.json missing at $proposal_path"
  local approved
  approved="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('approved', False))" "$proposal_path")"

  if [[ "$approved" != "True" ]]; then
    cat >&2 <<EOM
[$key] Proposal awaits approval.
  Review: $run_dir/proposal.md
  Edit:   $proposal_path (set "approved": true)
  Apply:  make update-v2-continue PROJECT=$key
EOM
    return 0
  fi

  # Stage 4: apply
  bash "$STAGES_ROOT/04-apply/run.sh" \
    --project "$key" --project-dir "$project_dir" --run-dir "$run_dir"

  # apply_commit — advance last_seen_commit_pending -> last_seen_commit
  # (Plan C will gate this behind validate status)
  PROJECTS_ROOT="$PROJECTS_ROOT" bash "$ROOT_DIR/scripts/apply_commit.sh" --project "$key"

  echo "[$key] pipeline complete"
}
```

Also update the env-var comment block near the top of the script to list the new env vars:

```bash
# Env:
#   LLM_STUB_RESPONSES_DIR  if set, agents use canned stub responses
#   UPDATE_STAGES_ROOT       override stages root (for testing)
#   UPDATE_PROJECTS_ROOT     override projects root (for testing)
#   UPDATE_ARTIFACTS_ROOT    override artifacts root (for testing)
#   AUTO                     1 = write approved=true in proposal, split destructive to pending-approvals
#   CONTINUE                 1 = resume from latest existing run's proposal (post-approval)
#   RANKING_CUTOFF           override ranking cutoff
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_plan_b_acceptance.py -v`
Expected: 3 tests pass.

Full suite: `.venv/bin/pytest -q`
Expected: 78 pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/update.sh tests/test_plan_b_acceptance.py
git commit -m "feat(scripts): extend update.sh with propose + apply + continue mode"
```

---

### Task 9: Makefile targets — `update-v2-continue`, `apply-pending`, `reject-pending`

**Files:**
- Modify: `Makefile`
- Test: `tests/test_plan_b_acceptance.py` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_plan_b_acceptance.py`:

```python
def test_make_update_v2_continue_target_exists():
    makefile_content = (REPO_ROOT / "Makefile").read_text()
    assert "update-v2-continue:" in makefile_content


def test_make_apply_pending_target_exists():
    makefile_content = (REPO_ROOT / "Makefile").read_text()
    assert "apply-pending:" in makefile_content


def test_make_reject_pending_target_exists():
    makefile_content = (REPO_ROOT / "Makefile").read_text()
    assert "reject-pending:" in makefile_content
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_plan_b_acceptance.py -v -k target_exists`
Expected: FAIL.

- [ ] **Step 3: Edit `Makefile`**

Add `update-v2-continue`, `apply-pending`, `reject-pending` to the `.PHONY` list (add after `update-v2`):

```makefile
.PHONY: init init-project bootstrap bootstrap-orient bootstrap-domains bootstrap-expand bootstrap-validate bootstrap-reconcile validate lint ingest ingest-v2 ingest-apply ingest-global status status-all prune help update-v2 update-v2-continue apply-pending reject-pending
```

Append the three new targets at the end of the Makefile (use TAB indentation for the recipe lines):

```makefile

update-v2-continue:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make update-v2-continue PROJECT=sample" && exit 1)
	@CONTINUE=1 bash scripts/update.sh --project $(PROJECT)

apply-pending:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@test -n "$(PROPOSAL)" || (echo "PROPOSAL is required, for example: make apply-pending PROJECT=sample PROPOSAL=20260418-...-update" && exit 1)
	@bash scripts/apply_pending.sh --project $(PROJECT) --proposal $(PROPOSAL)

reject-pending:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@test -n "$(PROPOSAL)" || (echo "PROPOSAL is required" && exit 1)
	@bash scripts/reject_pending.sh --project $(PROJECT) --proposal $(PROPOSAL)
```

Also add help lines near the other command listings (find the help block and add after the `make update-v2` line):

```makefile
	@echo "  make update-v2-continue PROJECT=<project-key>  # resume after gated approval"
	@echo "  make apply-pending PROJECT=<project-key> PROPOSAL=<proposal-id>  # apply deferred destructive slice"
	@echo "  make reject-pending PROJECT=<project-key> PROPOSAL=<proposal-id>  # archive slice without applying"
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_plan_b_acceptance.py -v`
Expected: 6 tests pass (3 prior + 3 new).

Full suite: `.venv/bin/pytest -q`
Expected: 81 pass.

- [ ] **Step 5: Commit**

```bash
git add Makefile tests/test_plan_b_acceptance.py
git commit -m "feat(makefile): add update-v2-continue, apply-pending, reject-pending"
```

---

### Task 10: `scripts/status.sh` — v2 state with fallback

**Files:**
- Modify: `scripts/status.sh`
- Test: `tests/test_status_v2_fallback.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_status_v2_fallback.py`:

```python
"""status.sh must read update-state.json on v2 projects and fall back to bootstrap-state.json on v1."""

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_status_reads_v2_update_state(tmp_sample_project):
    us = json.loads((tmp_sample_project / "state" / "update-state.json").read_text())
    us["last_completed_stage"] = "impact"
    us["stages"]["sense"]["status"] = "completed"
    us["stages"]["impact"]["status"] = "completed"
    (tmp_sample_project / "state" / "update-state.json").write_text(json.dumps(us, indent=2))

    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "status.sh"),
         "--project", "sample", "--project-dir", str(tmp_sample_project)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"
    assert "impact" in result.stdout


def test_status_falls_back_to_v1_bootstrap_state(tmp_path):
    """If only bootstrap-state.json (v1) exists, status still prints with a warning."""
    proj = tmp_path / "projects" / "v1_project"
    (proj / "state").mkdir(parents=True)
    (proj / "state" / "project.json").write_text(json.dumps({
        "key": "v1_project", "name": "V1", "repo_paths": [],
        "entry_pages": ["index.md"], "bootstrap_focuses": [],
        "related_concepts": [], "ignored_paths": [], "tags": []
    }))
    (proj / "state" / "bootstrap-state.json").write_text(json.dumps({
        "project": "v1_project",
        "last_completed_stage": "validate",
        "stages": {}
    }))
    (proj / "state" / "freshness.json").write_text(json.dumps({"status": "unknown"}))
    (proj / "state" / "pages.json").write_text(json.dumps({"pages": []}))

    result = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "status.sh"),
         "--project", "v1_project", "--project-dir", str(proj)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stderr={result.stderr}"
    combined = result.stdout + result.stderr
    assert "validate" in combined  # v1 stage name shows through
    assert "not yet migrated" in combined.lower() or "v1" in combined.lower() or "bootstrap-state" in combined.lower()
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_status_v2_fallback.py -v`
Expected: FAIL (status.sh currently only reads bootstrap-state.json).

- [ ] **Step 3: Update `scripts/status.sh`**

Read the full current `scripts/status.sh`. The script invokes an embedded Python heredoc (`python3 - ... <<'PY' ... PY`) that does the actual state reading. Changes must land **inside the Python heredoc**, not just in the surrounding bash.

Two edits required:

**Edit 1 — Bash wrapper:** near the top of `status.sh`, after `ROOT_DIR` is set, export a resolved state file path environment variable so the Python heredoc can read it. In the section that invokes Python for a single project (the `--project` path), replace the hardcoded state-file argument passed to Python with a conditional resolver:

```bash
# Prefer v2 update-state.json; fall back to v1 bootstrap-state.json with a warning.
if [[ -f "$project_dir/state/update-state.json" ]]; then
  state_file="$project_dir/state/update-state.json"
  state_schema="v2"
else
  state_file="$project_dir/state/bootstrap-state.json"
  state_schema="v1"
  echo "warning: [$project_key] not yet migrated to v2 state; run scripts/migrate_state_v1_to_v2.sh PROJECT=$project_key" >&2
fi
export state_file state_schema
```

**For the `--all` mode**, the env-var export pattern does not compose — the Python heredoc iterates multiple projects and cannot rely on a single exported `state_file`. Instead, move the v2/v1 resolution **entirely into the Python heredoc**. Inside the `status_view(project_dir)` helper (or equivalent per-project function in the heredoc), replace any `bootstrap-state.json` path reference with:

```python
v2 = project_dir / "state" / "update-state.json"
state_path = v2 if v2.is_file() else project_dir / "state" / "bootstrap-state.json"
state = json.loads(state_path.read_text()) if state_path.is_file() else {}
if not v2.is_file() and state_path.is_file():
    print(f"warning: {project_dir.name} not yet migrated to v2 state", file=sys.stderr)
```

This per-project resolver works for both `--project` and `--all` paths. You can then drop the Bash-level env-var export from Edit 1 if the Python resolver is the single source of truth. (Keeping the Bash var as a hint is harmless; just don't depend on it inside the `--all` loop.)

**Edit 2 — Python heredoc body:** inside each `python3 - <<'PY'` block, replace any hardcoded `"bootstrap-state.json"` path with a read from the exported env var:

```python
import os
state_path = Path(os.environ.get("state_file", project_dir / "state" / "bootstrap-state.json"))
state = json.loads(state_path.read_text()) if state_path.is_file() else {}
```

Any downstream use of the state dict is schema-tolerant because both v1 and v2 expose compatible top-level keys (`stages`, `last_completed_stage`, `latest_lint_findings`, etc.). If the script prints schema-specific stage names, guard those reads with `state.get(...)`.

Verify by running `grep -n "bootstrap-state.json" scripts/status.sh` — after the edit, the only remaining occurrences should be inside the fallback-selection conditional.

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_status_v2_fallback.py -v`
Expected: 2 tests pass.

Full suite: `.venv/bin/pytest -q`
Expected: 83 pass (including prior status tests still green).

- [ ] **Step 5: Commit**

```bash
git add scripts/status.sh tests/test_status_v2_fallback.py
git commit -m "feat(status): support v2 update-state.json with v1 fallback"
```

---

### Task 11: `scripts/lint.sh` — write to update-state.json with fallback

**Files:**
- Modify: `scripts/lint.sh`
- Modify: `agents/bootstrap/_shared/state.py` (its `record-lint` subcommand writes to bootstrap-state.json — update to detect and write to update-state.json if present)
- Test: extend `tests/test_lint_script.py` (if present) or create `tests/test_lint_v2_fallback.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_lint_v2_fallback.py`:

```python
"""lint.sh must write findings to update-state.json on v2 projects."""

import json
import os
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_lint_writes_to_v2_update_state(tmp_sample_project, tmp_path):
    """When update-state.json exists, lint findings go there under latest_lint_findings."""
    us_path = tmp_sample_project / "state" / "update-state.json"
    assert us_path.is_file(), "fixture should have v2 state"

    findings_path = tmp_sample_project / "state" / "latest" / "lint-findings.json"
    findings_path.parent.mkdir(parents=True, exist_ok=True)
    findings_path.write_text(json.dumps({"findings": [], "status": "pass"}))

    fake_audit_run_dir = tmp_path / "audit-run"
    fake_audit_run_dir.mkdir()

    subprocess.run(
        ["python3", "-m", "agents.bootstrap._shared.state", "record-lint",
         "--project-dir", str(tmp_sample_project),
         "--status", "pass",
         "--findings-path", str(findings_path),
         "--audit-run-dir", str(fake_audit_run_dir)],
        cwd=str(REPO_ROOT), capture_output=True, text=True, check=True,
    )

    us = json.loads(us_path.read_text())
    assert us.get("latest_lint_findings", {}).get("status") == "pass"


def test_lint_fallback_writes_to_v1_bootstrap_state(tmp_path):
    """When only bootstrap-state.json exists, lint findings go there."""
    proj = tmp_path / "projects" / "v1_project"
    (proj / "state" / "latest").mkdir(parents=True)
    (proj / "state" / "project.json").write_text(json.dumps({"key": "v1_project"}))
    (proj / "state" / "bootstrap-state.json").write_text(json.dumps({
        "project": "v1_project", "stages": {}
    }))
    findings_path = proj / "state" / "latest" / "lint-findings.json"
    findings_path.write_text(json.dumps({"findings": [], "status": "pass"}))

    fake_audit_run_dir = tmp_path / "audit-run"
    fake_audit_run_dir.mkdir()

    subprocess.run(
        ["python3", "-m", "agents.bootstrap._shared.state", "record-lint",
         "--project-dir", str(proj),
         "--status", "pass",
         "--findings-path", str(findings_path),
         "--audit-run-dir", str(fake_audit_run_dir)],
        cwd=str(REPO_ROOT), capture_output=True, text=True, check=True,
    )

    bs = json.loads((proj / "state" / "bootstrap-state.json").read_text())
    assert bs.get("latest_lint_findings", {}).get("status") == "pass"
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_lint_v2_fallback.py -v`
Expected: FAIL (state.py currently only writes to bootstrap-state.json).

- [ ] **Step 3: Update `agents/bootstrap/_shared/state.py`**

`state.py` currently hardcodes `bootstrap-state.json` in multiple command handlers. Add a shared resolver helper near the top of the file:

```python
def _state_file(project_dir: Path) -> Path:
    """Return update-state.json if present, else bootstrap-state.json."""
    v2 = project_dir / "state" / "update-state.json"
    if v2.is_file():
        return v2
    return project_dir / "state" / "bootstrap-state.json"
```

Then replace **every** `Path(args.project_dir) / "state" / "bootstrap-state.json"` occurrence with `_state_file(Path(args.project_dir))`. Verify by running `grep -n "bootstrap-state.json" agents/bootstrap/_shared/state.py` after the edit — only the literal string inside `_state_file` itself should remain.

Specifically, the functions that need updating (all hit the hardcoded path today) include:

- `cmd_ensure`
- `cmd_record_stage` (if present)
- `cmd_record_validation`
- `cmd_record_lint`
- `cmd_record_ingest`
- any `save_state` helper that reads/writes the file
- the `normalize_state` helper (if present) that opens the file directly

For any function that both reads and writes, the same path must be used for both — reuse the value from `_state_file` once per invocation rather than calling it twice (so the read and write target the same file).

**`cmd_ensure` — apply the v2 rewrite here, not in Task 12.** Task 12 originally owned this change; it is moved here so Task 11 ends in a clean v2 state with no short-lived regression. Replace the `cmd_ensure` function body with:

```python
def cmd_ensure(args: argparse.Namespace) -> int:
    path = Path(args.project_dir) / "state" / "update-state.json"
    if path.is_file():
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    initial = {
        "project": args.project,
        "latest_run_dir": None,
        "last_completed_stage": None,
        "latest_validation_findings": None,
        "latest_lint_findings": None,
        "latest_ingest_findings": None,
        "stages": {
            s: {"status": "pending", "last_run_dir": None, "last_completed_at": None, "summary_file": None}
            for s in ("sense", "impact", "propose", "apply", "validate", "reconcile")
        },
    }
    path.write_text(json.dumps(initial, indent=2) + "\n")
    return 0
```

After this rewrite, `cmd_ensure` always produces `update-state.json` (v2). The other handlers (`cmd_record_stage`, `cmd_record_validation`, `cmd_record_lint`, `cmd_record_ingest`, any `save_state` helper) continue to use `_state_file()` so they remain tolerant of v1 projects during migration.

- [ ] **Step 4: Verify `scripts/lint.sh` doesn't hardcode the path**

Read `scripts/lint.sh` and confirm it only interacts with state via `state.py`. If there's any direct `bootstrap-state.json` reference, update it to use the same fallback.

- [ ] **Step 5: Run tests**

Run: `.venv/bin/pytest tests/test_lint_v2_fallback.py -v`
Expected: 2 tests pass.

Full suite: `.venv/bin/pytest -q`
Expected: 85 pass, existing lint tests still green.

- [ ] **Step 6: Commit**

```bash
git add agents/bootstrap/_shared/state.py scripts/lint.sh tests/test_lint_v2_fallback.py
git commit -m "feat(lint): write to update-state.json with v1 fallback"
```

---

### Task 12: `scripts/init_project.sh` — produce v2 project.json

**Files:**
- Modify: `scripts/init_project.sh`
- Modify: `templates/state/project.template.json`
- Create: `templates/state/update-state.template.json`
- Test: `tests/test_init_project_v2.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_init_project_v2.py`:

```python
"""init_project produces v2-shape project.json."""

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_init_project_creates_v2_project_json(tmp_path):
    env = {**os.environ, "PROJECTS_DIR": str(tmp_path / "projects")}
    # Most init scripts take positional or flag args; use the repo's pattern
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "init_project.sh"),
         "--project", "newproj"],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    pj = json.loads((tmp_path / "projects" / "newproj" / "state" / "project.json").read_text())
    assert pj["key"] == "newproj"
    assert "bootstrap_focuses" not in pj
    assert pj["acceptance_questions_path"] == "acceptance-questions.md"
    assert pj["ranking_cutoff"] == 20


def test_init_project_creates_update_state_not_bootstrap_state(tmp_path):
    env = {**os.environ, "PROJECTS_DIR": str(tmp_path / "projects")}
    rc = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "init_project.sh"),
         "--project", "newproj2"],
        env=env, capture_output=True, text=True,
    )
    assert rc.returncode == 0, f"stderr={rc.stderr}"
    proj = tmp_path / "projects" / "newproj2"
    assert (proj / "state" / "update-state.json").is_file()
    assert not (proj / "state" / "bootstrap-state.json").is_file()
```

- [ ] **Step 2: Run to verify fail**

Run: `.venv/bin/pytest tests/test_init_project_v2.py -v`
Expected: FAIL (init creates v1 shape).

- [ ] **Step 3: Update templates**

(Task 0 already updated `tests/fixtures/project_state/state/freshness.json` and `projects/sample/state/freshness.json` with the complete v2 freshness schema including `last_update_at_pending`. Do not re-edit them here.)

Overwrite `templates/state/project.template.json`:

```json
{
  "key": "<project-key>",
  "name": "<Project Name>",
  "repo_paths": [],
  "tags": [],
  "entry_pages": ["index.md"],
  "related_concepts": [],
  "ignored_paths": [],
  "acceptance_questions_path": "acceptance-questions.md",
  "ranking_cutoff": 20
}
```

Create `templates/state/update-state.template.json`:

```json
{
  "project": "<project-key>",
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

Keep `templates/state/bootstrap-state.template.json` in place for now — it will be deleted in Plan C's M5.

- [ ] **Step 4: Update `scripts/init_project.sh`**

(Task 11 already rewrote `cmd_ensure` in `state.py` to write `update-state.json` unconditionally. Nothing further is needed in `state.py` for Task 12.)

Read the full current script. Note: the script writes `project.json` via an inline bash heredoc (around line 380-393), **not** by copying the template file. The template is a reference shape; the heredoc is what actually ships the JSON. Find:
- The inline heredoc that writes `project.json` (search for `"bootstrap_focuses"` in the script). In the heredoc body, **remove** the `"bootstrap_focuses": ...` line, and **add** after `"ignored_paths": ...`:

  ```
  "acceptance_questions_path": "acceptance-questions.md",
  "ranking_cutoff": 20
  ```

  (Mind comma placement — the new final key has no trailing comma; the prior final key must get one.) Keep the template file in `templates/state/project.template.json` in sync for reference, but the heredoc is the load-bearing write.
- The `--focus`/`--focuses` CLI options — keep the parsing but write the received values to a new `projects/<key>/.migration-hints/bootstrap-focuses-archive.md` (so nothing is silently dropped), and print a stderr warning: `"deprecated: --focus archived to .migration-hints/; port to acceptance-questions.md"`.
- Where it seeds `bootstrap-state.json` (likely via `state.py ensure`) — that call now writes `update-state.json` per the state.py change above, so the script does not need a separate edit here other than confirming no other `bootstrap-state.json` path is created.
- Ensure it creates an `acceptance-questions.md` placeholder:

  ```markdown
  # Acceptance Questions — <display-name>

  <!-- version: 0.1 -->

  Questions a cold LLM session should be able to answer from the wiki alone.

  1. [discipline] What is this project and what are its major surfaces?

  ## Scoring

  - 2: full answer with citations from wiki alone
  - 1: directional but incomplete or uncited
  - 0: can't answer; wrong; wiki contradicts itself

  ## Acceptance bar

  - Total ≥ 16/20
  - No zero on [discipline]-tagged questions
  ```

- Honor `PROJECTS_DIR` env var if set (for testability). The current script already has `PROJECTS_DIR="$ROOT_DIR/projects"` at (approximately) line 6 — **replace that exact line** with:

  ```bash
  PROJECTS_DIR="${PROJECTS_DIR:-$ROOT_DIR/projects}"
  ```

  Do not add a second `PROJECTS_DIR=` assignment; the existing line is the only one that needs to change. Verify by running `grep -n "^PROJECTS_DIR=" scripts/init_project.sh` after the edit — exactly one occurrence.

- [ ] **Step 5: Run tests**

Run: `.venv/bin/pytest tests/test_init_project_v2.py -v`
Expected: 2 tests pass.

Full suite: `.venv/bin/pytest -q`
Expected: 87 pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/init_project.sh templates/state/ tests/test_init_project_v2.py
git commit -m "feat(init_project): produce v2 project.json + update-state.json"
```

---

### Task 13: `AGENTS.md` — add index.md `## Status` block carve-out

**Files:**
- Modify: `AGENTS.md` (CLAUDE.md and GEMINI.md are symlinks — editing AGENTS.md propagates)
- Test: none (documentation change)

- [ ] **Step 1: Read current AGENTS.md**

Run: `grep -n "## Status" AGENTS.md | head -5`

Note the writing-rules section that bans `## Status` blocks.

- [ ] **Step 2: Add the carve-out**

Find the section in `AGENTS.md` titled "Writing Style For Wiki Pages" (or similar). Append a new bullet at the end of that rules list:

```markdown
- **`index.md` carve-out:** the project's `index.md` MAY include a `## Status` block as the final section. This block points at machine-readable state files (e.g., `state/latest/validation-report.md`) and lists the last update timestamp plus the source commit SHA. It is **not** a narration of pipeline construction, and the ban on `## Status` sections on wiki pages does **not** apply to `index.md`. See `docs/superpowers/specs/2026-04-18-unified-update-pipeline-design.md` Section 5.2.
```

- [ ] **Step 3: Verify symlink propagation**

```bash
ls -la CLAUDE.md GEMINI.md
```

Both should be symlinks to AGENTS.md. Reading either should now include the new carve-out text:

```bash
grep -c "index.md carve-out" CLAUDE.md
```

Expected: 1.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): add index.md ## Status block carve-out"
```

---

### Task 14: Final sweep and acceptance

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `.venv/bin/pytest -q`
Expected: all tests pass (target ≥87). No regressions.

- [ ] **Step 2: Run AUTO-mode end-to-end against isolated sample**

```bash
# Ensure the sample_repo fixture has git history before the pipeline looks for HEAD
bash tests/fixtures/sample_repo_init.sh

rm -rf /tmp/plan-b-smoke && mkdir -p /tmp/plan-b-smoke/projects /tmp/plan-b-smoke/artifacts
cp -R projects/sample /tmp/plan-b-smoke/projects/sample

LLM_STUB_RESPONSES_DIR=tests/fixtures/stubs \
UPDATE_PROJECTS_ROOT=/tmp/plan-b-smoke/projects \
UPDATE_ARTIFACTS_ROOT=/tmp/plan-b-smoke/artifacts \
AUTO=1 \
make update-v2 PROJECT=sample
```

Expected output:
```
validated N stage config(s)
[sample] run_dir: /tmp/plan-b-smoke/artifacts/sample/runs/<timestamp>-update
sense report written: ...
ranking-snapshot.json + impact-report.json written to ...
proposal.json + proposal.md written to ...
apply: wrote 3 additive unit(s)
apply_commit: advanced last_seen_commit -> <sha>
[sample] pipeline complete
```

Verify:
```bash
ls /tmp/plan-b-smoke/projects/sample/wiki/systems/
# Expect: authentication.md, data-store.md, entry-point.md

cat /tmp/plan-b-smoke/projects/sample/index.md | head -5
# Expect: project summary paragraph

jq '.last_seen_commit, .last_seen_commit_pending' /tmp/plan-b-smoke/projects/sample/state/freshness.json
# Expect: "<sha>", null
```

- [ ] **Step 3: Run gated-mode end-to-end against isolated sample**

```bash
rm -rf /tmp/plan-b-gated && mkdir -p /tmp/plan-b-gated/projects /tmp/plan-b-gated/artifacts
cp -R projects/sample /tmp/plan-b-gated/projects/sample

# First run: should stop at propose, wiki should remain empty
LLM_STUB_RESPONSES_DIR=tests/fixtures/stubs \
UPDATE_PROJECTS_ROOT=/tmp/plan-b-gated/projects \
UPDATE_ARTIFACTS_ROOT=/tmp/plan-b-gated/artifacts \
make update-v2 PROJECT=sample

ls /tmp/plan-b-gated/projects/sample/wiki/systems/
# Expect: empty or no *.md files
```

Approve the proposal manually:

```bash
LATEST=$(ls -td /tmp/plan-b-gated/artifacts/sample/runs/*-update | head -1)
python3 -c "
import json, sys
p = json.load(open('$LATEST/proposal.json'))
p['approved'] = True
open('$LATEST/proposal.json', 'w').write(json.dumps(p, indent=2))
"

# Continue run
LLM_STUB_RESPONSES_DIR=tests/fixtures/stubs \
UPDATE_PROJECTS_ROOT=/tmp/plan-b-gated/projects \
UPDATE_ARTIFACTS_ROOT=/tmp/plan-b-gated/artifacts \
make update-v2-continue PROJECT=sample

ls /tmp/plan-b-gated/projects/sample/wiki/systems/
# Expect: authentication.md, data-store.md, entry-point.md
```

- [ ] **Step 4: Self-review**

- [ ] No TODO / TBD / FIXME in Plan B files:

```bash
grep -rn "TODO\|TBD\|FIXME" agents/update/03-propose/ agents/update/04-apply/ scripts/apply_commit.sh scripts/apply_pending.sh scripts/reject_pending.sh 2>&1 | grep -v "__pycache__"
```

Expected: no matches.

- [ ] Test counts match:
  - `tests/test_update_propose.py`: 3 tests
  - `tests/test_update_apply.py`: 7 tests (6 base + 1 destructive split from Task 5b)
  - `tests/test_apply_commit.py`: 4 tests (advance, noop, changelog, atomic)
  - `tests/test_pending_approvals.py`: 3 tests
  - `tests/test_status_v2_fallback.py`: 2 tests
  - `tests/test_lint_v2_fallback.py`: 2 tests
  - `tests/test_init_project_v2.py`: 2 tests
  - `tests/test_plan_b_acceptance.py`: 6 tests
  - Plus Task 1 + 4 config assertions (2 new in test_validate_stage_configs.py)
  - Plus Task 2 stub-present assertion (1 new in test_llm_client_stub.py)
  - Total new in Plan B: ~32 tests

- [ ] Acceptance check:
  - `make update-v2 PROJECT=sample AUTO=1` produces a wiki in one command
  - `make update-v2 PROJECT=sample` (gated) stops at propose
  - `make update-v2-continue PROJECT=sample` applies an approved proposal
  - Commit pointer advances from pending to committed at pipeline end
  - No destructive changes applied silently under AUTO=1 (they'd go to pending-approvals; baseline stub has none)

- [ ] **Step 5: Commit final sweep marker**

```bash
git commit --allow-empty -m "chore: Plan B complete — propose + apply + safety ladder + v2 state fallbacks landed"
```

---

## Plan B Deliverables Summary

- Propose stage (`agents/update/03-propose/`) with gated/AUTO modes
- Apply stage (`agents/update/04-apply/`) with pre-flight validation + additive path + destructive split
- Commit-pointer advancement (`scripts/apply_commit.sh`)
- Pending-approvals flow (`scripts/apply_pending.sh`, `scripts/reject_pending.sh`)
- Pipeline continuity: `scripts/update.sh` wires propose + apply + apply_commit; `CONTINUE=1` for gated resume
- Makefile targets: `update-v2-continue`, `apply-pending`, `reject-pending`
- v2 state migration of existing tools: `status.sh`, `lint.sh` (via `state.py`), `init_project.sh`
- Templates updated: `project.template.json`, new `update-state.template.json`
- Documentation: `index.md` `## Status` carve-out in `AGENTS.md`
- Baseline LLM stub for propose
- ~32 new tests across 8 test modules

## Acceptance

After all Plan B deliverables land:

```bash
# One-shot AUTO mode
LLM_STUB_RESPONSES_DIR=tests/fixtures/stubs AUTO=1 make update-v2 PROJECT=sample
```

Writes `projects/sample/wiki/systems/{authentication,data-store,entry-point}.md` + regenerates `index.md` + advances commit pointer. All tests pass.

Gated mode:

```bash
LLM_STUB_RESPONSES_DIR=tests/fixtures/stubs make update-v2 PROJECT=sample
# stops at proposal.md, prints instructions
# operator edits proposal.json to set approved: true
LLM_STUB_RESPONSES_DIR=tests/fixtures/stubs make update-v2-continue PROJECT=sample
# applies the approved proposal
```

## Next

Plan C (validate + reconcile + measurement + pilot rebootstrap + M5 promotion) is authored separately after Plan B is reviewed and executed.
