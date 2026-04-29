#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any


def _load_json(path: Path, *, metadata_required: bool = False) -> dict[str, Any]:
    if not path.is_file():
        if metadata_required:
            raise SystemExit(
                f"metadata has not been generated yet: {path}; "
                "run make compile PROJECT=<key> AUTO=1 or make update PROJECT=<key> AUTO=1 first"
            )
        raise SystemExit(f"missing required file: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit(f"JSON file must contain an object: {path}")
    return payload


def _yaml_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    text = str(value)
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _yaml_list(values: list[Any]) -> list[str]:
    if not values:
        return ["[]"]
    return [f"- {_yaml_scalar(value)}" for value in values]


def _frontmatter(properties: dict[str, Any]) -> str:
    lines = ["---"]
    for key, value in properties.items():
        if isinstance(value, list):
            rendered = _yaml_list(value)
            if rendered == ["[]"]:
                lines.append(f"{key}: []")
            else:
                lines.append(f"{key}:")
                lines.extend(f"  {line}" for line in rendered)
        else:
            lines.append(f"{key}: {_yaml_scalar(value)}")
    lines.append("---")
    return "\n".join(lines) + "\n\n"


def _obsidian_tag(tag: str) -> str:
    cleaned = tag.strip().replace(" ", "-")
    return f"#{cleaned.lstrip('#')}"


def _markdown_table_cell(value: Any) -> str:
    return str(value).replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ")


def _canonical_page_path(project_dir: Path, page_path: str) -> Path:
    resolved_project_dir = project_dir.resolve()
    candidate = (resolved_project_dir / page_path).resolve()
    try:
        candidate.relative_to(resolved_project_dir)
    except ValueError as exc:
        raise SystemExit(f"page path escapes project directory: {page_path}") from exc
    if not candidate.is_file():
        raise SystemExit(f"canonical page missing: {page_path}")
    return candidate


def _safe_reset_export_dir(project_dir: Path) -> Path:
    export_dir = project_dir / "obsidian"
    resolved_project_dir = project_dir.resolve()
    resolved_export_dir = export_dir.resolve()
    try:
        resolved_export_dir.relative_to(resolved_project_dir)
    except ValueError as exc:
        raise SystemExit(f"refusing to delete outside project directory: {export_dir}") from exc
    if resolved_export_dir.name != "obsidian":
        raise SystemExit(f"refusing to delete non-obsidian export directory: {export_dir}")
    if export_dir.exists():
        shutil.rmtree(export_dir)
    export_dir.mkdir(parents=True)
    return export_dir


def _project_key(project_dir: Path, metadata: dict[str, Any]) -> str:
    value = metadata.get("project_key")
    if isinstance(value, str) and value.strip():
        return value
    project_state = _load_json(project_dir / "state" / "project.json")
    return str(project_state.get("key") or project_dir.name)


def _page_properties(project_key: str, page: dict[str, Any]) -> dict[str, Any]:
    page_tags = [_obsidian_tag(str(tag)) for tag in page.get("tags", []) if str(tag).strip()]
    return {
        "project": project_key,
        "brain": project_key,
        "kind": page.get("page_kind"),
        "domains": page.get("domains", []),
        "topics": page.get("topics", []),
        "tags": page_tags,
        "aliases": page.get("aliases", []),
        "freshness": page.get("freshness_status"),
        "canonical": bool(page.get("canonical")),
        "source_paths": page.get("source_paths", []),
        "last_verified_commit": page.get("last_verified_commit"),
        "last_verified_at": page.get("last_verified_at"),
        "canonical_path": page.get("path"),
    }


def _write_readme(export_dir: Path, project_key: str) -> None:
    (export_dir / "README.md").write_text(
        "\n".join(
            [
                f"# {project_key} Obsidian Projection",
                "",
                "This directory is generated from application-owned llm-wiki state.",
                "Do not edit these files as canonical project knowledge.",
                "",
                "- Projected pages live under `pages/` and mirror canonical page paths.",
                "- YAML properties come from `state/page-metadata.json`.",
                "- Regenerate with `make obsidian PROJECT=<key>`.",
                "",
            ]
        ),
        encoding="utf-8",
    )


def _write_graph_groups(export_dir: Path, pages: list[dict[str, Any]]) -> None:
    tags = sorted({str(tag) for page in pages for tag in page.get("tags", []) if str(tag).strip()})
    lines = [
        "# Obsidian Graph Groups",
        "",
        "Copy these filters into Obsidian graph group settings.",
        "",
    ]
    for tag in tags:
        obsidian_tag = _obsidian_tag(tag)
        lines.append(f"- `{obsidian_tag}`")
    lines.append("")
    (export_dir / "graph-groups.md").write_text("\n".join(lines), encoding="utf-8")


def _write_bases_readme(export_dir: Path, pages: list[dict[str, Any]]) -> None:
    bases_dir = export_dir / "bases"
    bases_dir.mkdir(parents=True)
    rows = [
        "# Table Views",
        "",
        "Generated Markdown views are provided instead of unstable `.base` syntax.",
        "",
        "| Page | Kind | Freshness | Domains | Canonical Path |",
        "| --- | --- | --- | --- | --- |",
    ]
    for page in sorted(pages, key=lambda item: str(item.get("path") or "")):
        rows.append(
            "| "
            + " | ".join(
                [
                    _markdown_table_cell(page.get("title") or ""),
                    _markdown_table_cell(page.get("page_kind") or ""),
                    _markdown_table_cell(page.get("freshness_status") or ""),
                    _markdown_table_cell(", ".join(str(domain) for domain in page.get("domains", []))),
                    _markdown_table_cell(page.get("path") or ""),
                ]
            )
            + " |"
        )
    rows.append("")
    (bases_dir / "README.md").write_text("\n".join(rows), encoding="utf-8")


def export_obsidian(project_dir: Path) -> Path:
    metadata = _load_json(project_dir / "state" / "page-metadata.json", metadata_required=True)
    pages = metadata.get("pages")
    if not isinstance(pages, list):
        raise SystemExit("state/page-metadata.json must contain a pages list")
    metadata_pages = [page for page in pages if isinstance(page, dict) and page.get("path")]
    project_key = _project_key(project_dir, metadata)
    export_dir = _safe_reset_export_dir(project_dir)

    _write_readme(export_dir, project_key)
    _write_graph_groups(export_dir, metadata_pages)
    _write_bases_readme(export_dir, metadata_pages)

    pages_dir = export_dir / "pages"
    for page in metadata_pages:
        page_path = str(page["path"])
        canonical_path = _canonical_page_path(project_dir, page_path)
        output_path = pages_dir / page_path
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            _frontmatter(_page_properties(project_key, page))
            + canonical_path.read_text(encoding="utf-8"),
            encoding="utf-8",
        )
    return export_dir


def main() -> int:
    parser = argparse.ArgumentParser(description="Export Obsidian projection files for a project brain")
    parser.add_argument("--project-dir", required=True)
    args = parser.parse_args()
    export_dir = export_obsidian(Path(args.project_dir))
    print(export_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
