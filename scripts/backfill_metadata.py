#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


sys.path.insert(0, str(_repo_root()))

from agents.update._shared import brain_metadata  # noqa: E402


def _load_json(path: Path) -> dict:
    if not path.is_file():
        raise SystemExit(f"missing required state file: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit(f"state file must contain a JSON object: {path}")
    return payload


def _generated_at(freshness: dict) -> str:
    for key in ("last_update_at_pending", "last_update_at", "updated_at"):
        value = freshness.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return "1970-01-01T00:00:00+00:00"


def backfill(project_dir: Path) -> None:
    state_dir = project_dir / "state"
    product_paths = [
        state_dir / "page-metadata.json",
        state_dir / "tag-index.json",
        state_dir / "alias-index.json",
    ]
    if all(path.is_file() for path in product_paths):
        return

    project_state = _load_json(state_dir / "project.json")
    pages_payload = _load_json(state_dir / "pages.json")
    freshness = _load_json(state_dir / "freshness.json")
    project_key = str(project_state.get("key") or project_dir.name)

    products = brain_metadata.build_metadata_products(
        project_key=project_key,
        project_state=project_state,
        pages=pages_payload.get("pages", []),
        freshness=freshness,
        generated_at=_generated_at(freshness),
    )
    (state_dir / "page-metadata.json").write_text(
        json.dumps(products["page_metadata"], indent=2) + "\n",
        encoding="utf-8",
    )
    (state_dir / "tag-index.json").write_text(
        json.dumps(products["tag_index"], indent=2) + "\n",
        encoding="utf-8",
    )
    (state_dir / "alias-index.json").write_text(
        json.dumps(products["alias_index"], indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", required=True)
    args = parser.parse_args()
    backfill(Path(args.project_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
