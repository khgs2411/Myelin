# Chunk 02: Markdown Entry Renderer And Safe Mutation

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-apply-payload-contracts-and-validation.md`
**Enables:** `03-apply-journal-staging-and-recovery.md`, `04-creation-apply.md`, `05-maintenance-apply.md`

## Goal

Create deterministic markdown rendering and safe page mutation helpers for Project Memory apply. This chunk builds provider-free code that renders structured page/entry payloads, replaces exact entry blocks, updates lifecycle markers, extracts bounded snippets, and resolves wiki-relative targets safely. It does not perform canonical write promotion or service integration.

## Source Artifacts

- `../spec.md`: Markdown Shape, Concrete Apply Payload, Error Handling.
- `../agenda.md`: Questions 1 and 4.
- `../pseudocode/ProjectMemoryEntryBlockFormat.md`
- `../pseudocode/src/project/project-memory-markdown-applier.ts`
- `../pseudocode/ProjectApplyGateBoundary.md`
- `../../../adr/0059-use-structured-project-memory-apply-payloads.md`
- `src/project/project-memory-apply-contracts.ts`
- `src/runtime/fs.ts`
- `src/project/project-memory-lookup.ts`

## Relationships

- **Depends on:** `ProjectMemoryApplyPayload`, `ProjectMemoryEntryDraft`, and `ProjectMemoryPageDraft` from chunk 01.
- **Enables:** staged apply, creation apply, maintenance apply.
- **Shared contracts:** stable `<!-- myelin-entry ... -->` markers, visible provenance rendering, bounded snippets.
- **Integration points:** `ProjectMemoryMarkdownApplier` in later chunks, validator path checks from chunk 01.

## File Responsibility Map

**Create:**

- `src/project/project-memory-markdown-renderer.ts` - pure rendering, parsing, entry block mutation, lifecycle mutation, and snippet extraction.
- `tests/project/project-memory-markdown-renderer.test.ts` - renderer and mutation tests.

**Modify:**

- None required outside exports unless the implementation chooses to re-export from an existing project barrel. There is no current barrel file.

**Test:**

- `tests/project/project-memory-markdown-renderer.test.ts` - exact marker replacement, provenance rendering, marker-breaking content rejection, lifecycle updates, snippets.

## Implementation Tasks

### Task 1: Add Renderer Tests First

**Files:**

- Create: `tests/project/project-memory-markdown-renderer.test.ts`

- [ ] **Step 1: Create tests for rendering and mutation**

```ts
import { expect, test } from "bun:test";
import {
  boundedSnippetForText,
  renderEntryBlock,
  renderPageDraft,
  updateEntryLifecycle,
  upsertEntryBlock,
} from "../../src/project/project-memory-markdown-renderer.ts";
import type { ProjectMemoryEntryDraft, ProjectMemoryPageDraft } from "../../src/project/project-memory-apply-contracts.ts";

test("renders entry blocks with stable markers and visible provenance", () => {
  const rendered = renderEntryBlock(entryDraft());

  expect(rendered).toContain('<!-- myelin-entry id="setup.cli" lifecycle="active" -->');
  expect(rendered).toContain("### Setup CLI");
  expect(rendered).toContain("Document CLI setup command.");
  expect(rendered).toContain("Provenance:");
  expect(rendered).toContain("- Evidence: project_candidate:cand_1 - durable setup");
  expect(rendered).toContain("- Repo: src/commands/project.ts:1-20 - CLI command registration");
  expect(rendered).toContain("<!-- /myelin-entry -->");
});

test("renders page drafts as human-readable markdown", () => {
  const rendered = renderPageDraft(pageDraft());

  expect(rendered.startsWith("# Setup\n")).toBe(true);
  expect(rendered).toContain("Setup workflows.");
  expect(rendered).toContain("Provenance:");
});

test("upserts entry blocks by exact entry id", () => {
  const original = ["# Setup", "", renderEntryBlock(entryDraft({ title: "Old Setup CLI", body: { paragraphs: ["Old text."] } })), ""].join("\n");
  const next = upsertEntryBlock(original, "setup.cli", renderEntryBlock(entryDraft()));

  expect(next).toContain("### Setup CLI");
  expect(next).toContain("Document CLI setup command.");
  expect(next).not.toContain("Old text.");
});

