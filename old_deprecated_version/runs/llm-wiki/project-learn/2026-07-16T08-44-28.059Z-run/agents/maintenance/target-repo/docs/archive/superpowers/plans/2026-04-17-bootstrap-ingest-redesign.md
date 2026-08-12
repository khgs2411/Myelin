# Bootstrap and Ingest Layer Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `llm-wiki`'s bootstrap and ingest layers domain-neutral, add semantic validation with teeth, formalize the ingest proposal/approval/apply flow, and verify the whole pipeline by wiping and rebootstrapping `rpg_game` under the new contract.

**Architecture:** The existing 5-stage bootstrap pipeline, directory layout, state-file shapes, and inbox workflow are preserved. Domain-specific vocabulary is stripped from the global agent contract and stage instructions. Stage 4 gains an LLM-driven semantic validator alongside the existing structural validator. A new standalone `make lint` runs the same pair post-bootstrap. The `ingest` command is split into `ingest` (produces a proposal, no writes) and `ingest-apply` (executes an approved proposal). An `--auto` fast path skips the proposal gate for trusted sources.

**Tech Stack:** Bash scripts with embedded Python 3 heredocs, JSON state files, Makefile targets, Markdown docs. Existing pattern: `scripts/*.sh` wrap `python3 -` heredocs for state mutation; agent stages under `agents/bootstrap/<stage>/` share helpers in `_shared/`. Tests are written as `pytest` files under `tests/` (new directory) executed from the repo root.

**Source spec:** `docs/superpowers/specs/2026-04-17-bootstrap-ingest-redesign-design.md`

---

## File Structure

**Docs to modify:**
- `AGENTS.md` — strip domain sections, add scope preamble
- `V1_SPEC.md` — strip domain sections
- `SYSTEM_DESIGN.md` — add `## Scope`, rewrite stage examples
- `README.md` — add scope line, refresh commands

**Stage instructions to rewrite (domain-neutral):**
- `agents/bootstrap/01-orient/instructions.md`
- `agents/bootstrap/02-domain-compiler/instructions.md`
- `agents/bootstrap/03-query-expander/instructions.md`
- `agents/bootstrap/04-validate/instructions.md` (becomes semantic-validator prompt)
- `agents/bootstrap/05-reconcile/instructions.md` (minor: consume new findings shape)

**New files:**
- `tests/test_structural_validator.py` — pytest for structural checks
- `tests/test_lint_script.py` — pytest for `scripts/lint.sh`
- `tests/test_ingest_proposal.py` — pytest for `scripts/ingest_v2.sh` proposal emission
- `tests/test_ingest_apply.py` — pytest for `scripts/ingest_apply.sh`
- `tests/test_docs_no_domain_vocab.py` — pytest that docs and instructions contain no banned vocabulary
- `tests/conftest.py` — shared pytest fixtures (temp project, sample repo)
- `agents/bootstrap/04-validate/config.json` — severity thresholds
- `scripts/lint.sh` — runs structural + semantic validators standalone
- `scripts/ingest_v2.sh` — proposal-emitting ingest (built alongside the existing `ingest.sh`, then promoted)
- `scripts/ingest_apply.sh` — applies an approved proposal
- `docs/INGEST_PROPOSAL_FORMAT.md` — proposal file format reference

**Files to modify (scripts):**
- `scripts/validate.sh` — extend structural checks, add `--project-dir` override, remove fixed page requirements
- `scripts/init_project.sh` — remove hardcoded `wiki/architecture/system-overview.md` scaffolding
- `agents/bootstrap/_shared/state.py` — add `record-lint` subcommand and `latest_lint_findings` field
- `agents/bootstrap/04-validate/run.sh` — wire structural + semantic together
- `Makefile` — add `lint`, `ingest-apply`, `ingest-v2` (transitional), `--auto` passthrough; later flip `ingest` to v2

**Templates to modify:**
- `templates/pages/system-overview.template.md` → rename to `templates/pages/architecture-overview.template.md` (body unchanged, removes the prescribed-filename signal)
- `templates/state/project.template.json` — drop `wiki/architecture/system-overview.md` from `entry_pages`
- `templates/state/bootstrap-state.template.json` — add `latest_lint_findings` field

**Project state to reset (Phase 7):**
- `projects/rpg_game/wiki/` — wipe (only after the disposable copy passes)
- `projects/rpg_game/state/pages.json|sources.json|relationships.json|freshness.json|bootstrap-state.json` — reset to empty templates
- `projects/rpg_game/state/project.json` — preserve (operator-owned)
- `projects/rpg_game/changelog.md` — append-only, keep history

---

## Phased Execution

Phases are ordered by dependency. Each phase ends in a working, testable state. Commit at every green step.

- **Phase 0** — Scope Declaration (docs only, unblocks Phase 1)
- **Phase 1** — Contract Coherence Tranche (docs + scaffolding + validator foundation land as one logical unit so a fresh `make init` works under the new contract)
- **Phase 2** — Stage Instruction Rewrites (domain-neutral)
- **Phase 3** — Structural Validator + State Shape (generic checks, plus `record-lint` and `latest_lint_findings` shape)
- **Phase 4** — Semantic Validator
- **Phase 5** — Standalone `make lint` (script + Makefile target only; state shape already in place)
- **Phase 6** — `ingest_v2` Transition (build alongside `ingest.sh`, dogfood, flip, delete)
- **Phase 7** — Disposable Cold Test + Canonical Rebootstrap

---

## Phase 0 — Scope Declaration

### Task 0.1: Add scope section to SYSTEM_DESIGN.md

**Files:**
- Modify: `SYSTEM_DESIGN.md`

- [ ] **Step 1: Insert scope section near the top of the file, immediately after `## Product Thesis`**

Add this section:

```markdown
## Scope

- `llm-wiki` targets software repositories: services, applications, libraries, games, SDKs, CLI tools, infrastructure.
- Not targeted: personal journaling, research over non-code sources, book companions, trip planning, general-purpose knowledge management.
- The reference "LLM Wiki" pattern covers a broader space; this implementation narrows to repos deliberately, because that is where token savings compound for the primary user.
- Cross-project knowledge that is non-repo (e.g., notes about LLM architecture patterns that apply across projects) is allowed under `concepts/`.
```

- [ ] **Step 2: Verify the section is present**

Run: `grep -A 4 "^## Scope" SYSTEM_DESIGN.md`
Expected: prints the four bullets above.

- [ ] **Step 3: Commit**

```bash
git add SYSTEM_DESIGN.md
git commit -m "docs: declare llm-wiki scope in SYSTEM_DESIGN"
```

### Task 0.2: Add scope line to README.md and preamble to AGENTS.md

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: In `README.md`, insert a one-sentence scope line as the second paragraph (right after "`llm-wiki` is a local-first knowledge layer for codebases.")**

Add this paragraph:

```markdown
Scope: software repositories only — services, apps, libraries, games, SDKs, CLI tools, infrastructure. Non-repo use cases (journaling, research over non-code sources, book companions) are explicitly out of scope.
```

- [ ] **Step 2: In `AGENTS.md`, insert a scope line at the top of the `## System Model` section, as the first line of that section**

Add this line before the existing `Treat llm-wiki as four layers:`:

```markdown
Scope: software repositories only. Do not attempt to ingest non-repo content dropped into the inbox — classify as `unknown` and route to `needs-review`.
```

- [ ] **Step 3: Verify both files**

Run:
```bash
grep -n "Scope: software repositories only" README.md AGENTS.md
```
Expected: two matches, one per file.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: add scope declaration to README and AGENTS"
```

---

## Phase 1 — Contract Coherence Tranche

This phase lands the contract-strip docs, the scaffolding decoupling, and the validator foundation as one logical tranche. Commits happen per file, but the phase is a single coherent unit: at the end of Phase 1 a fresh `make init` must succeed under the new contract (no prescribed `system-overview.md`), and `scripts/validate.sh` must be ready for Phase 3's test fixtures. The anchor is Task 1.5's end-of-tranche verification.

### Task 1.1: Add pytest infrastructure and banned-vocabulary test

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/test_docs_no_domain_vocab.py`

- [ ] **Step 1: Create `tests/conftest.py` with shared fixtures**

```python
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def repo_root() -> Path:
    return REPO_ROOT


@pytest.fixture
def tmp_project(tmp_path: Path) -> Path:
    """A freshly scaffolded project directory under a tmp path."""
    project_dir = tmp_path / "projects" / "sample"
    (project_dir / "wiki" / "architecture").mkdir(parents=True)
    (project_dir / "wiki" / "systems").mkdir()
    (project_dir / "wiki" / "modules").mkdir()
    (project_dir / "wiki" / "integrations").mkdir()
    (project_dir / "wiki" / "decisions").mkdir()
    (project_dir / "wiki" / "runbooks").mkdir()
    (project_dir / "wiki" / "sessions").mkdir()
    (project_dir / "wiki" / "glossary").mkdir()
    (project_dir / "wiki" / "open-questions").mkdir()
    (project_dir / "state").mkdir()
    (project_dir / "sources").mkdir()
    (project_dir / "inbox").mkdir()

    (project_dir / "index.md").write_text("# Sample\n\n## Current Priorities\n\nNo verified project priorities are documented in source materials yet.\n")
    (project_dir / "changelog.md").write_text("# Changelog\n")

    (project_dir / "state" / "project.json").write_text(json.dumps({
        "key": "sample", "name": "Sample", "repo_paths": [],
        "tags": [], "entry_pages": [], "bootstrap_focuses": [],
        "related_concepts": [], "ignored_paths": []
    }, indent=2))
    (project_dir / "state" / "pages.json").write_text(json.dumps({"pages": []}, indent=2))
    (project_dir / "state" / "sources.json").write_text(json.dumps({"sources": []}, indent=2))
    (project_dir / "state" / "relationships.json").write_text(json.dumps({"relationships": []}, indent=2))
    (project_dir / "state" / "freshness.json").write_text(json.dumps({
        "last_seen_commit": None, "changed_paths": [], "impacted_pages": [],
        "status": "unknown", "updated_at": None
    }, indent=2))
    (project_dir / "state" / "bootstrap-state.json").write_text(json.dumps({
        "project": "sample", "latest_run_dir": None,
        "last_completed_stage": None, "latest_validation_report": None,
        "latest_validation_findings": None, "reconciliation_required": False,
        "stages": {}
    }, indent=2))
    return project_dir
```

- [ ] **Step 2: Create `tests/test_docs_no_domain_vocab.py`**

```python
from __future__ import annotations

import re
from pathlib import Path

import pytest

BANNED = [
    # Gameplay vocabulary that leaked from rpg_game
    r"\bgameplay loop\b",
    r"\bdungeon\b",
    r"\babilities\b",
    r"\boverworld\b",
    r"\bbattle\b",
    r"\bquests\b",
    r"\binventory\b",
    # Prescribed domain concepts that should be agent-chosen
    r"\bserver-first\b",
    r"\bsubscription\b",
    r"\bmultiplayer\b",
    r"\bnon-player runtime\b",
    # Prescribed page names
    r"\bruntime-topology\.md\b",
    r"\bsystem-overview\.md\b",
    r"\bserver-module\.md\b",
]

CONTRACT_FILES = [
    "AGENTS.md",
    "V1_SPEC.md",
]

INSTRUCTION_FILES = [
    "agents/bootstrap/01-orient/instructions.md",
    "agents/bootstrap/02-domain-compiler/instructions.md",
    "agents/bootstrap/03-query-expander/instructions.md",
    "agents/bootstrap/04-validate/instructions.md",
    "agents/bootstrap/05-reconcile/instructions.md",
]


@pytest.mark.parametrize("rel_path", CONTRACT_FILES + INSTRUCTION_FILES)
def test_no_banned_vocabulary(repo_root: Path, rel_path: str) -> None:
    text = (repo_root / rel_path).read_text()
    hits = [pat for pat in BANNED if re.search(pat, text, flags=re.IGNORECASE)]
    assert not hits, f"{rel_path} still contains banned vocabulary: {hits}"
```

- [ ] **Step 3: Run the test to verify it currently fails**

Run: `cd /Users/liadgoren/Repositories/llm-wiki && python3 -m pytest tests/test_docs_no_domain_vocab.py -v`
Expected: multiple FAILURES — `AGENTS.md` and `V1_SPEC.md` still contain banned vocabulary. Instructions may or may not fail yet.

- [ ] **Step 4: Commit the test infrastructure**

```bash
git add tests/conftest.py tests/test_docs_no_domain_vocab.py
git commit -m "test: add banned-vocabulary guard for contract and instruction files"
```

### Task 1.2: Strip domain sections from AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Remove the entire `## Canonical Page Role Rules` section**

