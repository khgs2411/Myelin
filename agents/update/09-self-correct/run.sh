#!/usr/bin/env bash
# Self-correct stage - one bounded repo-grounded repair pass after validate passes with warnings.

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  agents/update/09-self-correct/run.sh --project <key> [--project-dir <path>] --run-dir <path>
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
project_dir=""
run_dir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project_key="${2:?}"; shift 2 ;;
    --project-dir) project_dir="${2:?}"; shift 2 ;;
    --run-dir) run_dir="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
[[ -n "$run_dir" ]] || die "--run-dir is required"
if [[ -z "$project_dir" ]]; then
  project_dir="$ROOT_DIR/projects/$project_key"
fi
[[ -d "$project_dir" ]] || die "project dir not found: $project_dir"
[[ -f "$run_dir/validation-findings.json" ]] || die "validation-findings.json missing in $run_dir"
[[ -f "$run_dir/proposal.json" ]] || die "proposal.json missing in $run_dir"
[[ -f "$run_dir/ranking-snapshot.json" ]] || die "ranking-snapshot.json missing in $run_dir"

python3 - "$project_key" "$project_dir" "$run_dir" "$ROOT_DIR" "$AGENT_DIR" <<'PY'
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

project_key = sys.argv[1]
project_dir = Path(sys.argv[2])
run_dir = Path(sys.argv[3])
root_dir = Path(sys.argv[4])
agent_dir = Path(sys.argv[5])

sys.path.insert(0, str(root_dir))
from agents.update._shared import llm_client, proposal_citations, self_correct_context


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def rel_path(path: Path) -> str:
    return str(path.relative_to(project_dir)).replace("\\", "/")


def extract_related_pages(seed_pages: list[str], max_related_pages: int) -> list[str]:
    related: list[str] = []
    seen = set(seed_pages)
    link_pattern = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
    for seed in seed_pages:
        page_path = project_dir / seed
        if not page_path.is_file():
            continue
        for match in link_pattern.finditer(load_text(page_path)):
            candidate = self_correct_context.normalize_project_link(seed, match.group(1))
            if not candidate or candidate in seen:
                continue
            target = project_dir / candidate
            if not target.is_file():
                continue
            seen.add(candidate)
            related.append(candidate)
            if len(related) >= max_related_pages:
                return related
    return related


_CITATION_RE = re.compile(r"([A-Za-z0-9_./-]+\.[A-Za-z0-9_+-]+):(\d+)(?:-(\d+))?")


def iter_citations(page_paths: list[str]) -> list[str]:
    citations: list[str] = []
    seen: set[str] = set()
    for rel in page_paths:
        page = project_dir / rel
        if not page.is_file():
            continue
        for match in _CITATION_RE.finditer(load_text(page)):
            citation = f"{match.group(1)}:{match.group(2)}"
            if match.group(3):
                citation += f"-{match.group(3)}"
            if citation in seen:
                continue
            seen.add(citation)
            citations.append(citation)
    return citations


def load_citation_snippets(repo_root: Path, citations: list[str], max_files: int, max_lines: int) -> list[dict]:
    snippets: list[dict] = []
    seen_paths: set[str] = set()
    for citation in citations:
        match = _CITATION_RE.fullmatch(citation)
        if not match:
            continue
        rel = match.group(1)
        start = int(match.group(2))
        end = int(match.group(3) or match.group(2))
        path = repo_root / rel
        if not path.is_file() or rel in seen_paths:
            continue
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            continue
        start_idx = max(start - 1, 0)
        end_idx = min(len(lines), max(end, start) + 1)
        slice_lines = lines[start_idx:end_idx]
        if len(slice_lines) > max_lines:
            slice_lines = slice_lines[:max_lines]
            end_idx = start_idx + len(slice_lines)
        snippets.append(
            {
                "citation": citation,
                "path": rel,
                "start_line": start_idx + 1,
                "end_line": end_idx,
                "content": self_correct_context.clip_chars(
                    "\n".join(slice_lines),
                    max_snippet_chars,
                ),
            }
        )
        seen_paths.add(rel)
        if len(snippets) >= max_files:
            break
    return snippets


def ignored_path(rel: str, ignored_roots: list[str]) -> bool:
    normalized = rel.replace("\\", "/")
    for root in ignored_roots:
        root = root.strip().strip("/")
        if not root:
            continue
        if normalized == root or normalized.startswith(root + "/"):
            return True
    return False


def search_repo(repo_root: Path, ignored_roots: list[str], terms: list[str], max_files: int, max_lines: int) -> list[dict]:
    rg = shutil.which("rg")
    if rg is None:
        return []
    snippets: list[dict] = []
    seen_paths: set[str] = set()
    for term in terms:
        if len(snippets) >= max_files:
            break
        result = subprocess.run(
            [rg, "-n", "-S", "--no-heading", "--hidden", "--max-count", "1", term, str(repo_root)],
            capture_output=True,
            text=True,
        )
        if result.returncode not in (0, 1):
            continue
        for line in result.stdout.splitlines():
            parts = line.split(":", 2)
            if len(parts) != 3:
                continue
            abs_path, line_no_text, content = parts
            try:
                abs_file = Path(abs_path)
                rel = str(abs_file.relative_to(repo_root)).replace("\\", "/")
                line_no = int(line_no_text)
            except (ValueError, OSError):
                continue
            if rel in seen_paths or ignored_path(rel, ignored_roots):
                continue
            try:
                lines = abs_file.read_text(encoding="utf-8").splitlines()
            except (UnicodeDecodeError, OSError):
                continue
            start = max(1, line_no - 2)
            end = min(len(lines), start + max_lines - 1)
            snippet = self_correct_context.clip_chars(
                "\n".join(lines[start - 1:end]),
                max_snippet_chars,
            )
            snippets.append(
                {
                    "term": term,
                    "path": rel,
                    "start_line": start,
                    "end_line": end,
                    "content": snippet,
                }
            )
            seen_paths.add(rel)
            break
    return snippets


