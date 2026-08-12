# Route Repair Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make route measurement actionable by teaching update to repair route misses, cleaning relationship state, and surfacing route health in status.

**Architecture:** Keep route measurement and gap emission as the trigger. Add deterministic route-gap classification and prompt payload shaping in the ingest path, add relationship normalization/dedupe in the metadata/state maintenance layer, and teach status to read `state/latest/route-measurement.json`. Generated metadata remains application-owned; update repairs canonical inputs and relationships rather than hand-editing metadata products. V1 does not add an alias source-of-truth; route-vocabulary repair works through summaries, topics, and relationships.

**Tech Stack:** Python scripts, Bash Make targets, file-backed JSON state, pytest, existing inbox writer and update pipeline

---

## File Map

- `scripts/measure_routes.py`: already emits route-miss gap notes; only adjust if the emitted contract needs minor compatibility fixes.
- `agents/update/_shared/ingest.py`: classify route-repair inbox items and include route evidence in prompt payloads.
- `agents/update/08-ingest/instructions.md`: instruct the model how to repair route misses.
- `agents/update/_shared/brain_metadata.py`: relationship normalization/dedupe helper.
- `agents/update/04-apply/run.sh`: normalize and rewrite `state/relationships.json` after apply refreshes page state.
- `scripts/stable_products.py`: copy normalized `state/relationships.json` into `state/latest/relationships.json`.
- `scripts/status.sh`: render latest route measurement summary.
- `tests/test_ingest_batcher.py` or a new focused ingest test: route-gap classification/payload coverage.
- `tests/test_brain_metadata.py` or new relationship test: relationship dedupe/normalization coverage.
- `tests/test_status_script.py`: route health status rendering.
- `tests/test_measure_routes.py`: guard the existing gap-note contract.

## Task 1: Preserve The Route Gap Contract

**Files:**
- Modify: `tests/test_measure_routes.py`
- Inspect: `scripts/measure_routes.py`

- [ ] **Step 1: Add a regression that route gap notes contain route repair evidence**

Add assertions to the existing emitted-item test that parse `operator_notes` and verify these keys:

```python
notes = json.loads(inbox_items[0]["operator_notes"])
assert "failure_reasons" in notes
assert "route_confidence" in notes
assert "route_reason" in notes
assert "expected_page" in notes
assert "selected_pages" in notes
assert "metadata_available" in notes
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
.venv/bin/pytest tests/test_measure_routes.py -q
```

Expected: pass. If it fails, adjust `scripts/measure_routes.py` without changing the public JSON report shape.

- [ ] **Step 3: Review status**

```bash
rtk git status --short --untracked-files=all
```

## Task 2: Classify Route Repair Items In Ingest

**Files:**
- Modify: `agents/update/_shared/ingest.py`
- Test: `tests/test_ingest_batcher.py`

- [ ] **Step 1: Write a failing test for route-repair classification**

Add a test that creates a `measure-auto` inbox item with `operator_notes` JSON containing `failure_reasons`. Assert the scanned/batched item exposes a route-repair classification field such as:

```python
assert record["route_repair"]["is_route_repair"] is True
assert record["route_repair"]["failure_reasons"] == ["expected_page_not_selected"]
assert record["route_repair"]["expected_page"] == "wiki/systems/incremental-ingest-and-gap-notes.md"
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
.venv/bin/pytest tests/test_ingest_batcher.py -q
```

Expected: fail because route repair classification does not exist yet.

- [ ] **Step 3: Implement a small parser**

In `agents/update/_shared/ingest.py`, add a helper equivalent to:

```python
def route_repair_from_item(item: dict) -> dict:
    if item.get("source") != "measure-auto":
        return {"is_route_repair": False}
    notes_raw = item.get("operator_notes")
    if not isinstance(notes_raw, str) or not notes_raw.strip():
        return {"is_route_repair": False}
    try:
        notes = json.loads(notes_raw)
    except json.JSONDecodeError:
        return {"is_route_repair": False}
    reasons = notes.get("failure_reasons")
    if not isinstance(reasons, list) or not reasons:
        return {"is_route_repair": False}
    return {
        "is_route_repair": True,
        "failure_reasons": [str(reason) for reason in reasons],
        "route_confidence": notes.get("route_confidence"),
        "route_reason": notes.get("route_reason"),
        "expected_page": notes.get("expected_page"),
        "expected_page_selected": notes.get("expected_page_selected"),
        "selected_pages": notes.get("selected_pages") if isinstance(notes.get("selected_pages"), list) else [],
        "freshness_warning_count": notes.get("freshness_warning_count"),
        "metadata_available": notes.get("metadata_available"),
    }
```

