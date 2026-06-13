# Chunk 07: Docs Validation And Source Set

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-storage-schema-contracts.md`, `02-experience-log-claim-finalize.md`, `03-ingest-job-runtime.md`, `04-memory-output-repositories.md`, `05-ingest-agent-orchestration.md`, `06-operator-cli-surfaces.md`
**Enables:** Execution handoff after the full plan set is complete and reviewed

## Goal

Align documentation and source-set hygiene after the implementation chunks land. This chunk ensures ADR 0056, the roadmap, and chunk plans are included in the artifact set; verifies the command vocabulary in docs; records that status/current-briefing integration, SQLite VEC retrieval, Practice/Personal canonical homes, and scheduler-style worker management remain outside this plan set.

## Source Artifacts

- `../plan.md`
- `../spec.md`
- `../agenda.md`
- `../../../adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`
- `../../../../CONTEXT.md`
- `../../../../MYELIN.md`
- `../../../../AGENTS.md`
- `../../../../README.md`
- root docs backlog/status files, discovered with `rtk ls docs`
- `../../../../schema/schema-context.md` if present

## Relationships

- **Depends on:** all behavior chunks.
- **Enables:** clean execution handoff and future roadmap or execution review.
- **Shared contracts:** public command vocabulary, source artifact list, deferred decision list.
- **Integration points:** documentation files and final verification commands.

## File Responsibility Map

**Modify:**
- `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/plan.md` - update status and chunk links if this was not already done during plan generation.
- `README.md` - document top-level `myelin ingest <project-key>` only if README has current command vocabulary.
- `AGENTS.md` - verify the `project ingest` versus top-level `ingest` split remains accurate.
- `MYELIN.md` - verify canonical Session Memory and ingest command wording remains accurate.
- `CONTEXT.md` - verify glossary terms remain accurate.
- root docs backlog/status files - update only if they track current implementation status in this repo.
- `schema/schema-context.md` - update only if it lists command vocabulary or memory surfaces that are now stale.

**Test:**
- No new test file is required unless documentation tests exist.

## Implementation Tasks

### Task 1: Verify Source Artifact Set

**Files:**
- Inspect: all source artifacts listed above

- [ ] **Step 1: Confirm design artifacts exist**

Run:

```bash
rtk rg --files docs/design/2026-06-12-experience-log-drain-memory-candidate-queue docs/adr | rtk rg 'experience-log-drain-memory-candidate-queue/(spec|agenda|plan)\\.md|0056-use-detached-target-repo-agents-for-experience-log-ingest\\.md'
```

Expected output includes:

```text
docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/spec.md
docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/agenda.md
docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/plan.md
docs/adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md
```

- [ ] **Step 2: Confirm chunk files exist**

Run:

```bash
rtk rg --files docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/plans
```

Expected output includes the seven approved chunk files:

```text
docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/plans/01-storage-schema-contracts.md
docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/plans/02-experience-log-claim-finalize.md
docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/plans/03-ingest-job-runtime.md
docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/plans/04-memory-output-repositories.md
docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/plans/05-ingest-agent-orchestration.md
docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/plans/06-operator-cli-surfaces.md
docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/plans/07-docs-validation-and-source-set.md
```

### Task 2: Update Documentation If It Is Stale

**Files:**
- Modify: `README.md`, `AGENTS.md`, `MYELIN.md`, `CONTEXT.md`, root docs backlog/status files, and `schema/schema-context.md` when Task 2 finds stale current-command, storage, or source-set claims

- [ ] **Step 1: Search for stale command vocabulary**

Run:

```bash
rtk rg -n 'project ingest|myelin ingest|session_memories|sessions / session_events|needs-review|needs_review' README.md AGENTS.md MYELIN.md CONTEXT.md docs schema
```

Expected: any occurrences of `project ingest` describe queued source/inbox processing; any occurrences of top-level `ingest` describe detached Experience Log to Session Memory processing; `needs_review` is the stored status when state/JSON is discussed.

- [ ] **Step 2: Apply targeted documentation edits**

Use this exact wording where a doc needs the command split:

```markdown
`project ingest <key>` processes queued source/inbox material through the project-memory pipeline. Top-level `ingest <key>` starts a detached provider-backed Experience Log to Session Memory job and returns a durable handle.
```

Use this exact wording where a doc needs the Session Memory split:

```markdown
Trusted agent-written Session Memory from Experience Log ingest lives in `session_memories`; `sessions` / `session_events` remain the existing manual session surface until status/current-briefing integration is intentionally redesigned.
```

If a searched file is historical or intentionally describes old implementation state, do not rewrite it. Add a short note in the chunk completion report naming the file and why it stayed unchanged.

### Task 3: Record Deferred Decisions

**Files:**
- Modify: `../plan.md`
- Modify docs only if they have current-decision sections

- [ ] **Step 1: Ensure the roadmap keeps these deferrals explicit**

Verify `../plan.md` still names these deferrals in Unresolved Decision Ownership or Risks:

```text
Full retry daemon, cancellation, scheduler, and multi-agent worker pool are deferred.
SQLite VEC and embedding-backed Session Memory retrieval are deferred.
Status/current-briefing integration with session_memories is deferred.
Practice and Personal canonical homes are deferred.
```

If one is missing, add it to the owning section with the owning chunk or a final out-of-scope note.

### Task 4: Run Full Verification

**Files:**
- Whole repo

- [ ] **Step 1: Run the full test suite**

Run:

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 3: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 4: Inspect source set status**

Run:

```bash
rtk git status --short
```

Expected: ADR 0056, `plan.md`, and all chunk plan files are visible in the worktree status so they can be staged intentionally with the implementation or planning commit.

## Verification

- Run: `bun test`
  - Expected: all tests pass.
- Run: `bun run typecheck`
  - Expected: no TypeScript errors.
- Run: `git diff --check`
  - Expected: no whitespace errors.
- Run: `rtk rg -n 'project ingest|myelin ingest|session_memories|needs-review|needs_review' README.md AGENTS.md MYELIN.md CONTEXT.md docs schema`
  - Expected: current docs distinguish command surfaces and status spelling correctly.

## Acceptance Criteria Covered

- ADR 0056 remains part of the source set.
- Roadmap and chunk plans are visible and internally consistent.
- Documentation does not reintroduce the `project ingest` versus top-level `ingest` ambiguity.
- Documentation records the `session_memories` split without redesigning status/current briefing.
- Full repo verification is run after implementation chunks.

## Risks And Rollback

- Risk: broad documentation edits can create churn. Keep edits limited to stale command, storage, or source-set claims.
- Risk: docs backlog/status files may be historical records. Do not rewrite historical status without clear current-maintenance intent.
- Rollback: revert doc-only edits from this chunk; keep code chunks intact if verification remains green.

## Non-Goals

- No new product behavior.
- No code changes except documentation-adjacent generated source-set references if the repo already uses them.
- No status/current-briefing integration.
- No vector retrieval or embeddings.
- No Practice/Personal canonical memory home implementation.

## Type And Name Consistency

Verify every command name, table name, chunk file name, and artifact path in docs matches the implemented code and this plan set.
