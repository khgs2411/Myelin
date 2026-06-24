# Chunk 08: Docs Roadmap And Final Verification

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `07-project-learn-service-integration.md`
**Enables:** Execution handoff completion

## Goal

Align documentation, roadmap state, and verification evidence after Project Memory markdown apply is implemented. This chunk does not add product behavior; it makes the repository truth match the shipped apply semantics and runs full repo-native verification.

## Source Artifacts

- `../spec.md`: Acceptance Criteria, Testing Strategy.
- `../agenda.md`: all resolved decisions.
- `../plan.md`: final coverage and verification strategy.
- `docs/ROADMAP.md`
- `AGENTS.md`
- `CONTEXT.md`
- `docs/adr/0059-use-structured-project-memory-apply-payloads.md`
- `docs/adr/0060-use-apply-journal-for-project-memory-writes.md`
- All chunk implementation diffs from chunks 01-07.

## Relationships

- **Depends on:** completed service integration and passing focused tests.
- **Enables:** handoff to `$pmp-executing-plans` completion or release/commit workflow if requested later.
- **Shared contracts:** docs must match actual command/result/artifact names.
- **Integration points:** roadmap, glossary, ADRs only when behavior differs from current wording.

## File Responsibility Map

**Create:**

- No new production file required.

**Modify:**

- `docs/ROADMAP.md` - mark or update Step 3 apply item according to repo roadmap convention.
- `CONTEXT.md` - update only if implementation introduced durable term changes beyond existing Apply Payload and Source Consumption terms.
- `docs/design/2026-06-23-project-memory-markdown-apply/plan.md` - update status to reflect chunk plans and, if execution uses this chunk, note final verification evidence.

**Test:**

- No new test file required unless final verification reveals a docs-related command test gap.

## Implementation Tasks

### Task 1: Review Documentation Drift

**Files:**

- Review and modify on documented drift: `docs/ROADMAP.md`
- Review and modify on documented drift: `CONTEXT.md`
- Review and modify on documented drift: `docs/design/2026-06-23-project-memory-markdown-apply/plan.md`

- [ ] **Step 1: Inspect roadmap Step 3 wording**

Run:

```bash
rg -n "Apply bounded page updates|Project Memory|Step 3|project learn" docs/ROADMAP.md
```

Expected: output identifies the Step 3 apply item and nearby checklist status.

- [ ] **Step 2: Update roadmap only if behavior is implemented**

If chunks 01-07 are implemented and focused/full verification passes, update the apply item from unchecked to checked using the existing roadmap checklist style. If the roadmap uses prose status instead of checkboxes, update the item wording to say the apply slice now covers structured payloads, journaled apply, creation, maintenance, source-consumption evidence, and recovery.

The exact edit must preserve the roadmap's existing format. Do not add a duplicate "current next item" section.

- [ ] **Step 3: Verify glossary terms still match implementation**

Run:

```bash
rg -n "Project Memory Apply Payload|Project Memory Source Consumption|Experience Log Tombstone" CONTEXT.md
```

Expected: all three terms are present. Update `CONTEXT.md` only if implementation names differ materially from the approved terms.

### Task 2: Run Full Verification

**Files:**

- No planned edits.

- [ ] **Step 1: Run targeted tests first**

Run:

```bash
bun test tests/project/project-memory-curator-validator.test.ts
bun test tests/project/project-memory-markdown-renderer.test.ts
bun test tests/project/project-memory-markdown-applier.test.ts
bun test tests/project/project-memory-curator-service.test.ts
bun test tests/commands/project.test.ts
```

Expected: every command exits `0`.

- [ ] **Step 2: Run full test suite**

Run:

```bash
bun test
```

Expected: exits `0`.

- [ ] **Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: exits `0`.

- [ ] **Step 4: Run diff whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit `0`.

### Task 3: Inspect Final Behavioral Evidence

**Files:**

- No planned edits unless evidence reveals drift.

- [ ] **Step 1: Verify artifact names appear in tests or code**

Run:

```bash
rg -n "project-memory-apply-journal.json|project-memory-apply-result.json|project-memory-changeset.json|project-memory-source-consumptions.json" src tests
```

Expected: output includes production code and tests for all four artifact/state names.

- [ ] **Step 2: Verify stopped-before-writes semantics**

Run:

```bash
rg -n "stopped_before_writes" src tests
```

Expected: output includes applied-run assertions for `false` and stopped-run assertions for `true`.

- [ ] **Step 3: Verify no candidate/handoff status mutation was added**

Run:

```bash
rg -n "update.*candidate|candidate.*status|handoff.*status|project-memory-source-consumptions" src/project src/memory tests/project tests/commands
```

Expected: source-consumption code is present; no new candidate/handoff status update path appears inside Project Memory apply.

## Verification

Run:

```bash
bun test tests/project/project-memory-curator-validator.test.ts
bun test tests/project/project-memory-markdown-renderer.test.ts
bun test tests/project/project-memory-markdown-applier.test.ts
bun test tests/project/project-memory-curator-service.test.ts
bun test tests/commands/project.test.ts
bun test
bun run typecheck
git diff --check
```

Expected:

- All targeted tests exit `0`.
- Full test suite exits `0`.
- Typecheck exits `0`.
- Whitespace check exits `0`.

## Acceptance Criteria Covered

- Confirms all prior chunks satisfy the full spec acceptance criteria.
- Documentation and roadmap match implemented behavior.
- Verification evidence is complete and repo-native.

## Risks And Rollback

- Risk: documentation update marks roadmap complete before verification is actually green.
- Rollback: revert only the docs/roadmap status line and keep implementation code intact.
- Risk: full test suite reveals pre-existing unrelated failure.
- Rollback: report exact failing command and failure; do not claim the full suite passes.

## Non-Goals

- Does not implement behavior missing from chunks 01-07.
- Does not create commits, push branches, or open pull requests.
- Does not invoke `$pmp-executing-plans`.
- Does not update derived retrieval indexing docs as if that scope shipped.

## Type And Name Consistency

- Documentation must use `Project Memory Apply Payload`, `Project Memory Source Consumption`, `project-memory-apply-journal.json`, `project-memory-apply-result.json`, `project-memory-changeset.json`, and `project-memory-source-consumptions.json` consistently.
- Do not call Project Memory Source Consumption records tombstones.
