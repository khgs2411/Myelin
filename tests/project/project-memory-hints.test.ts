import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  projectMemoryHintHash,
  validateProjectMemoryHintFile,
  writeProjectMemoryHintFile,
  writeProjectMemoryHintStatus,
  type ProjectMemoryHintEntry,
  type ProjectMemoryHintFile,
} from "../../src/project/project-memory-hints.ts";
import type { ProjectMemorySectionManifest } from "../../src/project/project-memory-markdown-sections.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-pm-hints-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("validates hints against current section refs and hashes", () => {
  const result = validateProjectMemoryHintFile(manifestWithSection("sha256:section"), hintFile([hintEntry()]));

  expect(result.valid_entries).toHaveLength(1);
  expect(result.status_entries[0]).toMatchObject({ status: "valid", reason: null });
});

test("marks changed hash hints stale and missing refs orphaned", () => {
  const result = validateProjectMemoryHintFile(
    manifestWithSection("sha256:current"),
    hintFile([
      hintEntry({ section_hash: "sha256:old" }),
      hintEntry({ section_id: "missing", section_hash: "sha256:current" }),
    ]),
  );

  expect(result.status_entries.map((entry) => entry.status)).toEqual(["stale", "orphaned"]);
  expect(result.valid_entries).toEqual([]);
});

test("excludes low-confidence hints from valid embedding inputs", () => {
  const result = validateProjectMemoryHintFile(
    manifestWithSection("sha256:section"),
    hintFile([hintEntry({ confidence: "low" })]),
  );

  expect(result.valid_entries).toEqual([]);
  expect(result.status_entries[0]).toMatchObject({ status: "low_confidence" });
});

test("writes category hint files and hint status under retrieval state", async () => {
  const hints = hintFile([hintEntry()]);

  const hintPath = await writeProjectMemoryHintFile(root, hints);
  const statusPath = await writeProjectMemoryHintStatus(root, "demo", [
    { wiki_path: "wiki/architecture/ranking.md", section_id: "ranking", status: "valid", reason: null },
  ]);

  expect(hintPath).toBe("projects/demo/state/project-memory-retrieval/hints/architecture.json");
  expect(statusPath).toBe("projects/demo/state/project-memory-retrieval/hint-status.json");
  expect(await readFile(join(root, hintPath), "utf8")).toContain('"keywords"');
  expect(await readFile(join(root, statusPath), "utf8")).toContain('"status": "valid"');
  expect(projectMemoryHintHash(hints.entries[0])).toStartWith("sha256:");
});

function manifestWithSection(sectionHash: string): ProjectMemorySectionManifest {
  return {
    schema_version: 1,
    project_key: "demo",
    generated_at: "2026-06-28T10:00:00.000Z",
    pages: [],
    sections: [
      {
        project_key: "demo",
        wiki_path: "wiki/architecture/ranking.md",
        category: "architecture",
        page_title: "Ranking",
        section_id: "ranking",
        heading_level: 1,
        heading_text: "Ranking",
        heading_path: ["Ranking"],
        body_text: "Ranking body.",
        snippet: "Ranking body.",
        section_hash: sectionHash,
      },
    ],
    warnings: [],
  };
}

function hintFile(entries: ProjectMemoryHintEntry[]): ProjectMemoryHintFile {
  return {
    schema_version: 1,
    project_key: "demo",
    category: "architecture",
    generated_by: { flow: "project_memory_hint_generation", provider: "stub", model: "stub", run_ref: "run" },
    entries,
  };
}

function hintEntry(overrides: Partial<ProjectMemoryHintEntry> = {}): ProjectMemoryHintEntry {
  return {
    wiki_path: "wiki/architecture/ranking.md",
    section_id: "ranking",
    section_hash: "sha256:section",
    keywords: ["ranking"],
    aliases: ["proposal ranking"],
    topics: ["architecture"],
    query_phrases: ["how does ranking work"],
    confidence: "high",
    ...overrides,
  };
}
