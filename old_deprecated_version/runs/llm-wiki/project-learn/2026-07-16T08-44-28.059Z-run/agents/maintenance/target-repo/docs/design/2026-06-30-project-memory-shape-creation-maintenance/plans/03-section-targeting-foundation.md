# Chunk 03: Section Targeting Foundation

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-quality-contract-and-diagnostics.md`
**Enables:** `05-maintain-mode-section-first-apply.md`, `06-project-memory-markdown-query.md`

## Goal

Establish stable Project Memory section identity and packet-visible wiki structure before maintenance writes target sections. This chunk chooses heading-derived section IDs with section hashes as the first implementation strategy, while keeping current entry-block maintenance as a compatibility path until chunk 05 changes write behavior.

## Source Artifacts

- `../spec.md`: `Maintenance target granularity`, `Retrieval And Query Shape`, and `Planning Boundary Guidance`.
- `../agenda.md`: Question 4 and roadmap audit recommendations.
- `../pseudocode/MaintenanceSectionTargetingFlow.md`, `../pseudocode/ProjectMemoryMarkdownQueryBoundary.md`.
- `../plans/01-quality-contract-and-diagnostics.md`.
- ADRs: `docs/adr/0021-keep-curated-project-memory-in-markdown.md`, `docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`.
- Current code: `src/project/project-memory-markdown-sections.ts`, `src/project/project-memory-packet.ts`, `src/project/project-memory-retrieval-contracts.ts`, `src/project/project-memory-lookup.ts`.
- Tests: `tests/project/project-memory-markdown-sections.test.ts`, `tests/project/project-memory-packet.test.ts`, `tests/memory/project-memory-retrieval-indexer.test.ts`.

## Relationships

- **Depends on:** Chunk 01 diagnostics vocabulary.
- **Enables:** Chunk 05 section-first operations and chunk 06 markdown-backed query resolution.
- **Shared contracts:** `ProjectMemoryCanonicalSectionRef`, packet `wiki.sections`, heading-derived `section_id`, `section_hash`.
- **Integration points:** Section manifest extraction, packet construction, retrieval index manifest, future maintenance targets.

## File Responsibility Map

**Create:**
- `src/project/project-memory-section-targets.ts` - section target helpers, target validation, and stable key formatting.
- `tests/project/project-memory-section-targets.test.ts` - section target key and stale-hash behavior.

**Modify:**
- `src/project/project-memory-packet.ts` - includes current wiki sections in `packet.wiki.sections`.
- `src/project/project-memory-markdown-sections.ts` - exports any missing helper needed to resolve a section by `wiki_path` and `section_id`.
- `src/project/project-memory-retrieval-contracts.ts` - ensures canonical section refs are reusable by packet, maintenance, and query.

**Test:**
- `tests/project/project-memory-markdown-sections.test.ts` - duplicate heading and hash stability.
- `tests/project/project-memory-packet.test.ts` - packet includes section structure.
- `tests/project/project-memory-section-targets.test.ts` - target resolution behavior.

## Implementation Tasks

### Task 1: Add section target helpers

**Files:**
- Create: `src/project/project-memory-section-targets.ts`
- Test: `tests/project/project-memory-section-targets.test.ts`

- [ ] **Step 1: Add tests for stable target keys**

```ts
import { describe, expect, test } from "bun:test";
import { sectionTargetKey, resolveSectionTarget } from "../../src/project/project-memory-section-targets.ts";

describe("Project Memory section targets", () => {
  test("formats section target keys from canonical wiki path and section id", () => {
    expect(sectionTargetKey({ wiki_path: "wiki/runtime.md", section_id: "commands" })).toBe("wiki/runtime.md#commands");
  });

  test("marks missing section targets as unresolved", () => {
    const result = resolveSectionTarget([], { wiki_path: "wiki/runtime.md", section_id: "commands" });
    expect(result.status).toBe("missing_section");
  });
});
```

- [ ] **Step 2: Implement target helpers**

```ts
import type { ProjectMemoryMarkdownSection } from "./project-memory-markdown-sections.ts";

export type ProjectMemorySectionTargetRef = {
  wiki_path: string;
  section_id: string;
  expected_section_hash?: string;
};

