# Chunk 01: Sectioned Page Payload Renderer

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** None
**Enables:** `02-answer-domain-contracts.md`, `03-rendered-quality-evaluator.md`

## Goal

Replace create-mode page payloads that publish one free-form body with ordered page sections that render as real markdown headings. After this chunk, `renderPageDraft` must emit `##` sections from structured payloads, and the existing markdown section extractor must see those same sections.

## Source Artifacts

- `../spec.md`: Sectioned Page Payloads, Role Coverage Derived From Rendered Markdown, Testing Strategy.
- `../agenda.md`: Question 1 and the documented current quality bug.
- `../plan.md`: Shared contract "Sectioned page apply payload".
- `src/project/project-memory-apply-contracts.ts`
- `src/project/project-memory-markdown-renderer.ts`
- `src/project/project-memory-markdown-sections.ts`
- `src/project/project-memory-markdown-applier.ts`
- `tests/project/project-memory-markdown-renderer.test.ts`
- `tests/project/project-memory-markdown-sections.test.ts`
- `tests/project/project-memory-markdown-applier.test.ts`

## Relationships

- **Depends on:** No prior chunk.
- **Enables:** Answer-domain contracts can attach domains to rendered sections; rendered quality can inspect actual sections.
- **Shared contracts:** `ProjectMemoryPageDraft.sections`, `ProjectMemorySectionDraft`, `renderPageDraft`, `extractProjectMemorySectionsFromMarkdown`.
- **Integration points:** Apply validation in `project-memory-curator-validator.ts` still accepts the new payload shape in chunk 05; this chunk only changes shared types, renderer behavior, and renderer/extractor tests.

## File Responsibility Map

**Modify:**
- `src/project/project-memory-apply-contracts.ts` - make create page drafts sectioned while keeping `ProjectMemoryMarkdownLines` and section provenance types reusable.
- `src/project/project-memory-markdown-renderer.ts` - render ordered `##` sections and section-level provenance.

**Test:**
- `tests/project/project-memory-markdown-renderer.test.ts` - verifies sectioned rendering and marker rejection.
- `tests/project/project-memory-markdown-sections.test.ts` - verifies extracted sections match rendered create sections.
- `tests/project/project-memory-markdown-applier.test.ts` - update fixture payloads from page body to page sections where create-mode rendering is exercised.

## Implementation Tasks

### Task 1: Introduce Sectioned Page Drafts

**Files:**
- Modify: `src/project/project-memory-apply-contracts.ts`
- Test: `tests/project/project-memory-markdown-renderer.test.ts`

- [ ] **Step 1: Update the page draft contract**

Replace the create page draft body field with ordered sections. Keep `ProjectMemorySectionDraft.level` because maintenance section payloads already use it, but create-mode page rendering will normalize page sections to `##`.

```ts
export type ProjectMemoryPageDraft = {
  page_path: string;
  title: string;
  purpose: string;
  sections: ProjectMemorySectionDraft[];
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  inference?: ProjectMemoryInferenceLabel;
};

export type ProjectMemorySectionDraft = {
  heading: string;
  level: number;
  body: ProjectMemoryMarkdownLines;
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  inference?: ProjectMemoryInferenceLabel;
};
```

- [ ] **Step 2: Update renderer tests first**

Add a test that proves rendered sections are real markdown headings. Use the repo's current Bun test style in `tests/project/project-memory-markdown-renderer.test.ts`.

```ts
test("renderPageDraft renders ordered page sections as markdown headings with section provenance", () => {
  const rendered = renderPageDraft({
    page_path: "storage-retrieval.md",
    title: "Storage And Retrieval",
    purpose: "Documents where Myelin stores memory and how retrieval points back to markdown.",
    sections: [
      {
        heading: "SQLite State",
        level: 2,
        body: {
          paragraphs: ["The root SQLite database lives at state/memory.db."],
          bullets: ["Session Memory and Project Memory retrieval rows are different tables."],
          warnings: [],
        },
        evidence_refs: [{ kind: "repo_citation", ref: "src/memory/db.ts" }],
        repo_citations: [{ path: "src/memory/db.ts", line_start: 11, reason: "memory database path" }],
      },
    ],
    evidence_refs: [{ kind: "repo_citation", ref: "src/memory/db.ts" }],
    repo_citations: [{ path: "src/memory/db.ts", line_start: 11, reason: "memory database path" }],
  });

  expect(rendered).toContain("# Storage And Retrieval\n");
  expect(rendered).toContain("## SQLite State\n");
  expect(rendered).toContain("The root SQLite database lives at state/memory.db.");
  expect(rendered).toContain("- Repo: src/memory/db.ts:11 - memory database path");
});
```

Expected focused failure before implementation: TypeScript/test failure because `ProjectMemoryPageDraft` no longer matches `renderPageDraft`.