Open `AGENTS.md` and delete the section titled `## Canonical Page Role Rules` in its entirety (from the heading through the last bullet before the next `##` heading). This section contains the `runtime-topology.md` prescription, client coverage split, architecture page roles, and gameplay/subscription vocabulary.

- [ ] **Step 2: Remove or rewrite any other references to removed concepts**

Search the remaining text for any surviving references and clean them up:

```bash
grep -n -iE "runtime-topology|server-first|gameplay|subscription|dungeon|overworld|abilities|battle|quests|inventory|client coverage|server-module" AGENTS.md
```

Any match that is not inside a fenced code block showing what is explicitly removed must be deleted or rewritten to remove the banned term. Use `Edit` tool to replace each occurrence with a domain-neutral version or remove the sentence entirely.

- [ ] **Step 3: Keep these sections intact**

Verify these sections still exist unchanged in structure (content wording is fine to have preserved):

- `## Purpose`
- `## System Model` (now with scope preamble from Task 0.2)
- `## Non-Negotiable Rules`
- `## Canonical Session Bootstrap`
- `## Bootstrap Stage Contract`
- `## Operator-Owned Project Config`
- `## Project Resolution Rules`
- `## Inbox Handling Rules`
- `## Mandatory Source Classification Output`
- `## Destination Rules By Source Type`
- `## Page Creation Policy`
- `## Ingestion Workflow Contract`
- `## Wiki Writing Rules`
- `## Writing Style For Wiki Pages`
- `## Freshness Contract`
- `## Session Memory Contract`
- `## Logging Contract`
- `## Escalation Rules`
- `## Quality Gate Before Writing`
- `## Success Condition`

Run: `grep -c "^## " AGENTS.md`
Expected: exactly 19 `##` headings. (AGENTS.md starts with 20 top-level sections; Task 1.2 removes one — `## Canonical Page Role Rules`. Task 0.2 adds the scope line to an existing `## System Model` section without introducing a new heading, so the count becomes 19. If the count is not 19, something else was removed or added incorrectly.)

- [ ] **Step 4: Run the banned-vocabulary test for AGENTS.md**

Run: `python3 -m pytest tests/test_docs_no_domain_vocab.py::test_no_banned_vocabulary -v -k AGENTS`
Expected: `AGENTS.md` case passes.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "refactor: strip domain vocabulary from AGENTS.md contract"
```

### Task 1.3: Strip domain sections from V1_SPEC.md

**Files:**
- Modify: `V1_SPEC.md`

- [ ] **Step 1: Remove the `## Architecture Page Role Contract` section entirely**

From the `## Architecture Page Role Contract` heading through the last sub-bullet before the next `##` heading. This removes prescriptions for `system-overview.md` and `runtime-topology.md` page roles.

- [ ] **Step 2: Remove the `## Server-First Project Contract` section entirely.**

- [ ] **Step 3: Remove the `## Client Coverage Split Contract` section entirely.**

- [ ] **Step 4: Remove `wiki/architecture/system-overview.md` and `wiki/architecture/runtime-topology.md` from the Stage 1 bootstrap output list in `### Stage 1: broad orientation`**

Replace the original list that includes those two files with:

```markdown
Must produce:

- `index.md`
- a top-level architecture page whose filename is chosen from repo evidence and placed under `wiki/architecture/`
- initial state updates
- a durable bootstrap session note
```

- [ ] **Step 5: Remove Stage 4 validation bullets that reference domain concepts**

In `### Stage 4: validation`, remove these bullets:

- `missing backend landing page for server-first projects`
- `overloaded client coverage`
- `overlapping architecture page roles`

Keep the generic bullets (broad-only output, domain-only output, fake priorities).

- [ ] **Step 6: Run the banned-vocabulary test for V1_SPEC.md**

Run: `python3 -m pytest tests/test_docs_no_domain_vocab.py -v -k V1_SPEC`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add V1_SPEC.md
git commit -m "refactor: strip domain contracts from V1_SPEC"
```

### Task 1.4: Decouple init, project template, and validator from prescribed architecture filename

**Why this is one task:** The contract body in `templates/pages/system-overview.template.md` is already generic. The real coupling lives in three places that bake `wiki/architecture/system-overview.md` into the scaffold and validation contract: `scripts/init_project.sh` (creates the file), `templates/state/project.template.json` (lists it as an `entry_page`), and `scripts/validate.sh` (requires it). All three must move together so a freshly initialized project passes validation under the new contract. The `--project-dir` override and the `scaffold_mode` softening are pulled into this tranche too — they are foundation work the structural validator and Phase 3 test fixtures both depend on.

**Files:**
- Modify: `scripts/init_project.sh`
- Modify: `templates/state/project.template.json`
- Modify: `scripts/validate.sh`
- Rename: `templates/pages/system-overview.template.md` → `templates/pages/architecture-overview.template.md`
- Modify: `templates/README.md` (if present and references the old name)

- [ ] **Step 1: Survey existing references**

Run: `grep -rn "system-overview" /Users/liadgoren/Repositories/llm-wiki/scripts /Users/liadgoren/Repositories/llm-wiki/templates`
Record every reference. Expected hits in `scripts/init_project.sh` (around line 330 and several others), `templates/state/project.template.json` (around line 6), `scripts/validate.sh` (around line 70), and the template filename itself.

- [ ] **Step 2: Remove the hardcoded scaffold from `scripts/init_project.sh`**

In `scripts/init_project.sh`, delete the heredoc block that writes `wiki/architecture/system-overview.md` (around line 380 of the current file: `cat >"$project_dir/wiki/architecture/system-overview.md" <<EOF ... EOF`). Also remove the index.md `Start Here` bullet that links to `./wiki/architecture/system-overview.md` (currently appears around lines 337 and 345 — both index-emission heredocs link to it). Replace the link line with a generic placeholder bullet such as:

```markdown
- The architecture overview will be created by Stage 1 of bootstrap.
```

Remove `wiki/architecture/system-overview.md` from any `pages.json` seed entries (around line 415) and any `relationships.json` seed entries (around line 438).

- [ ] **Step 3: Remove the prescribed entry from `templates/state/project.template.json`**

Edit `templates/state/project.template.json` so `entry_pages` contains only `index.md`:

```json
{
  "key": "<project-key>",
  "name": "<Project Name>",
  "repo_paths": [],
  "tags": [],
  "entry_pages": [
    "index.md"
  ],
  "bootstrap_focuses": [],
  "related_concepts": [],
  "ignored_paths": []
}
```

- [ ] **Step 4: Remove the entry from `scripts/validate.sh` `required_files`**

In the embedded Python heredoc (`required_files = [...]` block, currently around lines 70–80), remove the `"wiki/architecture/system-overview.md"` entry. The final list must be:

```python
required_files = [
    "index.md",
    "changelog.md",
    "state/project.json",
    "state/pages.json",
    "state/sources.json",
    "state/relationships.json",
    "state/freshness.json",
]
```

- [ ] **Step 5: Soften the empty-pages check on `scaffold_mode`**

The current `scripts/validate.sh` has (near line 143):

```python
if not pages:
    errors.append("state/pages.json has no page entries")
```

This fails on freshly initialized projects. Gate it on `scaffold_mode`:

```python
if not pages and not scaffold_mode:
    errors.append("state/pages.json has no page entries")
