#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat()


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def duration_seconds(started_at: str | None, completed_at: str | None) -> float | None:
    start = parse_time(started_at)
    end = parse_time(completed_at)
    if start is None or end is None:
        return None
    return round(max(0.0, (end - start).total_seconds()), 3)


def load_profile(path: Path) -> dict[str, Any]:
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def base_stage_name(name: str) -> str:
    return re.sub(r"\s+\([^)]*\)$", "", name).strip()


def stage_id_prefix(name: str) -> str | None:
    base = base_stage_name(name)
    mapping = {
        "sense": "01-sense",
        "impact": "02-impact",
        "propose": "03-propose",
        "apply": None,
        "validate": "06-validate",
        "reconcile": "07-reconcile",
        "self-correct": "09-self-correct",
        "terminal-state": None,
        "acceptance": "05-acceptance",
        "apply_commit": None,
        "ingest": "08-ingest",
    }
    return mapping.get(base)


def load_llm_results(run_dir: Path) -> list[dict[str, Any]]:
    results_dir = run_dir / "llm-results"
    if not results_dir.is_dir():
        return []
    results: list[dict[str, Any]] = []
    for path in sorted(results_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            data["_path"] = str(path)
            results.append(data)
    return results


def token_totals(tokens: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not tokens:
        return None
    return {
        "input_chars": sum(int(item.get("input_chars") or 0) for item in tokens),
        "output_chars": sum(int(item.get("output_chars") or 0) for item in tokens),
        "is_estimate": any(bool(item.get("is_estimate", True)) for item in tokens),
    }


def load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def proposal_metrics(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    proposal = load_json(path)
    units = [unit for unit in proposal.get("units", []) if isinstance(unit, dict)]
    touched_pages = {
        page
        for unit in units
        for page in [unit.get("page_path")]
        if isinstance(page, str) and page
    }
    affected_cross_refs = {
        ref
        for unit in units
        for ref in (unit.get("affected_cross_refs") or [])
        if isinstance(ref, str) and ref.endswith(".md")
    }
    return {
        "proposal_unit_count": len(units),
        "touched_page_count": len(touched_pages),
        "affected_cross_ref_count": len(affected_cross_refs),
    }


def validation_metrics(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    findings = load_json(path)
    structural = [item for item in findings.get("structural", []) if isinstance(item, dict)]
    semantic = [item for item in findings.get("semantic", []) if isinstance(item, dict)]
    return {
        "structural_blocker_count": sum(1 for item in structural if item.get("severity") == "blocker"),
        "structural_warning_count": sum(1 for item in structural if item.get("severity") in {"warn", "warning"}),
        "semantic_blocker_count": sum(1 for item in semantic if item.get("severity") == "blocker"),
        "semantic_warning_count": sum(1 for item in semantic if item.get("severity") in {"warn", "warning"}),
    }


def stage_artifact_metrics(stage_name: str, run_dir: Path) -> dict[str, Any]:
    base = base_stage_name(stage_name)
    if base in {"propose", "ingest", "self-correct"}:
        if base == "self-correct":
            return proposal_metrics(run_dir / "self-correct-proposal.json")
        return proposal_metrics(run_dir / "proposal.json")
    if base == "reconcile":
        metrics = proposal_metrics(run_dir / "reconcile-proposal.json")
        metrics.update(validation_metrics(run_dir / "validation-findings.json"))
        return metrics
    if base == "validate":
        return validation_metrics(run_dir / "validation-findings.json")
    return {}


def llm_metadata_summary(matches: list[dict[str, Any]]) -> dict[str, Any]:
    metadata_items = [item.get("metadata") for item in matches if isinstance(item.get("metadata"), dict)]
    if not metadata_items:
        return {}
    backends = sorted({str(item.get("backend")) for item in metadata_items if item.get("backend")})
    models = sorted({str(item.get("model")) for item in metadata_items if item.get("model")})
    reasoning = sorted({str(item.get("reasoning_effort")) for item in metadata_items if item.get("reasoning_effort")})
    return {
        "backends": backends,
        "models": models,
        "reasoning_efforts": reasoning,
        "runtime_prompt_chars": sum(int(item.get("runtime_prompt_chars") or 0) for item in metadata_items),
        "combined_prompt_chars": sum(int(item.get("combined_prompt_chars") or 0) for item in metadata_items),
        "recorded_output_chars": sum(int(item.get("output_chars") or 0) for item in metadata_items),
    }


def attach_tokens(profile: dict[str, Any], run_dir: Path) -> None:
    llm_results = load_llm_results(run_dir)
    prefixes = sorted(
        {
            prefix
            for stage in profile.get("stages", [])
            for prefix in [stage_id_prefix(str(stage.get("name") or ""))]
            if prefix
        }
    )
    matches_by_stage: dict[int, list[dict[str, Any]]] = {
        index: [] for index, _stage in enumerate(profile.get("stages", []))
    }
    for prefix in prefixes:
        prefix_results = [
            result
            for result in llm_results
            if str(result.get("stage_id") or "") == prefix
            or str(result.get("stage_id") or "").startswith(f"{prefix}.")
        ]
        stage_indexes = [
            index
            for index, stage in enumerate(profile.get("stages", []))
            if stage_id_prefix(str(stage.get("name") or "")) == prefix
        ]
        if len(stage_indexes) == 1:
            matches_by_stage[stage_indexes[0]].extend(prefix_results)
            continue
        for offset, result in enumerate(prefix_results):
            target_index = stage_indexes[min(offset, len(stage_indexes) - 1)]
            matches_by_stage[target_index].append(result)

    for index, stage in enumerate(profile.get("stages", [])):
        matches = matches_by_stage.get(index, [])
        tokens = token_totals([item.get("tokens_consumed") or {} for item in matches])
        if tokens:
            stage["tokens"] = tokens
            stage["llm_call_count"] = len(matches)
            stage["llm_stage_ids"] = [str(item.get("stage_id")) for item in matches]
            metadata = llm_metadata_summary(matches)
            if metadata:
                stage["llm_metadata"] = metadata
        else:
            stage.pop("tokens", None)
            stage.pop("llm_call_count", None)
            stage.pop("llm_stage_ids", None)
            stage.pop("llm_metadata", None)
        stage_status = str(stage.get("status") or "")
        artifact_metrics = (
            stage_artifact_metrics(str(stage.get("name") or ""), run_dir)
            if stage_status in {"completed", "failed"}
            else {}
        )
        if artifact_metrics and not isinstance(stage.get("profile"), dict):
            stage["profile"] = artifact_metrics
        elif not artifact_metrics:
            stage.pop("profile", None)


def recompute_summary(profile: dict[str, Any], run_dir: Path) -> None:
    attach_tokens(profile, run_dir)
    stages = profile.get("stages") or []
    completed = [stage for stage in stages if stage.get("duration_seconds") is not None]
    slowest = None
    if completed:
        slowest = max(completed, key=lambda item: float(item.get("duration_seconds") or 0)).get("name")
    token_stages = [stage for stage in stages if isinstance(stage.get("tokens"), dict)]
    profile["summary"] = {
        "stage_count": len(stages),
        "llm_stage_count": len(token_stages),
        "total_input_chars": sum(int((stage.get("tokens") or {}).get("input_chars") or 0) for stage in token_stages),
        "total_output_chars": sum(int((stage.get("tokens") or {}).get("output_chars") or 0) for stage in token_stages),
        "slowest_stage": slowest,
    }


def render_markdown(profile: dict[str, Any]) -> str:
    lines = [
        f"# Run Profile - {profile.get('run_id', 'unknown')}",
        "",
        f"- Project: `{profile.get('project_key', 'unknown')}`",
        f"- Pipeline: `{profile.get('pipeline', 'unknown')}`",
        f"- Status: `{profile.get('status', 'unknown')}`",
        f"- Duration: {profile.get('duration_seconds', 0)}s",
        "",
        "## Summary",
        "",
    ]
    summary = profile.get("summary") or {}
    lines.extend(
        [
            f"- Stages: {summary.get('stage_count', 0)}",
            f"- LLM stages: {summary.get('llm_stage_count', 0)}",
            f"- Input chars: {summary.get('total_input_chars', 0)}",
            f"- Output chars: {summary.get('total_output_chars', 0)}",
            f"- Slowest stage: {summary.get('slowest_stage') or 'none'}",
            "",
            "## Stages",
            "",
            "| Stage | Attempt | Status | Duration | LLM calls | Input chars | Output chars |",
            "| --- | ---: | --- | ---: | ---: | ---: | ---: |",
        ]
    )
    detail_lines: list[str] = []
    for stage in profile.get("stages") or []:
        tokens = stage.get("tokens") or {}
        lines.append(
            "| {name} | {attempt} | {status} | {duration}s | {calls} | {input_chars} | {output_chars} |".format(
                name=stage.get("name", ""),
                attempt=stage.get("attempt", 1),
                status=stage.get("status", ""),
                duration=stage.get("duration_seconds", 0),
                calls=stage.get("llm_call_count", 0),
                input_chars=tokens.get("input_chars", 0),
                output_chars=tokens.get("output_chars", 0),
            )
        )
        compact = compact_stage_detail(stage)
        if compact:
            detail_lines.append(f"- `{stage.get('name', '')}`: {compact}")
    if detail_lines:
        lines.extend(["", "## LLM Stage Details", "", *detail_lines])
    lines.append("")
    return "\n".join(lines)


def compact_stage_detail(stage: dict[str, Any]) -> str:
    parts: list[str] = []
    metadata = stage.get("llm_metadata") or {}
    if metadata:
        models = ", ".join(metadata.get("models") or [])
        backends = ", ".join(metadata.get("backends") or [])
        reasoning = ", ".join(metadata.get("reasoning_efforts") or [])
        if models:
            parts.append(f"model {models}")
        if backends:
            parts.append(f"backend {backends}")
        if reasoning:
            parts.append(f"reasoning {reasoning}")
        if metadata.get("combined_prompt_chars"):
            parts.append(f"prompt {metadata.get('combined_prompt_chars')} chars")
    profile = stage.get("profile") or {}
    if profile.get("proposal_unit_count") is not None:
        parts.append(f"units {profile.get('proposal_unit_count')}")
    if profile.get("touched_page_count") is not None:
        parts.append(f"touched pages {profile.get('touched_page_count')}")
    if profile.get("structural_blocker_count") is not None:
        parts.append(f"structural blockers {profile.get('structural_blocker_count')}")
    return "; ".join(parts)


def write_outputs(profile: dict[str, Any], run_dir: Path, project_dir: Path) -> None:
    recompute_summary(profile, run_dir)
    if profile.get("started_at"):
        completed_at = profile.get("completed_at") or iso_now()
        profile["duration_seconds"] = duration_seconds(profile.get("started_at"), completed_at)

    run_dir.mkdir(parents=True, exist_ok=True)
    latest_dir = project_dir / "state" / "latest"
    latest_dir.mkdir(parents=True, exist_ok=True)

    profile_json = json.dumps(profile, indent=2) + "\n"
    profile_md = render_markdown(profile)
    (run_dir / "run-profile.json").write_text(profile_json, encoding="utf-8")
    (run_dir / "run-profile.md").write_text(profile_md, encoding="utf-8")
    (latest_dir / "run-profile.json").write_text(profile_json, encoding="utf-8")
    (latest_dir / "run-profile.md").write_text(profile_md, encoding="utf-8")


def ensure_profile(args: argparse.Namespace) -> dict[str, Any]:
    profile = load_profile(Path(args.profile))
    if profile:
        return profile
    return {
        "project_key": args.project_key,
        "run_id": args.run_id,
        "pipeline": args.pipeline,
        "started_at": None,
        "completed_at": None,
        "duration_seconds": None,
        "status": "running",
        "stages": [],
        "summary": {},
    }


def next_attempt(profile: dict[str, Any], name: str) -> int:
    base = base_stage_name(name)
    return 1 + sum(1 for stage in profile.get("stages", []) if base_stage_name(str(stage.get("name") or "")) == base)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("event", choices=["run-started", "stage-started", "stage-finished", "stage-skipped", "run-finished"])
    parser.add_argument("--profile", required=True)
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--project-key", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--pipeline", required=True)
    parser.add_argument("--stage-name")
    parser.add_argument("--status")
    parser.add_argument("--exit-code", type=int)
    args = parser.parse_args()

    profile_path = Path(args.profile)
    project_dir = Path(args.project_dir)
    run_dir = profile_path.parent
    profile = ensure_profile(args)

    now = iso_now()
    if args.event == "run-started":
        profile.update(
            {
                "project_key": args.project_key,
                "run_id": args.run_id,
                "pipeline": args.pipeline,
                "started_at": profile.get("started_at") or now,
                "completed_at": None,
                "status": "running",
            }
        )
    elif args.event == "stage-started":
        if not args.stage_name:
            raise SystemExit("--stage-name is required")
        profile.setdefault("stages", []).append(
            {
                "name": args.stage_name,
                "attempt": next_attempt(profile, args.stage_name),
                "status": "running",
                "started_at": now,
                "completed_at": None,
                "duration_seconds": None,
            }
        )
    elif args.event == "stage-finished":
        if not args.stage_name:
            raise SystemExit("--stage-name is required")
        target = None
        for stage in reversed(profile.get("stages", [])):
            if stage.get("name") == args.stage_name and stage.get("status") == "running":
                target = stage
                break
        if target is None:
            target = {
                "name": args.stage_name,
                "attempt": next_attempt(profile, args.stage_name),
                "started_at": now,
            }
            profile.setdefault("stages", []).append(target)
        status = args.status or ("completed" if args.exit_code in {None, 0} else "failed")
        target["status"] = status
        target["exit_code"] = args.exit_code
        target["completed_at"] = now
        target["duration_seconds"] = duration_seconds(target.get("started_at"), now)
        if status == "failed":
            profile["status"] = "failed"
    elif args.event == "stage-skipped":
        if not args.stage_name:
            raise SystemExit("--stage-name is required")
        profile.setdefault("stages", []).append(
            {
                "name": args.stage_name,
                "attempt": next_attempt(profile, args.stage_name),
                "status": "skipped",
                "started_at": now,
                "completed_at": now,
                "duration_seconds": 0.0,
            }
        )
    elif args.event == "run-finished":
        status = args.status or ("failed" if profile.get("status") == "failed" else "completed")
        profile["status"] = status
        profile["completed_at"] = now

    write_outputs(profile, run_dir, project_dir)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - shell wrapper surfaces this.
        print(f"warning: run profile update failed: {exc}", file=sys.stderr)
        raise SystemExit(2)
