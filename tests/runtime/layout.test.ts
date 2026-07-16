import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateProjectLayout, projectLayout } from "../../src/runtime/layout.ts";
import { readJson, writeJson } from "../../src/runtime/json.ts";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import {
  ensurePendingProjectMemoryRetrievalEmbedding,
  projectMemoryRetrievalEmbeddingId,
} from "../../src/memory/project-memory-retrieval-storage.ts";
import {
  ensureProjectMemoryRetrievalVectorTable,
  getSqliteVecAvailability,
  upsertProjectMemoryRetrievalVector,
} from "../../src/memory/sqlite-vec.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-layout-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("project layout migration flattens Project Memory and moves generated data", async () => {
  const run = "2026-07-15T07-41-06.542Z-run";
  await mkdir(join(root, "projects", "trygga", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "trygga", "wiki", "index.md"), "# Trygga\n", "utf8");
  await writeFile(join(root, "projects", "trygga", "wiki", "architecture.md"), "# Architecture\n", "utf8");
  await writeJson(join(root, "projects", "trygga", "state", "project.json"), { key: "trygga", name: "Trygga" });
  await writeJson(join(root, "projects", "trygga", "state", "project-memory.json"), {
    status: "curated",
    source_run_dir: `projects/trygga/runs/project-learn/${run}`,
  });
  await writeJson(join(root, "projects", "trygga", "state", "pages.json"), {
    pages: ["wiki/index.md", "wiki/architecture.md"],
  });
  await mkdir(join(root, "projects", "trygga", "sources", "inbox"), { recursive: true });
  await mkdir(join(root, "projects", "trygga", "runs", "project-learn", run), { recursive: true });
  await mkdir(join(root, "projects", "trygga", "logs"), { recursive: true });
  await writeFile(join(root, "projects", "trygga", "sources", "inbox", "note.json"), "{}", "utf8");
  await writeFile(join(root, "projects", "trygga", "runs", "project-learn", run, "proposal.json"), "run-bytes", "utf8");
  await writeFile(join(root, "projects", "trygga", "logs", "maintenance.log"), "log-bytes", "utf8");
  await writeFile(
    join(root, "projects", "trygga", "readme.md"),
    "# trygga\n\nProject Memory is curated for this project.\n",
    "utf8",
  );
  await mkdir(join(root, "state"), { recursive: true });
  const legacyDb = openMemoryDbAt(join(root, "state", "memory.db"));
  const legacyRow = ensurePendingProjectMemoryRetrievalEmbedding(legacyDb, {
    project_key: "trygga",
    wiki_path: "wiki/index.md",
    section_id: "overview",
    section_hash: "sha256:section",
    hint_hash: null,
    contract: { provider: "ollama_nomic", model: "nomic", dimensions: 768, purpose: "retrieval_document", formatVersion: 1 },
    now: "2026-07-15T00:00:00.000Z",
  });
  legacyDb.query(
    "INSERT INTO project_memory_section_fts (retrieval_row_id, project_key, wiki_path, page_title, heading_text, section_id, body_text) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(legacyRow.id, "trygga", "wiki/index.md", "Trygga", "Overview", "overview", "body");
  expect(ensureProjectMemoryRetrievalVectorTable(legacyDb, { dimensions: 768 }).available).toBe(true);
  upsertProjectMemoryRetrievalVector(legacyDb, {
    retrieval_row_id: legacyRow.id,
    project_key: "trygga",
    wiki_path: "wiki/index.md",
    section_id: "overview",
    embedding_model: "nomic",
    embedding_dimensions: 768,
    embedding_purpose: "retrieval_document",
    format_version: 1,
    embedding: Array.from({ length: 768 }, (_, index) => index / 768),
  });
  legacyDb.close();

  const actions = await migrateProjectLayout(root, "trygga");
  const paths = projectLayout(root, "trygga");

  expect(actions.some((action) => action.action === "updated-state")).toBe(true);
  expect(await readFile(join(paths.root, "index.md"), "utf8")).toBe("# Trygga\n");
  expect(await readFile(join(paths.root, "architecture.md"), "utf8")).toBe("# Architecture\n");
  expect(await readFile(join(paths.sources, "inbox", "note.json"), "utf8")).toBe("{}");
  expect(await readFile(join(paths.runs, "project-learn", run, "proposal.json"), "utf8")).toBe("run-bytes");
  expect(await readFile(join(paths.log, "maintenance.log"), "utf8")).toBe("log-bytes");
  const migratedDb = openMemoryDbAt(join(root, "state", "memory", "memory.db"));
  expect(getSqliteVecAvailability(migratedDb).available).toBe(true);
  const migratedRow = migratedDb.query(
    "SELECT id, wiki_path FROM project_memory_retrieval_embeddings WHERE project_key = ?",
  ).get("trygga") as { id: string; wiki_path: string };
  expect(migratedRow).toEqual({
    id: projectMemoryRetrievalEmbeddingId({
      project_key: "trygga",
      wiki_path: "index.md",
      section_id: "overview",
      section_hash: "sha256:section",
      hint_hash: null,
      contract: { provider: "ollama_nomic", model: "nomic", dimensions: 768, purpose: "retrieval_document", formatVersion: 1 },
    }),
    wiki_path: "index.md",
  });
  expect(migratedDb.query("SELECT retrieval_row_id, wiki_path FROM project_memory_section_fts").get()).toEqual({
    retrieval_row_id: migratedRow.id,
    wiki_path: "index.md",
  });
  expect(migratedDb.query("SELECT retrieval_row_id, wiki_path FROM project_memory_section_vec").get()).toEqual({
    retrieval_row_id: migratedRow.id,
    wiki_path: "index.md",
  });
  migratedDb.close();
  expect((await readJson<{ source_run_dir: string }>(join(paths.state, "project-memory.json"))).source_run_dir).toBe(
    `runs/trygga/project-learn/${run}`,
  );
  expect((await readJson<{ pages: string[] }>(join(paths.state, "pages.json"))).pages).toEqual([
    "index.md",
    "architecture.md",
  ]);
  expect((await readdir(paths.root)).sort()).toEqual(["architecture.md", "index.md"]);

  const second = await migrateProjectLayout(root, "trygga");
  expect(second.some((action) => action.action === "moved")).toBe(false);
});

test("project layout migration fails closed on a destination collision", async () => {
  await mkdir(join(root, "projects", "trygga", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "trygga", "wiki", "index.md"), "legacy\n", "utf8");
  await writeFile(join(root, "projects", "trygga", "index.md"), "current\n", "utf8");

  await expect(migrateProjectLayout(root, "trygga")).rejects.toThrow("Layout migration collision");
  expect(await readFile(join(root, "projects", "trygga", "wiki", "index.md"), "utf8")).toBe("legacy\n");
  expect(await readFile(join(root, "projects", "trygga", "index.md"), "utf8")).toBe("current\n");
});
