from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from agents._shared.inbox_writer import ALLOWED_SOURCES, INBOX_ITEM_KEYS, canonicalize_item


RELAXED_VALIDATOR_RULES = ("ranked_domain_coverage", "domain_collapse_check")
COMPACT_ITEM_KEYS = (
    "id",
    "source",
    "emitted_at",
    "question",
    "target_hint",
    "confidence",
    "pages_read",
    "pages_considered",
    "enriched_notes",
    "operator_notes",
    "route_repair",
)
MEANINGFUL_MEASUREMENT_KEYS = (
    "expected_page",
    "score_awarded",
    "score_max",
    "question_tag",
)
SUMMARY_CHAR_LIMIT = 120
CONTEXT_PAGE_FULL_CHAR_LIMIT = 4000
CONTEXT_PAGE_HEAD_CHAR_LIMIT = 1800
CONTEXT_PAGE_TAIL_CHAR_LIMIT = 800
CONTEXT_PAGE_OMITTED_MARKER = "\n\n[... non-target context page excerpted for prompt size ...]\n\n"


def _project_key(project_dir: Path) -> str:
    project_json = project_dir / "state" / "project.json"
    if not project_json.is_file():
        return project_dir.name
    data = json.loads(project_json.read_text(encoding="utf-8"))
    return str(data.get("key") or project_dir.name)


def _needs_review_dir(project_dir: Path) -> Path:
    path = project_dir / "inbox" / "needs-review"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_reason(reason_path: Path, reason: str) -> None:
    reason_path.write_text(f"{reason.rstrip()}\n", encoding="utf-8")


def move_to_needs_review(project_dir: Path, item_path: Path, reason: str) -> Path:
    destination_dir = _needs_review_dir(project_dir)
    destination_path = destination_dir / item_path.name
    item_path.replace(destination_path)
    _write_reason(destination_dir / f"{item_path.stem}.reason.md", reason)
    return destination_path


