# Chunk 07: Independent Usefulness Critique

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `04-evidence-map-builder.md`, `05-create-mode-schema-validator.md`, `06-curator-writer-flow.md`
**Enables:** `08-all-or-nothing-promotion-state.md`, `10-dogfood-regression-slice.md`

## Goal

Add an independent model-backed usefulness critique for first-create Project Memory. The critique reviews rendered markdown and the evidence map after deterministic validation and before curated state promotion, returning `pass`, `review_only`, or `fail`.

## Source Artifacts

- `../spec.md`: Independent Usefulness Critique, All-Or-Nothing First Create.
- `../agenda.md`: Question 3.
- `../../../adr/0065-require-independent-first-create-usefulness-critique.md`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-markdown-renderer.ts`
- `src/project/project-memory-curator-contracts.ts`
- `src/runtime/project-run-infrastructure.ts`
- `tests/project/project-memory-curator-service.test.ts`

## Relationships

- **Depends on:** Evidence map and validated sectioned create output.
- **Enables:** Promotion state can require deterministic pass plus critique pass.
- **Shared contracts:** `project-memory-usefulness-critique.json`, `ProjectMemoryUsefulnessCritique`, verdict `pass | review_only | fail`.
- **Integration points:** Provider invocation uses rendered markdown and evidence map, not hidden curator reasoning. Reuse the same provider invocation seam used by `project-memory-curator-service.ts`: `invokeProjectCurator`/the injected runner path with a critique-specific prompt, schema artifact, and strict parser.

## File Responsibility Map

**Create:**
- `src/project/project-memory-usefulness-critique.ts` - artifact contract, prompt construction, structured validation.
- `src/project/project-memory-usefulness-critique-schema.ts` - provider-safe structured-output schema for the critique response if the existing provider path accepts a per-stage schema.
- `tests/project/project-memory-usefulness-critique.test.ts` - verdict parsing and prompt content.

**Modify:**
- `src/project/project-memory-curator-contracts.ts` - add artifact refs/result fields if needed.
- `src/project/project-memory-curator-service.ts` - run critique between deterministic validation and apply for create mode.

**Test:**
- `tests/project/project-memory-curator-service.test.ts` - pass applies, review/fail does not apply.

## Implementation Tasks

### Task 1: Add Critique Contract

**Files:**
- Create: `src/project/project-memory-usefulness-critique.ts`
- Test: `tests/project/project-memory-usefulness-critique.test.ts`

- [ ] **Step 1: Define artifact and verdict types**

```ts
export const PROJECT_MEMORY_USEFULNESS_CRITIQUE_ARTIFACT = "project-memory-usefulness-critique.json" as const;
export const PROJECT_MEMORY_USEFULNESS_CRITIQUE_VERDICTS = ["pass", "review_only", "fail"] as const;

export type ProjectMemoryUsefulnessCritiqueVerdict = (typeof PROJECT_MEMORY_USEFULNESS_CRITIQUE_VERDICTS)[number];

