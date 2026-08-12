# Chunk 02: Create Mode Documentation Contract

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-quality-contract-and-diagnostics.md`
**Enables:** `07-dogfood-reset-and-validation.md`

## Goal

Wire creation mode to the role-based Project Memory Documentation Contract. Creation must inspect a bounded hybrid orientation set, emit role-bearing page drafts, provide inspected-surface diagnostics, reject shallow role coverage, and mark Project Memory curated only after trusted content quality.

## Source Artifacts

- `../spec.md`: `Creation Quality Bar`, `Proposed Direction`, `Testing Strategy`.
- `../agenda.md`: Question 1 and Question 3.
- `../pseudocode/CreationDocumentationFlow.md`.
- `../plans/01-quality-contract-and-diagnostics.md`.
- ADRs: `docs/adr/0018-project-learn-can-read-live-repo.md`, `docs/adr/0021-keep-curated-project-memory-in-markdown.md`, `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`.
- Current code: `src/project/project-memory-prompt-budget.ts`, `src/project/project-memory-curator-output-schema.ts`, `src/project/project-memory-curator-contracts.ts`, `src/project/project-memory-curator-validator.ts`, `src/project/project-memory-markdown-applier.ts`, `src/project/project-memory-curator-service.ts`.
- Tests: `tests/project/project-memory-prompt-budget.test.ts`, `tests/project/project-memory-curator-output-schema.test.ts`, `tests/project/project-memory-curator-validator.test.ts`, `tests/project/project-memory-markdown-applier.test.ts`.

## Relationships

- **Depends on:** Chunk 01's `ProjectMemoryQualityDiagnostics`, role constants, and trusted-only canApply behavior.
- **Enables:** Dogfood creation can prove documentation usefulness instead of page-count compliance.
- **Shared contracts:** Creation page `role`, `inspected_surface_refs`, creation-level `documentation_contract`, trusted creation state.
- **Integration points:** Artifact-reference curator prompt, output schema, deterministic validator, creation applier.

## Resolved Decisions For Execution

- Default orientation surfaces are required when present in the target repo. If a default surface is absent, the curator must record it in `documentation_contract.missing_orientation_surfaces` with reason `not_present`; absence alone is not a blocker.
- If a default orientation surface is present but not inspected, creation quality is `shallow` and validation stops before curated-state writes.
- `llm-wiki` strong surfaces are part of the default manifest for this repo: `MYELIN.md`, `CONTEXT.md`, `docs/ROADMAP.md`, relevant `docs/adr/`, `docs/design/`, `src/project/`, `src/memory/`, `src/query/`, `src/commands/`, and `src/runtime/`.
- Orientation presence must be checked against the target repository root passed to the curator, not Myelin's own repo root unless Myelin is the target project.

## File Responsibility Map

**Create:**
- `src/project/project-memory-orientation-contract.ts` - default orientation surfaces and validation helpers.
- `tests/project/project-memory-orientation-contract.test.ts` - default surface list and required-surface validation.

**Modify:**
- `src/project/project-memory-curator-contracts.ts` - add creation page role and inspected surfaces to creation draft types.
- `src/project/project-memory-curator-output-schema.ts` - require role and inspected-surface fields in create mode.
- `src/project/project-memory-prompt-budget.ts` - make the role contract and hybrid orientation set explicit in the curator prompt.
- `src/project/project-memory-curator-validator.ts` - enforce create role coverage, orientation diagnostics, citation sufficiency, and shallow-summary blockers.
- `src/project/project-memory-markdown-applier.ts` - rely on trusted quality state from chunk 01, not page count alone, before marking curated.

**Test:**
- `tests/project/project-memory-prompt-budget.test.ts` - prompt includes default orientation set and role contract.
- `tests/project/project-memory-curator-output-schema.test.ts` - schema requires creation role fields.
- `tests/project/project-memory-curator-validator.test.ts` - missing role or inspected default surface fails.
- `tests/project/project-memory-markdown-applier.test.ts` - shallow creation cannot write curated state through service path.

## Implementation Tasks

### Task 1: Add orientation contract

**Files:**
- Create: `src/project/project-memory-orientation-contract.ts`
- Test: `tests/project/project-memory-orientation-contract.test.ts`

- [ ] **Step 1: Add default orientation tests**

```ts
import { describe, expect, test } from "bun:test";
import { PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES } from "../../src/project/project-memory-orientation-contract.ts";

describe("Project Memory orientation contract", () => {
  test("includes repo docs, command, roadmap, and CLI defaults", () => {
    expect(PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES).toContain("AGENTS.md");
    expect(PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES).toContain("MYELIN.md");
    expect(PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES).toContain("CONTEXT.md");
    expect(PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES).toContain("docs/ROADMAP.md");
    expect(PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES).toContain("src/cli.ts");
  });
});
```

- [ ] **Step 2: Add orientation helper**

```ts
export const PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES = [
  "AGENTS.md",
  "MYELIN.md",
  "CONTEXT.md",
  "README.md",
  "package.json",
  "Makefile",
  "docs/CLI.md",
  "docs/ROADMAP.md",
  "docs/adr/",
  "src/cli.ts",
  "src/project/",
  "src/memory/",
  "src/ingest/",
  "src/commands/",
  "src/runtime/",
] as const;

export type ProjectMemoryOrientationSurface = {
  path: string;
  required: boolean;
  reason: string;
};