def load_item(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("item must be a JSON object")
    return canonicalize_item(data)


def validate_item(item: dict[str, Any], *, expected_project_key: str) -> list[str]:
    errors: list[str] = []
    missing = [key for key in INBOX_ITEM_KEYS if key not in item]
    if missing:
        errors.append(f"missing field(s): {', '.join(missing)}")

    for key in ("id", "source", "emitted_at", "project_key", "question", "target_hint"):
        value = item.get(key)
        if not isinstance(value, str):
            errors.append(f"{key} must be a string")
        elif key != "target_hint" and not value.strip():
            errors.append(f"{key} must not be blank")

    if item.get("schema_version") != 1:
        errors.append("schema_version must equal 1")
    if item.get("source") not in ALLOWED_SOURCES:
        errors.append(f"source must be one of {sorted(ALLOWED_SOURCES)}")
    if item.get("project_key") != expected_project_key:
        errors.append(
            f"project_key mismatch: expected {expected_project_key!r}, got {item.get('project_key')!r}"
        )

    return errors


def route_repair_from_item(item: dict[str, Any]) -> dict[str, Any]:
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

    selected_pages = notes.get("selected_pages")
    if not isinstance(selected_pages, list):
        selected_pages = []

    return {
        "is_route_repair": True,
        "failure_reasons": [str(reason) for reason in reasons],
        "route_confidence": notes.get("route_confidence"),
        "route_reason": notes.get("route_reason"),
        "expected_page": notes.get("expected_page"),
        "expected_page_selected": notes.get("expected_page_selected"),
        "selected_pages": [str(page) for page in selected_pages],
        "freshness_warning_count": notes.get("freshness_warning_count"),
        "metadata_available": notes.get("metadata_available"),
    }


def scan_inbox(project_dir: Path, max_items_per_run: int) -> dict[str, Any]:
    inbox_dir = project_dir / "inbox"
    inbox_dir.mkdir(parents=True, exist_ok=True)
    expected_project_key = _project_key(project_dir)
    valid_records: list[dict[str, Any]] = []

    for entry in sorted(inbox_dir.iterdir(), key=lambda path: path.name):
        if entry.is_dir() or entry.suffix != ".json":
            continue
        try:
            item = load_item(entry)
        except json.JSONDecodeError as exc:
            move_to_needs_review(project_dir, entry, f"Malformed inbox item JSON: {exc}")
            continue
        except ValueError as exc:
            move_to_needs_review(project_dir, entry, f"Malformed inbox item: {exc}")
            continue

        errors = validate_item(item, expected_project_key=expected_project_key)
        if errors:
            move_to_needs_review(project_dir, entry, "Malformed inbox item:\n\n- " + "\n- ".join(errors))
            continue

        valid_records.append(
            {
                "path": str(entry),
                "item": item,
                "route_repair": route_repair_from_item(item),
            }
        )

    valid_records.sort(
        key=lambda record: (
            str(record["item"].get("emitted_at") or ""),
            str(record["item"].get("id") or ""),
        )
    )
    selected = valid_records[:max_items_per_run]
    return {
        "selected": selected,
        "remaining_count": max(0, len(valid_records) - len(selected)),
    }


def batch_items(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for record in records:
        item = record["item"]
        route_repair = record.get("route_repair") or {"is_route_repair": False}
        if route_repair.get("is_route_repair"):
            item = {**item, "route_repair": route_repair}
        raw_target = str(item.get("target_hint") or "").strip()
        target_hint = raw_target or "routing-needed"
        batch = grouped.setdefault(
            target_hint,
            {
                "target_hint": target_hint,
                "items": [],
                "paths": [],
            },
        )
        batch["items"].append(item)
        batch["paths"].append(record["path"])
    return list(grouped.values())


def _load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def _first_summary_line(content: str, *, limit: int = SUMMARY_CHAR_LIMIT) -> str:
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if len(stripped) <= limit:
            return stripped
        return stripped[: max(0, limit - 3)].rstrip() + "..."
    return ""


def _truncate_context_content(content: str) -> tuple[str, bool]:
    if len(content) <= CONTEXT_PAGE_FULL_CHAR_LIMIT:
        return content, False
    return (
        content[:CONTEXT_PAGE_HEAD_CHAR_LIMIT]
        + CONTEXT_PAGE_OMITTED_MARKER
        + content[-CONTEXT_PAGE_TAIL_CHAR_LIMIT:],
        True,
    )


def _page_context(path: str, content: str, *, truncate_context: bool = False) -> dict[str, Any]:
    included_content, truncated = _truncate_context_content(content) if truncate_context else (content, False)
    return {
        "path": path,
        "content": included_content,
        "summary": _first_summary_line(content),
        "char_count": len(content),
        "content_truncated": truncated,
        "original_char_count": len(content),
        "included_char_count": len(included_content),
    }


def _meaningful(value: Any) -> bool:
    return value is not None and value != "" and value != [] and value != {}


def _compact_prompt_value(key: str, value: Any) -> Any:
    if key != "operator_notes" or not isinstance(value, str):
        return value
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return value
    return parsed if isinstance(parsed, dict) else value


def compact_prompt_item(item: dict[str, Any]) -> dict[str, Any]:
    compact: dict[str, Any] = {}
    for key in COMPACT_ITEM_KEYS:
        if key in item and _meaningful(item.get(key)):
            compact[key] = _compact_prompt_value(key, item[key])
    for key in MEANINGFUL_MEASUREMENT_KEYS:
        if key in item and _meaningful(item.get(key)):
            compact[key] = item[key]
    return compact


def _gather_context_pages(project_dir: Path, item: dict[str, Any]) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    seen: set[str] = set()
    pages_read = item.get("pages_read") or []
    if not isinstance(pages_read, list):
        return pages

    for rel in pages_read:
        if not isinstance(rel, str) or not rel or rel in seen:
            continue
        target = project_dir / rel
        if not target.is_file():
            continue
        seen.add(rel)
        pages.append(_page_context(rel, _load_text(target), truncate_context=True))
    return pages


def build_prompt_payload(project_key: str, project_dir: Path, batches: list[dict[str, Any]]) -> dict[str, Any]:
    existing_page_paths: set[str] = set()
    prompt_batches: list[dict[str, Any]] = []
    inbox_item_count = 0
    current_page_count = 0
    context_page_count = 0
    total_page_body_chars = 0
    compact_item_chars = 0
    truncated_context_page_count = 0
    original_context_page_body_chars = 0
    included_context_page_body_chars = 0

    for batch in batches:
        target_hint = batch["target_hint"]
        current_page = None
        if target_hint != "routing-needed":
            current_path = project_dir / target_hint
            if current_path.is_file():
                current_page = _page_context(target_hint, _load_text(current_path))
                existing_page_paths.add(target_hint)
                current_page_count += 1
                total_page_body_chars += current_page["char_count"]

        context_pages: dict[str, dict[str, Any]] = {}
        for item in batch["items"]:
            for page in _gather_context_pages(project_dir, item):
                if current_page is not None and page["path"] == current_page["path"]:
                    continue
                context_pages.setdefault(page["path"], page)
                existing_page_paths.add(page["path"])

        compact_items = [compact_prompt_item(item) for item in batch["items"]]
        inbox_item_count += len(compact_items)
        compact_item_chars += sum(len(json.dumps(item, sort_keys=True)) for item in compact_items)
        context_page_count += len(context_pages)
        total_page_body_chars += sum(page["char_count"] for page in context_pages.values())
        truncated_context_page_count += sum(1 for page in context_pages.values() if page["content_truncated"])
        original_context_page_body_chars += sum(page["original_char_count"] for page in context_pages.values())
        included_context_page_body_chars += sum(page["included_char_count"] for page in context_pages.values())

        prompt_batches.append(
            {
                "target_hint": target_hint,
                "current_page": current_page,
                "context_pages": [
                    context_pages[path] for path in sorted(context_pages)
                ],
                "inbox_items": compact_items,
            }
        )

    return {
        "project_key": project_key,
        "batches": prompt_batches,
        "existing_page_paths": sorted(existing_page_paths),
        "prompt_profile": {
            "batch_count": len(prompt_batches),
            "inbox_item_count": inbox_item_count,
            "current_page_count": current_page_count,
            "context_page_count": context_page_count,
            "total_page_body_chars": total_page_body_chars,
            "compact_item_chars": compact_item_chars,
            "truncated_context_page_count": truncated_context_page_count,
            "original_context_page_body_chars": original_context_page_body_chars,
            "included_context_page_body_chars": included_context_page_body_chars,
        },
    }


def terminal_state_for_items(
    project_dir: Path,
    consumed_items: list[dict[str, Any]],
    *,
    outcome: str,
    reason: str | None = None,
) -> list[dict[str, Any]]:
    if outcome not in {"processed", "needs-review"}:
        raise ValueError(f"invalid terminal outcome: {outcome}")

    target_dir = project_dir / "inbox" / outcome
    target_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []

    for item in consumed_items:
        source_path = Path(item["path"])
        destination_path = target_dir / source_path.name
        if source_path.exists():
            source_path.replace(destination_path)
        entry = {
            "id": item["id"],
            "from_path": item["path"],
            "to_path": str(destination_path),
            "outcome": outcome,
            "reason_path": None,
        }
        if outcome == "needs-review":
            reason_path = target_dir / f"{destination_path.stem}.reason.md"
            _write_reason(reason_path, reason or "Ingest validation failed.")
            entry["reason_path"] = str(reason_path)
        results.append(entry)

    return results
