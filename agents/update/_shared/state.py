#!/usr/bin/env python3

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


STAGES = ["orient", "domains", "expand", "validate", "reconcile"]


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def default_state(project: str) -> dict:
    return {
        "project": project,
        "latest_run_dir": None,
        "last_completed_stage": None,
        "latest_validation_report": None,
        "latest_validation_findings": None,
        "latest_lint_findings": None,
        "latest_ingest_findings": None,
        "reconciliation_required": False,
        "stages": {
            stage: {
                "status": "pending",
                "last_run_dir": None,
                "last_completed_at": None,
                "summary_file": None,
            }
            for stage in STAGES
        },
    }


def default_update_state(project: str) -> dict:
    return {
        "project": project,
        "latest_run_dir": None,
        "last_completed_stage": None,
        "latest_validation_findings": None,
        "latest_lint_findings": None,
        "latest_ingest_findings": None,
        "stages": {
            stage: {
                "status": "pending",
                "last_run_dir": None,
                "last_completed_at": None,
                "summary_file": None,
            }
            for stage in ("sense", "impact", "propose", "apply", "validate", "reconcile")
        },
    }


def _state_file(project_dir: Path) -> Path:
    v2 = project_dir / "state" / "update-state.json"
    if v2.is_file():
        return v2
    return project_dir / "state" / "bootstrap-state.json"


