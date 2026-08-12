# Chunk 08: Live Dogfood And Acceptance

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `07-retrieval-and-legacy-curator-cleanup.md`  
**Enables:** None

## Goal

Verify the redesigned Project Memory flow with a live provider on `llm-wiki`. Acceptance is based on whether the resulting wiki is useful project documentation and queryable memory, not whether it satisfies schema-shaped section, citation, role, or quality gates. This chunk captures evidence artifacts and any product-quality gaps discovered by dogfood.

## Source Artifacts

- `../spec.md`: acceptance, dogfood, no structure validations.
- `../agenda.md`: user vision of a living, self-maintaining project brain.
- `../../../adr/0067-use-agent-authored-project-memory-documentation.md`.
- Current commands:
  - `make learn PROJECT=<key>`
  - `make query PROJECT=<key> QUESTION="..."`
  - `bun test`
  - `bun run typecheck`
- Generated runtime paths:
  - `projects/llm-wiki/wiki/`
  - `projects/llm-wiki/state/project-memory.json`
  - `projects/llm-wiki/runs/project-learn/<run-id>/`

## Relationships

- **Depends on:** complete agent-authored implementation and cleanup.
- **Enables:** handoff to `$pmp-executing-plans` completion or user acceptance of remaining risks.
- **Shared contracts:** live provider mode, run artifacts, state v2, query answerability.
- **Integration points:** actual `llm-wiki` project memory, retrieval query facade, generated run artifacts.

## File Responsibility Map

**Create:**
- `docs/design/2026-07-06-project-memory-agent-authored-documentation/dogfood-acceptance.md` - dogfood commands, run refs, query results, acceptance decision, and follow-up gaps.

**Modify:**
- No implementation files by default. Modify implementation only to fix bugs found by dogfood, then rerun the relevant earlier chunk verification.
- `projects/llm-wiki/wiki/**` and `projects/llm-wiki/state/**` may change as generated dogfood output.

**Test:**
- Existing test suite and live command checks.

## Implementation Tasks

### Task 1: Run Full Local Verification Before Dogfood

**Files:**
- No planned file edits.

- [ ] **Step 1: Run all tests**

