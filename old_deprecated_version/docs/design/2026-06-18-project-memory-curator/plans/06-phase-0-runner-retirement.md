# Chunk 06: Phase-0 Runner Retirement

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `04-curator-service-prewrite-flow.md`, `05-command-surface-and-vocabulary.md`
**Enables:** Future bounded markdown apply planning

## Goal

Delete the Phase-0 Project Memory runner after replacement behavior exists and searches prove no supported runtime surface depends on it. This chunk removes obsolete `runProjectPipeline` ownership from Project Memory, replaces runner tests with curator-flow and command-surface coverage, and removes obsolete stage scaffolding only when production and test references have been replaced. Historical documentation references may remain if they are clearly not runtime contracts.

## Source Artifacts

- `../spec.md`: Relationship To Existing Pipeline Stages and Acceptance Criteria.
- `../pseudocode/ProjectRunInfrastructureBoundary.md`: removed boundaries.
- `src/pipeline/runner.ts`: obsolete Phase-0 runner.
- `stages/*`: obsolete Phase-0 stage instructions for Project Memory, subject to the production/test reference checks in Task 3.
- `tests/pipeline/runner.test.ts`: old behavior assertions.
- Chunks 03-05: replacement runtime, service, and command cutover.

## Relationships

- **Depends on:** `project learn` no longer imports `runProjectPipeline`; `project ingest` is no longer registered.
- **Enables:** Future apply planning starts from curator artifacts instead of Phase-0 stage artifacts.
- **Shared contracts:** No new contracts. This chunk removes obsolete contracts.
- **Integration points:** imports from `src/project/project-service.ts`, command tests, runtime tests, stage files.

## File Responsibility Map

**Create:**
- None by default.

**Modify:**
- `src/project/project-service.ts` - remove `runPipeline` facade and `PipelineKind` / `PipelineRunResult` imports if unused.
- `src/commands/project.ts` - confirm no imports from `src/pipeline/runner.ts`.
- `tests/project/project-memory-curator-service.test.ts` - add any missing replacement assertions for old runner result expectations.
- `tests/commands/project.test.ts` - keep command-surface absence coverage.

**Delete:**
- `src/pipeline/runner.ts` - delete after `rg` proves no production or test import remains outside deletion targets.
- `tests/pipeline/runner.test.ts` - delete old Phase-0 runner tests.
- `stages/01-sense`, `stages/02-impact`, `stages/03-propose`, `stages/04-apply`, `stages/06-validate`, `stages/08-ingest` - delete if no production code, tests, or non-historical docs consume them.

**Test:**
- Existing curator and command tests from Chunks 04 and 05 are the replacement coverage.

## Implementation Tasks

### Task 1: Prove Runner Is Unused Before Deletion

**Files:**
- Inspect: repository imports and command registrations.

- [ ] **Step 1: Run import search**

Run: `rg -n "runProjectPipeline|PipelineKind|PipelineRunResult|../pipeline/runner|pipeline/runner" src tests`
Expected after Chunks 04 and 05: matches only in `src/pipeline/runner.ts`, `tests/pipeline/runner.test.ts`, or planned deletion targets. Any match in `src/commands`, `src/project`, `src/runtime`, or non-runner tests blocks deletion until removed by the owning prior chunk.

- [ ] **Step 2: If production imports remain, stop and fix the owner**

Allowed production survivors: none.

Use this replacement in `src/project/project-service.ts` if old facade code remains:

```ts
import { migrateProjectLayout, type MigrationAction } from "../runtime/layout.ts";
import { discoverProjects } from "../runtime/projects.ts";
import { buildProjectMemoryPacket, type ProjectMemoryPacket } from "./project-memory-packet.ts";
import { ProjectMemoryCuratorService } from "./project-memory-curator-service.ts";
import type { ProjectMemoryCuratorRunResult, RunProjectMemoryCuratorInput } from "./project-memory-curator-contracts.ts";
```

Keep these methods only:

```ts
async buildMemoryPacket(projectKey: string): Promise<ProjectMemoryPacket> {
  return await buildProjectMemoryPacket(this.root, projectKey);
}

async runProjectLearn(input: Omit<RunProjectMemoryCuratorInput, "projectKey"> & { projectKey: string }): Promise<ProjectMemoryCuratorRunResult> {
  return new ProjectMemoryCuratorService(this.root).runProjectLearn(input);
}
```

