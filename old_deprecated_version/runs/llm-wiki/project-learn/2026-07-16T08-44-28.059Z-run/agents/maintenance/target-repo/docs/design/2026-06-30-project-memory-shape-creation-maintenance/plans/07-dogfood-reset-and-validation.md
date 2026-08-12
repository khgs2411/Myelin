# Chunk 07: Dogfood Reset And Validation

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `02-create-mode-documentation-contract.md`, `05-maintain-mode-section-first-apply.md`, `06-project-memory-markdown-query.md`
**Enables:** None

## Goal

Validate the full Step 4 shape by recreating and maintaining `llm-wiki` Project Memory with the new documentation contract, indexing Project Memory retrieval rows, querying the markdown-backed project layer, and recording whether the result is useful living repo documentation.

## Source Artifacts

- `../spec.md`: full acceptance target and `Testing Strategy`.
- `../agenda.md`: dogfood recommendations from design and roadmap audits.
- `../plans/02-create-mode-documentation-contract.md`, `../plans/05-maintain-mode-section-first-apply.md`, `../plans/06-project-memory-markdown-query.md`.
- Current repo docs: `MYELIN.md`, `CONTEXT.md`, `docs/ROADMAP.md`, relevant ADRs, `src/project/`, `src/memory/`, `src/query/`, `src/commands/`.
- Commands: `bun test`, `bun run typecheck`, `bun src/cli.ts project learn llm-wiki`, `bun src/cli.ts memory index project llm-wiki`, `bun src/cli.ts memory query llm-wiki "how does project learn work?" --layer project --json`.

## Relationships

- **Depends on:** Creation quality, maintenance section-first apply, and Project Memory query chunks.
- **Enables:** User-facing confidence that Step 4 works on this repo's own memory layer.
- **Shared contracts:** Run artifacts, Project Memory wiki pages, state metadata, retrieval index rows, query response shape.
- **Integration points:** Real `llm-wiki` project config, provider-backed curator, markdown apply journal, retrieval index, query CLI.

## Resolved Decisions For Execution

- Dogfood reset is non-destructive: archive the current shallow Project Memory wiki and state under `projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/` before creating a clean wiki directory.
- Chunk 07 must not move or archive files until the execution preflight explicitly confirms that dogfood reset is in the selected scope and the user accepts the reset operation.
- If `projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/` already exists, stop before moving files and ask for a new baseline directory name.
- Create-mode proof is mandatory before provider execution: after reset, `projects/llm-wiki/state/project-memory.json` must be absent and `projects/llm-wiki/wiki/` must exist but contain no markdown pages. Since current `bootstrap-state.json` is `uncurated`, `project learn` should enter create mode.
- If `bootstrap-state.json` is no longer `uncurated` at execution time, stop before running the provider and return to planning because the create-mode forcing mechanism has changed.

## File Responsibility Map

