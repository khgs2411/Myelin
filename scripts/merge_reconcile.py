#!/usr/bin/env python3
"""Merge a reconcile patch over the original proposal for re-apply/re-validate."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _load(path: str) -> dict:
    return json.loads(Path(path).read_text())


def merge(original: dict, patch: dict) -> dict:
    units_by_id = {unit["id"]: unit for unit in original.get("units", [])}
    for unit in patch.get("units", []):
        units_by_id[unit["id"]] = unit
    merged_units = list(units_by_id.values())

    merged = dict(original)
    merged["units"] = merged_units
    merged["deferred_domains"] = patch.get("deferred_domains") or original.get("deferred_domains", [])
    merged["index_changes"] = patch.get("index_changes")
    merged["new_pages_count"] = sum(1 for unit in merged_units if unit.get("action") == "create")

    for key in (
        "approved",
        "summary",
        "run_id",
        "ranking_snapshot_path",
        "max_new_pages",
    ):
        if key in patch:
            merged[key] = patch[key]

    original_state_changes = original.get("state_changes_intent") or {}
    patch_state_changes = patch.get("state_changes_intent") or {}
    merged["state_changes_intent"] = dict(original_state_changes)
    for key, value in patch_state_changes.items():
        if value is not None:
            merged["state_changes_intent"][key] = value

    return merged


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(
            "usage: merge_reconcile.py <proposal.original.json> <reconcile-proposal.json> <proposal.json>",
            file=sys.stderr,
        )
        return 2

    _, original_path, patch_path, output_path = argv
    original = _load(original_path)
    patch = _load(patch_path)
    merged = merge(original, patch)
    Path(output_path).write_text(json.dumps(merged, indent=2) + "\n")
    print(
        f"merged {len(patch.get('units', []))} patch unit(s) over "
        f"{len(original.get('units', []))} original unit(s) "
        f"-> {len(merged.get('units', []))} total"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
