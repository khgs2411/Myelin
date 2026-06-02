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


def _route_repair_item(*, gap_id: str, emitted_at: str) -> dict:
    item = _valid_item(
        gap_id=gap_id,
        emitted_at=emitted_at,
        target_hint="wiki/systems/auth.md",
    )
    item["source"] = "measure-auto"
    item["question"] = "How does the auth router find sessions?"
    item["expected_page"] = "wiki/systems/auth.md"
    item["pages_read"] = ["wiki/systems/wrong.md"]
    item["operator_notes"] = json.dumps(
        {
            "failure_reasons": ["expected_page_not_selected"],
            "route_confidence": 0.42,
            "route_reason": "metadata products used",
            "expected_page": "wiki/systems/auth.md",
            "expected_page_selected": False,
            "selected_pages": ["wiki/systems/wrong.md"],
            "freshness_warning_count": 0,
            "metadata_available": True,
            "router_prompt_chars": 1234,
        }
    )
    return item


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
    assert payload["batches"][0]["current_page"]["content"] == "Unique authentication page body.\n"
    assert payload["batches"][0]["context_pages"] == []
    assert payload["existing_page_paths"] == ["wiki/systems/authentication.md"]
    assert payload["batches"][0]["current_page"]["summary"] == "Unique authentication page body."
    assert payload["batches"][0]["current_page"]["char_count"] == len("Unique authentication page body.\n")
    assert payload["batches"][0]["current_page"]["content_truncated"] is False


def test_scan_inbox_classifies_route_repair_measurement_items(tmp_project: Path):
    item = _route_repair_item(
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        emitted_at="2026-04-19T20:30:00Z",
    )
    _write_item(tmp_project, f"{item['id']}.json", item)

    result = ingest.scan_inbox(tmp_project, max_items_per_run=50)
    record = result["selected"][0]

    assert record["route_repair"]["is_route_repair"] is True
    assert record["route_repair"]["failure_reasons"] == ["expected_page_not_selected"]
    assert record["route_repair"]["expected_page"] == "wiki/systems/auth.md"
    assert record["route_repair"]["selected_pages"] == ["wiki/systems/wrong.md"]


def test_build_prompt_payload_includes_compact_route_repair_evidence(tmp_project: Path):
    item = _route_repair_item(
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        emitted_at="2026-04-19T20:30:00Z",
    )
    _write_item(tmp_project, f"{item['id']}.json", item)

    scan = ingest.scan_inbox(tmp_project, max_items_per_run=50)
    batches = ingest.batch_items(scan["selected"])
    payload = ingest.build_prompt_payload("sample", tmp_project, batches)
    unit = payload["batches"][0]["inbox_items"][0]

    assert unit["route_repair"]["is_route_repair"] is True
    assert unit["route_repair"]["expected_page"] == "wiki/systems/auth.md"
    assert unit["route_repair"]["selected_pages"] == ["wiki/systems/wrong.md"]
    assert unit["expected_page"] == "wiki/systems/auth.md"
    assert unit["operator_notes"]["failure_reasons"] == ["expected_page_not_selected"]
    assert "measurement_run_id" not in unit