Run: `bun test`  
Expected: exits `0`.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`  
Expected: exits `0`.

- [ ] **Step 3: Confirm no stub provider is active**

Run:

```bash
env | rg "LLM_STUB_RESPONSES_DIR|FILE_AUTHORING_STUB_OUTPUTS_DIR"
```

Expected: no output. If output exists, unset those variables for the dogfood commands.

### Task 2: Run Live Project Learn On `llm-wiki`

**Files:**
- Generated: `projects/llm-wiki/runs/project-learn/<run-id>/`
- Generated: `projects/llm-wiki/wiki/**`
- Generated: `projects/llm-wiki/state/project-memory.json`

- [ ] **Step 1: Run live learn**

Run:

```bash
make learn PROJECT=llm-wiki ARGS="--json"
```

Expected:

```json
{
  "project_key": "llm-wiki",
  "status": "completed"
}
```

or:

```json
{
  "project_key": "llm-wiki",
  "status": "completed_with_pending_index"
}
```

Failure is acceptable only if it is a real implementation or provider failure to fix before acceptance.

- [ ] **Step 2: Inspect state v2**

Run:

```bash
bun -e 'const s=require("./projects/llm-wiki/state/project-memory.json"); console.log(JSON.stringify({schema_version:s.schema_version,status:s.status,curation_kind:s.curation_kind,run_kind:s.run_kind,provider_mode:s.provider_mode,retrieval:s.retrieval_readiness?.status},null,2))'
```

Expected:

```json
{
  "schema_version": 2,
  "status": "curated",
  "curation_kind": "agent_authored",
  "run_kind": "create_then_maintenance",
  "provider_mode": "live"
}
```

`retrieval` may be `"ready"`, `"pending"`, or `"degraded"`; degraded retrieval must have a captured reason.

- [ ] **Step 3: Inspect generated wiki shape without enforcing a fixed structure**

Run:

```bash
find projects/llm-wiki/wiki -maxdepth 2 -type f -name "*.md" | sort
```

Expected:

- includes `projects/llm-wiki/wiki/index.md`
- includes multiple subject pages chosen by the planner
- does not include `projects/llm-wiki/state/index.md` as documentation output

### Task 3: Run Product-Usefulness Query Checks

**Files:**
- Generated: query outputs captured in `dogfood-acceptance.md`.

- [ ] **Step 1: Ask representative product questions**

Run these commands:

```bash
make query PROJECT=llm-wiki QUESTION="How does project learn create and maintain Project Memory?" ARGS="--json"
make query PROJECT=llm-wiki QUESTION="What are the main runtime components and where should I look before changing them?" ARGS="--json"
make query PROJECT=llm-wiki QUESTION="How are Project Memory candidates processed and marked consumed?" ARGS="--json"
make query PROJECT=llm-wiki QUESTION="What safety boundaries prevent agents from writing directly to canonical docs?" ARGS="--json"
make query PROJECT=llm-wiki QUESTION="What ADRs or design decisions define the current Project Memory architecture?" ARGS="--json"
```

Expected for each:

- answer is not empty
- answer cites or references relevant wiki pages
- answer points to useful repo paths or design/ADR files when appropriate
- answer does not depend on a fabricated fixed file shape

- [ ] **Step 2: Inspect the wiki as documentation**

Read `projects/llm-wiki/wiki/index.md` and the linked subject pages. Acceptance is subjective but must be recorded against these concrete questions:

```markdown
- Can a new Codex session understand what Myelin is and where to start?
- Can it find the project memory architecture and runtime flows?
- Can it understand create vs maintenance behavior?
- Can it understand state, provenance, candidate lifecycle, and retrieval readiness?
- Are important gaps explicitly marked instead of hidden?
- Is `index.md` an index, not a state dump?
```

### Task 4: Capture Dogfood Acceptance Artifact

**Files:**
- Create: `docs/design/2026-07-06-project-memory-agent-authored-documentation/dogfood-acceptance.md`

- [ ] **Step 1: Write dogfood report**

Create the report with this structure:

```markdown
# Dogfood Acceptance

**Date:** 2026-07-06
**Project:** `llm-wiki`
**Run:** `<run-dir>`
**Provider Mode:** `live`
**Result:** `accepted` | `accepted_with_gaps` | `rejected`

## Commands

- `bun test`: `<result>`
- `bun run typecheck`: `<result>`
- `make learn PROJECT=llm-wiki ARGS="--json"`: `<result summary>`

## State

```json
{
  "schema_version": 2,
  "status": "curated",
  "curation_kind": "agent_authored",
  "run_kind": "...",
  "provider_mode": "live",
  "retrieval_readiness": "..."
}
```

## Wiki Shape

- `projects/llm-wiki/wiki/index.md`
- `<planner-selected page>`

## Query Checks

### How does project learn create and maintain Project Memory?

Result: `pass` | `fail`
Evidence: `<short summary>`

### What safety boundaries prevent agents from writing directly to canonical docs?

Result: `pass` | `fail`
Evidence: `<short summary>`

## Documentation Review

- New-session orientation: `pass` | `fail`
- Architecture/runtime findability: `pass` | `fail`
- Create vs maintenance clarity: `pass` | `fail`
- State/provenance/candidate lifecycle clarity: `pass` | `fail`
- Known gaps marked: `pass` | `fail`
- `index.md` remains an index: `pass` | `fail`

## Follow-Up Gaps

- `<gap or None>`
```

- [ ] **Step 2: Decide acceptance result**

Use:

- `accepted`: all query checks pass and documentation review passes.
- `accepted_with_gaps`: implementation works, docs are useful, but one or more non-blocking improvements should be tracked.
- `rejected`: wiki is still not useful project documentation, `index.md` is state-like, live provider did not actually run, or query checks fail materially.

## Verification

- Run: `bun test`  
  Expected: pass.
- Run: `bun run typecheck`  
  Expected: pass.
- Run: `make learn PROJECT=llm-wiki ARGS="--json"` with live provider env  
  Expected: `completed` or `completed_with_pending_index`.
- Run: five representative `make query` commands listed above  
  Expected: each produces a useful answer backed by generated wiki content.
- Inspect: `docs/design/2026-07-06-project-memory-agent-authored-documentation/dogfood-acceptance.md`  
  Expected: contains command evidence, run ref, state summary, query checks, and acceptance decision.

## Acceptance Criteria Covered

- Live provider dogfood is run.
- Stubbed deterministic output is not accepted as final product evidence.
- Wiki usefulness is judged by product questions.
- No schema-quality gate is used as acceptance.
- Queryability is verified after learning.
- Gaps are captured explicitly.

## Risks And Rollback

- Risk: live provider credentials or Codex CLI availability may fail. That blocks this chunk until environment is fixed; do not substitute stubs for final acceptance.
- Risk: generated dogfood files make the worktree noisier. This is expected, but the executor must report exactly which generated files changed.
- Rollback: if dogfood output is rejected, keep implementation changes and preserve failed run artifacts for debugging unless the user explicitly asks to delete generated files.

## Non-Goals

- Does not add a synthesis agent in response to first dogfood unless the acceptance report rejects the two-layer create mode.
- Does not enforce a fixed page list.
- Does not stage, commit, or push generated dogfood files.
- Does not use Session Memory candidates as the primary create-mode input.

## Type And Name Consistency

- Dogfood report: `dogfood-acceptance.md`.
- Project: `llm-wiki`.
- Live state field: `provider_mode: "live"`.
- Valid final result labels: `accepted`, `accepted_with_gaps`, `rejected`.
