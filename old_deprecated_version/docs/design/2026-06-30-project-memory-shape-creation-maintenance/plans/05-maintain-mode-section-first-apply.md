# Chunk 05: Maintain Mode Section-First Apply

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-quality-contract-and-diagnostics.md`, `03-section-targeting-foundation.md`, `04-producer-boundary-and-packet-prioritization.md`
**Enables:** `07-dogfood-reset-and-validation.md`

## Goal

Evolve Project Memory maintenance from entry-first operations to section-first documentation updates. Maintenance should target existing sections when possible, create sections under owned pages when needed, create pages only for missing ownership, emit candidate dispositions, and stop before broad or shallow writes.

## Source Artifacts

- `../spec.md`: `Proposed Direction`, `Maintenance target granularity`, `Publication Quality States`.
- `../agenda.md`: Question 4.
- `../pseudocode/MaintenanceSectionTargetingFlow.md`.
- `../plans/01-quality-contract-and-diagnostics.md`, `../plans/03-section-targeting-foundation.md`, `../plans/04-producer-boundary-and-packet-prioritization.md`.
- ADRs: `docs/adr/0021-keep-curated-project-memory-in-markdown.md`, `docs/adr/0059-use-structured-project-memory-apply-payloads.md`, `docs/adr/0060-use-apply-journal-for-project-memory-writes.md`.
- Current code: `src/project/project-memory-curator-contracts.ts`, `src/project/project-memory-curator-output-schema.ts`, `src/project/project-memory-curator-validator.ts`, `src/project/project-memory-markdown-applier.ts`, `src/project/project-memory-markdown-renderer.ts`, `src/project/project-memory-section-targets.ts`.
- Tests: `tests/project/project-memory-curator-validator.test.ts`, `tests/project/project-memory-markdown-applier.test.ts`, `tests/project/project-memory-markdown-renderer.test.ts`.

## Relationships

- **Depends on:** Trusted quality gate, packet section structure, and producer priority/disposition metadata.
- **Enables:** Dogfood maintenance against real candidates and handoffs.
- **Shared contracts:** Maintenance operations `PATCH_SECTION`, `CREATE_SECTION`, `CREATE_PAGE`, `ATTACH_EVIDENCE`, `MARK_STALE`, `MARK_DISPUTED`, `NOOP`; section target refs; candidate dispositions.
- **Integration points:** Curator output schema, validator, renderer, applier, source consumption state.

## Resolved Decisions For Execution

- Section patching must use a resolved canonical section from chunk 03: `wiki_path`, `section_id`, `expected_section_hash`, `start_line`, `end_line`, and `heading_path`.
- The applier must re-extract sections immediately before applying and reject stale or missing section refs. It must not trust line ranges from provider output.
- Renderer helpers must patch by the resolved line range after hash verification, not by searching for heading text.
- Tests must include duplicate heading text, stale hash, missing section, and "only target range changed" cases.

## File Responsibility Map

**Create:**
- `src/project/project-memory-section-renderer.ts` - deterministic markdown section patch/insert helpers.
- `tests/project/project-memory-section-renderer.test.ts` - patch and insert behavior.

**Modify:**
- `src/project/project-memory-curator-contracts.ts` - section-first operation enums and maintenance item target shape.
- `src/project/project-memory-curator-output-schema.ts` - maintenance schema for section targets and candidate disposition.
- `src/project/project-memory-curator-validator.ts` - section target validation, ownership checks, and shallow/broad rewrite rejection.
- `src/project/project-memory-markdown-applier.ts` - applies eligible section operations through staged writes and journal.
- `src/project/project-memory-markdown-renderer.ts` - keeps entry-block rendering only for compatibility if needed by existing tests.

**Test:**
- `tests/project/project-memory-section-renderer.test.ts` - section update mechanics.
- `tests/project/project-memory-curator-validator.test.ts` - section target and disposition validation.
- `tests/project/project-memory-markdown-applier.test.ts` - staged section writes and source consumption.

## Implementation Tasks

### Task 1: Change maintenance contract to section-first

**Files:**
- Modify: `src/project/project-memory-curator-contracts.ts`
- Modify: `src/project/project-memory-curator-output-schema.ts`
- Test: `tests/project/project-memory-curator-output-schema.test.ts`

- [ ] **Step 1: Replace primary operations**

Update `PROJECT_MEMORY_MAINTENANCE_OPERATIONS`:

```ts
export const PROJECT_MEMORY_MAINTENANCE_OPERATIONS = [
  "PATCH_SECTION",
  "CREATE_SECTION",
  "CREATE_PAGE",
  "ATTACH_EVIDENCE",
  "MARK_STALE",
  "MARK_DISPUTED",
  "NOOP",
] as const;
```

Keep legacy entry operations only if required behind a clearly named compatibility union, not as the preferred curator contract.

- [ ] **Step 2: Add section target and disposition fields**

Extend `ProjectMemoryMaintenanceProposalItem`:

```ts
target: {
  target_kind: "existing_section" | "new_section_in_existing_page" | "new_page";
  wiki_path: string;
  section_id?: string;
  expected_section_hash?: string;
  heading_path?: string[];
  ownership_reason: string;
};
candidate_priority: "high" | "normal" | "low";
candidate_disposition: ProjectMemoryCandidateDisposition;
missing_coverage_diagnostic?: string;
```

Schema must require `target`, `candidate_priority`, and `candidate_disposition`.

### Task 2: Add deterministic section renderer

**Files:**
- Create: `src/project/project-memory-section-renderer.ts`
- Test: `tests/project/project-memory-section-renderer.test.ts`

- [ ] **Step 1: Add tests**

```ts
import { describe, expect, test } from "bun:test";
import { patchMarkdownSection, insertMarkdownSection } from "../../src/project/project-memory-section-renderer.ts";