export async function missingRequiredOrientationSurfaces(input: { targetRepoRoot: string; inspected: string[] }): Promise<string[]> {
  const { stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  async function exists(path: string): Promise<boolean> {
    try {
      await stat(join(input.targetRepoRoot, path));
      return true;
    } catch {
      return false;
    }
  }
  const inspectedSet = new Set(input.inspected);
  const missing: string[] = [];
  for (const surface of PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES) {
    if (surface.endsWith("/")) continue;
    if ((await exists(surface)) && !inspectedSet.has(surface)) {
      missing.push(`required orientation surface not inspected: ${surface}`);
    }
  }
  return missing;
}
```

### Task 2: Extend create-mode output shape

**Files:**
- Modify: `src/project/project-memory-curator-contracts.ts`
- Modify: `src/project/project-memory-curator-output-schema.ts`
- Test: `tests/project/project-memory-curator-output-schema.test.ts`

- [ ] **Step 1: Add creation fields to contracts**

Extend `ProjectMemoryCreationPageDraft`:

```ts
role: ProjectMemoryDocumentationRole;
inspected_surface_refs: string[];
```

Add creation-level diagnostics:

```ts
documentation_contract: {
  inspected_default_surfaces: string[];
  curator_added_surfaces: { path: string; reason: string }[];
  missing_orientation_surfaces: { path: string; reason: "not_present" | "present_not_inspected" }[];
  missing_coverage: string[];
  shallow_summary_findings: string[];
};
```

- [ ] **Step 2: Require the fields in creation schema**

In `creationPageDraft`, add:

```ts
role: { type: "string", enum: [...PROJECT_MEMORY_DOCUMENTATION_ROLES] },
inspected_surface_refs: stringArraySchema(1),
```

In the creation root schema, add `documentation_contract` with required `inspected_default_surfaces`, `curator_added_surfaces`, `missing_orientation_surfaces`, `missing_coverage`, and `shallow_summary_findings`.

### Task 3: Update prompt and validator

**Files:**
- Modify: `src/project/project-memory-prompt-budget.ts`
- Modify: `src/project/project-memory-curator-validator.ts`
- Test: `tests/project/project-memory-prompt-budget.test.ts`
- Test: `tests/project/project-memory-curator-validator.test.ts`

- [ ] **Step 1: Update create prompt**

Replace the current generic create coverage lines with exact role and orientation language:

```ts
"Create mode: Project Memory is living repo documentation, not a page-count exercise.",
`Create mode: inspect the default orientation surfaces when present: ${PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES.join(", ")}.`,
"Create mode: you may inspect extra target-repo files only when justified in documentation_contract.curator_added_surfaces.",
"Create mode: candidates, handoffs, and Session Memory are leads only; cite repo docs/code for durable claims.",
`Create mode: cover all required roles: ${PROJECT_MEMORY_DOCUMENTATION_ROLES.join(", ")}.`,
"Create mode: each page draft must name its role, inspected_surface_refs, required_sections, direct repo_citations, and one matching apply_payload page.",
```

- [ ] **Step 2: Enforce role coverage**

Add validator checks that:

- all six roles appear at least once;
- each role has at least two `required_sections`;
- each role-bearing page has direct repo citations;
- `documentation_contract.inspected_default_surfaces` covers required default surfaces or records a missing coverage reason;
- non-empty `shallow_summary_findings` makes content not trusted.

Use chunk 01's `evaluateProjectMemoryQuality` and pass the computed role coverage into `quality_diagnostics` if the curator supplied diagnostics are missing or inconsistent.

## Verification

- Run: `bun test tests/project/project-memory-orientation-contract.test.ts`
  Expected: default orientation surfaces include repo docs, roadmap, CLI, and project/memory modules.
- Run: `bun test tests/project/project-memory-prompt-budget.test.ts`
  Expected: create prompt includes required role names and hybrid orientation instructions.
- Run: `bun test tests/project/project-memory-curator-output-schema.test.ts`
  Expected: create schema requires `role`, `inspected_surface_refs`, and `documentation_contract`.
- Run: `bun test tests/project/project-memory-curator-validator.test.ts`
  Expected: creation output missing a role, required sections, or inspected defaults is rejected or held for review.
- Run: `bun run typecheck`
  Expected: no TypeScript errors.
- Run: `git diff --check`
  Expected: no whitespace errors.

## Acceptance Criteria Covered

- Creation uses role-based documentation coverage instead of generic page count as the publication bar.
- Creation records deterministic default orientation surfaces plus curator-added surfaces.
- Valid but shallow creation output cannot mark Project Memory curated.
- Candidates and Session Memory are treated as leads during creation, not durable text.

## Risks And Rollback

- Risk: provider output becomes too constrained. Mitigation: keep schema fields explicit and prompt language short.
- Risk: orientation default paths differ across repos. Mitigation: defaults are "when present" and missing surfaces can be explained in diagnostics.
- Rollback: remove new create-only fields from schema and validator; chunk 01 quality fields remain usable by maintenance.

## Non-Goals

- Does not implement section-first maintenance.
- Does not implement Project Memory query.
- Does not rebuild dogfood Project Memory.

## Type And Name Consistency

Before finalizing implementation, verify that role names match `PROJECT_MEMORY_DOCUMENTATION_ROLES`, output schema enums, validator checks, prompt text, and tests exactly.