Remove `RunProjectPipelineInput` and `runPipeline`.

### Task 2: Delete Obsolete Runner And Tests

**Files:**
- Delete: `src/pipeline/runner.ts`
- Delete: `tests/pipeline/runner.test.ts`

- [ ] **Step 1: Delete files after import search passes**

Use `rm` or the editor to delete:

```text
src/pipeline/runner.ts
tests/pipeline/runner.test.ts
```

- [ ] **Step 2: Run focused tests**

Run: `bun test tests/project/project-memory-curator-service.test.ts tests/commands/project.test.ts`
Expected: passes, proving replacement behavior covers project learn and command absence.

### Task 3: Remove Obsolete Phase-0 Stage Assets

**Files:**
- Delete: `stages/01-sense`
- Delete: `stages/02-impact`
- Delete: `stages/03-propose`
- Delete: `stages/04-apply`
- Delete: `stages/06-validate`
- Delete: `stages/08-ingest`

- [ ] **Step 1: Search stage references**

Run: `rg -n "01-sense|02-impact|03-propose|04-apply|06-validate|08-ingest|stages/" src tests docs`
Expected: no `src/` or `tests/` matches outside planned deletion targets. Documentation matches are allowed only when they describe historical Phase-0 scaffolding or this retirement plan; documentation that instructs operators or executors to use these stages must be updated before deletion.

- [ ] **Step 2: Delete obsolete stage directories**

Delete only the listed Phase-0 Project Memory stage directories after the reference search passes. Do not delete unrelated stage assets if new ones were added for another subsystem.

- [ ] **Step 3: Re-run reference search**

Run: `rg -n "01-sense|02-impact|03-propose|04-apply|06-validate|08-ingest|stages/" src tests`
Expected: no production or test references to deleted stage directories.

### Task 4: Final Replacement Verification

**Files:**
- Test: full relevant suite.

- [ ] **Step 1: Run focused replacement tests**

Run: `bun test tests/project/project-memory-curator-contracts.test.ts tests/project/project-memory-curator-validator.test.ts tests/runtime/project-run-infrastructure.test.ts tests/project/project-memory-curator-service.test.ts tests/commands/project.test.ts tests/commands/ingest.test.ts`
Expected: all listed suites pass.

- [ ] **Step 2: Run repo-wide checks**

Run: `bun test`
Expected: pass, or report pre-existing unrelated failures with exact failing test names.

Run: `bun run typecheck`
Expected: pass, proving no stale imports from deleted runner or stage types.

Run: `git diff --check`
Expected: no whitespace errors.

## Verification

- `rg -n "runProjectPipeline|PipelineKind|PipelineRunResult|../pipeline/runner|pipeline/runner" src tests`
  - Expected: no matches after deletion.
- `rg -n "project ingest" src Makefile tests/commands`
  - Expected: no active command references.
- `bun test tests/project/project-memory-curator-service.test.ts tests/commands/project.test.ts`
  - Expected: replacement project learn and command-surface tests pass.
- `bun test`
  - Expected: full suite pass or explicit pre-existing failures.
- `bun run typecheck`
  - Expected: no stale runner/stage imports.

## Acceptance Criteria Covered

- `src/pipeline/runner.ts` is not preserved as the future Project Memory product boundary.
- Old Phase-0 runner tests no longer define accepted behavior.
- Replacement curator-flow and command-surface tests define accepted behavior.
- Future apply planning starts from curator artifacts, not generic Phase-0 stage artifacts.

## Risks And Rollback

- Risk: deleting `stages/*` can remove useful historical prompt text. If historical value matters, preserve snippets in design docs before deletion, not as live runtime assets.
- Risk: hidden imports can surface only at typecheck. Run typecheck before reporting completion.
- Rollback: restore deleted files from git if command or typecheck coverage proves a supported surface still depends on them. Do not restore `project ingest` unless Chunk 05 is also rolled back intentionally.

## Non-Goals

- No new curator behavior.
- No command vocabulary changes beyond removing stale references found during deletion.
- No markdown apply.
- No broad documentation rewrite.

## Type And Name Consistency

Before marking this chunk done, verify no exported symbol named `runProjectPipeline`, `PipelineKind`, or `PipelineRunResult` remains in `src/`, and no command path named `project ingest` is registered.
