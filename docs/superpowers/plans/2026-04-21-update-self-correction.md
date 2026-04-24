# Update Self-Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one bounded repo-grounded self-correction pass to `make update` so residual semantic warnings can be repaired before the run falls back to manual review.

**Architecture:** Keep the existing `ingest -> apply -> validate -> reconcile?` flow, then add an update-only `self-correct` LLM stage that runs only after a passing validate with remaining semantic warnings. Suppress `validate-auto` emission during update-run validate calls, harvest bounded repo context for affected/related pages, run one self-correction pass, re-apply, re-validate, and stop.

**Tech Stack:** Bash orchestration, embedded Python stage runners, pytest, file-backed artifacts and stable products

---

### Task 1: Add Design and Red Tests For Update Self-Correction

**Files:**
- Create: `tests/fixtures/stubs/09-self-correct.json`
- Modify: `tests/test_update_orchestrator.py`
- Modify: `tests/test_plan_c_acceptance.py`
- Modify: `tests/test_validate_stage_configs.py`

- [ ] **Step 1: Add an orchestrator test where validate passes with a semantic warning, self-correct runs, apply/validate rerun, and the update succeeds**
- [ ] **Step 2: Add an orchestrator test where self-correct emits no units and the update still completes without looping**
- [ ] **Step 3: Add config existence coverage for the new stage**
- [ ] **Step 4: Run the focused tests and confirm they fail before implementation**

### Task 2: Add The New Self-Correct Stage

**Files:**
- Create: `agents/update/09-self-correct/config.json`
- Create: `agents/update/09-self-correct/instructions.md`
- Create: `agents/update/09-self-correct/run.sh`

- [ ] **Step 1: Define the stage config and prompt contract**
- [ ] **Step 2: Implement a runner that reads validation findings, current wiki pages, related pages, and bounded repo snippets**
- [ ] **Step 3: Emit proposal-shaped patch units for apply/merge**

### Task 3: Wire Self-Correct Into `make update`

**Files:**
- Modify: `scripts/update.sh`
- Modify: `scripts/merge_reconcile.py` (only if proposal merge needs a generic rename or shared path)

- [ ] **Step 1: Increase update pipeline orchestration to include self-correct**
- [ ] **Step 2: Suppress validate-auto emission during update-run validate invocations**
- [ ] **Step 3: Re-apply and re-validate once after a self-correct patch**
- [ ] **Step 4: Keep reconcile semantics unchanged for true validation failures**

### Task 4: Add Validate Emission Control And Shared Helpers

**Files:**
- Modify: `agents/update/06-validate/run.sh`

- [ ] **Step 1: Gate `validate-auto` emission behind an env switch**
- [ ] **Step 2: Preserve the current default behavior for direct validate runs and non-update callers**

### Task 5: Tighten Status And Docs For Residual Manual Review

**Files:**
- Modify: `scripts/status.sh`
- Modify: `docs/inbox-item-schema.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Adjust status wording so residual post-self-correct warnings point to manual review, not another default update loop**
- [ ] **Step 2: Document the new update-only self-correction pass and the validate-auto suppression rule**

### Task 6: Verify Focused Surface

**Files:**
- Modify: none

- [ ] **Step 1: Run `./.venv/bin/pytest tests/test_update_orchestrator.py tests/test_plan_c_acceptance.py tests/test_validate_stage_configs.py tests/test_status_script.py tests/test_update_validate.py -q`**
- [ ] **Step 2: If the focused suite passes, live-dogfood on `make update PROJECT=llm-wiki AUTO=1` only if you want real-run confirmation in this session**
