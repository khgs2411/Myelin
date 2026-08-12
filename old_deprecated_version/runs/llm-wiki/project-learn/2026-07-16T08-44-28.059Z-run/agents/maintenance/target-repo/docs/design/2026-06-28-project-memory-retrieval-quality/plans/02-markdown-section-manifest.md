# Chunk 02: Markdown Section Manifest

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Completed  
**Depends on:** `01-retrieval-contracts-and-run-status.md`  
**Enables:** `03-retrieval-storage-and-vector-state.md`, `05-indexer-and-status-command.md`, `06-lookup-and-packet-quality.md`, `08-hint-generation-flow.md`

## Goal

Implement deterministic extraction of Project Memory wiki pages into stable section records and generated project-local state files. This chunk creates the canonical section refs and hashes used by storage, indexing, lookup hydration, hint validation, and evidence dependencies.

## Source Artifacts

- `../spec.md`: Target retrieval shape, hint freshness, testing strategy
- `../agenda.md`: Question 2 retrieval unit, Question 4 freshness
- `../pseudocode/ProjectMemoryMarkdownSections.ts`
- `../pseudocode/ProjectMemoryRetrievalStateFiles.md`
- `../pseudocode/ProjectMemoryRetrievalContracts.ts`
- `../../../../CONTEXT.md`: Structural Retrieval Metadata
- `../../../../docs/adr/0021-keep-curated-project-memory-in-markdown.md`
- `../../../../docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`
- `../../../../src/project/project-memory-lookup.ts`
- `../../../../src/runtime/fs.ts`
- `../../../../src/runtime/json.ts`

## Relationships

- **Depends on:** Chunk 1 retrieval contract types.
- **Enables:** SQLite rows and vector indexes can reference stable `ProjectMemoryCanonicalSectionRef` values; fallback lookup can score sections rather than whole pages.
- **Shared contracts:** `ProjectMemoryCanonicalSectionRef`, `ProjectMemorySectionManifest`, `sections.json`, `hint-status.json`.
- **Integration points:** `projects/<key>/wiki/**/*.md`, `projects/<key>/state/project-memory-retrieval/sections.json`, future hint files.

## File Responsibility Map

**Create:**

- `src/project/project-memory-markdown-sections.ts` - extracts pages and heading-bounded sections from canonical wiki markdown.
- `tests/project/project-memory-markdown-sections.test.ts` - verifies deterministic ids, hashes, snippets, categories, duplicate headings, and empty/missing wiki behavior.

**Modify:**

- No existing runtime files need to change unless utility exports from `runtime/json.ts` are required for writing generated state. Prefer local writes if existing helpers already support this.

**Test:**

- `tests/project/project-memory-markdown-sections.test.ts` - new focused coverage.

## Implementation Tasks

### Task 1: Add section extraction tests

**Files:**

- Create: `tests/project/project-memory-markdown-sections.test.ts`

- [ ] **Step 1: Create tests for stable extraction**

Use temporary projects and simple wiki files. The exact expected hashes should be computed by the implementation and asserted for stability between repeated runs rather than hardcoded.

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractProjectMemorySections,
  writeProjectMemorySectionManifest,
} from "../../src/project/project-memory-markdown-sections.ts";
import { readJsonIfExists } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-section-manifest-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("extracts deterministic page and heading section records", async () => {
  await mkdir(join(root, "projects", "demo", "wiki", "architecture"), { recursive: true });
  await writeFile(
    join(root, "projects", "demo", "wiki", "architecture", "ranking.md"),
    [
      "# Ranking",
      "",
      "Page overview text.",
      "",
      "## Proposal Ranking",
      "",
      "Ranking body.",
      "",
      "## Proposal Ranking",
      "",
      "Duplicate heading body.",
    ].join("\n"),
    "utf8",
  );

  const first = await extractProjectMemorySections(root, "demo");
  const second = await extractProjectMemorySections(root, "demo");

  expect(first.pages).toHaveLength(1);
  expect(first.pages[0]).toMatchObject({
    wiki_path: "wiki/architecture/ranking.md",
    category: "architecture",
    slug: "ranking",
    title: "Ranking",
  });
  expect(first.sections.map((section) => section.section_id)).toEqual([
    "ranking",
    "ranking/proposal-ranking",
    "ranking/proposal-ranking-2",
  ]);
  expect(first.sections.map((section) => section.section_hash)).toEqual(
    second.sections.map((section) => section.section_hash),
  );
  expect(first.sections[1].snippet).toContain("Ranking body.");
  expect(first.warnings).toEqual(expect.arrayContaining([expect.stringContaining("duplicate heading")]));
});

test("writes sections.json under project-memory-retrieval state", async () => {
  await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "index.md"), "# Demo\n\nProject memory.\n", "utf8");

  const manifest = await extractProjectMemorySections(root, "demo");
  const written = await writeProjectMemorySectionManifest(root, manifest);

  expect(written).toBe("projects/demo/state/project-memory-retrieval/sections.json");
  const stored = await readJsonIfExists(join(root, written));
  expect(stored).toMatchObject({ schema_version: 1, project_key: "demo" });
});

test("missing wiki directory returns empty manifest with warning", async () => {
  const manifest = await extractProjectMemorySections(root, "demo");

  expect(manifest.sections).toEqual([]);
  expect(manifest.pages).toEqual([]);
  expect(manifest.warnings[0]).toContain("wiki directory missing");
});
```

- [ ] **Step 2: Run the focused test**

Run: `rtk bun test tests/project/project-memory-markdown-sections.test.ts`  
Expected: fails because `project-memory-markdown-sections.ts` does not exist.

### Task 2: Implement extraction and manifest writing

**Files:**

- Create: `src/project/project-memory-markdown-sections.ts`

- [ ] **Step 1: Add exported types and helpers**

Use the chunk 1 `ProjectMemoryCanonicalSectionRef` type and keep this module independent from storage and providers.

```ts
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative } from "node:path";
import type { ProjectMemoryCanonicalSectionRef } from "./project-memory-retrieval-contracts.ts";
import { projectPath, resolveInside } from "../runtime/fs.ts";
import { stableJson } from "../runtime/json.ts";

