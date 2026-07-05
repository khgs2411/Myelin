import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractProjectMemorySections,
  extractProjectMemorySectionsFromMarkdown,
  writeProjectMemorySectionManifest,
} from "../../src/project/project-memory-markdown-sections.ts";
import { renderPageDraft } from "../../src/project/project-memory-markdown-renderer.ts";
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

  const first = await extractProjectMemorySections(root, "demo", { now: new Date("2026-06-28T10:00:00.000Z") });
  const second = await extractProjectMemorySections(root, "demo", { now: new Date("2026-06-28T10:00:00.000Z") });

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

  const manifest = await extractProjectMemorySections(root, "demo", { now: new Date("2026-06-28T10:00:00.000Z") });
  const written = await writeProjectMemorySectionManifest(root, manifest);

  expect(written).toBe("projects/demo/state/project-memory-retrieval/sections.json");
  const stored = await readJsonIfExists(join(root, written));
  expect(stored).toMatchObject({ schema_version: 1, project_key: "demo" });
});

test("section extractor sees rendered create page sections", () => {
  const markdown = renderPageDraft({
    page_path: "storage-retrieval.md",
    title: "Storage And Retrieval",
    purpose: "Documents where Myelin stores memory and how retrieval points back to markdown.",
    sections: [
      {
        heading: "SQLite State",
        level: 2,
        body: { paragraphs: ["The root SQLite database lives at state/memory.db."] },
        evidence_refs: [{ kind: "repo_citation", ref: "src/memory/db.ts" }],
        repo_citations: [{ path: "src/memory/db.ts", line_start: 11, reason: "memory database path" }],
      },
    ],
    evidence_refs: [{ kind: "repo_citation", ref: "src/memory/db.ts" }],
    repo_citations: [{ path: "src/memory/db.ts", line_start: 11, reason: "memory database path" }],
  });

  const sections = extractProjectMemorySectionsFromMarkdown({
    projectKey: "llm-wiki",
    wikiPath: "wiki/storage-retrieval.md",
    text: markdown,
  });

  expect(sections.map((section) => section.heading_path.join(" > "))).toContain("Storage And Retrieval > SQLite State");
});

test("missing wiki directory returns empty manifest with warning", async () => {
  const manifest = await extractProjectMemorySections(root, "demo", { now: new Date("2026-06-28T10:00:00.000Z") });

  expect(manifest.sections).toEqual([]);
  expect(manifest.pages).toEqual([]);
  expect(manifest.warnings[0]).toContain("wiki directory missing");
});