describe("Project Memory section renderer", () => {
  test("patches only the resolved duplicate-heading range", () => {
    const page = "# Runtime\n\n## Commands\n\nfirst\n\n## Commands\n\nsecond\n";
    const next = patchMarkdownSection(page, {
      section: {
        wiki_path: "wiki/runtime.md",
        section_id: "commands/2",
        section_hash: "hash_before",
        heading_path: ["Runtime", "Commands"],
        start_line: 7,
        end_line: 9,
      },
      expected_section_hash: "hash_before",
      body: "run new\n",
    });
    expect(next).toContain("## Commands\n\nfirst");
    expect(next).toContain("## Commands\n\nrun new");
    expect(next).not.toContain("second");
  });

  test("rejects stale section hashes before patching", () => {
    expect(() =>
      patchMarkdownSection("# Runtime\n\n## Commands\n\nrun old\n", {
        section: {
          wiki_path: "wiki/runtime.md",
          section_id: "commands",
          section_hash: "actual_hash",
          heading_path: ["Runtime", "Commands"],
          start_line: 3,
          end_line: 5,
        },
        expected_section_hash: "stale_hash",
        body: "run new\n",
      }),
    ).toThrow("stale section hash");
  });
});
```

- [ ] **Step 2: Implement renderer helpers**

```ts
export type ResolvedMarkdownSectionRange = {
  wiki_path: string;
  section_id: string;
  section_hash: string;
  heading_path: string[];
  start_line: number;
  end_line: number;
};

export function patchMarkdownSection(text: string, input: {
  section: ResolvedMarkdownSectionRange;
  expected_section_hash: string;
  body: string;
}): string {
  if (input.section.section_hash !== input.expected_section_hash) {
    throw new Error(`stale section hash for ${input.section.wiki_path}#${input.section.section_id}`);
  }
  if (!Number.isInteger(input.section.start_line) || !Number.isInteger(input.section.end_line) || input.section.start_line <= 0) {
    throw new Error(`invalid section range for ${input.section.wiki_path}#${input.section.section_id}`);
  }
  const lines = text.split(/\r?\n/);
  const startIndex = input.section.start_line - 1;
  const endIndexInclusive = Math.min(input.section.end_line, lines.length) - 1;
  const headingLine = lines[startIndex] ?? "";
  if (!headingLine.startsWith("#")) {
    throw new Error(`section range does not start at heading for ${input.section.wiki_path}#${input.section.section_id}`);
  }
  return [
    ...lines.slice(0, startIndex + 1),
    "",
    input.body.trimEnd(),
    "",
    ...lines.slice(endIndexInclusive + 1),
  ].join("\n");
}