**Create:**
- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/dogfood-validation.md` - manual validation record, command outputs summary, accepted gaps.

**Modify:**
- `projects/llm-wiki/wiki/*` - generated Project Memory pages from `project learn`.
- `projects/llm-wiki/state/project-memory.json` - curated state with content quality and retrieval readiness.
- `projects/llm-wiki/state/project-memory-source-consumptions.json` - source terminal decisions from maintenance.
- `docs/ROADMAP.md` - update Step 4 status only if user asks to record roadmap progress after validation.

**Test:**
- Existing automated tests from chunks 01-06.
- Manual query prompts listed below.

## Implementation Tasks

### Task 1: Establish pre-dogfood baseline

**Files:**
- Create: `docs/design/2026-06-30-project-memory-shape-creation-maintenance/dogfood-validation.md`

- [ ] **Step 1: Record baseline**

Write a validation file with:

```md
# Project Memory Step 4 Dogfood Validation

Project key: `llm-wiki`
Date: 2026-06-30
Baseline shallow wiki state: recorded before reset/recreate

## Baseline Checks

- Existing wiki page count:
- Existing project-memory state:
- Existing retrieval index status:
```

Use exact commands and paste concise outputs:

```bash
find projects/llm-wiki/wiki -maxdepth 2 -type f -name '*.md' | sort
bun src/cli.ts memory index project llm-wiki --json
```

### Task 2: Recreate Project Memory through the real provider path

**Files:**
- Modify: `projects/llm-wiki/wiki/*`
- Modify: `projects/llm-wiki/state/project-memory.json`
- Create run artifacts under the `projects/llm-wiki/runs/project-learn/` run directory reported by the command output.

- [ ] **Step 1: Archive the current Project Memory baseline**

Do not run these commands until execution preflight confirms chunk 07 scope and the user accepts the dogfood reset operation.

Run:

```bash
test ! -e projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4
mkdir -p projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4
mv projects/llm-wiki/wiki projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/wiki-before-reset
mv projects/llm-wiki/state/project-memory.json projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/project-memory-before-reset.json
mkdir -p projects/llm-wiki/wiki
```

If `projects/llm-wiki/state/project-memory-source-consumptions.json` or `projects/llm-wiki/state/project-memory-retrieval/` exists, move them into the same baseline directory before running `project learn`. Use exact move commands for the observed paths and record them in `dogfood-validation.md`.

Expected:

- `test ! -e` exits 0; if it fails, stop and ask for a new baseline directory name;
- previous wiki files are preserved under `state/dogfood-baselines/2026-06-30-step4/wiki-before-reset`;
- previous curated state is preserved as `project-memory-before-reset.json`;
- `projects/llm-wiki/wiki/` exists and has no markdown files;
- `projects/llm-wiki/state/project-memory.json` is absent.

- [ ] **Step 2: Prove create mode before provider execution**

Run:

```bash
find projects/llm-wiki/wiki -maxdepth 2 -type f -name '*.md' | sort
sed -n '1,80p' projects/llm-wiki/state/bootstrap-state.json
test ! -f projects/llm-wiki/state/project-memory.json
```

Expected:

- `find` prints no markdown paths;
- `bootstrap-state.json` shows `"status": "uncurated"`;
- `test ! -f` exits 0.

If any expected signal fails, stop before provider execution.

- [ ] **Step 3: Run create path**

Run:

```bash
bun src/cli.ts project learn llm-wiki --json
```

Expected:

- terminal status is `completed` or `completed_with_pending_index`;
- output packet mode is `create`;
- `curator-validation.json` has `quality_diagnostics.content_quality.status: "trusted"`;
- `project-memory.json` has `status: "curated"` and `content_quality.status: "trusted"`;
- created wiki pages cover the six required roles.

If the run returns `needs_review`, record the quality diagnostics and stop dogfood execution for user review.

### Task 3: Run maintenance against a real lead

**Files:**
- Modify: `projects/llm-wiki/wiki/*`
- Modify: `projects/llm-wiki/state/project-memory-source-consumptions.json`

- [ ] **Step 1: Create or reuse a project candidate**

If no suitable pending candidate exists, create one through runtime inbox:

```bash
bun src/cli.ts memory inbox create llm-wiki --layer project --title "Session Memory project query shape" --body "Project Memory query should return markdown content or refs from derived retrieval hits." --rationale "Dogfood candidate for section-first Project Memory maintenance." --confidence high --risk low --evidence-ref "dogfood:step4"
```

Expected: a runtime inbox source is created.

- [ ] **Step 2: Intake and maintain**

Run:

```bash
bun src/cli.ts project learn llm-wiki --json
```

Expected:

- packet mode is `maintain`;
- maintenance item targets an existing section or creates a justified new section/page;
- source terminal decision is applied or explicit supported no-op;
- no broad page rewrite occurs.

### Task 4: Index and query Project Memory

**Files:**
- Generated retrieval state under `projects/llm-wiki/state/project-memory-retrieval/`
- SQLite memory state under `state/memory.db`

- [ ] **Step 1: Index Project Memory**

Run:

```bash
bun src/cli.ts memory index project llm-wiki --json
```

Expected:

- `structural_sections_seen` is greater than zero;
- `indexed` is greater than zero or `degraded` records an honest sqlite/provider reason;
- no trusted-content status is downgraded by retrieval readiness.

- [ ] **Step 2: Query project layer**

Run:

```bash
bun src/cli.ts memory query llm-wiki "how does session memory feed project memory?" --layer project --max-inline-chars 4000 --json
bun src/cli.ts memory query llm-wiki "how does project learn decide whether to write Project Memory?" --layer project --max-inline-chars 4000 --json
bun src/cli.ts memory query llm-wiki "what commands should an agent use to validate Project Memory?" --layer project --max-inline-chars 4000 --json
```

Expected:

- response `memory_scope` is `project_memory`;
- matches include canonical `wiki_path` and `section_id`;
- content appears inline when under threshold;
- large/stale sections return references with reasons.

### Task 5: Manual usefulness review

**Files:**
- Modify: `docs/design/2026-06-30-project-memory-shape-creation-maintenance/dogfood-validation.md`

- [ ] **Step 1: Score usefulness**

Record pass/fail for:

- role coverage: all six roles present;
- citation quality: repo-groundable claims cite repo docs/code/design artifacts;
- candidate handling: candidate text was explored and placed as documentation or explicitly no-oped;
- query behavior: project layer returns content or refs from markdown, not SQLite claims;
- future-agent utility: a fresh agent can answer the three query prompts from Project Memory without broad codebase rediscovery.

## Verification

- Run: `bun test`
  Expected: full test suite passes.
- Run: `bun run typecheck`
  Expected: no TypeScript errors.
- Run: `git diff --check`
  Expected: no whitespace errors.
- Run: `bun src/cli.ts project learn llm-wiki --json`
  Expected: trusted quality status or documented `needs_review` stop.
- Run: `bun src/cli.ts memory index project llm-wiki --json`
  Expected: indexed Project Memory sections or honest degraded retrieval readiness.
- Run: the three `memory query --layer project` prompts above.
  Expected: markdown-backed content/ref results.

## Acceptance Criteria Covered

- End-to-end creation proves the documentation contract, not only schema validity.
- Maintenance proves section-first candidate handling.
- Query proves Project Memory retrieval resolves back to markdown.
- Dogfood validation records evidence strong enough for future sessions.

## Risks And Rollback

- Risk: provider-backed run fails for model/schema reasons despite local tests. Mitigation: record exact provider error and stop before claiming completion.
- Risk: dogfood reset overwrites useful comparison evidence. Mitigation: record baseline file list and state before recreate.
- Rollback: restore previous wiki/state from git if the generated Project Memory is rejected; apply journal and run artifacts remain evidence.

## Non-Goals

- Does not add new product behavior beyond validating chunks 01-06.
- Does not synthesize final answers with an LLM.
- Does not close roadmap Step 4 unless the user asks to update roadmap status after review.

## Type And Name Consistency

Before finalizing validation, verify command names, project key, run artifact names, quality field names, and query JSON fields match the implemented chunks exactly.