config = load_json(agent_dir / "config.json")
project_json = load_json(project_dir / "state" / "project.json")
max_page_chars = int(config["stage_specific"].get("max_page_chars", 6000))
max_snippet_chars = int(config["stage_specific"].get("max_snippet_chars", 4000))
prompt_target_chars = int(
    config["stage_specific"].get(
        "max_prompt_chars",
        min(llm_client.PROMPT_SIZE_LIMIT - 20000, 120000),
    )
)
findings = load_json(run_dir / "validation-findings.json")
if findings.get("status") != "pass":
    print(
        "error: self-correct should only run after validation passes with warnings; "
        f"current status: {findings.get('status')!r}",
        file=sys.stderr,
    )
    sys.exit(2)

semantic_warnings = [
    finding for finding in findings.get("semantic", [])
    if str(finding.get("severity") or "").strip().lower() == "warn"
]

if not semantic_warnings:
    print("error: self-correct requires at least one semantic warning", file=sys.stderr)
    sys.exit(2)

repo_paths = project_json.get("repo_paths", [])
repo_root = Path(repo_paths[0]) if repo_paths else project_dir
if not repo_root.is_absolute():
    repo_root = root_dir / repo_root

affected_pages: list[str] = []
for finding in semantic_warnings:
    for page in finding.get("pages") or []:
        if not isinstance(page, str):
            continue
        page = page.strip()
        if not page or page in affected_pages:
            continue
        target = project_dir / page
        if target.is_file():
            affected_pages.append(page)

related_pages = extract_related_pages(
    affected_pages,
    int(config["stage_specific"].get("max_related_pages", 6)),
)
page_context = affected_pages + [page for page in related_pages if page not in affected_pages]
repo_citation_snippets = load_citation_snippets(
    repo_root,
    iter_citations(page_context),
    int(config["stage_specific"].get("max_repo_files", 8)),
    int(config["stage_specific"].get("max_repo_lines_per_file", 120)),
)
repo_search_snippets = search_repo(
    repo_root,
    list(project_json.get("ignored_paths") or []),
    self_correct_context.extract_search_terms(
        semantic_warnings,
        affected_pages,
        int(config["stage_specific"].get("max_repo_search_terms", 8)),
    ),
    int(config["stage_specific"].get("max_repo_files", 8)),
    int(config["stage_specific"].get("max_repo_lines_per_file", 120)),
)

payload = {
    "project_key": project_key,
    "validation_findings": semantic_warnings,
    "current_proposal": load_json(run_dir / "proposal.json"),
    "ranking_snapshot": load_json(run_dir / "ranking-snapshot.json"),
    "affected_pages": [
        {
            "path": rel,
            "content": self_correct_context.clip_chars(load_text(project_dir / rel), max_page_chars),
        }
        for rel in affected_pages
    ],
    "related_pages": [
        {
            "path": rel,
            "content": self_correct_context.clip_chars(load_text(project_dir / rel), max_page_chars),
        }
        for rel in related_pages
    ],
    "repo_citation_snippets": repo_citation_snippets,
    "repo_search_snippets": repo_search_snippets,
}

while len(json.dumps(payload)) > prompt_target_chars:
    if payload["repo_search_snippets"]:
        payload["repo_search_snippets"].pop()
        continue
    if len(payload["related_pages"]) > 2:
        payload["related_pages"].pop()
        continue
    if payload["repo_citation_snippets"]:
        payload["repo_citation_snippets"].pop()
        continue
    break

prompt = json.dumps(payload)
result = llm_client.invoke(stage_id="09-self-correct", prompt=prompt)
self_correct_proposal = result["response"]
self_correct_proposal["run_id"] = run_dir.name
self_correct_proposal = proposal_citations.normalize_proposal_citations(self_correct_proposal, repo_root)

proposal_path = run_dir / "self-correct-proposal.json"
proposal_path.write_text(json.dumps(self_correct_proposal, indent=2) + "\n", encoding="utf-8")

now = datetime.now(timezone.utc).isoformat()
update_state_path = project_dir / "state" / "update-state.json"
if update_state_path.is_file():
    update_state = load_json(update_state_path)
    update_state.setdefault("stages", {})
    update_state["stages"]["self-correct"] = {
        "status": "completed",
        "last_run_dir": str(run_dir),
        "last_completed_at": now,
        "summary_file": str(proposal_path),
    }
    update_state["last_completed_stage"] = "self-correct"
    update_state["latest_run_dir"] = str(run_dir)
    update_state_path.write_text(json.dumps(update_state, indent=2) + "\n", encoding="utf-8")

units = self_correct_proposal.get("units", [])
print(
    f"self-correct: {len(units)} unit(s) proposed, "
    f"approved={self_correct_proposal.get('approved', False)}"
)
PY