### Task 2: Render Sectioned Markdown

**Files:**
- Modify: `src/project/project-memory-markdown-renderer.ts`
- Test: `tests/project/project-memory-markdown-renderer.test.ts`

- [ ] **Step 1: Add section rendering helpers**

Use this implementation shape. Keep `renderMarkdownLines` private and reuse existing provenance rendering.

```ts
export function renderPageDraft(page: ProjectMemoryPageDraft): string {
  rejectMarkerBreakingContent([
    page.page_path,
    page.title,
    page.purpose,
    ...page.sections.flatMap((section) => [
      section.heading,
      ...section.body.paragraphs,
      ...(section.body.bullets ?? []),
      ...(section.body.warnings ?? []),
    ]),
  ]);

  return normalizeMarkdown([
    `# ${page.title}`,
    "",
    page.purpose,
    "",
    ...page.sections.flatMap((section) => renderPageSection(section)),
    ...renderPageProvenance(page),
    "",
  ].join("\n"));
}

function renderPageSection(section: ProjectMemoryPageDraft["sections"][number]): string[] {
  return [
    `## ${section.heading}`,
    "",
    ...renderMarkdownLines(section.body),
    "",
    ...renderProvenance(section.evidence_refs, section.repo_citations, section.inference),
    "",
  ];
}

function renderPageProvenance(page: ProjectMemoryPageDraft): string[] {
  return [
    "Page provenance:",
    "",
    ...renderProvenance(page.evidence_refs, page.repo_citations, page.inference).slice(2),
  ];
}
```

- [ ] **Step 2: Preserve marker rejection for section content**

Add or update a test that inserts `"<!-- myelin-entry"` in a section paragraph and expects `renderPageDraft` to throw `Entry content cannot contain myelin-entry markers`.

### Task 3: Verify Extractor Compatibility

**Files:**
- Test: `tests/project/project-memory-markdown-sections.test.ts`

- [ ] **Step 1: Add rendered-section extraction coverage**

Add a test around `extractProjectMemorySectionsFromMarkdown` using `renderPageDraft` output:

```ts
test("section extractor sees rendered create page sections", () => {
  const markdown = renderPageDraft(sectionedStoragePageFixture());
  const sections = extractProjectMemorySectionsFromMarkdown({
    projectKey: "llm-wiki",
    wikiPath: "wiki/storage-retrieval.md",
    text: markdown,
  });

  expect(sections.map((section) => section.heading_path.join(" > "))).toContain("Storage And Retrieval > SQLite State");
});
```

The helper `sectionedStoragePageFixture` can live in the test file unless existing fixtures already provide a better local pattern.

### Task 4: Update Create Fixtures

**Files:**
- Modify tests that construct `ProjectMemoryPageDraft` or create-mode `apply_payload.pages`.

- [ ] **Step 1: Replace body payloads with sections**

Where create fixtures currently use:

```ts
body: { paragraphs: ["..."], bullets: [], warnings: [] }
```

replace with:

```ts
sections: [{
  heading: "SQLite State",
  level: 2,
  body: { paragraphs: ["..."], bullets: [], warnings: [] },
  evidence_refs: [{ kind: "repo_citation", ref: "src/memory/db.ts" }],
  repo_citations: [{ path: "src/memory/db.ts", line_start: 11, reason: "memory database path" }],
}]
```

Keep maintain-mode entry and section payload fixtures unchanged.

## Verification

- Run: `bun test tests/project/project-memory-markdown-renderer.test.ts`
  - Expected: exits 0 and includes the new section rendering tests.
- Run: `bun test tests/project/project-memory-markdown-sections.test.ts`
  - Expected: exits 0 and the extractor sees `##` sections from `renderPageDraft`.
- Run: `bun test tests/project/project-memory-markdown-applier.test.ts`
  - Expected: exits 0 after fixture updates.
- Run: `bun run typecheck`
  - Expected: exits 0 with no remaining `ProjectMemoryPageDraft.body` errors in create-mode paths.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Page rendering outputs real `##` sections from structured section payloads.
- Section extraction sees the same sections rendered by create mode.
- Project Memory retrieval can keep deriving section units from canonical markdown.

## Risks And Rollback

- Risk: existing create fixtures are numerous and type failures may be broad. Keep the change scoped to page payloads and renderer tests; validator/schema migration belongs to chunk 05.
- Rollback: revert `ProjectMemoryPageDraft.sections` and `renderPageDraft` changes. This chunk should not modify persistence state.

## Non-Goals

- No answer-domain schema.
- No rendered quality scoring.
- No curator prompt changes.
- No canonical apply behavior changes beyond rendering sectioned page payloads.

## Type And Name Consistency

Before finishing, verify `ProjectMemoryPageDraft.sections`, `ProjectMemorySectionDraft`, `renderPageDraft`, and every updated fixture use the same field names and import paths.