```

Note: `scaffold_mode` is computed later in the current file. Move the `scaffold_mode` computation above this `if not pages` block so the gate works. Specifically, move the lines:

```python
has_bootstrap_entry = "bootstrap" in changelog_text
scaffold_mode = not has_bootstrap_entry and not session_files
```

and their prerequisites (`changelog_md`, `changelog_text`, `sessions_dir`, `session_files`) up to immediately before the `if not pages` check.

- [ ] **Step 6: Add `--project-dir` override to `scripts/validate.sh`**

`validate.sh` currently resolves the target project as `$ROOT_DIR/projects/<key>` where `$ROOT_DIR` is derived from the script's own location. Tests cannot point it at a temp-path fixture without an override. Add `--project-dir` argument parsing (around lines 22–44) by adding a third case:

```bash
    --project-dir)
      shift
      [[ $# -gt 0 ]] || die "--project-dir requires a value"
      project_dir_override="$1"
      shift
      ;;
```

Initialize `project_dir_override=""` alongside the existing `project_key=""` and `run_dir=""` declarations.

After the existing `project_dir="$ROOT_DIR/projects/$project_key"` line (around line 48), add:

```bash
if [[ -n "$project_dir_override" ]]; then
  project_dir="$project_dir_override"
fi
[[ -d "$project_dir" ]] || die "project does not exist: $project_dir"
```

Remove the original `[[ -d "$project_dir" ]] || die ...` line if it now runs before the override; the new one replaces it.

- [ ] **Step 7: Rename the template file**

```bash
git mv templates/pages/system-overview.template.md templates/pages/architecture-overview.template.md
```

The body stays unchanged. The rename only removes the prescribed-filename signal. Update `templates/README.md` (if present) to reflect the rename.

- [ ] **Step 8: Sanity check**

Run: `bash scripts/validate.sh --help 2>&1 | head -5` — should still print usage without error.
Run: `bash scripts/validate.sh --project rpg_game 2>&1 | head -5` — should run to completion (rpg_game may still report errors from old shape; that is fine, just no Python NameError).
Run: `grep -n "system-overview" scripts/init_project.sh` — no matches expected, or matches only inside comments explicitly explaining the rename.

- [ ] **Step 9: Commit each file separately**

```bash
git add scripts/init_project.sh
git commit -m "refactor(init): stop pre-creating wiki/architecture/system-overview.md"

git add templates/state/project.template.json
git commit -m "refactor(templates): drop system-overview.md from default entry_pages"

git add scripts/validate.sh
git commit -m "refactor(validate): drop fixed page requirement, soften empty-pages, add --project-dir override"

git add templates/pages/architecture-overview.template.md
git commit -m "refactor: rename system-overview template to generic architecture-overview"
```

### Task 1.5: End-of-tranche verification

**Files:** none authored — verification only.

This task anchors the Phase 1 contract: a fresh `make init` must succeed under the new contract. Run before moving to Phase 2.

- [ ] **Step 1: Init a throwaway project**

```bash
make init PROJECT=phase1_smoke NAME="Phase 1 smoke" 2>&1 | tail -20
```

- [ ] **Step 2: Verify no `wiki/architecture/system-overview.md` was created**

```bash
ls projects/phase1_smoke/wiki/architecture/
```

Expected: an empty directory or a directory without `system-overview.md`.

- [ ] **Step 3: Verify `state/project.json` `entry_pages` does not reference that path**

```bash
grep -c "system-overview.md" projects/phase1_smoke/state/project.json
```

Expected: `0`.

- [ ] **Step 4: Verify `scripts/validate.sh` exits 0 on the fresh scaffold**

```bash
bash scripts/validate.sh --project phase1_smoke ; echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 5: Clean up**

```bash
rm -rf projects/phase1_smoke
```

- [ ] **Step 6: Commit only if any of the verification steps revealed a fix that needed to land. Otherwise skip — no file changes.**

---

## Phase 2 — Stage Instruction Rewrites

### Task 2.1: Rewrite Stage 01 orient instructions (domain-neutral)

**Files:**
- Modify: `agents/bootstrap/01-orient/instructions.md`

- [ ] **Step 1: Replace the file contents with the generic version**

New content:

```markdown
# Bootstrap Stage 01: Orient

Purpose:

- establish the project frame
- identify source-of-truth areas
- create the smallest useful orientation layer

Write scope:

- `index.md`
- one top-level page under `wiki/architecture/` describing repo shape (what the project is, entry points, main surfaces, tech stack). Choose the filename from repo evidence.
- supporting state metadata (`pages.json`, `sources.json`, `relationships.json`, `freshness.json`)
- one bootstrap session note under `wiki/sessions/`

Rules:

- do not try to create the full second brain in this stage
- do not prescribe a fixed page name; let the architecture page reflect the project
- do not create subsystem, module, feature, or runtime pages — Stage 2 owns those
- do not rewrite operator-owned project config (`project.json`)
- consult `project.json` hints (`tags`, `bootstrap_focuses`, `entry_pages`) if present; they are optional steering, not requirements

Success condition:

- a new agent can orient from `index.md` and the architecture page without starting from a broad repo scan
- state files are valid and registered
```

- [ ] **Step 2: Run the banned-vocabulary test**

Run: `python3 -m pytest tests/test_docs_no_domain_vocab.py -v -k orient`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add agents/bootstrap/01-orient/instructions.md
git commit -m "refactor: rewrite Stage 01 orient instructions domain-neutral"
```

### Task 2.2: Rewrite Stage 02 domain-compiler instructions

**Files:**
- Modify: `agents/bootstrap/02-domain-compiler/instructions.md`

- [ ] **Step 1: Replace the file contents**

```markdown
# Bootstrap Stage 02: Compile

Purpose:

- walk the repo surface and produce durable pages for stable subsystems, modules, integrations, and decisions
- turn the orientation shell into a real project memory graph

Write scope:

- new pages under `wiki/systems/`, `wiki/modules/`, `wiki/integrations/`, `wiki/decisions/`, `wiki/runbooks/`, `wiki/glossary/`, `wiki/open-questions/` as evidence justifies
- updates to `index.md` listing newly created pages
- updates to `pages.json`, `sources.json`, `relationships.json`

Page-creation criteria:

- create a dedicated page when at least two are true:
  - a stable folder, module, or domain exists to back it
  - multiple source files or docs support it
  - it is likely a direct query target in a future session
  - it is conceptually distinct from sibling systems
  - without it, another canonical page would become too broad

Rules:

- do not invent domain concepts; pages must be grounded in repo evidence with `file_path:line` citations
- do not produce overviews of content that already lives in a Stage 1 page
- do not split concepts across shelves arbitrarily — pick the shelf that matches the concept (systems = runtime subsystems; modules = code-level units; integrations = external interfaces; decisions = architectural choices; runbooks = operational procedures; glossary = terms; open-questions = unresolved)

Success condition:

- every stable, queryable concept in the repo has a durable page on the right shelf
- `pages.json` reflects all new pages
- `index.md` links to every new page
```

- [ ] **Step 2: Run the banned-vocabulary test**

Run: `python3 -m pytest tests/test_docs_no_domain_vocab.py -v -k domain-compiler`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add agents/bootstrap/02-domain-compiler/instructions.md
git commit -m "refactor: rewrite Stage 02 compile instructions domain-neutral"
```

### Task 2.3: Rewrite Stage 03 query-expander instructions

**Files:**
- Modify: `agents/bootstrap/03-query-expander/instructions.md`

- [ ] **Step 1: Replace the file contents**

```markdown
# Bootstrap Stage 03: Expand

Purpose:

- split pages from Stage 2 that carry multiple stable concepts deserving direct lookup
- turn broad domain pages into direct query targets

Write scope:

- new pages under any existing shelf that host a split-out concept
- updates to source pages that had content lifted out
- updates to `index.md`, `pages.json`, `relationships.json`

Split criteria:

- a page exceeds the target line count (~60–80 lines) and has multiple distinct H2 sections each describing a stable concept
- a subsystem, registry, scheduler, feature path, or configuration surface is buried inside a broader page and is likely to be queried directly in the future
- two concepts in one page are conceptually distinct enough that a future reader would benefit from separate pages

Rules:

- do not create pages smaller than ~20 lines — if the concept does not warrant that much content, leave it in the parent page
- preserve provenance when lifting content: the new page must keep or extend the source citations
- update the original page to reference the new split-out page rather than duplicating content
- never invent new concepts during the split — only lift existing content

Success condition:

- high-value concepts that are likely direct query targets have their own pages
- no page from Stage 2 carries more than one major concept that deserves a lookup
- `pages.json` and `index.md` reflect all splits
```

- [ ] **Step 2: Run the banned-vocabulary test**

Run: `python3 -m pytest tests/test_docs_no_domain_vocab.py -v -k query-expander`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add agents/bootstrap/03-query-expander/instructions.md
git commit -m "refactor: rewrite Stage 03 expand instructions domain-neutral"
```

### Task 2.4: Rewrite Stage 04 validate instructions (semantic validator prompt)

**Files:**
- Modify: `agents/bootstrap/04-validate/instructions.md`

- [ ] **Step 1: Replace the file contents**

```markdown
# Bootstrap Stage 04: Validate

You are a semantic validator for a project wiki. The structural validator has already run and passed (file presence, JSON shapes, link resolution). Your job is to judge wiki quality.

Inputs available to you:

- `projects/<key>/index.md`
- all pages under `projects/<key>/wiki/**/*.md`
- `projects/<key>/state/pages.json`
- `projects/<key>/state/sources.json`
- `projects/<key>/state/relationships.json`
- the repo being wiki'd (for citation verification and coverage checks)
- `agents/bootstrap/04-validate/config.json` (severity thresholds)

Produce a single JSON findings report at `<run-dir>/semantic-findings.json` with this shape:

```
{
  "findings": [
    {
      "category": "orphan_page|dead_citation|redundant_pages|overloaded_page|coverage_gap|contradiction|stale_claim",
      "severity": "blocker|warning|info",
      "pages": ["<relative path>", "..."],
      "evidence": "<short description with concrete references>",
      "suggested_action": "<one sentence>"
    }
  ]
}
```

Categories:

- **orphan_page** — a durable page not referenced from `index.md` or any other wiki page. Severity: `blocker` if the orphan is under `wiki/architecture/`; `warning` otherwise.
- **dead_citation** — a `file_path:line` citation whose target does not exist. Verify with ripgrep against the repo. Severity: `blocker` if more than the configured ratio of a page's citations are dead; `warning` otherwise.
- **redundant_pages** — two pages whose summaries in `pages.json` substantially overlap. Severity: `warning`.
- **overloaded_page** — a page exceeding 120 lines with three or more distinct H2 sections each describing a different stable concept. Severity: `warning`.
- **coverage_gap** — a top-level repo surface (top-level directory, major feature inferred from entry points and build manifests) with no corresponding durable page. Severity: `blocker` for top-level architecture-tier gaps; `warning` otherwise.
- **contradiction** — two pages making opposing claims about the same entity. Severity: `blocker`.
- **stale_claim** — a page whose cited files have changed since the page's `last_reviewed_at`. Severity: `warning`.

Rules:

- produce ONLY the JSON file; do not write prose, do not modify wiki pages, do not modify state files
- read `config.json` for the dead-citation ratio threshold and any category severity overrides
- if a finding does not fit any category, emit under the closest match and flag in `evidence`
- cite concrete evidence for every finding — page path, line numbers, repo paths

Pass criterion (enforced by the caller, not by you): zero findings with severity `blocker`.
```

- [ ] **Step 2: Run the banned-vocabulary test**

Run: `python3 -m pytest tests/test_docs_no_domain_vocab.py -v -k validate`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add agents/bootstrap/04-validate/instructions.md
git commit -m "refactor: rewrite Stage 04 validate as semantic-validator prompt"
```

### Task 2.5: Update Stage 05 reconcile instructions to consume new findings shape

**Files:**
- Modify: `agents/bootstrap/05-reconcile/instructions.md`

- [ ] **Step 1: Read the current instructions**

Run: `cat agents/bootstrap/05-reconcile/instructions.md`

- [ ] **Step 2: Rewrite to consume the new shape**

Replace file contents with:

```markdown
# Bootstrap Stage 05: Reconcile

Purpose:

- fix the findings produced by Stage 04 (structural + semantic)
- converge the wiki into a validated state
- do not restart bootstrap from scratch

Inputs:

- `<run-dir>/validate-findings.json` (structural findings)
- `<run-dir>/semantic-findings.json` (semantic findings)
- `projects/<key>/state/bootstrap-state.json` (for `latest_validation_findings`)

Action rules by finding category:

- **orphan_page** — link the page from `index.md` under the appropriate shelf section, or from a related page if more natural. If the orphan is genuinely redundant, delete it and record the deletion in `changelog.md`.
- **dead_citation** — update the citation to a valid `file_path:line`, or remove the claim if it no longer holds. Do not leave pages citing non-existent code.
- **redundant_pages** — merge into one page, redirect links, delete the losing page, update `pages.json` and `index.md`.
- **overloaded_page** — split the page per Stage 3 criteria. Update all references.
- **coverage_gap** — create the missing durable page on the appropriate shelf. Cite repo evidence. Register in `pages.json` and `index.md`.
- **contradiction** — pick the correct claim based on repo evidence, update the losing page, preserve the historical version in `changelog.md`.
- **stale_claim** — re-review the citation, update the page, bump `last_reviewed_at` in `pages.json`.

Rules:

- do not introduce new concepts not grounded in evidence or existing pages
- preserve provenance: every new or updated citation must resolve
- append a `changelog.md` entry summarizing reconciliation actions
- after reconciliation, the caller re-runs Stage 04 to confirm zero `blocker` findings

Success condition:

- a subsequent Stage 04 run produces zero `blocker` findings
- all structural checks still pass
```

- [ ] **Step 3: Run the banned-vocabulary test**

Run: `python3 -m pytest tests/test_docs_no_domain_vocab.py -v -k reconcile`
Expected: pass.

- [ ] **Step 4: Run the full banned-vocabulary test suite**

Run: `python3 -m pytest tests/test_docs_no_domain_vocab.py -v`
Expected: all cases pass.

- [ ] **Step 5: Commit**

```bash
git add agents/bootstrap/05-reconcile/instructions.md
git commit -m "refactor: update Stage 05 reconcile for new findings shape"
```

---

## Phase 3 — Structural Validator + State Shape

This phase strips the remaining domain-specific logic from `validate.sh` (the `--project-dir` override and the `required_files` / `scaffold_mode` softening already landed in Phase 1), adds the new generic checks, and lands the `record-lint` subcommand and `latest_lint_findings` field on `bootstrap-state.json` so Phase 4 and Phase 5 have somewhere to write to. Task ordering:

1. Strip domain-specific logic from `validate.sh` (one focused commit).
2. Write failing tests for the new generic checks.
3. Implement the new checks (registration/existence, source preservation, oversized).
4. Add `record-lint` to `state.py` and the `latest_lint_findings` field to the bootstrap-state template.

### Task 3.1: Strip domain-specific logic from validate.sh

**Files:**
- Modify: `scripts/validate.sh`

**What to remove:** All blocks of the embedded Python heredoc (the Python block begins at line 59 with `python3 - ... <<'PY'` and runs to `PY` near the end of the file) that enforce gameplay/server-first/client-concern assumptions. Every line number cited below refers to positions inside that Python heredoc in the unmodified current file. Specifically:

1. The `system_overview` and `runtime_topology` named-path variables (current lines 118–119) and all their downstream uses.
2. The `server_first_signal` detection and backend-landing-page enforcement (current lines 242–253).
3. The `complex_server_surface` / `deep_dive_pages` expectation logic (current lines 255–317).
4. The `system_overview.md` ↔ `runtime_topology.md` overlap check (current lines 319–323).
5. The `client_concern_patterns` dict and its loop (current lines 325–354).
6. The `placeholder_markers` entries that reference "system inventory not written yet", "integrations not written yet", "runbooks not written yet" (current lines 84–86) — these presume a fixed page layout that is no longer prescribed.

**What to keep:** The generic checks that are not domain-biased:

- `required_files` loop (already slimmed in Phase 1 Task 1.4)
- JSON validity parsing
- `## Review Provenance` / `<!-- llm-wiki:review-provenance:` scaffolding detection
- `^## Status\s*$` construction-narration detection
- `pages.json` entry-must-exist loop (lines 146–152 in current file)
- `entry_pages` existence check
- `repo_dirty` / `freshness.json` sync check
- `has_bootstrap_entry` + session-file scaffold_mode detection
- `Current Priorities` ↔ `bootstrap_focuses` mirror detection
- Priority-placeholder warning
- `placeholder_index_links` check (the `./wiki/decisions/README.md` links)
- `^## Purpose\s*$` and `^## Stale Risk\s*$` heading warnings
- page-not-linked-from-index warning
- `freshness_status` metadata shape check

- [ ] **Step 1: Read the current validate.sh in full before editing**

```bash
wc -l scripts/validate.sh
cat scripts/validate.sh
```

Read it top to bottom so the upcoming edits land in the right places.

- [ ] **Step 2: Remove the named-path variables and all their usages**

Delete these lines (current numbering):
- line 118: `system_overview = project_dir / "wiki/architecture/system-overview.md"`
- line 119: `runtime_topology = project_dir / "wiki/architecture/runtime-topology.md"`
- lines 125–130: the `for path in [index_md, system_overview]:` loop that checks for placeholder markers — replace it with a loop over `[index_md, *wiki_pages]`.
- line 132: change `for path in [index_md, system_overview, *wiki_pages]:` to `for path in [index_md, *wiki_pages]:`.
- lines 214–216: `system_overview_text` and `runtime_topology_text` reads — delete both.

- [ ] **Step 3: Remove the server-first detection block**

Delete the entire block currently at lines 242–253 (the `server_first_signal` derivation and the "Server-first or backend-first project is missing a dedicated backend landing page" check).

- [ ] **Step 4: Remove the deep-dive expectation block**

Delete lines 255–317 (the `deep_dive_pages` gathering, `complex_server_surface` detection, `expected_deep_dive_count` branching, and all related errors).

- [ ] **Step 5: Remove the system-overview/runtime-topology overlap check**

Delete lines 319–323 (the `if system_overview.exists() and runtime_topology.exists():` block).

- [ ] **Step 6: Remove the client-concern patterns block**

Delete the `client_concern_patterns` dict (lines 325–336) and its loop (lines 338–354).

- [ ] **Step 7: Remove domain-specific placeholder markers**

In the `placeholder_markers` list (lines 81–88), remove these three entries:
- `"system inventory not written yet"`
- `"integrations not written yet"`
- `"runbooks not written yet"`

Keep `"Placeholder page."`, `"Bootstrap placeholder."`, and `"most pages are placeholders until real ingestion begins"` — those are generic.

- [ ] **Step 8: Remove the `signals` block's domain-specific fields**

In the findings JSON at the bottom (current lines 426–433), remove these fields from the `signals` dict:
- `"server_first": server_first_signal`
- `"complex_server_surface": complex_server_surface`
- `"deep_dive_pages": deep_dive_pages`

Keep `scaffold_mode`, `repo_dirty`, `dirty_paths`.

- [ ] **Step 9: Smoke test**

Run: `bash scripts/validate.sh --project rpg_game 2>&1 | tail -20`
Expected: the script runs to completion. It may report errors (rpg_game wiki is still in old shape), but there should be no Python NameError from a deleted variable.

- [ ] **Step 10: Verify no banned vocabulary remains in validate.sh**

```bash
grep -nE "server-first|backend-first|authoritative backend|gameplay|dungeon|overworld|abilities|battle|quests|inventory|runic well|grimoire|reclass|runtime-topology|system-overview" scripts/validate.sh
```
Expected: no matches.

- [ ] **Step 11: Commit**

```bash
git add scripts/validate.sh
git commit -m "refactor(validate): strip domain-specific logic from structural validator"
```

### Task 3.2: Write failing tests for new structural checks

**Files:**
- Create: `tests/test_structural_validator.py`

- [ ] **Step 1: Create the test file**

```python
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


def run_validate(repo_root: Path, project_dir: Path) -> subprocess.CompletedProcess:
    """Invoke scripts/validate.sh with --project-dir pointing at an arbitrary project dir."""
    env = os.environ.copy()
    return subprocess.run(
        [
            "bash",
            str(repo_root / "scripts" / "validate.sh"),
            "--project", project_dir.name,
            "--project-dir", str(project_dir),
        ],
        capture_output=True,
        text=True,
        env=env,
    )


def test_validate_passes_on_minimal_valid_project(repo_root: Path, tmp_project: Path) -> None:
    result = run_validate(repo_root, tmp_project)
    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"


def test_validate_flags_unregistered_wiki_page(repo_root: Path, tmp_project: Path) -> None:
    (tmp_project / "wiki" / "systems" / "orphan.md").write_text("# Orphan\n")
    result = run_validate(repo_root, tmp_project)
    assert result.returncode != 0
    assert "orphan.md" in (result.stdout + result.stderr)


def test_validate_flags_pages_json_pointing_to_missing_file(repo_root: Path, tmp_project: Path) -> None:
    pages = json.loads((tmp_project / "state" / "pages.json").read_text())
    pages["pages"].append({
        "path": "wiki/systems/ghost.md",
        "type": "system",
        "summary": "",
        "linked_sources": [],
        "linked_topics": [],
        "last_reviewed_at": None,
        "freshness_status": "baseline-validated",
        "baseline_pass": True,
    })
    (tmp_project / "state" / "pages.json").write_text(json.dumps(pages))
    result = run_validate(repo_root, tmp_project)
    assert result.returncode != 0
    assert "ghost.md" in (result.stdout + result.stderr)


def test_validate_flags_source_without_preserved_file(repo_root: Path, tmp_project: Path) -> None:
    sources = json.loads((tmp_project / "state" / "sources.json").read_text())
    sources["sources"].append({
        "source_id": "src-1",
        "original_path": "missing.md",
        "source_kind": "spec",
        "project_key": "sample",
        "status": "processed",
        "derived_pages": [],
        "ingested_at": "2026-04-17T00:00:00Z",
    })
    (tmp_project / "state" / "sources.json").write_text(json.dumps(sources))
    result = run_validate(repo_root, tmp_project)
    assert result.returncode != 0
    combined = result.stdout + result.stderr
    assert "src-1" in combined or "missing.md" in combined


def test_validate_flags_oversized_page(repo_root: Path, tmp_project: Path) -> None:
    body = "\n".join([f"line {i}" for i in range(200)])
    (tmp_project / "wiki" / "systems" / "big.md").write_text(f"# Big\n\n{body}\n")
    pages = json.loads((tmp_project / "state" / "pages.json").read_text())
    pages["pages"].append({
        "path": "wiki/systems/big.md",
        "type": "system",
        "summary": "oversized",
        "linked_sources": [],
        "linked_topics": [],
        "last_reviewed_at": None,
        "freshness_status": "baseline-validated",
        "baseline_pass": True,
    })
    (tmp_project / "state" / "pages.json").write_text(json.dumps(pages))
    result = run_validate(repo_root, tmp_project)
    assert result.returncode != 0
    assert "big.md" in (result.stdout + result.stderr)
```

- [ ] **Step 2: Run — expect the first test to pass (after Phase 1) and the other four to fail (new checks not yet implemented)**

Run: `python3 -m pytest tests/test_structural_validator.py -v`
Expected: `test_validate_passes_on_minimal_valid_project` PASSES. The other four FAIL because the new checks are not yet implemented.

- [ ] **Step 3: Commit**

```bash
git add tests/test_structural_validator.py
git commit -m "test: add failing tests for new structural validator checks"
```

### Task 3.3: Implement page-registration and page-existence checks

**Files:**
- Modify: `scripts/validate.sh`

**NOTE:** The existing `validate.sh` collects errors in a Python list named `errors` (not `failures`). Append to `errors`.

- [ ] **Step 1: Add the two checks inside the Python heredoc, anchored to the `if not pages` landmark**

Use the `if not pages and not scaffold_mode:` check (introduced in Phase 1 Task 1.4 Step 5) as the insertion landmark. Insert this new block **immediately after** that check so the new logic runs with `scaffold_mode` already defined. Do not use raw line numbers from the original file — those shifted during Phase 1's refactor.

```python
# New check: every .md under wiki/ (excluding README.md and sessions/) is registered in pages.json
pages_data_for_check = json_data.get("state/pages.json", {}) or {}
registered_paths = {p["path"] for p in pages_data_for_check.get("pages", []) if "path" in p}

disk_pages = set()
wiki_dir = project_dir / "wiki"
if wiki_dir.exists():
    for md in wiki_dir.rglob("*.md"):
        if md.name == "README.md":
            continue
        if "sessions" in md.parts:
            continue
        disk_pages.add(md.relative_to(project_dir).as_posix())

for page in sorted(disk_pages - registered_paths):
    errors.append(f"wiki page not registered in pages.json: {page}")

for page in sorted(registered_paths - disk_pages):
    if page.startswith("wiki/sessions/"):
        continue
    errors.append(f"pages.json entry points to missing file: {page}")
```

The registered-but-missing check is partially duplicated with the existing `for entry in pages` loop (lines ~146–152 of the original). Remove the old block to avoid double-reporting:

Delete the lines (from the current file):

```python
else:
    for entry in pages:
        rel = entry.get("path")
        if not rel:
            errors.append("state/pages.json contains an entry without path")
            continue
        if not (project_dir / rel).exists():
            errors.append(f"state/pages.json references missing file: {rel}")
```

Keep only the empty-check. The replacement registered/missing logic above now handles both directions.

- [ ] **Step 2: Run the relevant tests**

Run: `python3 -m pytest tests/test_structural_validator.py::test_validate_flags_unregistered_wiki_page tests/test_structural_validator.py::test_validate_flags_pages_json_pointing_to_missing_file -v`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate.sh
git commit -m "feat(validate): add page registration and existence checks"
```

### Task 3.4: Implement source-preservation and oversized-page checks

**Files:**
- Modify: `scripts/validate.sh`

- [ ] **Step 1: Add the source-preservation check**

Insert into the Python heredoc, after the block from Task 3.3:

```python
# New check: every source entry has a preserved file on disk
sources_data_for_check = json_data.get("state/sources.json", {}) or {}
for src in sources_data_for_check.get("sources", []):
    original = src.get("original_path", "")
    source_id = src.get("source_id", "<unknown>")
    candidates = [
        project_dir / "sources" / original,
        project_dir.parent.parent / "raw" / "processed" / original,
    ]
    if not any(c.exists() for c in candidates):
        errors.append(f"source entry {source_id} has no preserved file (looked in {', '.join(str(c) for c in candidates)})")
```

- [ ] **Step 2: Add the oversized-page check**

Immediately after the source-preservation check:

```python
# New check: pages larger than 150 lines must declare oversize_reason
OVERSIZE_THRESHOLD = 150
for entry in pages_data_for_check.get("pages", []):
    rel = entry.get("path")
    if not rel:
        continue
    path = project_dir / rel
    if not path.exists():
        continue
    with path.open() as f:
        line_count = sum(1 for _ in f)
    if line_count > OVERSIZE_THRESHOLD and not entry.get("oversize_reason"):
        errors.append(f"page exceeds {OVERSIZE_THRESHOLD} lines without oversize_reason: {rel} ({line_count} lines)")
```

- [ ] **Step 3: Run the full structural test suite**

Run: `python3 -m pytest tests/test_structural_validator.py -v`
Expected: all five tests PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/validate.sh
git commit -m "feat(validate): add source preservation and oversized page checks"
```

### Task 3.5: Add `record-lint` subcommand and `latest_lint_findings` field

**Files:**
- Modify: `agents/bootstrap/_shared/state.py`
- Modify: `templates/state/bootstrap-state.template.json`

This task lands the state shape that Phase 5's `scripts/lint.sh` will write to. It belongs in Phase 3 because the structural-validator state work is the natural home for state-file shape changes; pushing it into Phase 5 forced a separate state.py edit alongside the script work.

- [ ] **Step 1: Add `record-lint` subcommand to `state.py`**

Read the existing `state.py`:

```bash
cat agents/bootstrap/_shared/state.py
```

Mirror the structure of the existing `record-validation` subcommand (defined around line 133 of the current file; writes to `latest_validation_findings` around line 93). Add a `record-lint` subcommand that accepts `--project-dir`, `--project`, `--findings-path`, `--status` and writes the result under `bootstrap-state.json`'s `latest_lint_findings` field as:

```python
{
  "status": "pass" | "fail",
  "findings_path": "<run-dir>/semantic-findings.json",
  "updated_at": "<ISO timestamp>"
}
```

- [ ] **Step 2: Add `latest_lint_findings` to the bootstrap-state template**

Edit `templates/state/bootstrap-state.template.json` and add the field after `latest_validation_findings`:

```json
{
  "project": "<project-key>",
  "latest_run_dir": null,
  "last_completed_stage": null,
  "latest_validation_report": null,
  "latest_validation_findings": null,
  "latest_lint_findings": null,
  "reconciliation_required": false,
  ...
}
```

The field defaults to `null` so existing projects that have not yet run `make lint` are still valid.

- [ ] **Step 3: Smoke test the subcommand**

```bash
tmp=$(mktemp -d)
mkdir -p "$tmp/state"
cp templates/state/bootstrap-state.template.json "$tmp/state/bootstrap-state.json"
sed -i '' 's/<project-key>/smoke/g' "$tmp/state/bootstrap-state.json"
python3 agents/bootstrap/_shared/state.py record-lint \
  --project-dir "$tmp" --project smoke \
  --status pass --findings-path "$tmp/findings.json"
cat "$tmp/state/bootstrap-state.json"
```

Expected: `latest_lint_findings` is now an object with `status`, `findings_path`, `updated_at`.

- [ ] **Step 4: Commit**

```bash
git add agents/bootstrap/_shared/state.py templates/state/bootstrap-state.template.json
git commit -m "feat(state): add record-lint subcommand and latest_lint_findings field"
```

---

## Phase 4 — Semantic Validator

### Task 4.1: Add severity-threshold config

**Files:**
- Create: `agents/bootstrap/04-validate/config.json`

- [ ] **Step 1: Create the config file**

```json
{
  "dead_citation_ratio_blocker": 0.3,
  "oversized_page_line_threshold": 120,
  "overloaded_h2_count_threshold": 3,
  "severity_overrides": {
    "orphan_page": { "architecture_tier": "blocker", "default": "warning" },
    "dead_citation": { "above_ratio": "blocker", "default": "warning" },
    "redundant_pages": { "default": "warning" },
    "overloaded_page": { "default": "warning" },
    "coverage_gap": { "architecture_tier": "blocker", "default": "warning" },
    "contradiction": { "default": "blocker" },
    "stale_claim": { "default": "warning" }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/bootstrap/04-validate/config.json
git commit -m "feat: add semantic validator severity thresholds"
```

### Task 4.2: Extend Stage 04 run.sh to invoke both structural and semantic validators

**Files:**
- Modify: `agents/bootstrap/04-validate/run.sh`
- Modify: `agents/bootstrap/04-validate/agent.json` (if the `summary_file` field needs to be renamed)

**Authoritative CLI reference:** `stage_runner.sh` accepts only these flags: `--project`, `--agent-dir`, `--model`, `--run-dir`, `--dry-run`, `-h|--help`. It does NOT accept `--stage-dir` or `--output`. The runner writes the agent's final output to `$run_dir/$SUMMARY_FILE` where `SUMMARY_FILE` is read from `agent.json`.

This means the semantic validator's output filename is controlled by:

1. The `summary_file` field in `agents/bootstrap/04-validate/agent.json` — this determines where `stage_runner.sh` writes the agent's final message.
2. Whatever the agent writes directly to the filesystem per its instructions — the instructions already tell the agent to produce `<run-dir>/semantic-findings.json`.

Strategy: the agent writes `semantic-findings.json` directly (per the Stage 04 instructions from Task 2.4). The stage runner's own summary file (typically a final-message narrative) is separate. After the runner completes, `run.sh` reads `$run_dir/semantic-findings.json`.

- [ ] **Step 1: Read the current files to confirm assumptions**

```bash
cat agents/bootstrap/04-validate/run.sh
cat agents/bootstrap/04-validate/agent.json
```

Confirm `agent.json` has `summary_file`, `stage`, `stage_num`, `stage_label`, `pass_kind` fields. Confirm `run.sh` currently just calls `scripts/validate.sh` and records state.

- [ ] **Step 2: Replace the body of `run.sh` from the `if "$ROOT_DIR/scripts/validate.sh" ...` block onward**

Delete the existing `if / else` block (lines 74–92). Replace with:

```bash
# Stage 4a: structural validator
if ! "$ROOT_DIR/scripts/validate.sh" --project "$project_key" --run-dir "$run_dir"; then
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-validation \
    --project-dir "$project_dir" \
    --project "$project_key" \
    --status fail \
    --run-dir "$run_dir" \
    --report-path "$report_path" \
    --findings-path "$findings_path" >/dev/null
  echo "structural validation failed" >&2
  exit 1
fi

# Stage 4b: semantic validator (LLM-driven, via stage_runner.sh)
semantic_findings="$run_dir/semantic-findings.json"

if [[ "${LLM_WIKI_SEMANTIC_SKIP:-0}" == "1" ]]; then
  echo '{"findings": []}' > "$semantic_findings"
else
  "$ROOT_DIR/agents/bootstrap/_shared/stage_runner.sh" \
    --agent-dir "$AGENT_DIR" \
    --project "$project_key" \
    --run-dir "$run_dir"
fi

# The semantic validator writes semantic-findings.json per its instructions.
# Verify the file exists and is valid JSON before counting.
if [[ ! -f "$semantic_findings" ]]; then
  echo "semantic validator did not produce $semantic_findings" >&2
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-validation \
    --project-dir "$project_dir" --project "$project_key" \
    --status fail --run-dir "$run_dir" \
    --report-path "$report_path" --findings-path "$findings_path" >/dev/null
  exit 1
fi

blocker_count=$(python3 - "$semantic_findings" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except (json.JSONDecodeError, OSError) as exc:
    print(f"__PARSE_ERROR__:{exc}", file=sys.stderr)
    sys.exit(2)
print(sum(1 for f in data.get("findings", []) if f.get("severity") == "blocker"))
PY
) || {
  echo "semantic-findings.json is not valid JSON" >&2
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-validation \
    --project-dir "$project_dir" --project "$project_key" \
    --status fail --run-dir "$run_dir" \
    --report-path "$report_path" --findings-path "$findings_path" >/dev/null
  exit 1
}

if [[ "$blocker_count" -gt 0 ]]; then
  echo "semantic validation failed: $blocker_count blocker findings" >&2
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-validation \
    --project-dir "$project_dir" --project "$project_key" \
    --status fail --run-dir "$run_dir" \
    --report-path "$report_path" --findings-path "$findings_path" >/dev/null
  exit 1
fi

python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-validation \
  --project-dir "$project_dir" --project "$project_key" \
  --status pass --run-dir "$run_dir" \
  --report-path "$report_path" --findings-path "$findings_path" >/dev/null
exit 0
```

- [ ] **Step 3: Verify `agent.json` has a valid `summary_file` field**

Run: `cat agents/bootstrap/04-validate/agent.json`
The `summary_file` field must exist and follow the `<pass>.final-message.md` convention used elsewhere. The stage runner requires it; Task 4.2 does not need to rename it as long as it is present.

- [ ] **Step 4: Smoke-test with the semantic skip flag**

```bash
LLM_WIKI_SEMANTIC_SKIP=1 bash agents/bootstrap/04-validate/run.sh --project rpg_game 2>&1 | tail -20
```

Expected: structural validator may fail (rpg_game still has old content until Phase 7) — this is fine. What matters is that the semantic branch logic does not error when it runs. If the structural validator passes, the skip path should exit 0.

- [ ] **Step 5: Commit**

```bash
git add agents/bootstrap/04-validate/run.sh
git commit -m "feat: wire structural and semantic validators into Stage 04 run.sh"
```

---

## Phase 5 — Standalone `make lint`

State shape for `latest_lint_findings` and the `record-lint` subcommand already landed in Phase 3 Task 3.5. Phase 5 only adds the script and Makefile target.

### Task 5.1: Write failing tests for lint.sh

**Files:**
- Create: `tests/test_lint_script.py`

- [ ] **Step 1: Create the test file**

The test passes both `--project sample` and `--project-dir <absolute-path>` so `lint.sh` can run against the pytest temp fixture. This mirrors the pattern established in Phase 1 Task 1.4 for `validate.sh`.

```python
from __future__ import annotations

import os
import subprocess
from pathlib import Path


def test_lint_runs_and_writes_findings(repo_root: Path, tmp_project: Path) -> None:
    env = os.environ.copy()
    env["LLM_WIKI_SEMANTIC_SKIP"] = "1"
    result = subprocess.run(
        [
            "bash", str(repo_root / "scripts" / "lint.sh"),
            "--project", "sample",
            "--project-dir", str(tmp_project),
        ],
        capture_output=True,
        text=True,
        env=env,
    )
    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"
    bootstrap_state = (tmp_project / "state" / "bootstrap-state.json").read_text()
    assert "latest_lint_findings" in bootstrap_state
```

- [ ] **Step 2: Run — expect FAIL because `scripts/lint.sh` does not exist yet**

Run: `python3 -m pytest tests/test_lint_script.py -v`
Expected: FAIL with "No such file or directory" for `lint.sh`.

- [ ] **Step 3: Commit**

```bash
git add tests/test_lint_script.py
git commit -m "test: add failing test for standalone lint command"
```

### Task 5.2: Implement scripts/lint.sh and Makefile target

**Files:**
- Create: `scripts/lint.sh`
- Modify: `Makefile`

- [ ] **Step 1: Create `scripts/lint.sh`**

```bash
#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/lint.sh --project <project-key> [--project-dir <abs-path>] [--model <model>]

--project-dir overrides the default project lookup (ROOT_DIR/projects/<key>).
Used mainly by tests to point at a temp fixture.

MODEL selector (default: codex):
  --model codex              use Codex CLI default model
  --model codex/<id>         use Codex CLI with a specific model id
  --model claude             use Claude CLI default model
  --model claude/<id>        use Claude CLI with a specific model id
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
project_dir_override=""
model=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) shift; [[ $# -gt 0 ]] || die "--project requires a value"; project_key="$1"; shift ;;
    --project-dir) shift; [[ $# -gt 0 ]] || die "--project-dir requires a value"; project_dir_override="$1"; shift ;;
    --model) shift; [[ $# -gt 0 ]] || die "--model requires a value"; model="$1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"

if [[ -n "$project_dir_override" ]]; then
  project_dir="$project_dir_override"
else
  project_dir="$ROOT_DIR/projects/$project_key"
fi
[[ -d "$project_dir" ]] || die "project does not exist: $project_dir"

run_dir="$ROOT_DIR/artifacts/runs/$(date +%Y%m%d-%H%M%S)-lint-$project_key"
mkdir -p "$run_dir"

# Structural
validate_args=(--project "$project_key" --run-dir "$run_dir")
if [[ -n "$project_dir_override" ]]; then
  validate_args+=(--project-dir "$project_dir_override")
fi
if ! "$ROOT_DIR/scripts/validate.sh" "${validate_args[@]}"; then
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-lint \
    --project-dir "$project_dir" --project "$project_key" \
    --status fail --findings-path "$run_dir/validate-findings.json"
  exit 1
fi

# Semantic
semantic_findings="$run_dir/semantic-findings.json"
if [[ "${LLM_WIKI_SEMANTIC_SKIP:-0}" == "1" ]]; then
  echo '{"findings": []}' > "$semantic_findings"
else
  runner_args=(
    --agent-dir "$ROOT_DIR/agents/bootstrap/04-validate"
    --project "$project_key"
    --run-dir "$run_dir"
  )
  if [[ -n "$model" ]]; then
    runner_args+=(--model "$model")
  fi
  "$ROOT_DIR/agents/bootstrap/_shared/stage_runner.sh" "${runner_args[@]}"
fi

if [[ ! -f "$semantic_findings" ]]; then
  echo "semantic validator did not produce $semantic_findings" >&2
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-lint \
    --project-dir "$project_dir" --project "$project_key" \
    --status fail --findings-path "$semantic_findings"
  exit 1
fi

blocker_count=$(python3 - "$semantic_findings" <<'PY' || echo "PARSE_ERROR"
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except (json.JSONDecodeError, OSError) as exc:
    print(f"parse error: {exc}", file=sys.stderr)
    sys.exit(2)
print(sum(1 for f in data.get("findings", []) if f.get("severity") == "blocker"))
PY
)

if [[ "$blocker_count" == "PARSE_ERROR" ]]; then
  echo "semantic-findings.json is not valid JSON" >&2
  python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-lint \
    --project-dir "$project_dir" --project "$project_key" \
    --status fail --findings-path "$semantic_findings"
  exit 1
fi

status="pass"
[[ "$blocker_count" -gt 0 ]] && status="fail"

python3 "$ROOT_DIR/agents/bootstrap/_shared/state.py" record-lint \
  --project-dir "$project_dir" --project "$project_key" \
  --status "$status" --findings-path "$semantic_findings"

echo "lint complete: status=$status blockers=$blocker_count findings=$semantic_findings"
[[ "$status" == "pass" ]] || exit 1
```

Make executable: `chmod +x scripts/lint.sh`

- [ ] **Step 2: Add `lint` target to Makefile**

Append to the `.PHONY` line and add the target with MODEL passthrough (matches the existing pattern used by `bootstrap`, `ingest`):

```makefile
.PHONY: ... lint ...

lint:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make lint PROJECT=my_project" && exit 1)
	@./scripts/lint.sh --project "$(PROJECT)" $(if $(MODEL),--model "$(MODEL)",)
```

Also add a help line in the `help` target that documents `MODEL` the same way existing targets do.

- [ ] **Step 3: Run the test**

Run: `python3 -m pytest tests/test_lint_script.py -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/lint.sh Makefile
git commit -m "feat: add standalone make lint command"
```

---

## Phase 6 — `ingest_v2` Transition

This phase builds the new proposal/apply ingest flow as `scripts/ingest_v2.sh` alongside the untouched `scripts/ingest.sh`. The old script stays available throughout development as a known-good fallback. Once `ingest_v2.sh` has been dogfooded against a real session note and validated by the user in Obsidian, the Makefile `ingest` target is flipped to point at v2 and `scripts/ingest.sh` is deleted. No long-term dual-path maintenance.

### Task 6.1: Create `scripts/ingest_v2.sh` as a copy of the current ingest

**Files:**
- Create: `scripts/ingest_v2.sh`
- Modify: `Makefile` (add transitional `ingest-v2` target)

- [ ] **Step 1: Copy the existing script**

```bash
cp scripts/ingest.sh scripts/ingest_v2.sh
chmod +x scripts/ingest_v2.sh
```

- [ ] **Step 2: Add a transitional Makefile target**

```makefile
ingest-v2:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@./scripts/ingest_v2.sh --project "$(PROJECT)" $(if $(MODEL),--model "$(MODEL)",) $(if $(AUTO),--auto,)
```

Add `ingest-v2` to `.PHONY` and a help line. The existing `ingest` target stays untouched and points at the old `scripts/ingest.sh` until Task 6.9.

- [ ] **Step 3: Sanity check**

```bash
bash scripts/ingest_v2.sh --help 2>&1 | head -10
```

Expected: prints usage (since v2 is currently a copy of v1).

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest_v2.sh Makefile
git commit -m "feat(ingest): scaffold ingest_v2.sh and make target alongside existing ingest"
```

### Task 6.2: Write failing tests for ingest_v2 proposal emission

**Files:**
- Create: `tests/test_ingest_proposal.py`

- [ ] **Step 1: Create the test file**

```python
from __future__ import annotations

import os
import subprocess
from pathlib import Path


def test_ingest_emits_proposal_without_mutating_wiki(repo_root: Path, tmp_project: Path) -> None:
    # Drop a source into the project inbox
    source_path = tmp_project / "inbox" / "session-note.md"
    source_path.write_text(
        "# Session Note 2026-04-17\n\n"
        "Worked on auth refactor and the billing integration.\n"
        "New module: audit-log.\n"
    )

    wiki_before = sorted(p.as_posix() for p in tmp_project.glob("wiki/**/*.md"))
    state_before = (tmp_project / "state" / "pages.json").read_text()

    env = os.environ.copy()
    env["LLM_WIKI_INGEST_PLAN_STUB"] = "1"  # bypass LLM decomposition with a deterministic stub
    result = subprocess.run(
        ["bash", str(repo_root / "scripts" / "ingest_v2.sh"),
         "--project", "sample",
         "--project-dir", str(tmp_project)],
        capture_output=True,
        text=True,
        env=env,
    )
    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"

    wiki_after = sorted(p.as_posix() for p in tmp_project.glob("wiki/**/*.md"))
    state_after = (tmp_project / "state" / "pages.json").read_text()

    assert wiki_before == wiki_after, "ingest must not mutate wiki files in proposal mode"
    assert state_before == state_after, "ingest must not mutate state files in proposal mode"

    # ingest_v2.sh prints "proposal written: <path>" on stdout; parse and verify.
    proposal_lines = [line for line in result.stdout.splitlines() if line.startswith("proposal written:")]
    assert proposal_lines, f"expected ingest_v2.sh to print 'proposal written: <path>' on stdout. stdout={result.stdout}"
    proposal_path = Path(proposal_lines[0].split("proposal written:", 1)[1].strip())
    assert proposal_path.exists(), f"proposal.md does not exist at {proposal_path}"
    assert (proposal_path.parent / "proposal.json").exists(), "proposal.json must accompany proposal.md"
```

- [ ] **Step 2: Run — expect FAIL**

Run: `python3 -m pytest tests/test_ingest_proposal.py -v`
Expected: FAIL (current ingest_v2.sh is a copy of v1 and writes to wiki).

- [ ] **Step 3: Commit**

```bash
git add tests/test_ingest_proposal.py
git commit -m "test: add failing test for ingest_v2 proposal flow"
```

### Task 6.3: Rewrite ingest_v2.sh body to produce a proposal

**Files:**
- Modify: `scripts/ingest_v2.sh`

- [ ] **Step 1: Read the current ingest_v2.sh (currently a copy of v1) to understand its interface and argument parsing**

Run: `cat scripts/ingest_v2.sh`

- [ ] **Step 2: Rewrite the body so ingest_v2 produces a proposal and does not mutate the wiki**

Target behavior:

1. Parse `--project`, `--project-dir <abs-path>`, `--global`, `--model`, `--auto`, and `--source <path>` flags. `--model` preserves the Codex/Claude selector: it accepts `codex`, `codex/<id>`, `claude`, `claude/<id>`, or a legacy bare model id (which is passed to Codex). The default when `--model` is not given is Codex. `--project-dir` overrides the default project lookup (`ROOT_DIR/projects/<key>`) and is used primarily by tests. Pass both `--model` and `--project-dir` through to every `stage_runner.sh` invocation in this script, and pass them through to `scripts/ingest_apply.sh` in the `--auto` branch.
2. Resolve the target source: **one source per run**. If `--source` is given, use that path. Otherwise list `projects/<key>/inbox/` (or `raw/inbox/`) and require exactly one file. If the inbox has zero files, exit with a clear message. If the inbox has more than one, print their names and instruct the user to pass `--source` to pick one, then exit non-zero. This matches the spec's non-goal of multi-source batched ingest.
3. Create `artifacts/runs/<timestamp>-ingest-<project>/` (or `...-ingest-global/`).
4. Process the single source:
   - Read the source.
   - Classify via LLM. Write classification JSON into the run dir.
   - Decompose into units via LLM. Write `units.json` into the run dir.
   - Map each unit to an existing-or-new page path via LLM. Write `mapping.json` into the run dir.
   - Render both `proposal.md` (human review) and `proposal.json` (machine apply) using the schema from `docs/INGEST_PROPOSAL_FORMAT.md` (Task 6.7). `proposal.json` has a single top-level `"source"` field (not an array).
5. Emit a line to stdout in the exact form `proposal written: <absolute-path-to-proposal.md>`. Tests parse this line to locate the run directory.
6. Exit (or pass through to apply if `--auto` is set — wired in Task 6.6).

Stub guard for testing: honor `LLM_WIKI_INGEST_PLAN_STUB=1` by emitting a deterministic proposal derived from the source filename and its first H1 line, without calling the LLM. The stub produces a `proposal.json` with one `"create"` unit targeting `wiki/systems/<slug>.md`, and a matching `proposal.md`. The slug is derived from the source filename (`session-note.md` → `session-note`).

Do not modify wiki pages, state files, or preserved `sources/` in this script. All mutation is deferred to `ingest_apply.sh`.

- [ ] **Step 3: Run the test**

Run: `python3 -m pytest tests/test_ingest_proposal.py -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest_v2.sh
git commit -m "refactor(ingest_v2): emit proposal; no wiki mutation"
```

### Task 6.4: Write failing tests for ingest_apply.sh

**Files:**
- Create: `tests/test_ingest_apply.py`

- [ ] **Step 1: Create the test file**

```python
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


def _seed_proposal(tmp_project: Path, run_dir: Path) -> None:
    run_dir.mkdir(parents=True)
    # minimal proposal: one new page, one source preserve
    (run_dir / "proposal.md").write_text(
        "# Ingest Proposal\n\n"
        "## Unit 1 — NEW PAGE wiki/systems/audit-log.md\n"
        "summary: introduces audit-log module\n"
        "source: inbox/session-note.md\n"
    )
    (run_dir / "proposal.json").write_text(json.dumps({
        "source": "inbox/session-note.md",
        "source_id": "src-session-20260417",
        "source_kind": "session-note",
        "units": [
            {
                "action": "create",
                "page_path": "wiki/systems/audit-log.md",
                "page_type": "system",
                "summary": "introduces audit-log module",
                "content": "# Audit Log\n\nAudit log module.\n",
            }
        ],
    }))
    (tmp_project / "inbox" / "session-note.md").write_text("# Session Note\n")


def test_ingest_apply_creates_new_page_and_preserves_source(repo_root: Path, tmp_project: Path) -> None:
    project_root = tmp_project.parent.parent
    run_dir = project_root / "artifacts" / "runs" / "20260417-120000-ingest-sample"
    _seed_proposal(tmp_project, run_dir)

    env = os.environ.copy()
    env["LLM_WIKI_SEMANTIC_SKIP"] = "1"
    result = subprocess.run(
        ["bash", str(repo_root / "scripts" / "ingest_apply.sh"),
         "--project", "sample",
         "--project-dir", str(tmp_project),
         "--run-dir", str(run_dir)],
        capture_output=True, text=True, env=env,
    )
    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"

    new_page = tmp_project / "wiki" / "systems" / "audit-log.md"
    assert new_page.exists()

    preserved = tmp_project / "sources" / "session-note.md"
    assert preserved.exists()

    pages = json.loads((tmp_project / "state" / "pages.json").read_text())
    paths = {p["path"] for p in pages["pages"]}
    assert "wiki/systems/audit-log.md" in paths

    sources = json.loads((tmp_project / "state" / "sources.json").read_text())
    ids = {s["source_id"] for s in sources["sources"]}
    assert "src-session-20260417" in ids

    changelog = (tmp_project / "changelog.md").read_text()
    assert "audit-log.md" in changelog
```

- [ ] **Step 2: Run — expect FAIL (script does not exist)**

Run: `python3 -m pytest tests/test_ingest_apply.py -v`
Expected: FAIL with "No such file or directory".

- [ ] **Step 3: Commit**

```bash
git add tests/test_ingest_apply.py
git commit -m "test: add failing test for ingest_apply"
```

### Task 6.5: Implement scripts/ingest_apply.sh

**Files:**
- Create: `scripts/ingest_apply.sh`
- Modify: `Makefile`

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/ingest_apply.sh --project <project-key> --run-dir <run-dir> [--project-dir <abs-path>] [--model <model>]

--project-dir overrides the default project lookup (ROOT_DIR/projects/<key>).
Used mainly by tests to point at a temp fixture.

--model preserves the Codex/Claude selector used elsewhere (codex | codex/<id> | claude | claude/<id>).
It is forwarded to the post-ingest lint so the semantic validator uses the same backend.
EOF
}

die() { echo "error: $*" >&2; exit 1; }

project_key=""
run_dir=""
project_dir_override=""
model=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) shift; [[ $# -gt 0 ]] || die "--project requires a value"; project_key="$1"; shift ;;
    --run-dir) shift; [[ $# -gt 0 ]] || die "--run-dir requires a value"; run_dir="$1"; shift ;;
    --project-dir) shift; [[ $# -gt 0 ]] || die "--project-dir requires a value"; project_dir_override="$1"; shift ;;
    --model) shift; [[ $# -gt 0 ]] || die "--model requires a value"; model="$1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$project_key" ]] || die "--project is required"
[[ -n "$run_dir" && -d "$run_dir" ]] || die "--run-dir must point to an existing directory"

if [[ -n "$project_dir_override" ]]; then
  project_dir="$project_dir_override"
else
  project_dir="$ROOT_DIR/projects/$project_key"
fi
[[ -d "$project_dir" ]] || die "project does not exist: $project_dir"

proposal_json="$run_dir/proposal.json"
[[ -f "$proposal_json" ]] || die "missing proposal.json in run-dir"

python3 - "$project_dir" "$proposal_json" <<'PY'
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

project_dir = Path(sys.argv[1])
proposal = json.loads(Path(sys.argv[2]).read_text())

pages_file = project_dir / "state" / "pages.json"
sources_file = project_dir / "state" / "sources.json"
changelog_file = project_dir / "changelog.md"

pages_data = json.loads(pages_file.read_text())
sources_data = json.loads(sources_file.read_text())

source_rel = proposal["source"]
source_id = proposal["source_id"]
source_kind = proposal["source_kind"]

# Preserve the source
source_src = project_dir / source_rel
assert source_src.exists(), f"source missing on disk: {source_src}"
preserved_dir = project_dir / "sources"
preserved_dir.mkdir(exist_ok=True)
preserved_path = preserved_dir / Path(source_rel).name
shutil.copy2(source_src, preserved_path)

touched_pages: list[str] = []

for unit in proposal["units"]:
    page_rel = unit["page_path"]
    page_abs = project_dir / page_rel
    if unit["action"] == "create":
        page_abs.parent.mkdir(parents=True, exist_ok=True)
        page_abs.write_text(unit["content"])
        pages_data["pages"].append({
            "path": page_rel,
            "type": unit.get("page_type", "unknown"),
            "summary": unit.get("summary", ""),
            "linked_sources": [source_id],
            "linked_topics": [],
            "last_reviewed_at": datetime.utcnow().isoformat() + "Z",
            "freshness_status": "baseline-validated",
            "baseline_pass": True,
        })
    elif unit["action"] == "update":
        existing = page_abs.read_text() if page_abs.exists() else ""
        page_abs.write_text(existing.rstrip() + "\n\n" + unit.get("content", ""))
        for entry in pages_data["pages"]:
            if entry["path"] == page_rel:
                if source_id not in entry["linked_sources"]:
                    entry["linked_sources"].append(source_id)
                entry["last_reviewed_at"] = datetime.utcnow().isoformat() + "Z"
                entry["freshness_status"] = "baseline-validated"
                entry["baseline_pass"] = True
                break
    else:
        raise SystemExit(f"unknown unit action: {unit['action']}")
    touched_pages.append(page_rel)

sources_data["sources"].append({
    "source_id": source_id,
    "original_path": Path(source_rel).name,
    "source_kind": source_kind,
    "project_key": project_dir.name,
    "status": "processed",
    "derived_pages": touched_pages,
    "ingested_at": datetime.utcnow().isoformat() + "Z",
})

pages_file.write_text(json.dumps(pages_data, indent=2))
sources_file.write_text(json.dumps(sources_data, indent=2))

with changelog_file.open("a") as f:
    f.write(f"\n## [{datetime.utcnow().strftime('%Y-%m-%d')}] ingest | {source_rel}\n")
    for p in touched_pages:
        f.write(f"- touched: {p}\n")

# Remove the source from the inbox (it is now preserved)
source_src.unlink()

print(f"applied {len(touched_pages)} unit(s), source preserved at {preserved_path}")
PY

# Post-ingest lint (advisory). This invokes the semantic validator unless
# LLM_WIKI_SEMANTIC_SKIP=1 is set in the calling environment. Announce the
# side effect so the user knows an LLM call may happen here.
if [[ "${LLM_WIKI_SEMANTIC_SKIP:-0}" != "1" ]]; then
  echo "running post-ingest lint (invokes semantic validator; set LLM_WIKI_SEMANTIC_SKIP=1 to skip)"
fi
lint_args=(--project "$project_key")
if [[ -n "$project_dir_override" ]]; then
  lint_args+=(--project-dir "$project_dir_override")
fi
if [[ -n "$model" ]]; then
  lint_args+=(--model "$model")
fi
"$ROOT_DIR/scripts/lint.sh" "${lint_args[@]}" || true
```

Make executable: `chmod +x scripts/ingest_apply.sh`

- [ ] **Step 2: Add `ingest-apply` target to Makefile with MODEL passthrough**

```makefile
ingest-apply:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@test -n "$(RUN)" || (echo "RUN is required (path to artifacts/runs/<dir>)" && exit 1)
	@./scripts/ingest_apply.sh --project "$(PROJECT)" --run-dir "$(RUN)" $(if $(MODEL),--model "$(MODEL)",)
```

Update `.PHONY` and help.

- [ ] **Step 3: Run the test**

Run: `python3 -m pytest tests/test_ingest_apply.py -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest_apply.sh Makefile
git commit -m "feat: add ingest_apply script and make target"
```

### Task 6.6: Wire --auto flag in scripts/ingest_v2.sh

**Files:**
- Modify: `scripts/ingest_v2.sh`
- Modify: `Makefile`

- [ ] **Step 1: Add `--auto` argument parsing in ingest_v2.sh**

Extend the argument loop to accept `--auto` and set a flag variable `auto_apply=1`.

- [ ] **Step 2: At the end of proposal emission, if `auto_apply=1`, invoke ingest_apply.sh — forwarding the MODEL selector**

```bash
if [[ "${auto_apply:-0}" == "1" ]]; then
  echo "--auto: applying proposal immediately"
  apply_args=(--project "$project_key" --run-dir "$run_dir")
  if [[ -n "$project_dir_override" ]]; then
    apply_args+=(--project-dir "$project_dir_override")
  fi
  if [[ -n "$model" ]]; then
    apply_args+=(--model "$model")
  fi
  "$ROOT_DIR/scripts/ingest_apply.sh" "${apply_args[@]}"
  echo "--- AUTO INGEST SUMMARY ---"
  echo "run: $run_dir"
  python3 -c "
import json
data = json.load(open('$run_dir/proposal.json'))
units = data.get('units', [])
created = sum(1 for u in units if u.get('action') == 'create')
updated = sum(1 for u in units if u.get('action') == 'update')
print(f'pages created: {created}')
print(f'pages updated: {updated}')
"
fi
```

- [ ] **Step 3: Confirm the `ingest-v2` Makefile target already supports `AUTO`**

The transitional target added in Task 6.1 already has `$(if $(AUTO),--auto,)`. Verify:

```bash
grep -A 3 "^ingest-v2:" Makefile
```

Usage becomes: `make ingest-v2 PROJECT=foo AUTO=1 MODEL=claude`. Both `MODEL` and `AUTO` are optional and independent.

- [ ] **Step 4: Add an `--auto` smoke test (required, not optional)**

`--auto` is the only path that skips human review, so it must have an automated smoke test. The existing stub infrastructure (`LLM_WIKI_INGEST_PLAN_STUB=1`, `LLM_WIKI_SEMANTIC_SKIP=1`, the `tmp_project` fixture) makes this straightforward. Append to `tests/test_ingest_proposal.py`:

```python
def test_ingest_v2_auto_applies_immediately(repo_root: Path, tmp_project: Path) -> None:
    source_path = tmp_project / "inbox" / "session-note.md"
    source_path.write_text("# Session Note\n\nWorked on audit-log.\n")

    env = os.environ.copy()
    env["LLM_WIKI_INGEST_PLAN_STUB"] = "1"
    env["LLM_WIKI_SEMANTIC_SKIP"] = "1"
    result = subprocess.run(
        ["bash", str(repo_root / "scripts" / "ingest_v2.sh"),
         "--project", "sample",
         "--project-dir", str(tmp_project),
         "--auto"],
        capture_output=True, text=True, env=env,
    )
    assert result.returncode == 0, f"stdout={result.stdout} stderr={result.stderr}"

    # Wiki was mutated
    wiki_pages = list(tmp_project.glob("wiki/**/*.md"))
    assert wiki_pages, "auto-ingest must have created at least one wiki page"

    # --auto summary line is present
    assert "--- AUTO INGEST SUMMARY ---" in result.stdout
    assert "pages created:" in result.stdout
```

Run: `python3 -m pytest tests/test_ingest_proposal.py::test_ingest_v2_auto_applies_immediately -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest_v2.sh Makefile tests/
git commit -m "feat(ingest_v2): add --auto fast path"
```

### Task 6.7: Document proposal format

**Files:**
- Create: `docs/INGEST_PROPOSAL_FORMAT.md`

- [ ] **Step 1: Write the format reference**

Content:

```markdown
# Ingest Proposal Format

An ingest proposal lives under `artifacts/runs/<timestamp>-ingest-<project>/` and contains two files.

## proposal.md

Human-readable summary for review. One section per unit. Format:

    ## Unit <N> — <ACTION> <page_path>
    summary: <one-line summary>
    source: <inbox-relative path>
    <optional body: reasoning, extracted text>

ACTION is `NEW PAGE` or `UPDATE PAGE`.

## proposal.json

Machine-readable payload consumed by `scripts/ingest_apply.sh`:

    {
      "source": "inbox/<filename>",
      "source_id": "<stable id>",
      "source_kind": "session-note|spec|design|...",
      "units": [
        {
          "action": "create|update",
          "page_path": "wiki/<shelf>/<name>.md",
          "page_type": "system|module|integration|...",
          "summary": "<one-line summary>",
          "content": "<markdown content to write (create) or append (update)>"
        }
      ]
    }

## Review Workflow

1. `make ingest PROJECT=<key>` — emits proposal, no mutation.
2. Review `proposal.md` in Obsidian or your editor.
3. Edit `proposal.json` to reject or modify units (delete from `units` array to reject).
4. `make ingest-apply PROJECT=<key> RUN=<run-dir>` — applies the approved proposal.

## Fast Path

`make ingest PROJECT=<key> AUTO=1` skips the review and applies immediately. Reserved for sources the user trusts (typically their own session notes). Prints a summary of pages created and updated on completion.
```

- [ ] **Step 2: Commit**

```bash
git add docs/INGEST_PROPOSAL_FORMAT.md
git commit -m "docs: document ingest proposal format"
```

### Task 6.8: Dogfood ingest_v2 against a real session note

**Files:** none authored — this is an operational task. The output is a real ingest commit.

This task validates that `ingest_v2.sh` works end-to-end against a live project before the cutover in Task 6.9. The user picks the project (default: `rpg_game`).

- [ ] **Step 1: Drop one real session note into the project inbox**

Choose or write a real session note about recent work. Save as `projects/<key>/inbox/session-<date>.md`. Example for `rpg_game`:

```bash
ls projects/rpg_game/inbox/
# place session-2026-04-17.md there with real content
```

- [ ] **Step 2: Run the proposal step**

```bash
make ingest-v2 PROJECT=rpg_game
```

Expected: stdout includes `proposal written: <path>`. No mutation under `projects/rpg_game/wiki/` or `projects/rpg_game/state/`.

- [ ] **Step 3: Review the proposal**

Open `proposal.md` in Obsidian (or an editor). Confirm the units, page paths, and summaries match what you expected. Edit `proposal.json` if you want to reject a unit.

- [ ] **Step 4: Apply**

```bash
make ingest-apply PROJECT=rpg_game RUN=<absolute-path-to-run-dir>
```

Expected: pages created/updated, source preserved under `projects/rpg_game/sources/`, `pages.json` and `sources.json` updated, changelog entry appended.

- [ ] **Step 5: Verify in Obsidian**

Open the project vault in Obsidian. Confirm the new/updated pages render correctly and the citations resolve. If anything looks wrong, do not proceed to Task 6.9 — diagnose first.

- [ ] **Step 6: Commit the resulting wiki updates as a real ingest**

```bash
git add projects/rpg_game/
git commit -m "ingest: dogfood ingest_v2 with real session note"
```

### Task 6.9: Flip ingest target to v2 and delete the old script

**Files:**
- Modify: `Makefile`
- Delete: `scripts/ingest.sh`
- Rename: `scripts/ingest_v2.sh` → `scripts/ingest.sh`

This task only runs once Task 6.8 has passed.

- [ ] **Step 1: Delete the old script and rename v2 into its place**

```bash
git rm scripts/ingest.sh
git mv scripts/ingest_v2.sh scripts/ingest.sh
```

- [ ] **Step 2: Update the Makefile**

The existing `ingest` target invocation already calls `./scripts/ingest.sh`, which now points at the v2 body after the rename. Remove the transitional `ingest-v2` target (it becomes redundant) and remove `ingest-v2` from `.PHONY` and the help text. Confirm the `ingest` target still has the `MODEL` and `AUTO` passthrough:

```makefile
ingest:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@./scripts/ingest.sh --project "$(PROJECT)" $(if $(MODEL),--model "$(MODEL)",) $(if $(AUTO),--auto,)
```

- [ ] **Step 3: Update tests**

`tests/test_ingest_proposal.py` references `scripts/ingest_v2.sh`. After the rename, update the test to point at `scripts/ingest.sh`. Same for any `--auto` test added in Task 6.6.

```bash
sed -i '' 's/ingest_v2.sh/ingest.sh/g' tests/test_ingest_proposal.py tests/test_ingest_apply.py 2>/dev/null || true
```

- [ ] **Step 4: Run the full test suite**

```bash
python3 -m pytest tests/ -v
```

Expected: all tests pass. Especially `test_ingest_proposal.py` and `test_ingest_apply.py`.

- [ ] **Step 5: Commit**

```bash
git add scripts/ Makefile tests/
git commit -m "refactor(ingest): promote ingest_v2 to ingest; delete old ingest script"
```

---

## Phase 7 — Disposable Cold Test + Canonical Rebootstrap

The cold test runs against a disposable copy of the canonical project first. The canonical `projects/rpg_game/` is only wiped after the copy passes validation.

### Task 7.1: Disposable cold test against a copy of rpg_game

**Files:**
- Create (temporary): `projects/rpg_game_test/`

**Why this comes first:** running the new bootstrap pipeline against the canonical `projects/rpg_game/` directly risks losing the existing wiki if anything breaks. Bootstrap against a disposable copy first; only wipe canonical state after the copy passes. The simplest way to keep the orchestrator working is to copy the project to a sibling key inside `projects/` (the orchestrator already supports any registered project), rather than fighting symlinks or out-of-tree paths.

- [ ] **Step 1: Create the disposable copy inside `projects/`**

```bash
cp -R projects/rpg_game projects/rpg_game_test
```

- [ ] **Step 2: Adjust the copied `project.json` so the key reflects the new project**

```bash
sed -i '' 's/"key": "rpg_game"/"key": "rpg_game_test"/' projects/rpg_game_test/state/project.json
sed -i '' 's/"name": "[^"]*"/"name": "RPG Game (test copy)"/' projects/rpg_game_test/state/project.json
```

Other operator-owned fields (`repo_paths`, `tags`, `bootstrap_focuses`, `entry_pages`, `related_concepts`, `ignored_paths`) remain unchanged so the bootstrap exercises the same surface as the canonical project.

- [ ] **Step 3: Wipe the copy's wiki and state for a true cold rebootstrap**

```bash
rm -rf projects/rpg_game_test/wiki
mkdir -p projects/rpg_game_test/wiki/{architecture,systems,modules,integrations,decisions,runbooks,sessions,glossary,open-questions}
for f in pages relationships sources freshness bootstrap-state; do
  cp templates/state/${f}.template.json projects/rpg_game_test/state/${f}.json
done
sed -i '' 's/{{project_key}}/rpg_game_test/g' projects/rpg_game_test/state/*.json 2>/dev/null || true
sed -i '' 's/<project-key>/rpg_game_test/g' projects/rpg_game_test/state/*.json 2>/dev/null || true
```

- [ ] **Step 4: Run bootstrap against the copy**

```bash
make bootstrap PROJECT=rpg_game_test
```

Expected: all five stages complete. Stage 4 (validation) passes (structural + semantic with zero blockers). Stage 5 runs only if Stage 4 reports blockers; the orchestrator re-runs Stage 4 afterwards. Allow up to two reconcile cycles before investigating whether a finding is a genuine gap vs. an LLM false positive.

- [ ] **Step 5: Run standalone lint on the copy**

```bash
make lint PROJECT=rpg_game_test
```

Expected: exit 0, no blocker findings.

- [ ] **Step 6: Inspect the generated wiki for the copy in Obsidian**

Open `projects/rpg_game_test/wiki/` in an editor or Obsidian. Verify:

- `index.md` exists with a non-empty shelf listing
- at least one page under `wiki/architecture/`
- multiple pages under `wiki/systems/` and/or `wiki/modules/` reflecting actual repo subsystems
- no page contains banned vocabulary from the old contract (run the banned-vocab test on `wiki/` too if helpful)

- [ ] **Step 7: If anything fails, diagnose without touching canonical state**

Do not proceed to Task 7.3 until the copy bootstraps cleanly. The canonical `projects/rpg_game/` is untouched at this point and can still be opened in Obsidian as the existing wiki.

- [ ] **Step 8: Remove the disposable copy**

Once Step 6 passes, the copy has served its purpose:

```bash
rm -rf projects/rpg_game_test
```

No commit is required for the copy itself — it was scratch work. If anything notable was learned during the test, capture it as a session note for the canonical project.

### Task 7.2: Verify `make init` does not pre-create prescribed pages

**Files:** (verification only, no new files)

This task exists because Phase 1 Task 1.4 was supposed to remove any logic in `scripts/init_project.sh` that pre-creates `wiki/architecture/system-overview.md`. Before rebootstrapping the canonical project, re-confirm the init is domain-neutral.

- [ ] **Step 1: Run init against a throwaway project key**

```bash
make init PROJECT=init_smoke_test NAME="init smoke test" 2>&1 | tail -20
```

- [ ] **Step 2: Inspect the generated project**

```bash
ls projects/init_smoke_test/wiki/architecture/
```

Expected: either an empty directory, or a directory without `system-overview.md`. If the file is present, revisit Phase 1 Task 1.4 — the init is still hardcoding the page.

- [ ] **Step 3: Clean up**

```bash
rm -rf projects/init_smoke_test
```

- [ ] **Step 4: Commit** (no file changes, but record the verification in changelog if desired; otherwise skip.)

### Task 7.3: Canonical wipe and rebootstrap of rpg_game

**Files:**
- Modify: `projects/rpg_game/wiki/` (wipe)
- Modify: `projects/rpg_game/state/pages.json|sources.json|relationships.json|freshness.json|bootstrap-state.json` (reset)
- Preserve: `projects/rpg_game/state/project.json`
- Preserve: `projects/rpg_game/changelog.md`
- Preserve: `projects/rpg_game/inbox/` contents if any
- Preserve: `projects/rpg_game/sources/` contents

**Pre-condition:** Task 7.1 passed against the disposable copy.

- [ ] **Step 1: Back up current state as a safety net**

```bash
mkdir -p /tmp/rpg_game-backup
cp -R projects/rpg_game /tmp/rpg_game-backup/
```

- [ ] **Step 2: Wipe the wiki tree**

```bash
rm -rf projects/rpg_game/wiki
mkdir -p projects/rpg_game/wiki/{architecture,systems,modules,integrations,decisions,runbooks,sessions,glossary,open-questions}
```

- [ ] **Step 3: Reset state files (preserve project.json)**

For each of `pages.json`, `sources.json`, `relationships.json`, `freshness.json`, `bootstrap-state.json`, copy the template from `templates/state/` into place:

```bash
for f in pages relationships sources freshness bootstrap-state; do
  cp templates/state/${f}.template.json projects/rpg_game/state/${f}.json
done
```

If a template contains `{{project_key}}` or similar placeholders, substitute `rpg_game` with `sed -i ''` (macOS):

```bash
sed -i '' 's/{{project_key}}/rpg_game/g' projects/rpg_game/state/*.json
```

- [ ] **Step 4: Append a changelog entry marking the reset**

Append to `projects/rpg_game/changelog.md`:

```markdown

## [2026-04-17] reset | wiki wiped for domain-neutral rebootstrap

- preserved: project.json, changelog history, inbox, sources
- wiped: wiki/, all state files except project.json
- next: make bootstrap PROJECT=rpg_game under new contract
```

- [ ] **Step 5: Commit the reset**

```bash
git add projects/rpg_game/
git commit -m "reset: wipe rpg_game wiki and state for domain-neutral rebootstrap"
```

- [ ] **Step 6: Run bootstrap**

```bash
make bootstrap PROJECT=rpg_game
```

Expected: all five stages complete. Stage 4 (validation) reports pass (structural + semantic with zero blockers). Stage 5 (reconcile) is skipped or completes cleanly. Note: the semantic validator is nondeterministic — if it returns blocker findings, Stage 5 will run; the orchestrator re-runs Stage 4 afterwards. Allow up to two reconcile cycles before investigating whether a finding is a genuine gap vs. an LLM false positive.

- [ ] **Step 7: Inspect the generated wiki manually**

Open `projects/rpg_game/wiki/` in an editor or Obsidian. Verify:

- `index.md` exists with a non-empty shelf listing
- at least one page under `wiki/architecture/`
- multiple pages under `wiki/systems/` and/or `wiki/modules/` reflecting actual repo subsystems
- no page contains banned vocabulary from the old contract

- [ ] **Step 8: Run the standalone lint once more**

```bash
make lint PROJECT=rpg_game
```

Expected: exit 0, no blocker findings.

- [ ] **Step 9: Run the pytest suite**

```bash
python3 -m pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 10: Append a changelog entry marking the successful rebootstrap**

Append to `projects/rpg_game/changelog.md`:

```markdown

## [2026-04-17] rebootstrap | passed under new contract

- five stages completed
- validation passed with zero blockers
- contract: domain-neutral (post bootstrap-ingest redesign)
```

- [ ] **Step 11: Commit**

```bash
git add projects/rpg_game/
git commit -m "chore: rebootstrap rpg_game under new contract, validation passes"
```

---

## Final Verification

- [ ] **Step 1: Full test suite green**

```bash
python3 -m pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 2: Spec coverage check**

Re-read `docs/superpowers/specs/2026-04-17-bootstrap-ingest-redesign-design.md` and confirm each requirement in "Success Criteria" is addressed by a task in this plan:

- AGENTS.md / V1_SPEC.md free of banned vocabulary → Phase 1 Task 1.1–1.3 (test + strips)
- Scaffolding decoupled from prescribed architecture filename → Phase 1 Task 1.4 (init / template / validator) + Task 1.5 (verification)
- rpg_game cold bootstrap passes → Phase 7 Task 7.1 (disposable copy), Task 7.3 (canonical)
- `make init` does not pre-create prescribed pages → Phase 1 Task 1.5, Phase 7 Task 7.2
- Non-game repo bootstrap works without contract edits → **explicitly deferred**. This is a spec Success Criterion but requires access to a non-game repo you are willing to wiki as a second cold test. Track as an open question; when ready, repeat Phase 7 against the second repo.
- `make lint` runs standalone → Phase 3 Task 3.5 (state shape) + Phase 5 Task 5.1–5.2 (script + target)
- Ingest produces proposal, does not mutate → Phase 6 Task 6.1–6.3 (scaffold + test + rewrite)
- `make ingest-apply` applies proposal → Phase 6 Task 6.4–6.5
- `make ingest AUTO=1` skips gate and summarizes → Phase 6 Task 6.6
- ingest_v2 dogfooded and old ingest deleted → Phase 6 Task 6.8 (dogfood) + Task 6.9 (flip and delete)
- Scope declared in SYSTEM_DESIGN / README / AGENTS → Phase 0 Task 0.1–0.2
- MODEL selector preserved across new commands (`lint`, `ingest`, `ingest-apply`) → Phase 5 Task 5.2, Phase 6 Task 6.3, 6.5 (see "MODEL passthrough" note in Notes for the Implementer)

- [ ] **Step 3: Open follow-ups (not blocking this plan)**

Record in `projects/llm-wiki-self/wiki/open-questions/post-redesign.md` (or a similar location the user maintains) if these were not handled:

- Bootstrap a non-game repo to verify domain-neutrality in practice
- Auto-fix action for lint findings
- Concrete token-reduction measurement once the query op is built

---

## Notes for the Implementer

- The project is bash + embedded Python 3 heredocs. When editing `scripts/*.sh`, keep the shell vs Python split clean — no mixing business logic into shell when the Python block already owns that responsibility.
- `agents/bootstrap/_shared/stage_runner.sh` is the dispatch layer to the LLM agent. Its exact CLI is authoritative — read it before adding any new flag or output convention. Do not guess. The only flags it accepts are: `--project`, `--agent-dir`, `--model`, `--run-dir`, `--dry-run`, `-h|--help`. There is no `--stage-dir` and no `--output` flag — the agent's output path is controlled by the `summary_file` field in `agent.json` plus whatever the agent writes directly per its instructions.
- **MODEL passthrough is a cross-cutting concern.** The existing `make bootstrap` / `make ingest` / `make ingest-global` targets already accept `MODEL=<selector>` and pass it through to `stage_runner.sh`. Every new shell script and Makefile target introduced by this plan (`scripts/lint.sh`, `scripts/ingest_apply.sh`, `scripts/ingest_v2.sh`, and the rewritten `scripts/ingest.sh` after the Phase 6 cutover) must accept `--model` and forward it to every `stage_runner.sh` invocation. The Makefile targets (`lint`, `ingest-apply`, transitional `ingest-v2`, and the post-cutover `ingest`) must preserve the `$(if $(MODEL),--model "$(MODEL)",)` pattern. Default backend is Codex; `claude` and `claude/<id>` are supported per the existing stage_runner logic. Do not hardcode a backend anywhere.
- **`--project-dir` override pattern.** `scripts/validate.sh`, `scripts/lint.sh`, `scripts/ingest_v2.sh`, and `scripts/ingest_apply.sh` all accept `--project-dir <abs-path>` to override the default `ROOT_DIR/projects/<key>` lookup. Tests use this to point the scripts at pytest temp fixtures. Forward the override through any nested invocation (e.g., `ingest_apply.sh` calling `lint.sh`).
- Every LLM-invoking step must have a deterministic stub path gated by an environment variable (`LLM_WIKI_SEMANTIC_SKIP`, `LLM_WIKI_INGEST_PLAN_STUB`) so the pytest suite runs offline and cheaply.
- The `validate.sh` variable that collects error strings is named `errors` (not `failures`). Every new check added in Phase 3 must append to `errors`.
- **Phase 1 is one logical tranche.** Commits happen per file, but no Phase 2 work begins until Task 1.5's end-of-tranche verification passes. A fresh `make init` must succeed under the new contract before stage instructions are rewritten.
- **Phase 6 dual-path discipline.** Throughout Phase 6 Tasks 6.1–6.8, `scripts/ingest.sh` (the old script) stays untouched and `make ingest` still invokes it. The new code lives in `scripts/ingest_v2.sh` invoked via `make ingest-v2`. Only Task 6.9 deletes the old script and promotes v2 in its place. Do not maintain two parallel ingests beyond Phase 6.
- **Phase 7 disposable-copy discipline.** Never run the new bootstrap against canonical `projects/rpg_game/` until the disposable `projects/rpg_game_test/` copy passes Task 7.1. The backup in Task 7.3 Step 1 is a second safety net, not the first.
- Commit after every green step. Do not batch multiple green states into a single commit.
- The plan assumes no git commits exist yet on `main` at the time the implementation begins. If the user has made an initial commit in the meantime, the task flow is unchanged — continue committing per step.
