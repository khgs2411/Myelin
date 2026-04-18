#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json(path: Path | None) -> Any:
    if path is None or not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_latest_dir(project_dir: Path) -> Path:
    latest_dir = project_dir / "state" / "latest"
    latest_dir.mkdir(parents=True, exist_ok=True)
    return latest_dir


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def scalar_text(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return str(value)


def render_node(lines: list[str], node: Any, level: int) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            label = key.replace("_", " ")
            if isinstance(value, (dict, list)):
                lines.append(f"{'#' * level} {label}")
                lines.append("")
                render_node(lines, value, level + 1)
            else:
                lines.append(f"- {label}: {scalar_text(value)}")
        return

    if isinstance(node, list):
        if not node:
            lines.append("- none")
            return
        for index, item in enumerate(node, start=1):
            if isinstance(item, (dict, list)):
                lines.append(f"{'#' * level} item {index}")
                lines.append("")
                render_node(lines, item, level + 1)
            else:
                lines.append(f"- {scalar_text(item)}")
        return

    lines.append(f"- {scalar_text(node)}")


def render_markdown(title: str, payload: dict[str, Any]) -> str:
    lines = [f"# {title}", ""]
    render_node(lines, payload, 2)
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines) + "\n"


def cmd_render_lint(args: argparse.Namespace) -> int:
    project_dir = Path(args.project_dir)
    latest_dir = ensure_latest_dir(project_dir)
    semantic = load_json(Path(args.semantic_findings)) if args.semantic_findings else {}
    findings = semantic.get("findings", []) if isinstance(semantic, dict) else []
    blocker_count = sum(1 for item in findings if isinstance(item, dict) and item.get("severity") == "blocker")
    payload = {
        "project": project_dir.name,
        "status": args.status,
        "updated_at": now_iso(),
        "audit_run_dir": args.audit_run_dir,
        "finding_count": len(findings),
        "blocker_count": blocker_count,
        "findings": findings,
    }
    json_path = latest_dir / "lint-findings.json"
    md_path = latest_dir / "lint-findings.md"
    write_json(json_path, payload)
    md_path.write_text(render_markdown(f"Lint Findings: {project_dir.name}", payload), encoding="utf-8")
    return 0


def cmd_render_validation(args: argparse.Namespace) -> int:
    project_dir = Path(args.project_dir)
    latest_dir = ensure_latest_dir(project_dir)

    if args.input:
        payload = load_json(Path(args.input))
        if not isinstance(payload, dict):
            payload = {}
        payload.setdefault("project", project_dir.name)
        payload.setdefault("updated_at", now_iso())
    else:
        structural = load_json(Path(args.structural_findings))
        semantic = load_json(Path(args.semantic_findings)) if args.semantic_findings else {}
        structural_errors = structural.get("errors", []) if isinstance(structural, dict) else []
        structural_warnings = structural.get("warnings", []) if isinstance(structural, dict) else []
        semantic_findings = semantic.get("findings", []) if isinstance(semantic, dict) else []
        payload = {
            "project": project_dir.name,
            "status": args.status,
            "updated_at": now_iso(),
            "audit_run_dir": args.audit_run_dir,
            "finding_count": len(structural_errors) + len(structural_warnings) + len(semantic_findings),
            "structural": structural,
        }
        if args.semantic_findings:
            payload["semantic"] = {
                "finding_count": len(semantic_findings),
                "blocker_count": sum(
                    1 for item in semantic_findings
                    if isinstance(item, dict) and item.get("severity") == "blocker"
                ),
                "findings": semantic_findings,
            }

    json_path = latest_dir / "validation-findings.json"
    md_path = latest_dir / "validation-report.md"
    write_json(json_path, payload)

    structural_items = payload.get("structural", [])
    semantic_items = payload.get("semantic", [])
    if isinstance(structural_items, dict):
        structural_items = structural_items.get("errors", []) + structural_items.get("warnings", [])
    if isinstance(semantic_items, dict):
        semantic_items = semantic_items.get("findings", [])

    lines = [f"# Validation report - {payload.get('run_id', project_dir.name)}", ""]
    lines.append(f"Status: {payload.get('status', 'unknown')}")
    lines.append("")
    pass_count = payload.get("pass_count", {})
    if isinstance(pass_count, dict) and pass_count:
        lines.append(f"- Structural rules passed: {pass_count.get('structural', 'n/a')}")
        lines.append(f"- Semantic rules passed: {pass_count.get('semantic', 'n/a')}")
        lines.append("")
    lines.append("## Structural findings")
    lines.append("")
    if not structural_items:
        lines.append("- (none)")
    else:
        for finding in structural_items:
            if not isinstance(finding, dict):
                continue
            lines.append(
                f"- {finding.get('severity', 'warn')} [{finding.get('rule_id', '?')}] "
                f"`{finding.get('page', '?')}` - {finding.get('issue', '')}"
            )
    lines.append("")
    lines.append("## Semantic findings")
    lines.append("")
    if not semantic_items:
        lines.append("- (none)")
    else:
        for finding in semantic_items:
            if not isinstance(finding, dict):
                continue
            pages = ", ".join(finding.get("pages", []))
            lines.append(
                f"- {finding.get('severity', 'warn')} [{finding.get('category', '?')}] "
                f"{pages} - {finding.get('evidence', '')}"
            )
            if finding.get("suggested_action"):
                lines.append(f"  Suggested: {finding['suggested_action']}")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0


