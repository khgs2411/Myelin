import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDb, type MemoryDb } from "../../src/memory/db.ts";
import { indexProjectMemoryRetrieval } from "../../src/memory/project-memory-retrieval-indexer.ts";
import { writeProjectMemoryHintFile } from "../../src/project/project-memory-hints.ts";
import { extractProjectMemorySections } from "../../src/project/project-memory-markdown-sections.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";

let root: string;
let db: MemoryDb;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-pm-indexer-"));
  await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "index.md"), "# Demo\n\nProject memory body.\n\n## Overview\n\nUseful project memory section.\n", "utf8");
  db = openMemoryDb(root);
});

afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});

test("indexes markdown sections into Project Memory retrieval rows", async () => {
  const vectors: string[] = [];
  const result = await indexProjectMemoryRetrieval(db, {
    root,
    project_key: "demo",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: {
      async embed(request) {
        return {
          embedding: unitVector(request.contract.dimensions),
          model: request.contract.model,
          dimensions: request.contract.dimensions,
        };
      },
    },
    limit: 10,
    vector_store: {
      ensure: () => ({ available: true }),
      upsert: (_db, input) => vectors.push(input.retrieval_row_id),
    },
    now: () => "2026-06-28T10:00:00.000Z",
  });

  expect(result.indexed).toBeGreaterThan(0);
  expect(result.degraded).toBe(false);
  expect(vectors.length).toBe(result.indexed);
  expect(result.structural_sections_seen).toBe(1);
});

test("does not index top-level page title sections", async () => {
  const embeddedTexts: string[] = [];
  const result = await indexProjectMemoryRetrieval(db, {
    root,
    project_key: "demo",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: {
      async embed(request) {
        embeddedTexts.push(request.text);
        return {
          embedding: unitVector(request.contract.dimensions),
          model: request.contract.model,
          dimensions: request.contract.dimensions,
        };
      },
    },
    limit: 10,
    vector_store: {
      ensure: () => ({ available: true }),
      upsert: () => undefined,
    },
    now: () => "2026-06-28T10:00:00.000Z",
  });

  expect(result.indexed).toBe(1);
  expect(embeddedTexts).toHaveLength(1);
  expect(embeddedTexts[0]).toContain("heading_path: Demo > Overview");
  expect(embeddedTexts[0]).not.toContain("Project memory body.");
});

test("marks selected rows failed when vector store is unavailable", async () => {
  const result = await indexProjectMemoryRetrieval(db, {
    root,
    project_key: "demo",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: {
      async embed() {
        throw new Error("provider should not be called");
      },
    },
    limit: 10,
    vector_store: {
      ensure: () => ({ available: false, reason: "sqlite-vec unavailable" }),
      upsert: () => undefined,
    },
    now: () => "2026-06-28T10:00:00.000Z",
  });

  expect(result.degraded).toBe(true);
  expect(result.failed).toBeGreaterThan(0);
  expect(result.degraded_reason).toContain("sqlite-vec unavailable");
});

test("rejects query contracts at the Project Memory document indexing boundary", async () => {
  await expect(indexProjectMemoryRetrieval(db, {
    root,
    project_key: "demo",
    contract: { ...DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT, purpose: "retrieval_query" },
    provider: {
      async embed(request) {
        return {
          embedding: unitVector(request.contract.dimensions),
          model: request.contract.model,
          dimensions: request.contract.dimensions,
        };
      },
    },
    limit: 10,
  })).rejects.toThrow("requires retrieval_document embeddings");
});

test("indexes only valid matching hints with structural section text", async () => {
  await mkdir(join(root, "projects", "demo", "wiki", "architecture"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "architecture", "ranking.md"), "# Ranking\n\nRanking body.\n\n## Proposal Ranking\n\nRanking detail.\n", "utf8");
  const manifest = await extractProjectMemorySections(root, "demo", { now: new Date("2026-06-28T10:00:00.000Z") });
  const ranking = manifest.sections.find((section) => section.wiki_path === "wiki/architecture/ranking.md" && section.heading_level > 1);
  if (!ranking) throw new Error("missing ranking section");
  await writeProjectMemoryHintFile(root, {
    schema_version: 1,
    project_key: "demo",
    category: "architecture",
    generated_by: { flow: "project_memory_hint_generation", provider: "stub", model: "stub", run_ref: "run" },
    entries: [
      {
        wiki_path: ranking.wiki_path,
        section_id: ranking.section_id,
        section_hash: ranking.section_hash,
        keywords: ["ranking"],
        aliases: ["proposal ranking"],
        topics: ["architecture"],
        query_phrases: ["how does ranking work"],
        confidence: "high",
      },
      {
        wiki_path: ranking.wiki_path,
        section_id: ranking.section_id,
        section_hash: "sha256:old",
        keywords: ["old"],
        aliases: [],
        topics: [],
        query_phrases: [],
        confidence: "high",
      },
    ],
  });
  const embeddedTexts: string[] = [];

  const result = await indexProjectMemoryRetrieval(db, {
    root,
    project_key: "demo",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: {
      async embed(request) {
        embeddedTexts.push(request.text);
        return {
          embedding: unitVector(request.contract.dimensions),
          model: request.contract.model,
          dimensions: request.contract.dimensions,
        };
      },
    },
    limit: 10,
    vector_store: {
      ensure: () => ({ available: true }),
      upsert: () => undefined,
    },
    now: () => "2026-06-28T10:00:00.000Z",
  });

  expect(result.hints_valid).toBe(1);
  expect(result.hints_stale).toBe(1);
  expect(embeddedTexts.some((text) => text.includes("keywords: ranking"))).toBe(true);
  expect(embeddedTexts.some((text) => text.includes("keywords: old"))).toBe(false);
});

function unitVector(dimensions: number): number[] {
  return Array.from({ length: dimensions }, (_, index) => (index === 0 ? 1 : 0));
}
