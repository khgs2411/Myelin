from __future__ import annotations

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

from agents.update._shared import ingest


def _write_item(project_dir: Path, filename: str, payload: dict) -> Path:
    inbox_dir = project_dir / "inbox"
    inbox_dir.mkdir(exist_ok=True)
    path = inbox_dir / filename
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return path


def _valid_item(*, gap_id: str, emitted_at: str, target_hint: str) -> dict:
    return {
        "id": gap_id,
        "schema_version": 1,
        "source": "manual",
        "emitted_at": emitted_at,
        "project_key": "sample",
        "question": f"question for {gap_id}",
        "target_hint": target_hint,
        "confidence": None,
        "pages_read": None,
        "pages_considered": None,
        "router_model": None,
        "synthesizer_model": None,
        "enriched_notes": None,
        "question_index": None,
        "question_tag": None,
        "score_awarded": None,
        "score_max": None,
        "expected_page": None,
        "measurement_run_id": None,
        "operator_notes": "manual seed",
    }


def test_scan_inbox_routes_malformed_items_to_needs_review(tmp_project: Path):
    valid = _valid_item(
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        emitted_at="2026-04-19T20:30:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    invalid = _valid_item(
        gap_id="2026-04-19T20-31-00Z_bbbbbb",
        emitted_at="2026-04-19T20:31:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    invalid["source"] = "invalid"
    _write_item(tmp_project, f"{valid['id']}.json", valid)
    invalid_path = _write_item(tmp_project, f"{invalid['id']}.json", invalid)

    result = ingest.scan_inbox(tmp_project, max_items_per_run=50)

    assert [record["item"]["id"] for record in result["selected"]] == [valid["id"]]
    moved_path = tmp_project / "inbox" / "needs-review" / invalid_path.name
    assert moved_path.is_file()
    assert (tmp_project / "inbox" / "needs-review" / f"{invalid['id']}.reason.md").is_file()


def test_scan_inbox_batches_by_target_hint_and_catch_all(tmp_project: Path):
    first = _valid_item(
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        emitted_at="2026-04-19T20:30:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    second = _valid_item(
        gap_id="2026-04-19T20-31-00Z_bbbbbb",
        emitted_at="2026-04-19T20:31:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    third = _valid_item(
        gap_id="2026-04-19T20-32-00Z_cccccc",
        emitted_at="2026-04-19T20:32:00Z",
        target_hint="",
    )
    for item in (first, second, third):
        _write_item(tmp_project, f"{item['id']}.json", item)

    result = ingest.scan_inbox(tmp_project, max_items_per_run=50)
    batches = ingest.batch_items(result["selected"])

    assert [batch["target_hint"] for batch in batches] == [
        "wiki/systems/authentication.md",
        "routing-needed",
    ]
    assert [item["id"] for item in batches[0]["items"]] == [first["id"], second["id"]]
    assert [item["id"] for item in batches[1]["items"]] == [third["id"]]


def test_scan_inbox_caps_to_oldest_items(tmp_project: Path):
    items = [
        _valid_item(
            gap_id=f"2026-04-19T20-3{i}-00Z_{i}{i}{i}{i}{i}{i}",
            emitted_at=f"2026-04-19T20:3{i}:00Z",
            target_hint="wiki/systems/authentication.md",
        )
        for i in range(3)
    ]
    for item in items:
        _write_item(tmp_project, f"{item['id']}.json", item)

    result = ingest.scan_inbox(tmp_project, max_items_per_run=2)

    assert [record["item"]["id"] for record in result["selected"]] == [items[0]["id"], items[1]["id"]]
    assert result["remaining_count"] == 1


def test_scan_inbox_skips_terminal_state_subdirectories(tmp_project: Path):
    processed = tmp_project / "inbox" / "processed"
    needs_review = tmp_project / "inbox" / "needs-review"
    processed.mkdir(parents=True, exist_ok=True)
    needs_review.mkdir(parents=True, exist_ok=True)
    (processed / "ignored.json").write_text("{}\n")
    (needs_review / "ignored.json").write_text("{}\n")
    valid = _valid_item(
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        emitted_at="2026-04-19T20:30:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    _write_item(tmp_project, f"{valid['id']}.json", valid)

    result = ingest.scan_inbox(tmp_project, max_items_per_run=50)

    assert [record["item"]["id"] for record in result["selected"]] == [valid["id"]]


def test_build_prompt_payload_does_not_duplicate_page_bodies(tmp_project: Path):
    page_path = tmp_project / "wiki" / "systems" / "authentication.md"
    page_path.parent.mkdir(parents=True, exist_ok=True)
    page_path.write_text("Unique authentication page body.\n", encoding="utf-8")
    item = _valid_item(
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        emitted_at="2026-04-19T20:30:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    item["pages_read"] = ["wiki/systems/authentication.md"]
    _write_item(tmp_project, f"{item['id']}.json", item)

    scan = ingest.scan_inbox(tmp_project, max_items_per_run=50)
    batches = ingest.batch_items(scan["selected"])
    payload = ingest.build_prompt_payload("sample", tmp_project, batches)
    serialized = json.dumps(payload)

    assert serialized.count("Unique authentication page body.") == 1
    assert payload["existing_page_paths"] == ["wiki/systems/authentication.md"]