def test_build_prompt_payload_compacts_inbox_items_without_changing_canonical_scan(tmp_project: Path):
    item = _valid_item(
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        emitted_at="2026-04-19T20:30:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    item["confidence"] = 0.42
    item["pages_read"] = ["wiki/systems/authentication.md"]
    item["pages_considered"] = ["wiki/systems/authentication.md", "wiki/systems/users.md"]
    item["enriched_notes"] = "Use the auth module evidence."
    _write_item(tmp_project, f"{item['id']}.json", item)

    scan = ingest.scan_inbox(tmp_project, max_items_per_run=50)
    scanned_item = scan["selected"][0]["item"]
    batches = ingest.batch_items(scan["selected"])
    payload = ingest.build_prompt_payload("sample", tmp_project, batches)
    prompt_item = payload["batches"][0]["inbox_items"][0]

    assert "schema_version" in scanned_item
    assert "project_key" in scanned_item
    assert "router_model" in scanned_item
    assert prompt_item == {
        "id": item["id"],
        "source": "manual",
        "emitted_at": "2026-04-19T20:30:00Z",
        "question": item["question"],
        "target_hint": "wiki/systems/authentication.md",
        "confidence": 0.42,
        "pages_read": ["wiki/systems/authentication.md"],
        "pages_considered": ["wiki/systems/authentication.md", "wiki/systems/users.md"],
        "enriched_notes": "Use the auth module evidence.",
        "operator_notes": "manual seed",
    }
    assert "schema_version" not in prompt_item
    assert "project_key" not in prompt_item
    assert "router_model" not in prompt_item


def test_build_prompt_payload_keeps_meaningful_measurement_fields(tmp_project: Path):
    item = _valid_item(
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        emitted_at="2026-04-19T20:30:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    item["source"] = "measure-auto"
    item["expected_page"] = "wiki/systems/authentication.md"
    item["score_awarded"] = 1
    item["score_max"] = 2
    item["question_tag"] = "routing"
    item["measurement_run_id"] = None
    _write_item(tmp_project, f"{item['id']}.json", item)

    scan = ingest.scan_inbox(tmp_project, max_items_per_run=50)
    batches = ingest.batch_items(scan["selected"])
    payload = ingest.build_prompt_payload("sample", tmp_project, batches)
    prompt_item = payload["batches"][0]["inbox_items"][0]

    assert prompt_item["expected_page"] == "wiki/systems/authentication.md"
    assert prompt_item["score_awarded"] == 1
    assert prompt_item["score_max"] == 2
    assert prompt_item["question_tag"] == "routing"
    assert "measurement_run_id" not in prompt_item


def test_build_prompt_payload_page_context_includes_summary_and_char_count(tmp_project: Path):
    current = tmp_project / "wiki" / "systems" / "authentication.md"
    related = tmp_project / "wiki" / "systems" / "users.md"
    current.parent.mkdir(parents=True, exist_ok=True)
    current.write_text("# Heading\n\nCurrent page summary line.\n\nMore detail.\n", encoding="utf-8")
    related.write_text("# Users\n\nRelated page summary.\n", encoding="utf-8")
    item = _valid_item(
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        emitted_at="2026-04-19T20:30:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    item["pages_read"] = ["wiki/systems/authentication.md", "wiki/systems/users.md"]
    _write_item(tmp_project, f"{item['id']}.json", item)

    scan = ingest.scan_inbox(tmp_project, max_items_per_run=50)
    batches = ingest.batch_items(scan["selected"])
    payload = ingest.build_prompt_payload("sample", tmp_project, batches)
    batch = payload["batches"][0]

    assert batch["current_page"]["summary"] == "Current page summary line."
    assert batch["current_page"]["char_count"] == len(current.read_text(encoding="utf-8"))
    assert batch["context_pages"] == [
        {
            "path": "wiki/systems/users.md",
            "content": related.read_text(encoding="utf-8"),
            "summary": "Related page summary.",
            "char_count": len(related.read_text(encoding="utf-8")),
            "content_truncated": False,
            "original_char_count": len(related.read_text(encoding="utf-8")),
            "included_char_count": len(related.read_text(encoding="utf-8")),
        }
    ]


def test_build_prompt_payload_never_truncates_current_page(tmp_project: Path):
    current = tmp_project / "wiki" / "systems" / "authentication.md"
    current.parent.mkdir(parents=True, exist_ok=True)
    huge_content = "Current page summary.\n" + ("A" * (ingest.CONTEXT_PAGE_FULL_CHAR_LIMIT + 1000))
    current.write_text(huge_content, encoding="utf-8")
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
    current_page = payload["batches"][0]["current_page"]

    assert current_page["content"] == huge_content
    assert current_page["content_truncated"] is False
    assert current_page["original_char_count"] == len(huge_content)
    assert current_page["included_char_count"] == len(huge_content)
    assert payload["prompt_profile"]["truncated_context_page_count"] == 0


def test_build_prompt_payload_truncates_long_context_page_deterministically(tmp_project: Path):
    current = tmp_project / "wiki" / "systems" / "authentication.md"
    related = tmp_project / "wiki" / "systems" / "users.md"
    current.parent.mkdir(parents=True, exist_ok=True)
    current.write_text("Current page summary.\n", encoding="utf-8")
    long_content = (
        "Related page summary.\n"
        + ("H" * ingest.CONTEXT_PAGE_HEAD_CHAR_LIMIT)
        + ("M" * 2000)
        + ("T" * ingest.CONTEXT_PAGE_TAIL_CHAR_LIMIT)
    )
    related.write_text(long_content, encoding="utf-8")
    item = _valid_item(
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        emitted_at="2026-04-19T20:30:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    item["pages_read"] = ["wiki/systems/users.md"]
    _write_item(tmp_project, f"{item['id']}.json", item)

    scan = ingest.scan_inbox(tmp_project, max_items_per_run=50)
    batches = ingest.batch_items(scan["selected"])
    payload = ingest.build_prompt_payload("sample", tmp_project, batches)
    context_page = payload["batches"][0]["context_pages"][0]

    expected = (
        long_content[: ingest.CONTEXT_PAGE_HEAD_CHAR_LIMIT]
        + ingest.CONTEXT_PAGE_OMITTED_MARKER
        + long_content[-ingest.CONTEXT_PAGE_TAIL_CHAR_LIMIT :]
    )
    assert context_page["content"] == expected
    assert context_page["content_truncated"] is True
    assert context_page["original_char_count"] == len(long_content)
    assert context_page["included_char_count"] == len(expected)
    assert payload["prompt_profile"]["truncated_context_page_count"] == 1
    assert payload["prompt_profile"]["original_context_page_body_chars"] == len(long_content)
    assert payload["prompt_profile"]["included_context_page_body_chars"] == len(expected)


def test_build_prompt_payload_keeps_short_context_page_full(tmp_project: Path):
    current = tmp_project / "wiki" / "systems" / "authentication.md"
    related = tmp_project / "wiki" / "systems" / "users.md"
    current.parent.mkdir(parents=True, exist_ok=True)
    current.write_text("Current page summary.\n", encoding="utf-8")
    short_content = "Short related summary.\nDetails.\n"
    related.write_text(short_content, encoding="utf-8")
    item = _valid_item(
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        emitted_at="2026-04-19T20:30:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    item["pages_read"] = ["wiki/systems/users.md"]
    _write_item(tmp_project, f"{item['id']}.json", item)

    scan = ingest.scan_inbox(tmp_project, max_items_per_run=50)
    batches = ingest.batch_items(scan["selected"])
    payload = ingest.build_prompt_payload("sample", tmp_project, batches)
    context_page = payload["batches"][0]["context_pages"][0]

    assert context_page["content"] == short_content
    assert context_page["content_truncated"] is False
    assert context_page["original_char_count"] == len(short_content)
    assert context_page["included_char_count"] == len(short_content)
    assert payload["prompt_profile"]["truncated_context_page_count"] == 0


def test_build_prompt_payload_includes_duplicate_context_page_once(tmp_project: Path):
    current = tmp_project / "wiki" / "systems" / "authentication.md"
    related = tmp_project / "wiki" / "systems" / "users.md"
    current.parent.mkdir(parents=True, exist_ok=True)
    current.write_text("Current page summary.\n", encoding="utf-8")
    related.write_text("Related page summary.\n", encoding="utf-8")
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
    first["pages_read"] = ["wiki/systems/users.md"]
    second["pages_read"] = ["wiki/systems/users.md"]
    for item in (first, second):
        _write_item(tmp_project, f"{item['id']}.json", item)

    scan = ingest.scan_inbox(tmp_project, max_items_per_run=50)
    batches = ingest.batch_items(scan["selected"])
    payload = ingest.build_prompt_payload("sample", tmp_project, batches)

    assert [page["path"] for page in payload["batches"][0]["context_pages"]] == ["wiki/systems/users.md"]
    assert payload["prompt_profile"]["context_page_count"] == 1


def test_build_prompt_payload_page_summary_is_capped(tmp_project: Path):
    page = tmp_project / "wiki" / "systems" / "authentication.md"
    page.parent.mkdir(parents=True, exist_ok=True)
    page.write_text("A" * 200 + "\n", encoding="utf-8")
    item = _valid_item(
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        emitted_at="2026-04-19T20:30:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    _write_item(tmp_project, f"{item['id']}.json", item)

    scan = ingest.scan_inbox(tmp_project, max_items_per_run=50)
    batches = ingest.batch_items(scan["selected"])
    payload = ingest.build_prompt_payload("sample", tmp_project, batches)
    summary = payload["batches"][0]["current_page"]["summary"]

    assert len(summary) == 120
    assert summary.endswith("...")


def test_build_prompt_payload_prompt_profile_is_deterministic(tmp_project: Path):
    auth = tmp_project / "wiki" / "systems" / "authentication.md"
    users = tmp_project / "wiki" / "systems" / "users.md"
    auth.parent.mkdir(parents=True, exist_ok=True)
    auth.write_text("Auth summary.\nDetails.\n", encoding="utf-8")
    users.write_text("Users summary.\n", encoding="utf-8")
    first = _valid_item(
        gap_id="2026-04-19T20-30-00Z_aaaaaa",
        emitted_at="2026-04-19T20:30:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    first["pages_read"] = ["wiki/systems/users.md"]
    second = _valid_item(
        gap_id="2026-04-19T20-31-00Z_bbbbbb",
        emitted_at="2026-04-19T20:31:00Z",
        target_hint="wiki/systems/authentication.md",
    )
    for item in (first, second):
        _write_item(tmp_project, f"{item['id']}.json", item)

    scan = ingest.scan_inbox(tmp_project, max_items_per_run=50)
    batches = ingest.batch_items(scan["selected"])
    payload = ingest.build_prompt_payload("sample", tmp_project, batches)
    compact_chars = sum(
        len(json.dumps(item, sort_keys=True))
        for batch in payload["batches"]
        for item in batch["inbox_items"]
    )

    assert payload["prompt_profile"] == {
        "batch_count": 1,
        "inbox_item_count": 2,
        "current_page_count": 1,
        "context_page_count": 1,
        "total_page_body_chars": len(auth.read_text(encoding="utf-8")) + len(users.read_text(encoding="utf-8")),
        "compact_item_chars": compact_chars,
        "truncated_context_page_count": 0,
        "original_context_page_body_chars": len(users.read_text(encoding="utf-8")),
        "included_context_page_body_chars": len(users.read_text(encoding="utf-8")),
    }
