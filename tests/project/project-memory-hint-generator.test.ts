import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDb, type MemoryDb } from "../../src/memory/db.ts";
import { createProjectMemoryHintJob, getProjectMemoryHintJob } from "../../src/memory/project-memory-hint-jobs.ts";
import { generateProjectMemoryHints } from "../../src/project/project-memory-hint-generator.ts";
import type { ProjectMemoryHintEntry } from "../../src/project/project-memory-hints.ts";
import type { ProjectMemorySectionManifest } from "../../src/project/project-memory-markdown-sections.ts";

let root: string;
let db: MemoryDb;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-pm-hint-generator-"));
  db = openMemoryDb(root);
});

afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});

test("writes accepted category hint file and preserves raw provider output", async () => {
  const manifest = manifestWithSection("sha256:section");
  manifest.sections[0].body_text = [
    ...Array.from({ length: 12 }, (_, index) => `Intro line ${index}. ${"context ".repeat(20)}`),
    `myelin memory maintain project and myelin memory review ${"details ".repeat(20)}`,
    ...Array.from({ length: 12 }, (_, index) => `Closing line ${index}. ${"context ".repeat(20)}`),
  ].join("\n");
  manifest.sections[0].snippet = "Intro.";
  const calls: Array<{ command: string[]; stdin?: string }> = [];
  const job = createProjectMemoryHintJob(db, {
    project_key: "demo",
    category: "architecture",
    required: true,
    section_refs: ["wiki/architecture/ranking.md#ranking"],
    now: "2026-06-28T09:59:00.000Z",
  });

  const result = await generateProjectMemoryHints({
    root,
    projectKey: "demo",
    category: "architecture",
    manifest,
    sections: manifest.sections,
    provider: "codex",
    model: "stub-hints",
    required: true,
    db,
    job_id: job.id,
    runner: async (command, options) => {
      calls.push({ command, stdin: options?.stdin });
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          schema_version: 1,
          project_key: "demo",
          category: "architecture",
          entries: [hintEntry()],
        }),
        stderr: "",
      };
    },
    now: new Date("2026-06-28T10:00:00.000Z"),
  });

  expect(result.status).toBe("completed");
  expect(result.accepted_entries).toBe(1);
  expect(result.rejected_entries).toBe(0);
  expect(await Bun.file(join(root, "projects", "demo", "state", "project-memory-retrieval", "hints", "architecture.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_ref, "hint-generation-output.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_ref, "hint-generation-validation.json")).exists()).toBe(true);
  expect(getProjectMemoryHintJob(db, job.id).status).toBe("completed");
  expect(calls[0].command).toContain("--output-schema");
  expect(calls[0].command).toContain(join(root, "src", "project", "project-memory-hint-output.schema.json"));
  expect(calls[0].stdin).toContain("myelin memory maintain project and myelin memory review");
  expect(calls[0].stdin).toContain('"confidence": "high"');
});

test("fails required hint generation when provider output has no valid entries", async () => {
  const manifest = manifestWithSection("sha256:current");
  const job = createProjectMemoryHintJob(db, {
    project_key: "demo",
    category: "architecture",
    required: true,
    section_refs: ["wiki/architecture/ranking.md#ranking"],
    now: "2026-06-28T09:59:00.000Z",
  });

  const result = await generateProjectMemoryHints({
    root,
    projectKey: "demo",
    category: "architecture",
    manifest,
    sections: manifest.sections,
    provider: "codex",
    model: "stub-hints",
    required: true,
    db,
    job_id: job.id,
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        schema_version: 1,
        project_key: "demo",
        category: "architecture",
        entries: [hintEntry({ section_hash: "sha256:old" })],
      }),
      stderr: "",
    }),
    now: new Date("2026-06-28T10:05:00.000Z"),
  });

  expect(result.status).toBe("failed");
  expect(result.degraded_reason).toBe("required hint generation produced no valid entries");
  expect(getProjectMemoryHintJob(db, job.id)).toMatchObject({ status: "failed" });
  expect(await readFile(join(root, result.run_ref, "hint-generation-output.json"), "utf8")).toContain("sha256:old");
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
