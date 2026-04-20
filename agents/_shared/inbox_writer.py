from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
ALLOWED_SOURCES = {"mcp-auto", "agent-enriched", "agent-flagged", "measure-auto", "manual"}
INBOX_ITEM_KEYS = [
    "id",
    "schema_version",
    "source",
    "emitted_at",
    "project_key",
    "question",
    "target_hint",
    "confidence",
    "pages_read",
    "pages_considered",
    "router_model",
    "synthesizer_model",
    "enriched_notes",
    "question_index",
    "question_tag",
    "score_awarded",
    "score_max",
    "expected_page",
    "measurement_run_id",
    "operator_notes",
]
OPTIONAL_FIELDS = set(INBOX_ITEM_KEYS) - {
    "id",
    "schema_version",
    "source",
    "emitted_at",
    "project_key",
    "question",
    "target_hint",
}
OPTIONAL_FIELD_KEYS = [key for key in INBOX_ITEM_KEYS if key in OPTIONAL_FIELDS]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _format_emitted_at(now: datetime) -> str:
    return now.strftime("%Y-%m-%dT%H:%M:%SZ")


def _format_gap_id(now: datetime) -> str:
    return f"{now.strftime('%Y-%m-%dT%H-%M-%SZ')}_{secrets.token_hex(3)}"


def _project_key(project_dir: Path) -> str:
    state_path = project_dir / "state" / "project.json"
    if state_path.is_file():
        data = json.loads(state_path.read_text())
        key = data.get("key")
        if key:
            return str(key)
    return project_dir.name


def inbox_path(project_dir: Path, gap_id: str) -> Path:
    return project_dir / "inbox" / f"{gap_id}.json"


def _serialize(item: dict[str, Any]) -> str:
    return json.dumps(canonicalize_item(item), indent=2) + "\n"


def canonicalize_item(item: dict[str, Any]) -> dict[str, Any]:
    return {key: item.get(key) for key in INBOX_ITEM_KEYS}


def atomic_write_item(project_dir: Path, item: dict[str, Any]) -> Path:
    path = inbox_path(project_dir, str(item["id"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".json.tmp")
    tmp_path.write_text(_serialize(item))
    tmp_path.replace(path)
    return path


def write_gap(
    project_dir: Path,
    *,
    source: str,
    question: str,
    target_hint: str,
    **optional_fields: Any,
) -> dict[str, Any]:
    """Write a gap-note JSON to <project_dir>/inbox/ and return the item."""
    if source not in ALLOWED_SOURCES:
        raise ValueError(f"invalid source: {source}")

    unknown_fields = set(optional_fields) - OPTIONAL_FIELDS
    if unknown_fields:
        raise ValueError(f"unknown optional field(s): {sorted(unknown_fields)}")

    now = _utc_now()
    item: dict[str, Any] = {
        "id": _format_gap_id(now),
        "schema_version": SCHEMA_VERSION,
        "source": source,
        "emitted_at": _format_emitted_at(now),
        "project_key": _project_key(project_dir),
        "question": question,
        "target_hint": target_hint,
    }
    for key in OPTIONAL_FIELD_KEYS:
        item[key] = optional_fields.get(key)

    atomic_write_item(project_dir, item)
    return item