test("appends missing entry blocks under Project Memory Updates", () => {
  const next = upsertEntryBlock("# Setup\n", "setup.cli", renderEntryBlock(entryDraft()));

  expect(next).toContain("## Project Memory Updates");
  expect(next).toContain('id="setup.cli"');
});

test("updates lifecycle marker and appends lifecycle provenance", () => {
  const original = renderEntryBlock(entryDraft());
  const next = updateEntryLifecycle(original, "setup.cli", "stale_pending", "Lifecycle note.");

  expect(next).toContain('id="setup.cli" lifecycle="stale_pending"');
  expect(next).toContain("Lifecycle note.");
});

test("rejects marker-breaking entry content", () => {
  expect(() => renderEntryBlock(entryDraft({ body: { paragraphs: ["<!-- /myelin-entry -->"] } }))).toThrow(
    "Entry content cannot contain myelin-entry markers",
  );
});

test("extracts bounded snippets with truncation signal", () => {
  const snippet = boundedSnippetForText("wiki/setup/index.md", "setup.cli", "x".repeat(600), 120);

  expect(snippet.path).toBe("wiki/setup/index.md");
  expect(snippet.anchor).toBe("setup.cli");
  expect(snippet.text.length).toBeLessThanOrEqual(120);
  expect(snippet.truncated).toBe(true);
});

