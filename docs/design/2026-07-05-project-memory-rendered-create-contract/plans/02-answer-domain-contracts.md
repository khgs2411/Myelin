# Chunk 02: Answer-Domain Contracts

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-sectioned-page-payload-renderer.md`
**Enables:** `03-rendered-quality-evaluator.md`, `04-evidence-map-builder.md`, `05-create-mode-schema-validator.md`

## Goal

Replace the old create-mode role taxonomy with an answer-domain documentation contract. After this chunk, create-mode contracts and diagnostics use required answer domains instead of `PROJECT_MEMORY_DOCUMENTATION_ROLES`, while maintain-mode compatibility is preserved where existing maintenance code still needs role-era data.

## Source Artifacts

- `../spec.md`: Answer-Domain Documentation Map, Create-Mode Coverage Requirements, Quality Diagnostics.
- `../agenda.md`: Question 1.
- `../../../../CONTEXT.md`: Answer-Domain Documentation Map.
- `../../../adr/0063-use-answer-domain-project-memory-documentation-map.md`
- `src/project/project-memory-quality-contract.ts`
- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-curator-output-schema.ts`
- `src/project/project-memory-prompt-budget.ts`
- `tests/project/project-memory-quality-contract.test.ts`
- `tests/project/project-memory-curator-contracts.test.ts`
- `tests/project/project-memory-prompt-budget.test.ts`

## Relationships

- **Depends on:** Chunk 01 provides sectioned create pages.
- **Enables:** Rendered quality can score section/domain coverage; evidence map can target domains; schema/validator can require domain fields.
- **Shared contracts:** `PROJECT_MEMORY_ANSWER_DOMAINS`, `ProjectMemoryAnswerDomain`, `ProjectMemoryAnswerDomainCoverage`, `ProjectMemoryQualityDiagnostics.domain_coverage`.
- **Integration points:** Existing role exports may remain as legacy exports only if maintain-mode tests require them; create-mode code must not use roles as authority.

## File Responsibility Map

**Modify:**
- `src/project/project-memory-quality-contract.ts` - define answer domains and diagnostic coverage types.
- `src/project/project-memory-curator-contracts.ts` - replace create page `role` and `required_sections` with answer-domain fields.
- `src/project/project-memory-prompt-budget.ts` - change create-mode prompt language from roles to answer domains.

**Test:**
- `tests/project/project-memory-quality-contract.test.ts` - answer-domain evaluation surface.
- `tests/project/project-memory-curator-contracts.test.ts` - exported contract names.
- `tests/project/project-memory-prompt-budget.test.ts` - prompt names answer domains and does not ask for roles in create mode.

## Implementation Tasks

### Task 1: Define Answer-Domain Types

**Files:**
- Modify: `src/project/project-memory-quality-contract.ts`
- Test: `tests/project/project-memory-quality-contract.test.ts`

- [ ] **Step 1: Add domain constants and coverage type**

Keep old role exports only if existing maintain-mode imports still need them. Add this create-mode authority:

```ts
export const PROJECT_MEMORY_ANSWER_DOMAINS = [
  "product_memory_model",
  "storage_retrieval",
  "command_workflows",
  "curation_apply_lifecycle",
  "evidence_provenance_candidates",
  "current_work_roadmap_decisions",
] as const;

export type ProjectMemoryAnswerDomain = (typeof PROJECT_MEMORY_ANSWER_DOMAINS)[number];

export type ProjectMemoryAnswerDomainCoverage = {
  domain: ProjectMemoryAnswerDomain;
  page_refs: string[];
  section_refs: string[];
  representative_questions: string[];
  citations_seen: number;
  body_chars_seen: number;
  missing_topics: string[];
};
```

- [ ] **Step 2: Extend diagnostics shape**

Use domain coverage as the create-mode diagnostics authority:

```ts
export type ProjectMemoryQualityDiagnostics = {
  schema_version: 1;
  content_quality: { status: ProjectMemoryContentQualityStatus; reasons: string[] };
  retrieval_readiness: { status: ProjectMemoryRetrievalReadinessStatus; reason?: string | null };
  domain_coverage: ProjectMemoryAnswerDomainCoverage[];
  candidate_dispositions: { source_ref: string; disposition: ProjectMemoryCandidateDisposition; reason: string }[];
  missing_coverage: string[];
  shallow_summary_findings: string[];
  answerability_findings: string[];
};
```

If maintain-mode code still compiles only with `role_coverage`, add a transitional optional field:

```ts
role_coverage?: ProjectMemoryRoleCoverage[];
```

but create-mode evaluation must ignore it.

### Task 2: Make Quality Evaluation Domain-Based

**Files:**
- Modify: `src/project/project-memory-quality-contract.ts`
- Test: `tests/project/project-memory-quality-contract.test.ts`

- [ ] **Step 1: Update evaluator input and logic**

Replace role iteration with domain iteration:

```ts
export function evaluateProjectMemoryQuality(input: {
  mode: ProjectMemoryCuratorMode;
  domain_coverage: ProjectMemoryAnswerDomainCoverage[];
  candidate_dispositions: ProjectMemoryQualityDiagnostics["candidate_dispositions"];
  missing_coverage: string[];
  shallow_summary_findings: string[];
  answerability_findings: string[];
  blocked_reasons: string[];
  review_reasons: string[];
}): ProjectMemoryQualityDiagnostics {
  if (input.blocked_reasons.length > 0) return diagnosticsFor(input, "blocked", input.blocked_reasons);

  const reasons: string[] = [];
  if (input.mode === "create") {
    for (const domain of PROJECT_MEMORY_ANSWER_DOMAINS) {
      const coverage = input.domain_coverage.find((item) => item.domain === domain);
      if (!coverage) reasons.push(`missing required answer domain: ${domain}`);
      else if (coverage.section_refs.length < 1) reasons.push(`answer domain has no rendered sections: ${domain}`);
      else if (coverage.citations_seen < 1) reasons.push(`answer domain has insufficient repo citation coverage: ${domain}`);
      else if (coverage.body_chars_seen < 300) reasons.push(`answer domain has shallow body coverage: ${domain}`);
      for (const topic of coverage?.missing_topics ?? []) reasons.push(`answer domain missing topic ${domain}: ${topic}`);
    }
  }

  reasons.push(...input.missing_coverage, ...input.shallow_summary_findings, ...input.answerability_findings);
  if (reasons.length > 0) return diagnosticsFor(input, "shallow", reasons);
  if (input.review_reasons.length > 0) return diagnosticsFor(input, "review_only", input.review_reasons);
  return diagnosticsFor(input, "trusted", []);
}
```

### Task 3: Replace Create Page Role Fields

**Files:**
- Modify: `src/project/project-memory-curator-contracts.ts`

- [ ] **Step 1: Update imports and exports**

Export the new answer-domain types from the curator contract module:

```ts
export {
  PROJECT_MEMORY_ANSWER_DOMAINS,
  PROJECT_MEMORY_CANDIDATE_DISPOSITIONS,
  PROJECT_MEMORY_CONTENT_QUALITY_STATUSES,
  PROJECT_MEMORY_RETRIEVAL_READINESS_STATUSES,
} from "./project-memory-quality-contract.ts";

export type {
  ProjectMemoryAnswerDomain,
  ProjectMemoryAnswerDomainCoverage,
  ProjectMemoryCandidateDisposition,
  ProjectMemoryContentQualityStatus,
  ProjectMemoryQualityDiagnostics,
  ProjectMemoryRetrievalReadinessStatus,
} from "./project-memory-quality-contract.ts";
```

- [ ] **Step 2: Update `ProjectMemoryCreationPageDraft`**

Replace:

```ts
role: ProjectMemoryDocumentationRole;
required_sections: string[];
```

with:

```ts
answer_domains: ProjectMemoryAnswerDomain[];
required_topics: string[];
representative_questions: string[];
```

Keep `inspected_surface_refs`, `evidence_refs`, and `repo_citations`.

### Task 4: Update Create-Mode Prompt Vocabulary

**Files:**
- Modify: `src/project/project-memory-prompt-budget.ts`
- Test: `tests/project/project-memory-prompt-budget.test.ts`

- [ ] **Step 1: Replace role instructions**

Change create-mode instructions from role coverage to answer-domain coverage:

```ts
`Create mode: cover all required answer domains: ${PROJECT_MEMORY_ANSWER_DOMAINS.join(", ")}.`,
"Create mode: each page draft must name answer_domains, required_topics, representative_questions, inspected_surface_refs, and a concrete sectioned apply_payload.",
"Do not use the old documentation role taxonomy as create-mode authority.",
```

- [ ] **Step 2: Add prompt assertion**

Assert the prompt contains `storage_retrieval` and does not contain `cover all required roles`.

## Verification

- Run: `bun test tests/project/project-memory-quality-contract.test.ts`
  - Expected: exits 0 and proves missing required answer domains produce `shallow`.
- Run: `bun test tests/project/project-memory-curator-contracts.test.ts`
  - Expected: exits 0 with new answer-domain exports.
- Run: `bun test tests/project/project-memory-prompt-budget.test.ts`
  - Expected: exits 0 and create prompt uses answer-domain language.
- Run: `bun run typecheck`
  - Expected: exits 0 or exposes only downstream chunk-owned schema/validator references if this chunk is implemented independently; resolve local contract errors before ending.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Answer-domain documentation replaces six-role create taxonomy.
- Old roles are no longer create-mode authority.
- Initial Myelin answer domains are named in shared contracts.

## Risks And Rollback

- Risk: role names are imported broadly. Preserve legacy exports until all dependent chunks remove create-mode use.
- Rollback: restore previous `ProjectMemoryQualityDiagnostics` and create page fields. This chunk should not write project state or wiki files.

## Non-Goals

- No rendered section scoring beyond the basic domain evaluator.
- No JSON schema update; that belongs to chunk 05.
- No evidence-map implementation; that belongs to chunk 04.

## Type And Name Consistency

Before finishing, verify all create-mode references use `answer_domains`, `required_topics`, `representative_questions`, `domain_coverage`, and `PROJECT_MEMORY_ANSWER_DOMAINS`.