export function insertMarkdownSection(text: string, input: { after_heading_path?: string[]; heading: string; level: number; body: string }): string {
  const heading = `${"#".repeat(input.level)} ${input.heading}`;
  return `${text.trimEnd()}\n\n${heading}\n\n${input.body.trimEnd()}\n`;
}
```

### Task 3: Validate section-first targets

**Files:**
- Modify: `src/project/project-memory-curator-validator.ts`
- Test: `tests/project/project-memory-curator-validator.test.ts`

- [ ] **Step 1: Add target checks**

Validator must reject:

- `PATCH_SECTION` with missing or stale `target.section_id`;
- `CREATE_SECTION` without `target.ownership_reason`;
- `CREATE_PAGE` when an existing packet page owns the concept and no missing coverage reason is supplied;
- any operation where `candidate_disposition` is `applied_to_project_memory` but repo citations/inference are absent;
- broad page rewrite attempts that do not name a section or new page ownership.

Use `resolveSectionTarget(packet.wiki.sections, target)` from chunk 03.

### Task 4: Apply section-first writes

**Files:**
- Modify: `src/project/project-memory-markdown-applier.ts`
- Test: `tests/project/project-memory-markdown-applier.test.ts`

- [ ] **Step 1: Map operations to renderer helpers**

For each eligible item:

```ts
if (item.operation === "PATCH_SECTION" || item.operation === "ATTACH_EVIDENCE") {
  const resolved = resolveSectionTarget(currentSections, {
    wiki_path: `wiki/${item.target.wiki_path}`,
    section_id: item.target.section_id ?? "",
    expected_section_hash: item.target.expected_section_hash,
  });
  if (resolved.status !== "resolved") return skippedResult(`maintenance apply skipped: unresolved section target for ${item.id}`);
  nextPage = patchMarkdownSection(pageText, {
    section: resolved.section,
    expected_section_hash: item.target.expected_section_hash ?? resolved.section.section_hash,
    body: renderSectionBody(item),
  });
}
if (item.operation === "CREATE_SECTION") {
  nextPage = insertMarkdownSection(pageText, { heading: item.target.heading_path?.at(-1) ?? item.id, level: 2, body: renderSectionBody(item) });
}
```

For `CREATE_PAGE`, stage a new wiki page only after validator accepts missing ownership.

- [ ] **Step 2: Source consumption**

Source consumption records should use `terminal_decision: item.candidate_disposition` for supported terminal dispositions from chunk 04.

## Verification

- Run: `bun test tests/project/project-memory-section-renderer.test.ts`
  Expected: targeted patch/insert behavior is deterministic.
- Run: `bun test tests/project/project-memory-curator-output-schema.test.ts`
  Expected: maintenance schema accepts section-first target shape and rejects legacy missing targets.
- Run: `bun test tests/project/project-memory-curator-validator.test.ts`
  Expected: stale/missing section targets are rejected before apply.
- Run: `bun test tests/project/project-memory-markdown-applier.test.ts`
  Expected: section-first writes use apply journals and source consumption state.
- Run: `bun run typecheck`
  Expected: no TypeScript errors.
- Run: `git diff --check`
  Expected: no whitespace errors.

## Acceptance Criteria Covered

- Maintenance targets existing sections before creating pages.
- Candidates are prioritized but not copied directly into markdown.
- Missing coverage can be recorded without shallow writes.
- Broad page rewrites are not auto-applyable.

## Risks And Rollback

- Risk: heading-derived patching writes wrong section after heading edits. Mitigation: validator checks `expected_section_hash`.
- Risk: schema change breaks older provider outputs. Mitigation: chunk 05 is intentionally after chunk 03 and should update prompt/schema/tests together.
- Rollback: keep legacy entry operations as compatibility while disabling new section operations in validator.

## Non-Goals

- Does not implement query.
- Does not implement future producers.
- Does not run dogfood maintenance.

## Type And Name Consistency

Before finalizing implementation, verify operation enum names match contracts, output schema, validator, applier, renderer tests, and prompt language.