function entryDraft(overrides: Partial<ProjectMemoryEntryDraft> = {}): ProjectMemoryEntryDraft {
  return {
    entry_id: "setup.cli",
    title: "Setup CLI",
    body: { paragraphs: ["Document CLI setup command."] },
    lifecycle: "active",
    evidence_refs: [{ kind: "project_candidate", ref: "cand_1", note: "durable setup" }],
    repo_citations: [{ path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" }],
    applicability: { commands: ["myelin project learn demo"] },
    ...overrides,
  };
}

function pageDraft(): ProjectMemoryPageDraft {
  return {
    page_path: "setup/index.md",
    title: "Setup",
    purpose: "Setup workflows.",
    body: { paragraphs: ["Setup workflows."] },
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [{ path: "src/runtime/project-shell.ts", reason: "Project shell setup" }],
  };
}
```

- [ ] **Step 2: Run focused renderer tests**

Run: `bun test tests/project/project-memory-markdown-renderer.test.ts`

Expected: fails because `src/project/project-memory-markdown-renderer.ts` does not exist.

### Task 2: Implement Pure Markdown Renderer

**Files:**

- Create: `src/project/project-memory-markdown-renderer.ts`

- [ ] **Step 1: Add renderer implementation**

```ts
import { createHash } from "node:crypto";
import type {
  ProjectMemoryBoundedSnippet,
  ProjectMemoryEntryDraft,
  ProjectMemoryInferenceLabel,
  ProjectMemoryPageDraft,
} from "./project-memory-apply-contracts.ts";
import type { ProjectMemoryEvidenceRef, ProjectMemoryRepoCitation } from "./project-memory-curator-contracts.ts";

const ENTRY_START_RE = /<!-- myelin-entry id="([^"]+)" lifecycle="([^"]+)"(?: [^>]*)? -->/g;
const ENTRY_MARKER_RE = /<!-- \/?myelin-entry\b/;

export function renderEntryBlock(entry: ProjectMemoryEntryDraft): string {
  rejectMarkerBreakingContent([entry.title, ...entry.body.paragraphs, ...(entry.body.bullets ?? []), ...(entry.body.warnings ?? [])]);
  return [
    `<!-- myelin-entry id="${escapeAttr(entry.entry_id)}" lifecycle="${escapeAttr(entry.lifecycle)}" -->`,
    `### ${entry.title}`,
    "",
    ...renderMarkdownLines(entry.body),
    "",
    ...renderProvenance(entry.evidence_refs, entry.repo_citations, entry.inference),
    ...renderApplicability(entry.applicability),
    "<!-- /myelin-entry -->",
  ].join("\n");
}

export function renderPageDraft(page: ProjectMemoryPageDraft): string {
  rejectMarkerBreakingContent([page.title, page.purpose, ...page.body.paragraphs, ...(page.body.bullets ?? []), ...(page.body.warnings ?? [])]);
  return [
    `# ${page.title}`,
    "",
    page.purpose,
    "",
    ...renderMarkdownLines(page.body),
    "",
    ...renderProvenance(page.evidence_refs, page.repo_citations, page.inference),
    "",
  ].join("\n");
}

export function upsertEntryBlock(pageText: string, entryId: string, renderedBlock: string): string {
  const range = findEntryBlock(pageText, entryId);
  if (range) {
    return normalizeMarkdown(`${pageText.slice(0, range.start)}${renderedBlock}${pageText.slice(range.end)}`);
  }
  const base = pageText.trimEnd();
  const heading = base.includes("## Project Memory Updates") ? "" : "\n\n## Project Memory Updates";
  return normalizeMarkdown(`${base}${heading}\n\n${renderedBlock}`);
}

export function updateEntryLifecycle(pageText: string, entryId: string, lifecycle: string, reasonBlock: string): string {
  const range = findEntryBlock(pageText, entryId);
  if (!range) throw new Error(`Missing Project Memory entry block: ${entryId}`);
  const block = pageText.slice(range.start, range.end);
  const nextBlock = block
    .replace(/<!-- myelin-entry id="([^"]+)" lifecycle="([^"]+)"(.*?) -->/, `<!-- myelin-entry id="$1" lifecycle="${escapeAttr(lifecycle)}"$3 -->`)
    .replace("<!-- /myelin-entry -->", `\nLifecycle:\n\n${reasonBlock}\n\n<!-- /myelin-entry -->`);
  return normalizeMarkdown(`${pageText.slice(0, range.start)}${nextBlock}${pageText.slice(range.end)}`);
}

export function findEntryBlock(pageText: string, entryId: string): { start: number; end: number; text: string } | null {
  ENTRY_START_RE.lastIndex = 0;
  for (let match = ENTRY_START_RE.exec(pageText); match; match = ENTRY_START_RE.exec(pageText)) {
    if (match[1] !== entryId) continue;
    const close = pageText.indexOf("<!-- /myelin-entry -->", match.index);
    if (close === -1) throw new Error(`Unclosed Project Memory entry block: ${entryId}`);
    const end = close + "<!-- /myelin-entry -->".length;
    return { start: match.index, end, text: pageText.slice(match.index, end) };
  }
  return null;
}

export function boundedSnippetForText(path: string, anchor: string, text: string, maxChars = 800): ProjectMemoryBoundedSnippet {
  const truncated = text.length > maxChars;
  const visible = truncated ? text.slice(0, maxChars) : text;
  return {
    path,
    anchor,
    sha256: sha256(text),
    text: visible,
    truncated,
  };
}

export function normalizeMarkdown(text: string): string {
  return `${text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd()}\n`;
}

function renderMarkdownLines(body: ProjectMemoryEntryDraft["body"]): string[] {
  const lines: string[] = [];
  for (const paragraph of body.paragraphs) lines.push(paragraph, "");
  for (const bullet of body.bullets ?? []) lines.push(`- ${bullet}`);
  if ((body.bullets ?? []).length > 0) lines.push("");
  for (const warning of body.warnings ?? []) lines.push(`> ${warning}`, "");
  return lines.filter((line, index, all) => !(line === "" && all[index - 1] === ""));
}

function renderProvenance(
  evidenceRefs: ProjectMemoryEvidenceRef[],
  repoCitations: ProjectMemoryRepoCitation[],
  inference?: ProjectMemoryInferenceLabel,
): string[] {
  const lines = ["Provenance:", ""];
  for (const ref of evidenceRefs) {
    lines.push(`- Evidence: ${ref.kind}:${ref.ref}${ref.note ? ` - ${ref.note}` : ""}`);
  }
  for (const citation of repoCitations) {
    const range = citation.line_start ? `:${citation.line_start}${citation.line_end ? `-${citation.line_end}` : ""}` : "";
    lines.push(`- Repo: ${citation.path}${range} - ${citation.reason}`);
  }
  if (inference) {
    lines.push(`- Inference: ${inference.label} - ${inference.why_direct_repo_evidence_is_unavailable}`);
  }
  lines.push("");
  return lines;
}

function renderApplicability(applicability: ProjectMemoryEntryDraft["applicability"]): string[] {
  if (!applicability) return [];
  const lines = ["Applicability:", ""];
  for (const command of applicability.commands ?? []) lines.push(`- Commands: \`${command}\``);
  for (const path of applicability.repo_paths ?? []) lines.push(`- Repo path: \`${path}\``);
  for (const branch of applicability.branches ?? []) lines.push(`- Branch: \`${branch}\``);
  if (applicability.notes) lines.push(`- Notes: ${applicability.notes}`);
  lines.push("");
  return lines.length > 3 ? lines : [];
}

function rejectMarkerBreakingContent(values: string[]): void {
  if (values.some((value) => ENTRY_MARKER_RE.test(value))) {
    throw new Error("Entry content cannot contain myelin-entry markers");
  }
}

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
```

- [ ] **Step 2: Run focused renderer tests**

Run: `bun test tests/project/project-memory-markdown-renderer.test.ts`

Expected: exits `0`.

### Task 3: Add Wiki Target Resolution Helper

**Files:**

- Modify: `src/project/project-memory-markdown-renderer.ts`
- Test: `tests/project/project-memory-markdown-renderer.test.ts`

- [ ] **Step 1: Add tests for wiki target safety**

```ts
import { resolveWikiMarkdownTarget } from "../../src/project/project-memory-markdown-renderer.ts";

test("resolves safe wiki markdown targets under the project wiki root", () => {
  const resolved = resolveWikiMarkdownTarget("/repo", "demo", "setup/index.md");

  expect(resolved.relative_project_path).toBe("projects/demo/wiki/setup/index.md");
  expect(resolved.wiki_path).toBe("setup/index.md");
});

test("rejects unsafe wiki markdown targets", () => {
  expect(() => resolveWikiMarkdownTarget("/repo", "demo", "../state/project-memory.json")).toThrow("Unsafe wiki markdown target");
  expect(() => resolveWikiMarkdownTarget("/repo", "demo", "/tmp/out.md")).toThrow("Unsafe wiki markdown target");
  expect(() => resolveWikiMarkdownTarget("/repo", "demo", "setup.txt")).toThrow("Unsafe wiki markdown target");
});
```

- [ ] **Step 2: Implement target resolution**

Add imports:

```ts
import { relative } from "node:path";
import { projectPath } from "../runtime/fs.ts";
```

Add export:

```ts
export type ResolvedWikiMarkdownTarget = {
  absolute_path: string;
  relative_project_path: string;
  wiki_path: string;
};

export function resolveWikiMarkdownTarget(root: string, projectKey: string, wikiPath: string): ResolvedWikiMarkdownTarget {
  if (!wikiPath.endsWith(".md") || wikiPath.startsWith("/") || wikiPath.split("/").includes("..")) {
    throw new Error(`Unsafe wiki markdown target: ${wikiPath}`);
  }
  const absolute = projectPath(root, projectKey, "wiki", wikiPath);
  return {
    absolute_path: absolute,
    relative_project_path: relative(root, absolute).replaceAll("\\", "/"),
    wiki_path: wikiPath,
  };
}
```

- [ ] **Step 3: Run focused tests**

Run: `bun test tests/project/project-memory-markdown-renderer.test.ts`

Expected: exits `0`.

## Verification

Run:

```bash
bun test tests/project/project-memory-markdown-renderer.test.ts
bun run typecheck
git diff --check
```

Expected:

- Renderer tests pass.
- Typecheck exits `0`.
- Whitespace check exits `0`.

## Acceptance Criteria Covered

- Every durable page/entry write can render provenance or an explicit inference label.
- Stable machine-addressable markdown blocks support deterministic maintenance.
- Path traversal and non-wiki targets fail before writes.
- Changeset chunks can reuse bounded snippet extraction.

## Risks And Rollback

- Risk: marker regex may be too permissive or too strict for real wiki content.
- Rollback: this chunk is isolated to pure renderer helpers and tests; remove `src/project/project-memory-markdown-renderer.ts` and its test before any applier chunk depends on it.
- Risk: provenance text format may need small wording changes.
- Rollback: preserve visible provenance and stable marker properties while changing labels in this file and its tests.

## Non-Goals

- Does not write files.
- Does not stage or promote canonical outputs.
- Does not create apply journal/result/changeset artifacts.
- Does not decide whether a run may apply.
- Does not mutate candidate or handoff status.

## Type And Name Consistency

- Export pure functions from `src/project/project-memory-markdown-renderer.ts`.
- Keep `renderEntryBlock`, `renderPageDraft`, `upsertEntryBlock`, `updateEntryLifecycle`, `findEntryBlock`, `boundedSnippetForText`, and `resolveWikiMarkdownTarget` as the shared names for later chunks.
- Keep entry markers in the `myelin-entry` namespace.
