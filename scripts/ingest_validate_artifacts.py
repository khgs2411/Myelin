#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def is_nonempty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_run_dir(run_dir: Path, mode: str, project: str | None) -> list[str]:
    errors: list[str] = []

    classification_path = run_dir / "classification.json"
    units_path = run_dir / "units.json"
    mapping_path = run_dir / "mapping.json"
    proposal_path = run_dir / "proposal.json"
    proposal_md_path = run_dir / "proposal.md"

    required_files = [
        classification_path,
        units_path,
        mapping_path,
        proposal_path,
        proposal_md_path,
    ]
    for path in required_files:
        if not path.exists():
            errors.append(f"missing required artifact: {path.name}")

    if errors:
        return errors

    try:
        classification = load_json(classification_path)
    except Exception as exc:
        errors.append(f"classification.json is not valid JSON: {exc}")
        return errors
    try:
        units_data = load_json(units_path)
    except Exception as exc:
        errors.append(f"units.json is not valid JSON: {exc}")
        return errors
    try:
        mapping_data = load_json(mapping_path)
    except Exception as exc:
        errors.append(f"mapping.json is not valid JSON: {exc}")
        return errors
    try:
        proposal = load_json(proposal_path)
    except Exception as exc:
        errors.append(f"proposal.json is not valid JSON: {exc}")
        return errors

    if not isinstance(classification, dict):
        errors.append("classification.json must contain a JSON object")
    else:
        for field in ["source_kind", "ownership", "destination", "update_targets", "action"]:
            if field not in classification:
                errors.append(f"classification.json missing field: {field}")
        if "source_kind" in classification and not is_nonempty_string(classification["source_kind"]):
            errors.append("classification.json source_kind must be a non-empty string")
        if "ownership" in classification and not is_nonempty_string(classification["ownership"]):
            errors.append("classification.json ownership must be a non-empty string")
        if "destination" in classification and not is_nonempty_string(classification["destination"]):
            errors.append("classification.json destination must be a non-empty string")
        if "action" in classification and not is_nonempty_string(classification["action"]):
            errors.append("classification.json action must be a non-empty string")
        if "update_targets" in classification and not isinstance(classification["update_targets"], list):
            errors.append("classification.json update_targets must be an array")

        allowed_ownerships = {
            "review-required",
            "reject",
        }
        if mode == "project":
            allowed_ownerships.add(f"project:{project}")
        else:
            # Global intake may classify directly to a project or concept.
            if isinstance(classification.get("ownership"), str):
                ownership_value = classification["ownership"]
                if ownership_value.startswith("project:") or ownership_value.startswith("concept:"):
                    allowed_ownerships.add(ownership_value)
        if "ownership" in classification and classification["ownership"] not in allowed_ownerships:
            errors.append(
                "classification.json ownership must be one of "
                f"{sorted(allowed_ownerships)!r}, got {classification['ownership']!r}"
            )

    if not isinstance(units_data, dict) or not isinstance(units_data.get("units"), list):
        errors.append("units.json must contain a top-level units array")
    else:
        for index, unit in enumerate(units_data["units"], start=1):
            if not isinstance(unit, dict):
                errors.append(f"units.json units[{index}] must be an object")
                continue
            for field in ["unit_id", "title", "summary"]:
                if field not in unit or not is_nonempty_string(unit[field]):
                    errors.append(f"units.json units[{index}] missing non-empty field: {field}")

    if not isinstance(mapping_data, dict) or not isinstance(mapping_data.get("units"), list):
        errors.append("mapping.json must contain a top-level units array")
    else:
        for index, unit in enumerate(mapping_data["units"], start=1):
            if not isinstance(unit, dict):
                errors.append(f"mapping.json units[{index}] must be an object")
                continue
            for field in ["unit_id", "action", "page_path", "page_type", "summary"]:
                if field not in unit or not is_nonempty_string(unit[field]):
                    errors.append(f"mapping.json units[{index}] missing non-empty field: {field}")
            page_path = unit.get("page_path")
            if isinstance(page_path, str):
                if page_path.startswith("projects/"):
                    errors.append(f"mapping.json units[{index}] page_path must be project-relative, got {page_path!r}")
                if not page_path.startswith("wiki/"):
                    errors.append(f"mapping.json units[{index}] page_path must start with 'wiki/', got {page_path!r}")
            action = unit.get("action")
            if isinstance(action, str) and action not in {"create", "update"}:
                errors.append(f"mapping.json units[{index}] action must be 'create' or 'update', got {action!r}")

    if not isinstance(proposal, dict):
        errors.append("proposal.json must contain a JSON object")
        return errors

    source = proposal.get("source")
    if not is_nonempty_string(source):
        errors.append("proposal.json source must be a non-empty string path")
    else:
        expected_prefix = "raw/inbox/" if mode == "global" else "inbox/"
        if not source.startswith(expected_prefix):
            errors.append(f"proposal.json source must start with {expected_prefix!r}, got {source!r}")

    for field in ["source_id", "source_kind"]:
        if field not in proposal or not is_nonempty_string(proposal[field]):
            errors.append(f"proposal.json missing non-empty field: {field}")

    proposal_units = proposal.get("units")
    if not isinstance(proposal_units, list) or not proposal_units:
        errors.append("proposal.json units must be a non-empty array")
    else:
        for index, unit in enumerate(proposal_units, start=1):
            if not isinstance(unit, dict):
                errors.append(f"proposal.json units[{index}] must be an object")
                continue
            for field in ["action", "page_path", "page_type", "summary", "content"]:
                if field not in unit or not is_nonempty_string(unit[field]):
                    errors.append(f"proposal.json units[{index}] missing non-empty field: {field}")
            page_path = unit.get("page_path")
            if isinstance(page_path, str):
                if page_path.startswith("projects/"):
                    errors.append(f"proposal.json units[{index}] page_path must be project-relative, got {page_path!r}")
                if not page_path.startswith("wiki/"):
                    errors.append(f"proposal.json units[{index}] page_path must start with 'wiki/', got {page_path!r}")
            action = unit.get("action")
            if isinstance(action, str) and action not in {"create", "update"}:
                errors.append(f"proposal.json units[{index}] action must be 'create' or 'update', got {action!r}")
            content = unit.get("content")
            if isinstance(content, str):
                citation_matches = list(
                    __import__("re").finditer(r"`[^`\n]+:\d+(?:-\d+)?`", content)
                )
                if not citation_matches:
                    errors.append(
                        f"proposal.json units[{index}] content must include at least one concrete file_path:line citation"
                    )

    proposal_md = proposal_md_path.read_text(encoding="utf-8").strip()
    if not proposal_md:
        errors.append("proposal.md must not be empty")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--mode", required=True, choices=["global", "project"])
    parser.add_argument("--project")
    args = parser.parse_args()

    if args.mode == "project" and not args.project:
        parser.error("--project is required when --mode=project")

    errors = validate_run_dir(Path(args.run_dir), args.mode, args.project)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
