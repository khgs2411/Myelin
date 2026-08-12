# Chunk 07: Retrieval And Legacy Curator Cleanup

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `06-project-learn-composition-and-recreate.md`  
**Enables:** `08-live-dogfood-and-acceptance.md`

## Goal

Finish the migration by reconnecting retrieval indexing to the promoted agent-authored markdown and removing obsolete create quality gates from the active `project learn` path. This chunk deliberately deletes or isolates old structured-curator validation expectations so the system does not keep rejecting good agent-authored documentation for failing schema-shaped roles, answer domains, citation density, or `trusted` diagnostics.

## Source Artifacts

- `../spec.md`: remove structure validations, retrieval derives from markdown.
- `../../../adr/0062-derive-project-memory-retrieval-from-markdown.md`.
- `../../../adr/0067-use-agent-authored-project-memory-documentation.md`.
- Current code:
  - `src/project/project-memory-curator-validator.ts`
  - `src/project/project-memory-curator-output-schema.ts`
  - `src/project/project-memory-quality-contract.ts`
  - `src/project/project-memory-markdown-applier.ts`
  - `src/project/project-memory-curator-service.ts`
  - `src/memory/project-memory-retrieval-index-service.ts`
  - `tests/project/project-memory-rendered-quality.test.ts`
  - `tests/project/project-memory-create-contract-regression.test.ts`
  - `tests/project/project-memory-curator-validator.test.ts`
  - `tests/project/project-memory-curator-output-schema.test.ts`
  - `tests/project/project-memory-markdown-applier.test.ts`

## Relationships

- **Depends on:** chunk `06` makes the active public path agent-authored.
- **Enables:** live dogfood without the old harness blocking create output.
- **Shared contracts:** retrieval readiness is derived from promoted markdown; legacy validation is not part of agent-authored create acceptance.
- **Integration points:** post-promotion retrieval indexing, query readiness reporting, old tests and schema modules.

## File Responsibility Map

**Create:**
- `tests/project/project-memory-agent-cleanup.test.ts` - regression tests that active `project learn` does not call old quality gates.

**Modify:**
- `src/project/project-memory-curator-service.ts` - remove active calls to `validateCuratorOutput`, `evaluateProjectMemoryQuality`, usefulness critique, and evidence-map gate from agent-authored flow.
- `src/project/project-memory-markdown-applier.ts` - stop using `applyCreationDraft` on the active path; isolate or delete `isTrustedProjectMemoryQuality` gate from active create publication.
- `src/project/project-memory-quality-contract.ts` - mark rendered quality functions as legacy or move them to a legacy module if imports need to remain.
- `src/project/project-memory-curator-validator.ts` - keep only for legacy tests or remove exports once no active code imports it.
- `src/project/project-memory-curator-output-schema.ts` - keep only for legacy JSON-output tests or remove once no active code imports it.

**Test:**
- `tests/project/project-memory-curator-service.test.ts` - agent-authored expectations remain.
- `tests/project/project-memory-markdown-applier.test.ts` - remove create-publication tests that require `trusted` content quality, or move them to a legacy describe block that is not treated as product behavior.
- `tests/project/project-memory-rendered-quality.test.ts`, `tests/project/project-memory-create-contract-regression.test.ts`, `tests/project/project-memory-curator-validator.test.ts`, `tests/project/project-memory-curator-output-schema.test.ts` - delete, rename to legacy, or rewrite according to retained exports.

## Implementation Tasks

### Task 1: Prove Active Learn Path Does Not Use Old Gates

**Files:**
- Create: `tests/project/project-memory-agent-cleanup.test.ts`
- Modify: `src/project/project-memory-curator-service.ts`

- [ ] **Step 1: Add cleanup regression test**

```ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("agent-authored project learn cleanup", () => {
  test("active project learn implementation does not call old create gates", async () => {
    const source = await readFile(join(process.cwd(), "src", "project", "project-memory-curator-service.ts"), "utf8");
    expect(source).not.toContain("validateCuratorOutput(");
    expect(source).not.toContain("evaluateProjectMemoryQuality(");
    expect(source).not.toContain("applyCreationDraft(");
    expect(source).not.toContain("project-memory-usefulness-critique.json");
  });
});
```

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/project/project-memory-agent-cleanup.test.ts`  
Expected: fails until old active calls are removed from `ProjectMemoryCuratorService`.

- [ ] **Step 3: Remove old active calls**

In `src/project/project-memory-curator-service.ts`, the public `runProjectLearn` method should only call:

```ts
ensureProjectLearnSchemaContext(...);
buildProjectMemoryPacket(...);
runProjectMemoryCreateMode(...);
runProjectMemoryMaintenanceMode(...);
promoteDraftWiki(...);
updateProjectMemoryRetrieval(...);
new ProjectMemorySourceConsumptionReconciler(...).reconcileProject(...);
```

Remove active imports for:

```ts
validateCuratorOutput
buildProjectMemoryCuratorOutputSchema
buildProjectMemoryEvidenceMap
evaluateProjectMemoryUsefulness
invokeProjectCurator
applyCreationDraft
applyMaintenanceProposal
```

If helper functions are still needed by tests, move them into a `legacy` helper file and keep them out of the public `runProjectLearn` path.

- [ ] **Step 4: Run cleanup test**

Run: `bun test tests/project/project-memory-agent-cleanup.test.ts`  
Expected: passes.

### Task 2: Remove Or Isolate `applyCreationDraft` Trusted-Quality Gate

**Files:**
- Modify: `src/project/project-memory-markdown-applier.ts`
- Test: `tests/project/project-memory-markdown-applier.test.ts`

- [ ] **Step 1: Replace active applier tests**

Remove tests whose product assertion is:

```ts
expect(result.reason).toContain("Project Memory content quality is not trusted");
```

Add a promotion-focused test if chunk `03` did not already cover it:

```ts
test("draft promotion writes schema v2 state without trusted content quality", async () => {
  const result = await promoteDraftWiki(validDraftPromotionInput());
  expect(result.status).toBe("applied");
  const state = JSON.parse(await readFile(projectStatePath, "utf8"));
  expect(state.schema_version).toBe(2);
  expect(state.content_quality.status).toBe("not_evaluated");
});
```

- [ ] **Step 2: Isolate legacy method**

If `applyCreationDraft` still has imports, rename it to make legacy status explicit:

```ts
async applyLegacyStructuredCreationDraft(input: ApplyCreationDraftInput): Promise<ProjectMemoryApplyResult> {
  // existing structured JSON behavior retained only for legacy fixtures
}
```

Remove active imports of `isTrustedProjectMemoryQuality` from new-path code. If no tests or exports need the legacy method, delete `applyCreationDraft`, `ApplyCreationDraftInput`, and creation-specific renderer imports.

- [ ] **Step 3: Run applier tests**

Run: `bun test tests/project/project-memory-markdown-applier.test.ts tests/project/project-memory-draft-promotion.test.ts`  
Expected: passes with draft promotion as the product path.

### Task 3: Reconnect Retrieval Indexing To Promoted Markdown

**Files:**
- Modify: `src/project/project-memory-curator-service.ts`
- Test: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Add retrieval result test**

```ts
test("updates retrieval readiness after agent-authored promotion", async () => {
  const result = await service.runProjectLearn(validCreateThenMaintenanceInput());
  expect(result.artifacts.retrieval_sections).toBe("project-memory-retrieval-sections.json");
  expect(["ready", "pending", "degraded"]).toContain(result.retrieval_readiness_status);
});
```

- [ ] **Step 2: Preserve post-promotion retrieval flow**

After successful `promoteDraftWiki`, call the existing retrieval helper from `ProjectMemoryCuratorService` or extract it as:

```ts
const retrieval = await updateProjectMemoryRetrieval({
  root: this.root,
  projectKey: input.projectKey,
  runDir: run.run_dir,
  absoluteRunDir: run.absolute_run_dir,
  now: input.now,
});
```

The helper must read `projects/<key>/wiki/**/*.md`, not draft agent workspaces.

- [ ] **Step 3: Reflect pending index status in result**

If section extraction succeeds but vector indexing is unavailable, return:

```ts
status: "completed_with_pending_index",
retrieval_readiness_status: "pending",
artifacts: {
  retrieval_sections: "project-memory-retrieval-sections.json",
  retrieval_index_result: "project-memory-retrieval-index-result.json",
}
```

If extraction itself fails, return `completed` with `retrieval_readiness_status: "degraded"` only when canonical promotion succeeded and the error is captured in the run result.

- [ ] **Step 4: Run service tests**

Run: `bun test tests/project/project-memory-curator-service.test.ts`  
Expected: passes.

### Task 4: Retire Old Schema-Quality Tests From Product Acceptance

**Files:**
- Modify or delete old tests listed in File Responsibility Map.

- [ ] **Step 1: Classify old tests**

Use:

```bash
rg -n "content_quality_not_trusted|PROJECT_MEMORY_ANSWER_DOMAINS|PROJECT_MEMORY_DOCUMENTATION_ROLES|project-memory-usefulness-critique|applyCreationDraft" tests src
```

Expected: hits are either removed, inside explicitly named legacy tests, or unrelated historical docs.

- [ ] **Step 2: Update test files**

Allowed outcomes:

```ts
describe("legacy structured curator validation", () => {
  test("legacy validator rejects shallow structured output", () => {
    // retained only to protect archived compatibility helpers
  });
});
```

or delete the test file if no production import remains. Do not keep tests that imply agent-authored docs must satisfy answer-domain or role-shaped coverage.

- [ ] **Step 3: Run broad tests**

Run: `bun test`  
Expected: pass.

## Verification

- Run: `bun test tests/project/project-memory-agent-cleanup.test.ts`  
  Expected: pass.
- Run: `bun test tests/project/project-memory-curator-service.test.ts tests/project/project-memory-draft-promotion.test.ts`  
  Expected: pass.
- Run: `rg -n "validateCuratorOutput\\(|applyCreationDraft\\(|content_quality_not_trusted|project-memory-usefulness-critique" src/project`  
  Expected: no hits in active agent-authored service code; legacy-only hits are in clearly named legacy modules or tests.
- Run: `bun test`  
  Expected: pass.
- Run: `bun run typecheck`  
  Expected: pass.

## Acceptance Criteria Covered

- Old schema/content-quality gates do not control agent-authored create or maintenance.
- `ProjectMemoryMarkdownApplier.applyCreationDraft` no longer blocks active create publication on `trusted` diagnostics.
- Retrieval derives from promoted markdown.
- Pending/degraded retrieval readiness is reflected without blocking successful documentation promotion.
- Old tests no longer define product acceptance for new Project Memory.

## Risks And Rollback

- Risk: removing old tests could hide regressions in legacy code that is still imported. Mitigation is to keep a clearly named legacy describe block only for code that remains imported.
- Risk: retrieval indexing failures can mask promotion success. Result status must distinguish promotion success from pending or degraded retrieval.
- Rollback: restore old tests and service imports, but that also restores the product behavior this design rejects.

## Non-Goals

- Does not run live provider dogfood.
- Does not change query ranking semantics beyond feeding promoted markdown.
- Does not add schema-quality replacement gates.
- Does not rewrite generated wiki content.

## Type And Name Consistency

- Active promotion helper: `promoteDraftWiki`.
- Legacy method name if retained: `applyLegacyStructuredCreationDraft`.
- Cleanup test: `project-memory-agent-cleanup.test.ts`.
- Retrieval result artifacts: `project-memory-retrieval-sections.json`, `project-memory-retrieval-index-result.json`.