export type ProjectMemoryMarkdownPage = {
  project_key: string;
  wiki_path: string;
  absolute_path: string;
  category: string | null;
  slug: string;
  title: string;
  page_hash: string;
  size_bytes: number;
};

export type ProjectMemoryMarkdownSection = ProjectMemoryCanonicalSectionRef & {
  heading_level: number;
  heading_text: string;
  body_text: string;
  snippet: string;
  start_line?: number;
  end_line?: number;
};

export type ProjectMemorySectionManifest = {
  schema_version: 1;
  project_key: string;
  generated_at: string;
  pages: ProjectMemoryMarkdownPage[];
  sections: ProjectMemoryMarkdownSection[];
  warnings: string[];
};
```

- [ ] **Step 2: Implement extraction**

The implementation should include these exported functions and the behavior shown here. Exact helper organization can vary if the exports remain stable.

```ts
export async function extractProjectMemorySections(
  root: string,
  projectKey: string,
  input: { now?: Date } = {},
): Promise<ProjectMemorySectionManifest> {
  const wikiRoot = projectPath(root, projectKey, "wiki");
  if (!(await isDirectory(wikiRoot))) {
    return {
      schema_version: 1,
      project_key: projectKey,
      generated_at: (input.now ?? new Date()).toISOString(),
      pages: [],
      sections: [],
      warnings: [`projects/${projectKey}/wiki directory missing`],
    };
  }

  const files = (await markdownFiles(wikiRoot)).sort();
  const pages: ProjectMemoryMarkdownPage[] = [];
  const sections: ProjectMemoryMarkdownSection[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const wikiPath = `wiki/${relative(wikiRoot, file).replaceAll("\\", "/")}`;
    const category = categoryFor(wikiPath);
    const title = titleForMarkdown(wikiPath, text);
    pages.push({
      project_key: projectKey,
      wiki_path: wikiPath,
      absolute_path: file,
      category,
      slug: basename(wikiPath, ".md"),
      title,
      page_hash: sha256(normalizeText(text)),
      size_bytes: Buffer.byteLength(text, "utf8"),
    });
    sections.push(...sectionsForPage({ projectKey, wikiPath, category, title, text, warnings }));
  }

  return {
    schema_version: 1,
    project_key: projectKey,
    generated_at: (input.now ?? new Date()).toISOString(),
    pages,
    sections,
    warnings,
  };
}

export async function writeProjectMemorySectionManifest(
  root: string,
  manifest: ProjectMemorySectionManifest,
): Promise<string> {
  const relativePath = `projects/${manifest.project_key}/state/project-memory-retrieval/sections.json`;
  const absolutePath = resolveInside(root, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${stableJson(manifest)}\n`, "utf8");
  return relativePath;
}
```

- [ ] **Step 3: Implement heading parsing and stable ids**

Rules:

- First `#` heading becomes the page/title section id.
- Text before the first heading becomes a `page-overview` section only when there is no first heading.
- Duplicate heading paths receive `-2`, `-3`, and so on.
- `section_hash` is `sha256:<hex>` over normalized heading path plus body text.

```ts
function sectionIdFor(headingPath: string[], ordinal: number): string {
  const base = headingPath.map(slugify).filter(Boolean).join("/") || "page-overview";
  return ordinal > 1 ? `${base}-${ordinal}` : base;
}

function sectionHash(input: { heading_path: string[]; body_text: string }): string {
  return `sha256:${sha256(`${input.heading_path.join("\n")}\n\n${normalizeText(input.body_text)}`)}`;
}

function snippetFor(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .join(" ")
    .slice(0, 500);
}
```

- [ ] **Step 4: Run focused tests**

Run: `rtk bun test tests/project/project-memory-markdown-sections.test.ts`  
Expected: passes.

## Verification

- `rtk bun test tests/project/project-memory-markdown-sections.test.ts`  
  Expected: passes and proves deterministic ids/hashes, manifest writing, and missing wiki behavior.
- `rtk bun run typecheck`  
  Expected: passes with no imports from storage, indexer, provider, or curator service.

## Acceptance Criteria Covered

- Canonical wiki markdown is split into stable section records.
- Section refs include path, category, page title, heading path, section id, and section hash.
- `sections.json` is derived project-local state under `state/project-memory-retrieval/`.
- Missing wiki is visible as a warning, not a canonical memory mutation.

## Risks And Rollback

- Risk: heading parsing may miss unusual markdown. Mitigation: use deterministic regex parsing first and emit warnings for unsupported shapes.
- Risk: duplicate heading ids can drift if ordinal assignment is not deterministic. Mitigation: count duplicate heading paths in sorted file order.
- Rollback: remove the new extractor file, test file, and any generated `sections.json` from test fixtures. No migrations are introduced.

## Non-Goals

- No SQLite rows.
- No vector embeddings.
- No semantic hint generation.
- No packet lookup integration.
- No validator or apply gating changes.

## Type And Name Consistency

Verify these names are exact:

- `extractProjectMemorySections`
- `writeProjectMemorySectionManifest`
- `ProjectMemoryMarkdownPage`
- `ProjectMemoryMarkdownSection`
- `ProjectMemorySectionManifest`
- `projects/<key>/state/project-memory-retrieval/sections.json`