export type ProjectMemoryUsefulnessCritique = {
  schema_version: 1;
  project_key: string;
  verdict: ProjectMemoryUsefulnessCritiqueVerdict;
  reasons: string[];
  weak_sections: { page_path: string; heading: string; reason: string }[];
  evidence_map_ref: "project-memory-evidence-map.json";
  rendered_markdown_refs: string[];
};
```

- [ ] **Step 2: Validate verdict shape**

```ts
export function parseProjectMemoryUsefulnessCritique(value: unknown): ProjectMemoryUsefulnessCritique | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schema_version !== 1) return null;
  if (typeof record.project_key !== "string") return null;
  if (!PROJECT_MEMORY_USEFULNESS_CRITIQUE_VERDICTS.includes(record.verdict as ProjectMemoryUsefulnessCritiqueVerdict)) return null;
  if (!Array.isArray(record.reasons) || record.reasons.some((item) => typeof item !== "string")) return null;
  if (!Array.isArray(record.weak_sections)) return null;
  return record as ProjectMemoryUsefulnessCritique;
}
```

Do not include `blocked` in the verdict enum.

### Task 2: Build Critique Prompt Input From Rendered Markdown

**Files:**
- Modify: `src/project/project-memory-usefulness-critique.ts`
- Create: `src/project/project-memory-usefulness-critique-schema.ts`
- Test: `tests/project/project-memory-usefulness-critique.test.ts`

- [ ] **Step 1: Add prompt builder**

```ts
export function buildProjectMemoryUsefulnessCritiquePrompt(input: {
  projectKey: string;
  evidenceMapJson: string;
  renderedMarkdown: { page_path: string; markdown: string }[];
}): string {
  return [
    "You are auditing first-create Project Memory usefulness.",
    "Return JSON only.",
    "Review rendered markdown and the evidence map. Do not use hidden curator reasoning.",
    "Verdict must be one of: pass, review_only, fail.",
    "Use fail when the docs are too generic, shallow, or cannot answer core repo questions.",
    "Use review_only when the docs might help but should not be canonical trust yet.",
    `Project key: ${input.projectKey}`,
    "Evidence map JSON:",
    input.evidenceMapJson,
    "Rendered markdown pages:",
    ...input.renderedMarkdown.flatMap((page) => [`--- ${page.page_path} ---`, page.markdown]),
  ].join("\n");
}
```

- [ ] **Step 2: Prefer structured-output schema for provider invocation**

If `invokeProjectCurator` or the shared runtime provider helper accepts an `outputSchema` path for this new critique stage, create a provider-safe schema with explicit types and required nullable fields:

```ts
export function buildProjectMemoryUsefulnessCritiqueSchema(input: { projectKey: string }): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schema_version", "project_key", "verdict", "reasons", "weak_sections", "evidence_map_ref", "rendered_markdown_refs"],
    properties: {
      schema_version: { type: "number", const: 1 },
      project_key: { type: "string", const: input.projectKey },
      verdict: { type: "string", enum: ["pass", "review_only", "fail"] },
      reasons: { type: "array", items: { type: "string" } },
      weak_sections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["page_path", "heading", "reason"],
          properties: {
            page_path: { type: "string" },
            heading: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      evidence_map_ref: { type: "string", const: "project-memory-evidence-map.json" },
      rendered_markdown_refs: { type: "array", items: { type: "string" } },
    },
  };
}
```

If the available provider helper cannot accept a schema for this stage without broad runtime changes, keep the strict parser from Task 1 and write invalid critique output as a failed artifact before writes.

Add focused schema tests that assert:

```ts
const schema = buildProjectMemoryUsefulnessCritiqueSchema({ projectKey: "llm-wiki" });
expect(schema).toMatchObject({
  type: "object",
  additionalProperties: false,
  properties: {
    project_key: { type: "string", const: "llm-wiki" },
    verdict: { type: "string", enum: ["pass", "review_only", "fail"] },
  },
});
expect(JSON.stringify(schema)).not.toContain("blocked");
```

### Task 3: Gate Create Apply On Critique Pass

**Files:**
- Modify: `src/project/project-memory-curator-service.ts`
- Test: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Insert critique after deterministic validation**

After `const applyDecision = canApply(...)` and before `applier.applyCreationDraft`, add create-mode critique handling:

```ts
const critiqueDecision = packet.mode === "create" && applyDecision.ok
  ? await this.runUsefulnessCritique({ input, run, projectKey: input.projectKey, draft: curatorOutput as ProjectMemoryCreationDraft })
  : { ok: true as const };

if (!critiqueDecision.ok) {
  return await this.writeTerminalArtifacts({
    input,
    run,
    mode: packet.mode,
    outputArtifact,
    validation,
    status: "needs_review",
    stoppedReason: critiqueDecision.reason,
    promptBudget: true,
    runtimeInboxIntake: true,
    curatorOutputContract: true,
    evidenceMap: packet.mode === "create",
    usefulnessCritique: true,
  });
}
```

Implement `runUsefulnessCritique` with the repo's existing provider runner seam used by `project-memory-curator-service.ts`: call `invokeProjectCurator` or the service's injected runner path with the critique prompt and `project-memory-usefulness-critique` schema artifact, then parse with `parseProjectMemoryUsefulnessCritique`. Tests can inject `runner` with canned JSON responses.

- [ ] **Step 2: Add artifact ref to result**

Add `usefulness_critique?: "project-memory-usefulness-critique.json"` to result artifacts and set it when critique ran.

## Verification

- Run: `bun test tests/project/project-memory-usefulness-critique.test.ts`
  - Expected: exits 0; `blocked` verdict is rejected and prompt references rendered markdown plus evidence map.
- Run: `bun test tests/project/project-memory-curator-service.test.ts`
  - Expected: exits 0; create apply only proceeds on critique `pass`; `review_only` and `fail` stop before writes.
- Run: `bun run typecheck`
  - Expected: exits 0.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Independent usefulness critique gates curated state.
- Critique verdict vocabulary excludes `blocked`.
- Critique reviews rendered markdown and evidence map.

## Risks And Rollback

- Risk: provider invocation may add latency. Keep it first-create only and behind deterministic validation so bad drafts fail before model review.
- Rollback: remove critique gate and artifact wiring. Do not mark create output curated without this chunk in the final integrated feature.

## Non-Goals

- No answer synthesis.
- No human review UI.
- No maintenance-mode critique.

## Type And Name Consistency

Before finishing, verify `PROJECT_MEMORY_USEFULNESS_CRITIQUE_ARTIFACT`, `ProjectMemoryUsefulnessCritique`, `usefulness_critique`, and verdict values match across service, tests, and result contracts.
