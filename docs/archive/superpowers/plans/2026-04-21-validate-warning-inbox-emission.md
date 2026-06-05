# Validate Warning Inbox Emission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit curated semantic validation warnings as pending inbox items that a later manual `make update` can consume.

**Architecture:** Keep validate as the producer and reuse the existing inbox schema plus ingest path. Add a new inbox source for validator-produced maintenance items, emit only a curated subset with `suggested_action`, and dedupe only against still-pending inbox items.

**Tech Stack:** Bash wrapper with embedded Python, pytest, file-backed inbox JSON schema

---

### Task 1: Add Red Tests For Curated Validate Emission

**Files:**
- Create: `tests/fixtures/stubs/06-validate.semantic.redundancy.json`
- Modify: `tests/test_update_validate.py`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run `./.venv/bin/pytest tests/test_update_validate.py -q` and confirm the new tests fail**

### Task 2: Add `validate-auto` Inbox Producer

**Files:**
- Modify: `agents/_shared/inbox_writer.py`
- Modify: `agents/update/06-validate/run.sh`

- [ ] **Step 1: Extend allowed inbox sources to include `validate-auto`**
- [ ] **Step 2: Add validate-side helpers to map curated warnings into inbox items**
- [ ] **Step 3: Dedupe only against still-pending matching `validate-auto` items**
- [ ] **Step 4: Run `./.venv/bin/pytest tests/test_update_validate.py -q` and confirm green**

### Task 3: Document The New Producer

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/inbox-item-schema.md`

- [ ] **Step 1: Document `validate-auto` as a project inbox producer**
- [ ] **Step 2: Record its source-specific payload shape and operator model**

### Task 4: Verify Focused Surface

**Files:**
- Modify: `tests/test_mcp_flag_stale_answer.py`

- [ ] **Step 1: Add a focused source-acceptance test for `validate-auto`**
- [ ] **Step 2: Run `./.venv/bin/pytest tests/test_update_validate.py tests/test_mcp_flag_stale_answer.py -q`**
