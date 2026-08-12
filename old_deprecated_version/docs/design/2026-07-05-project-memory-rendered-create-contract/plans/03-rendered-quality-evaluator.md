# Chunk 03: Rendered Quality Evaluator

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-sectioned-page-payload-renderer.md`, `02-answer-domain-contracts.md`
**Enables:** `05-create-mode-schema-validator.md`, `08-all-or-nothing-promotion-state.md`

## Goal

Compute create-mode content quality from rendered markdown sections, not curator-declared metadata. After this chunk, a draft that declares answer domains but renders thin or missing sections must evaluate as `shallow`.

## Source Artifacts

- `../spec.md`: Role Coverage Derived From Rendered Markdown, Quality Diagnostics, Testing Strategy.
- `../agenda.md`: documented current bug.
- `src/project/project-memory-markdown-renderer.ts`
- `src/project/project-memory-markdown-sections.ts`
- `src/project/project-memory-quality-contract.ts`
- `src/project/project-memory-curator-validator.ts`
- `tests/project/project-memory-quality-contract.test.ts`
- `tests/project/project-memory-curator-validator.test.ts`

## Relationships

- **Depends on:** Sectioned pages and answer-domain diagnostics.
- **Enables:** Schema/validator can use deterministic rendered diagnostics; promotion state can trust the deterministic status.
- **Shared contracts:** `evaluateRenderedProjectMemoryQuality`, `ProjectMemoryRenderedQualityInput`, `ProjectMemoryAnswerabilityQuestion`.
- **Integration points:** Validator consumes this helper in chunk 05.

## File Responsibility Map

**Create:**
- `src/project/project-memory-rendered-quality.ts` - render proposed page payloads, extract sections, compute domain coverage, answerability findings, and shallow findings.

**Modify:**
- `src/project/project-memory-quality-contract.ts` - export answerability fixture types if not already added in chunk 02.

**Test:**
- `tests/project/project-memory-rendered-quality.test.ts` - focused rendered-quality tests.
- `tests/project/project-memory-curator-validator.test.ts` - later chunk wires this helper; add fixtures now if useful.

## Implementation Tasks

### Task 1: Add Rendered Quality Helper

**Files:**
- Create: `src/project/project-memory-rendered-quality.ts`
- Test: `tests/project/project-memory-rendered-quality.test.ts`

- [ ] **Step 1: Create answerability fixture constants**

```ts
import { extractProjectMemorySectionsFromMarkdown } from "./project-memory-markdown-sections.ts";
import { renderPageDraft } from "./project-memory-markdown-renderer.ts";
import {
  evaluateProjectMemoryQuality,
  PROJECT_MEMORY_ANSWER_DOMAINS,
  type ProjectMemoryAnswerDomain,
  type ProjectMemoryQualityDiagnostics,
} from "./project-memory-quality-contract.ts";
import type { ProjectMemoryCreationPageDraft, ProjectMemoryCuratorMode } from "./project-memory-curator-contracts.ts";

export type ProjectMemoryAnswerabilityQuestion = {
  domain: ProjectMemoryAnswerDomain;
  question: string;
  required_terms: string[];
};

export const PROJECT_MEMORY_CREATE_ANSWERABILITY_QUESTIONS: ProjectMemoryAnswerabilityQuestion[] = [
  { domain: "storage_retrieval", question: "Where is the SQLite database stored?", required_terms: ["state/memory.db", "session", "project"] },
  { domain: "storage_retrieval", question: "How do Project Memory retrieval rows differ from Session Memory rows?", required_terms: ["derived", "markdown", "session"] },
  { domain: "command_workflows", question: "Which CLI commands operate Project Memory?", required_terms: ["project learn", "memory query"] },
  { domain: "curation_apply_lifecycle", question: "How is Project Memory created and applied?", required_terms: ["curator", "validation", "apply"] },
  { domain: "evidence_provenance_candidates", question: "How do candidates become Project Memory?", required_terms: ["candidate", "lead", "evidence"] },
  { domain: "current_work_roadmap_decisions", question: "Where are roadmap and decisions captured?", required_terms: ["ROADMAP", "ADR"] },
  { domain: "product_memory_model", question: "What is Project Memory in Myelin?", required_terms: ["living", "documentation", "repo"] },
];
```

- [ ] **Step 2: Implement rendered diagnostics**

```ts
export function evaluateRenderedProjectMemoryQuality(input: {
  mode: ProjectMemoryCuratorMode;
  pages: ProjectMemoryCreationPageDraft[];
  candidate_dispositions: ProjectMemoryQualityDiagnostics["candidate_dispositions"];
  missing_coverage: string[];
  blocked_reasons: string[];
  review_reasons: string[];
  now?: Date;
}): ProjectMemoryQualityDiagnostics {
  const renderedPages = input.pages.flatMap((page) => {
    const payloadPage = page.apply_payload?.pages?.[0];
    if (!payloadPage) return [];
    const markdown = renderPageDraft(payloadPage);
    const sections = extractProjectMemorySectionsFromMarkdown({
      projectKey: "draft",
      wikiPath: `wiki/${payloadPage.page_path}`,
      text: markdown,
    });
    return [{ page, markdown, sections }];
  });

  const domain_coverage = PROJECT_MEMORY_ANSWER_DOMAINS.map((domain) => {
    const pages = renderedPages.filter((entry) => entry.page.answer_domains.includes(domain));
    const sections = pages.flatMap((entry) => entry.sections);
    const bodyText = sections.map((section) => section.body_text).join("\n");
    return {
      domain,
      page_refs: pages.map((entry) => entry.page.target.path),
      section_refs: sections.map((section) => section.section_id),
      representative_questions: pages.flatMap((entry) => entry.page.representative_questions),
      citations_seen: countRepoCitations(bodyText),
      body_chars_seen: bodyText.replace(/\s/g, "").length,
      missing_topics: topicLabelCoverageFindings(domain, pages),
    };
  });

  const answerability_findings = answerabilityFindings(renderedPages.map((entry) => entry.markdown).join("\n"));
  const shallow_summary_findings = renderedPages.flatMap((entry) => shallowSectionFindings(entry.page.target.path, entry.sections));

  return evaluateProjectMemoryQuality({
    mode: input.mode,
    domain_coverage,
    candidate_dispositions: input.candidate_dispositions,
    missing_coverage: input.missing_coverage,
    shallow_summary_findings,
    answerability_findings,
    blocked_reasons: input.blocked_reasons,
    review_reasons: input.review_reasons,
  });
}
```

Implement local helpers:

```ts
function countRepoCitations(text: string): number {
  return [...text.matchAll(/^- Repo:/gm)].length;
}