Attach this to each selected inbox record where existing scan/batch records are assembled.

- [ ] **Step 4: Run the focused test**

Run:

```bash
.venv/bin/pytest tests/test_ingest_batcher.py -q
```

Expected: pass.

- [ ] **Step 5: Review status**

```bash
rtk git status --short --untracked-files=all
```

## Task 3: Add Route Repair Evidence To The Ingest Prompt

**Files:**
- Modify: `agents/update/_shared/ingest.py`
- Modify: `agents/update/08-ingest/instructions.md`
- Test: `tests/test_ingest_batcher.py`

- [ ] **Step 1: Write a failing prompt-payload test**

Extend the prompt payload test so a route-repair item includes a compact `route_repair` object inside the existing `inbox_items` payload:

```python
payload = ingest.build_prompt_payload("sample", project_dir, batches)
unit = payload["batches"][0]["inbox_items"][0]
assert unit["route_repair"]["is_route_repair"] is True
assert unit["route_repair"]["expected_page"] == "wiki/systems/auth.md"
assert unit["route_repair"]["selected_pages"] == ["wiki/systems/wrong.md"]
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
.venv/bin/pytest tests/test_ingest_batcher.py -q
```

Expected: fail because the prompt payload omits route repair evidence.

- [ ] **Step 3: Include route evidence in prompt payload**

Modify the payload construction to include route repair evidence in each relevant `inbox_items[]` entry only when `is_route_repair` is true. Keep it compact; do not include full page bodies. Do not rename `inbox_items`.

- [ ] **Step 4: Update the ingest instructions**

Add a section to `agents/update/08-ingest/instructions.md`:

```markdown
## Route Repair Items

When an item includes `route_repair.is_route_repair=true`, prefer repairs that improve routing:

- add missing terminology to the expected page content/summary/topics when the source supports it
- add or strengthen relationships between selected pages and expected pages when traversal should bridge them
- update prose only when the route miss reveals a real documentation gap

Do not hand-edit generated metadata products. Metadata is regenerated by apply. V1 does not support direct alias edits because aliases are generated from page title/path only.
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
.venv/bin/pytest tests/test_ingest_batcher.py tests/test_measure_routes.py -q
```

Expected: pass.

- [ ] **Step 6: Review status**

```bash
rtk git status --short --untracked-files=all
```

## Task 4: Normalize And Dedupe Relationship State

**Files:**
- Modify: `agents/update/_shared/brain_metadata.py`
- Modify: `agents/update/04-apply/run.sh` or `scripts/stable_products.py`
- Test: `tests/test_brain_metadata.py`

- [ ] **Step 1: Write a failing relationship dedupe test**

Add a test for a helper named `normalize_relationships` that returns normalized edges plus a dropped-edge count:

```python
relationships = [
    {"from": "index.md", "to": "wiki/systems/auth.md", "relationship_type": "references", "confidence": "low"},
    {"source": "index.md", "target": "wiki/systems/auth.md", "type": "references", "confidence": "high"},
    {"from": "missing.md", "to": "wiki/systems/auth.md", "relationship_type": "references"},
    {"from": "index.md", "to": "wiki/systems/auth.md"},
]
pages = [{"path": "index.md"}, {"path": "wiki/systems/auth.md"}]
result = brain_metadata.normalize_relationships(relationships, pages)
assert result["relationships"] == [
    {"from": "index.md", "to": "wiki/systems/auth.md", "relationship_type": "references", "confidence": "high"}
]
assert result["dropped_count"] == 2
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
.venv/bin/pytest tests/test_brain_metadata.py -q
```

Expected: fail because the helper does not exist.

- [ ] **Step 3: Implement deterministic normalization**

Add `normalize_relationships(relationships, pages)` to `brain_metadata.py`.

Rules:

- accepted source keys: `from` or `source`
- accepted target keys: `to` or `target`
- accepted type keys: `relationship_type` or `type`
- only keep edges whose endpoints are known page paths
- dedupe by `(from, to, relationship_type)`
- confidence order: `high`, `medium`, `low`, `unknown`
- output sorted by `(from, to, relationship_type)`
- return `{"relationships": [...], "dropped_count": <int>}`