def write_bootstrap_summary(path: Path, data: dict) -> None:
    latest_dir = path.parent / "latest"
    latest_dir.mkdir(parents=True, exist_ok=True)
    last_stage = data.get("last_completed_stage")
    stages = data.get("stages", {}) or {}
    last_completed_at = None
    if last_stage and isinstance(stages.get(last_stage), dict):
        last_completed_at = stages[last_stage].get("last_completed_at")

    lines = [
        f"# Bootstrap Summary: {data.get('project') or path.parent.parent.name}",
        "",
        f"- last_completed_stage: {last_stage or 'null'}",
        f"- last_completed_at: {last_completed_at or 'null'}",
        f"- latest_run_dir: {data.get('latest_run_dir') or 'null'}",
        f"- reconciliation_required: {'true' if data.get('reconciliation_required') else 'false'}",
        "",
        "## Stages",
        "",
    ]

    for stage in STAGES:
        stage_data = stages.get(stage, {}) or {}
        lines.extend(
            [
                f"### {stage}",
                "",
                f"- status: {stage_data.get('status') or 'pending'}",
                f"- last_run_dir: {stage_data.get('last_run_dir') or 'null'}",
                f"- last_completed_at: {stage_data.get('last_completed_at') or 'null'}",
                f"- summary_file: {stage_data.get('summary_file') or 'null'}",
                "",
            ]
        )

    (latest_dir / "bootstrap-summary.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def load_state(path: Path, project: str) -> dict:
    if not path.exists():
        return default_state(project)
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    write_bootstrap_summary(path, data)


def cmd_ensure(args: argparse.Namespace) -> int:
    path = Path(args.project_dir) / "state" / "update-state.json"
    if path.is_file():
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    data = default_update_state(args.project)
    save_state(path, data)
    return 0


def cmd_get(args: argparse.Namespace) -> int:
    path = _state_file(Path(args.project_dir))
    data = load_state(path, args.project or Path(args.project_dir).name)
    value = data.get(args.field)
    if value is None:
      return 0
    if isinstance(value, (dict, list)):
        print(json.dumps(value))
    else:
        print(value)
    return 0


def cmd_record_stage(args: argparse.Namespace) -> int:
    path = _state_file(Path(args.project_dir))
    project = args.project or Path(args.project_dir).name
    data = load_state(path, project)
    stage = args.stage
    data["latest_run_dir"] = args.run_dir
    stage_data = data["stages"].setdefault(
        stage,
        {"status": "pending", "last_run_dir": None, "last_completed_at": None, "summary_file": None},
    )
    stage_data["status"] = args.status
    stage_data["last_run_dir"] = args.run_dir
    stage_data["summary_file"] = args.summary_file
    if args.status == "completed":
        stage_data["last_completed_at"] = now_iso()
        data["last_completed_stage"] = stage
    save_state(path, data)
    return 0


def cmd_record_validation(args: argparse.Namespace) -> int:
    path = _state_file(Path(args.project_dir))
    project = args.project or Path(args.project_dir).name
    data = load_state(path, project)
    data["latest_run_dir"] = args.run_dir
    data["latest_validation_report"] = args.report_path
    data["latest_validation_findings"] = {
        "findings_path": args.findings_path,
        "audit_run_dir": args.audit_run_dir,
    }
    data["reconciliation_required"] = args.status != "pass"
    stage_data = data["stages"].setdefault(
        "validate",
        {"status": "pending", "last_run_dir": None, "last_completed_at": None, "summary_file": None},
    )
    stage_data["status"] = "completed" if args.status == "pass" else "failed"
    stage_data["last_run_dir"] = args.run_dir
    stage_data["summary_file"] = args.report_path
    if args.status == "pass":
        stage_data["last_completed_at"] = now_iso()
        data["last_completed_stage"] = "validate"
    save_state(path, data)
    return 0


def cmd_record_lint(args: argparse.Namespace) -> int:
    path = _state_file(Path(args.project_dir))
    project = args.project or Path(args.project_dir).name
    data = load_state(path, project)
    data["latest_lint_findings"] = {
        "status": args.status,
        "findings_path": args.findings_path,
        "audit_run_dir": args.audit_run_dir,
        "updated_at": now_iso(),
    }
    save_state(path, data)
    return 0


def cmd_record_ingest(args: argparse.Namespace) -> int:
    path = _state_file(Path(args.project_dir))
    project = args.project or Path(args.project_dir).name
    data = load_state(path, project)
    data["latest_ingest_findings"] = {
        "status": args.status,
        "findings_path": args.findings_path,
        "audit_run_dir": args.audit_run_dir,
        "updated_at": now_iso(),
    }
    save_state(path, data)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    ensure = sub.add_parser("ensure")
    ensure.add_argument("--project-dir", required=True)
    ensure.add_argument("--project", required=True)
    ensure.set_defaults(func=cmd_ensure)

    get = sub.add_parser("get")
    get.add_argument("--project-dir", required=True)
    get.add_argument("--project")
    get.add_argument("--field", required=True)
    get.set_defaults(func=cmd_get)

    record_stage = sub.add_parser("record-stage")
    record_stage.add_argument("--project-dir", required=True)
    record_stage.add_argument("--project")
    record_stage.add_argument("--stage", required=True, choices=STAGES)
    record_stage.add_argument("--status", required=True, choices=["completed", "failed"])
    record_stage.add_argument("--run-dir", required=True)
    record_stage.add_argument("--summary-file")
    record_stage.set_defaults(func=cmd_record_stage)

    record_validation = sub.add_parser("record-validation")
    record_validation.add_argument("--project-dir", required=True)
    record_validation.add_argument("--project")
    record_validation.add_argument("--status", required=True, choices=["pass", "fail"])
    record_validation.add_argument("--run-dir", required=True)
    record_validation.add_argument("--report-path", required=True)
    record_validation.add_argument("--findings-path", required=True)
    record_validation.add_argument("--audit-run-dir", required=True)
    record_validation.set_defaults(func=cmd_record_validation)

    record_lint = sub.add_parser("record-lint")
    record_lint.add_argument("--project-dir", required=True)
    record_lint.add_argument("--project")
    record_lint.add_argument("--status", required=True, choices=["pass", "fail"])
    record_lint.add_argument("--findings-path", required=True)
    record_lint.add_argument("--audit-run-dir", required=True)
    record_lint.set_defaults(func=cmd_record_lint)

    record_ingest = sub.add_parser("record-ingest")
    record_ingest.add_argument("--project-dir", required=True)
    record_ingest.add_argument("--project")
    record_ingest.add_argument("--status", required=True, choices=["pass", "fail"])
    record_ingest.add_argument("--findings-path", required=True)
    record_ingest.add_argument("--audit-run-dir", required=True)
    record_ingest.set_defaults(func=cmd_record_ingest)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