function topicLabelCoverageFindings(
  domain: ProjectMemoryAnswerDomain,
  pages: { page: ProjectMemoryCreationPageDraft; sections: { body_text: string }[] }[],
): string[] {
  const hasRenderedCoverage = pages.some((entry) =>
    entry.page.required_topics.length > 0 &&
    entry.sections.some((section) => section.body_text.replace(/\s/g, "").length >= 300),
  );
  return hasRenderedCoverage ? [] : [`${domain}:required topic labels have no useful rendered coverage`];
}

function answerabilityFindings(markdown: string): string[] {
  const normalized = markdown.toLowerCase();
  return PROJECT_MEMORY_CREATE_ANSWERABILITY_QUESTIONS
    .filter((question) => question.required_terms.some((term) => !normalized.includes(term.toLowerCase())))
    .map((question) => `missing answerability evidence for ${question.domain}: ${question.question}`);
}

function shallowSectionFindings(pagePath: string, sections: { body_text: string; heading_path: string[] }[]): string[] {
  return sections
    .filter((section) => section.body_text.replace(/\s/g, "").length < 300)
    .map((section) => `section too shallow in ${pagePath}: ${section.heading_path.join(" > ")}`);
}
```

### Task 2: Add Thin-Section Regression Tests

**Files:**
- Create: `tests/project/project-memory-rendered-quality.test.ts`

- [ ] **Step 1: Prove declared domains do not pass without rendered depth**

```ts
test("rendered quality rejects declared domains with thin rendered sections", () => {
  const diagnostics = evaluateRenderedProjectMemoryQuality({
    mode: "create",
    pages: [thinStoragePageDraft()],
    candidate_dispositions: [],
    missing_coverage: [],
    blocked_reasons: [],
    review_reasons: [],
    now: new Date("2026-07-05T00:00:00.000Z"),
  });

  expect(diagnostics.content_quality.status).toBe("shallow");
  expect(diagnostics.content_quality.reasons.join("\n")).toContain("missing required answer domain");
  expect(diagnostics.shallow_summary_findings.join("\n")).toContain("section too shallow");
});
```

- [ ] **Step 2: Prove representative storage content can satisfy its domain**

Create a fixture with a `storage_retrieval` page containing `state/memory.db`, `session`, `project`, `derived`, and `markdown`, with repo citations. Assert storage coverage has sections and citations.

- [ ] **Step 3: Prove required topics are coverage labels, not exact prose terms**

Create a fixture whose `required_topics` labels are descriptive labels such as `"storage state boundary"` while rendered section prose covers the domain with enough depth, citations, and answerability terms without repeating the label verbatim. Assert `domain_coverage[].missing_topics` stays empty.

## Verification

- Run: `bun test tests/project/project-memory-rendered-quality.test.ts`
  - Expected: exits 0; thin section is `shallow`.
- Run: `bun test tests/project/project-memory-quality-contract.test.ts`
  - Expected: exits 0 with domain evaluator behavior intact.
- Run: `bun run typecheck`
  - Expected: exits 0 after matching the actual section manifest field names.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Quality is computed from rendered markdown sections.
- Declared create metadata cannot substitute for rendered sections.
- `required_topics` are labels validated through rendered domain coverage, not brittle exact body-text matches.
- Shallow role-shaped output has a deterministic failure path.
- Answerability coverage has a concrete fixture surface.

## Risks And Rollback

- Risk: the actual section manifest field names may differ from the helper sketch. Inspect `src/project/project-memory-markdown-sections.ts` before final edits and use exported names.
- Rollback: remove `project-memory-rendered-quality.ts` and its tests. Downstream chunks should not proceed without this evaluator.

## Non-Goals

- No schema or prompt changes.
- No independent model critique.
- No apply/promotion state changes.

## Type And Name Consistency

Before finishing, verify `evaluateRenderedProjectMemoryQuality`, `PROJECT_MEMORY_CREATE_ANSWERABILITY_QUESTIONS`, and `answerability_findings` are imported consistently by downstream chunks.