- [ ] **Step 4: Wire normalization into state generation**

Use the helper where relationship products are refreshed. Normalize and rewrite source `state/relationships.json` in the apply path after page state is refreshed, because query planner and MCP consume the source state file. `scripts/stable_products.py render-metadata` should then copy the normalized file into `state/latest/relationships.json`. Keep existing persisted state shape:

```json
{"relationships": [...]}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
.venv/bin/pytest tests/test_brain_metadata.py tests/test_update_validate.py tests/test_query_engine.py -q
```

Expected: pass.

- [ ] **Step 6: Review status**

```bash
rtk git status --short --untracked-files=all
```

Only report files that actually changed.

## Task 5: Surface Route Health In Status

**Files:**
- Modify: `scripts/status.sh`
- Test: `tests/test_status_script.py`

- [ ] **Step 1: Write a failing status test**

Create a temporary `state/latest/route-measurement.json`:

```json
{
  "project_key": "sample",
  "question_count": 4,
  "generated_at": "2026-04-30T00:00:00+00:00",
  "summary": {
    "average_route_confidence": 0.75,
    "low_confidence_count": 1,
    "expected_page_count": 4,
    "expected_page_hit_count": 3,
    "expected_page_hit_ratio": 0.75,
    "emitted_gap_count": 1,
    "no_emit": false
  }
}
```

Assert `scripts/status.sh --project sample --project-dir <tmp>` renders a route health line that includes question count, generated timestamp, hit ratio, average confidence, low-confidence count, and emitted gap count:

```text
Route health: 3/4 expected pages hit across 4 questions, avg confidence 0.75, 1 low-confidence route, 1 emitted gap note, measured 2026-04-30T00:00:00+00:00
```

Also assert path hints include `route-measurement.md` when low-confidence or miss counts exist.

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
.venv/bin/pytest tests/test_status_script.py -q
```

Expected: fail because status does not read route measurement yet.

- [ ] **Step 3: Implement route measurement loading**

In `scripts/status.sh`, add a Python helper near existing latest-product loaders:

- read `state/latest/route-measurement.json` when present
- tolerate missing or malformed files by returning no route health section
- render one concise line in full output including `question_count` and `generated_at`
- do not run measurement

- [ ] **Step 4: Add route report path hints**

When route health has `low_confidence_count > 0`, `expected_page_hit_count < expected_page_count`, or `emitted_gap_count > 0`, include:

```text
- route measurement: <project>/state/latest/route-measurement.md
```

- [ ] **Step 5: Run focused status tests**

Run:

```bash
.venv/bin/pytest tests/test_status_script.py -q
```

Expected: pass.

- [ ] **Step 6: Review status**

```bash
rtk git status --short --untracked-files=all
```

## Task 6: End-To-End Focused Verification

**Files:**
- Modify: none

- [ ] **Step 1: Run route measurement without emission**

Run:

```bash
NO_EMIT=1 make measure-routes PROJECT=llm-wiki
```

Expected: command succeeds, updates `projects/llm-wiki/state/latest/route-measurement.json`, and writes no inbox items.

- [ ] **Step 2: Run status**

Run:

```bash
make status PROJECT=llm-wiki
```

Expected: output includes route health and a route measurement path hint when misses exist.

- [ ] **Step 3: Run focused suite**

Run:

```bash
.venv/bin/pytest tests/test_measure_routes.py tests/test_ingest_batcher.py tests/test_brain_metadata.py tests/test_update_validate.py tests/test_query_engine.py tests/test_status_script.py -q
```

Expected: pass.

- [ ] **Step 4: Optional real repair dogfood**

Only if the operator approves real inbox writes:

```bash
make measure-routes PROJECT=llm-wiki
make update PROJECT=llm-wiki AUTO=1
NO_EMIT=1 make measure-routes PROJECT=llm-wiki
```

Expected: update consumes route-miss notes, and a later no-emit route measurement shows stable or improved expected-page hit ratio.

Do not run this optional dogfood unless explicitly approved because it creates real inbox items and may trigger LLM update work.

## Final Verification

Before handing back:

```bash
rtk git status --short --untracked-files=all
rtk git diff --check
```

Report:

- files changed
- tests and commands run
- route status sample line
- whether any real inbox items were created
- whether any real update pipeline was run