export type ProjectMemoryResolvedSectionTarget =
  | { status: "resolved"; section: ProjectMemoryMarkdownSection }
  | { status: "missing_section"; ref: ProjectMemorySectionTargetRef }
  | { status: "stale_hash"; ref: ProjectMemorySectionTargetRef; actual_hash: string };

export function sectionTargetKey(ref: Pick<ProjectMemorySectionTargetRef, "wiki_path" | "section_id">): string {
  return `${ref.wiki_path}#${ref.section_id}`;
}

export function resolveSectionTarget(
  sections: ProjectMemoryMarkdownSection[],
  ref: ProjectMemorySectionTargetRef,
): ProjectMemoryResolvedSectionTarget {
  const section = sections.find((item) => item.wiki_path === ref.wiki_path && item.section_id === ref.section_id);
  if (!section) return { status: "missing_section", ref };
  if (ref.expected_section_hash && section.section_hash !== ref.expected_section_hash) {
    return { status: "stale_hash", ref, actual_hash: section.section_hash };
  }
  return { status: "resolved", section };
}
```

### Task 2: Add sections to Project Memory packet

**Files:**
- Modify: `src/project/project-memory-packet.ts`
- Test: `tests/project/project-memory-packet.test.ts`

- [ ] **Step 1: Extend packet type**

Change `wiki` shape:

```ts
wiki: {
  page_count: number;
  pages: ProjectMemoryPage[];
  sections: ProjectMemoryMarkdownSection[];
};
```

- [ ] **Step 2: Populate packet sections**

Use the existing extractor in `buildProjectMemoryPacket`:

```ts
const sectionManifest = await extractProjectMemorySections(root, projectKey);
...
wiki: {
  page_count: pages.length,
  pages,
  sections: sectionManifest.sections,
},
```

If the target project's `wiki` directory is missing, keep existing degraded behavior and return `sections: []`.

- [ ] **Step 3: Test packet section visibility**

Create a fixture wiki page such as `wiki/runtime.md` with two headings and assert `packet.wiki.sections` includes `wiki/runtime.md`, `section_id`, `heading_path`, `section_hash`, and line numbers.

### Task 3: Preserve entry-block compatibility boundary

**Files:**
- Modify: `../plan.md` if implementation discovers a different section strategy is required.
- Modify: `src/project/project-memory-markdown-sections.ts` only if helper exports are needed.

- [ ] **Step 1: Record the strategy in implementation notes**

The implementation report for this chunk must state:

```text
Section identity strategy: heading-derived section_id plus section_hash.
Explicit marker strategy: deferred.
Entry-block compatibility: current entry apply remains until chunk 05.
```

## Verification

- Run: `bun test tests/project/project-memory-section-targets.test.ts`
  Expected: section key, missing target, and stale hash tests pass.
- Run: `bun test tests/project/project-memory-markdown-sections.test.ts`
  Expected: existing section extraction behavior still passes.
- Run: `bun test tests/project/project-memory-packet.test.ts`
  Expected: packet contains current wiki section structure.
- Run: `bun run typecheck`
  Expected: no TypeScript errors.
- Run: `git diff --check`
  Expected: no whitespace errors.

## Acceptance Criteria Covered

- Section identity is resolved before section-first maintenance.
- Current wiki structure is visible to the curator packet.
- Section refs remain canonical markdown refs, not SQLite row truth.
- Entry-block write behavior remains untouched until the maintenance chunk.

## Risks And Rollback

- Risk: heading-derived IDs change when headings change. Mitigation: use `section_hash` to detect stale targets and force review.
- Risk: packet size grows. Mitigation: later prompt budgeting can reduce section body text if needed; this chunk should expose structure first.
- Rollback: remove `wiki.sections` from packet and target helpers; retrieval extraction remains unchanged.

## Non-Goals

- Does not implement section patching or insertion.
- Does not change maintenance output operation enums.
- Does not add Project Memory query.

## Type And Name Consistency

Before finalizing implementation, verify that `wiki_path` values consistently include the `wiki/` prefix in section manifests and that maintenance plans account for page targets that are relative to the wiki root.