def cmd_render_ingest(args: argparse.Namespace) -> int:
    project_dir = Path(args.project_dir)
    latest_dir = ensure_latest_dir(project_dir)
    proposal = load_json(Path(args.proposal_json))
    units = proposal.get("units", []) if isinstance(proposal, dict) else []
    actions = {"create": 0, "update": 0}
    pages: list[str] = []
    for unit in units:
        if not isinstance(unit, dict):
            continue
        action = str(unit.get("action") or "")
        if action in actions:
            actions[action] += 1
        page_path = unit.get("page_path")
        if isinstance(page_path, str) and page_path:
            pages.append(page_path)
    payload = {
        "project": project_dir.name,
        "status": args.status,
        "updated_at": now_iso(),
        "audit_run_dir": args.audit_run_dir,
        "source": proposal.get("source"),
        "source_id": proposal.get("source_id"),
        "source_kind": proposal.get("source_kind"),
        "unit_count": len(units),
        "actions": actions,
        "pages": pages,
        "lint_findings_path": args.lint_findings_path or "",
    }
    json_path = latest_dir / "ingest-findings.json"
    md_path = latest_dir / "ingest-report.md"
    write_json(json_path, payload)
    md_path.write_text(render_markdown(f"Ingest Findings: {project_dir.name}", payload), encoding="utf-8")
    return 0


def cmd_render_ranking(args: argparse.Namespace) -> int:
    """Render ranking-snapshot.json → state/latest/ranking-snapshot.{json,md}."""
    input_path = Path(args.input)
    project_dir = Path(args.project_dir)
    data = json.loads(input_path.read_text())

    latest = project_dir / "state" / "latest"
    latest.mkdir(parents=True, exist_ok=True)

    (latest / "ranking-snapshot.json").write_text(json.dumps(data, indent=2) + "\n")

    lines: list[str] = []
    lines.append(f"# Ranking snapshot — {data.get('run_id', 'unknown')}")
    lines.append("")
    lines.append("## Cutoff")
    lines.append("")
    lines.append(f"- Cutoff: `{data.get('cutoff', 'n/a')}`")
    if data.get("cutoff_config_source"):
        lines.append(f"- Source: `{data['cutoff_config_source']}`")
    lines.append("")
    lines.append("## Ranked domains")
    lines.append("")
    lines.append("| Rank | Domain | Score | Signals | Reasoning |")
    lines.append("|------|--------|-------|---------|-----------|")
    for entry in data.get("ranked_domains", []):
        signals = ",".join(entry.get("signals", []))
        reasoning = entry.get("signal_c_reasoning", "").replace("|", "\\|")
        lines.append(
            f"| {entry.get('rank', '?')} | {entry.get('domain', '?')} | "
            f"{entry.get('score', '?')} | {signals} | {reasoning} |"
        )
    lines.append("")
    lines.append("## Signal A evidence")
    lines.append("")
    for src in data.get("signal_a_sources", []):
        lines.append(f"- {src}")
    if not data.get("signal_a_sources"):
        lines.append("- (none)")
    lines.append("")
    lines.append("## Signal B evidence")
    lines.append("")
    for ep in data.get("signal_b_entry_points", []):
        lines.append(f"- {ep}")
    if not data.get("signal_b_entry_points"):
        lines.append("- (none)")
    lines.append("")
    (latest / "ranking-snapshot.md").write_text("\n".join(lines) + "\n")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    lint = sub.add_parser("render-lint")
    lint.add_argument("--project-dir", required=True)
    lint.add_argument("--audit-run-dir", required=True)
    lint.add_argument("--status", required=True, choices=["pass", "fail"])
    lint.add_argument("--semantic-findings")
    lint.set_defaults(func=cmd_render_lint)

    validation = sub.add_parser("render-validation")
    validation.add_argument("--project-dir", required=True)
    validation.add_argument("--input")
    validation.add_argument("--audit-run-dir")
    validation.add_argument("--status", choices=["pass", "fail"])
    validation.add_argument("--structural-findings")
    validation.add_argument("--semantic-findings")
    validation.set_defaults(func=cmd_render_validation)

    ingest = sub.add_parser("render-ingest")
    ingest.add_argument("--project-dir", required=True)
    ingest.add_argument("--audit-run-dir", required=True)
    ingest.add_argument("--status", required=True, choices=["pass", "fail"])
    ingest.add_argument("--proposal-json", required=True)
    ingest.add_argument("--lint-findings-path")
    ingest.set_defaults(func=cmd_render_ingest)

    ranking = sub.add_parser("render-ranking")
    ranking.add_argument("--input", required=True)
    ranking.add_argument("--project-dir", required=True)
    ranking.set_defaults(func=cmd_render_ranking)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
