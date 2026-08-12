import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  projectPath,
  projectRunsPath,
  projectSourcesPath,
  projectStatePath,
  resolveInside,
} from "./fs.ts";
import { ensureParentDir } from "./fs.ts";
import { openMemoryDb } from "../memory/db.ts";
import { projectMemoryRetrievalEmbeddingId, type ProjectMemoryRetrievalEmbeddingRow } from "../memory/project-memory-retrieval-storage.ts";
import { getSqliteVecAvailability } from "../memory/sqlite-vec.ts";

export type ProjectLayoutPaths = {
  root: string;
  sources: string;
  wiki: string;
  schema: string;
  state: string;
  log: string;
  runs: string;
};

export type MigrationAction = {
  action: "created-dir" | "created-file" | "moved" | "copied" | "updated-state" | "kept" | "removed";
  from?: string;
  to?: string;
  path?: string;
};

const PATH_STATE_KEYS = new Set([
  "absolute_path",
  "canonical_project_path",
  "changed_files",
  "consumed_by_run",
  "file_authoring_runs",
  "last_log_path",
  "latest_run_dir",
  "latest_run_path",
  "output_refs",
  "pages",
  "source_run_dir",
  "wiki_path",
]);

export function projectLayout(root: string, key: string): ProjectLayoutPaths {
  const runs = projectRunsPath(root, key);
  return {
    root: projectPath(root, key),
    sources: projectSourcesPath(root, key),
    wiki: projectPath(root, key),
    schema: resolveInside(root, "schema"),
    state: projectStatePath(root, key),
    log: join(runs, "logs"),
    runs,
  };
}

export async function migrateProjectLayout(root: string, key: string): Promise<MigrationAction[]> {
  const paths = projectLayout(root, key);
  await assertDirectory(paths.root);
  await assertNoMigrationCollisions(root, key, paths);

  const actions: MigrationAction[] = [];
  for (const path of [paths.state, paths.sources, paths.runs, paths.log, resolveInside(root, "state", "memory")]) {
    actions.push(...(await ensureDirectory(path, relative(root, path))));
  }

  actions.push(...(await moveMemoryDatabase(root)));
  actions.push(...rewriteProjectMemoryDatabasePaths(root, key));
  actions.push(...(await moveDirectoryChildren(projectPath(root, key, "wiki"), paths.root, root)));
  actions.push(...(await moveDirectoryChildren(projectPath(root, key, "state"), paths.state, root)));
  actions.push(...(await moveDirectoryChildren(projectPath(root, key, "sources"), paths.sources, root)));
  actions.push(...(await moveDirectoryChildren(projectPath(root, key, "runs"), paths.runs, root)));
  actions.push(...(await moveDirectoryChildren(projectPath(root, key, "logs"), paths.log, root)));
  actions.push(...(await moveDirectoryChildren(projectPath(root, key, "log"), paths.log, root)));
  actions.push(...(await moveDirectoryChildren(resolveInside(root, "artifacts", key, "runs"), paths.runs, root)));
  actions.push(...(await removeGeneratedScaffold(projectPath(root, key, "readme.md"), root)));
  actions.push(...(await removeIfPresent(join(paths.runs, ".DS_Store"), root)));
  actions.push(...(await removeEmptyLegacyDirectories(root, key)));
  actions.push(...(await rewriteProjectStatePaths(root, key)));
  actions.push(...(await rewriteRepositoryIdentityLinks(root, key)));

  return actions;
}

function rewriteProjectMemoryDatabasePaths(root: string, key: string): MigrationAction[] {
  const db = openMemoryDb(root);
  try {
    const rows = db.query(
      "SELECT * FROM project_memory_retrieval_embeddings WHERE project_key = ? AND wiki_path LIKE 'wiki/%'",
    ).all(key) as ProjectMemoryRetrievalEmbeddingRow[];
    if (rows.length === 0) return [];

    const hasFts = Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_memory_section_fts'").get());
    const hasVector = Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_memory_section_vec'").get());
    if (hasVector) {
      const availability = getSqliteVecAvailability(db);
      if (!availability.available) throw new Error(`Cannot migrate Project Memory vector paths: ${availability.reason}`);
    }

    const updates = rows.map((row) => {
      const wikiPath = row.wiki_path.slice("wiki/".length);
      const id = projectMemoryRetrievalEmbeddingId({
        project_key: row.project_key,
        wiki_path: wikiPath,
        section_id: row.section_id,
        section_hash: row.section_hash,
        hint_hash: row.hint_hash,
        contract: {
          provider: row.embedding_provider as "ollama_nomic" | "ollama_qwen" | "gemini",
          model: row.embedding_model,
          dimensions: row.embedding_dimensions,
          purpose: row.embedding_purpose,
          formatVersion: row.format_version,
        },
      });
      return { oldId: row.id, id, wikiPath };
    });
    const vectorRows = hasVector
      ? updates.flatMap((update) => (
          db.query(
            `SELECT embedding, retrieval_row_id, project_key, wiki_path, section_id, embedding_model,
                    embedding_dimensions, embedding_purpose, format_version
             FROM project_memory_section_vec WHERE retrieval_row_id = ?`,
          ).all(update.oldId) as ProjectMemoryVectorMigrationRow[]
        ).map((row) => ({ ...row, newId: update.id, newWikiPath: update.wikiPath })))
      : [];

    for (const update of updates) {
      const collision = db.query("SELECT id FROM project_memory_retrieval_embeddings WHERE id = ? AND id != ?").get(update.id, update.oldId);
      if (collision) throw new Error(`Layout migration collision: Project Memory retrieval row ${update.oldId} -> ${update.id}`);
    }

    db.transaction(() => {
      for (const update of updates) {
        db.query("UPDATE project_memory_retrieval_embeddings SET id = ?, wiki_path = ? WHERE id = ?").run(
          update.id,
          update.wikiPath,
          update.oldId,
        );
        if (hasFts) {
          db.query("UPDATE project_memory_section_fts SET retrieval_row_id = ?, wiki_path = ? WHERE retrieval_row_id = ?").run(
            update.id,
            update.wikiPath,
            update.oldId,
          );
        }
      }
      for (const row of vectorRows) {
        db.query("DELETE FROM project_memory_section_vec WHERE retrieval_row_id = ?").run(row.retrieval_row_id);
        db.query(
          `INSERT INTO project_memory_section_vec
            (embedding, retrieval_row_id, project_key, wiki_path, section_id, embedding_model,
             embedding_dimensions, embedding_purpose, format_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          row.embedding,
          row.newId,
          row.project_key,
          row.newWikiPath,
          row.section_id,
          row.embedding_model,
          row.embedding_dimensions,
          row.embedding_purpose,
          row.format_version,
        );
      }
    })();

    return [{ action: "updated-state", path: relative(root, resolveInside(root, "state", "memory", "memory.db")) }];
  } finally {
    db.close();
  }
}

type ProjectMemoryVectorMigrationRow = {
  embedding: Uint8Array;
  retrieval_row_id: string;
  project_key: string;
  wiki_path: string;
  section_id: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_purpose: string;
  format_version: number;
};

async function assertNoMigrationCollisions(
  root: string,
  key: string,
  paths: ProjectLayoutPaths,
): Promise<void> {
  for (const [from, to] of [
    [projectPath(root, key, "wiki"), paths.root],
    [projectPath(root, key, "state"), paths.state],
    [projectPath(root, key, "sources"), paths.sources],
    [projectPath(root, key, "runs"), paths.runs],
    [projectPath(root, key, "logs"), paths.log],
    [projectPath(root, key, "log"), paths.log],
    [resolveInside(root, "artifacts", key, "runs"), paths.runs],
  ] as const) {
    if (!(await isDirectory(from))) continue;
    for (const entry of await readdir(from)) {
      const destination = join(to, entry);
      if (await exists(destination)) {
        throw new Error(`Layout migration collision: ${relative(root, join(from, entry))} -> ${relative(root, destination)}`);
      }
    }
  }
  for (const name of ["memory.db", "memory.db-wal", "memory.db-shm"]) {
    const from = resolveInside(root, "state", name);
    const to = resolveInside(root, "state", "memory", name);
    if ((await exists(from)) && (await exists(to))) {
      throw new Error(`Layout migration collision: ${relative(root, from)} -> ${relative(root, to)}`);
    }
  }
}

async function moveMemoryDatabase(root: string): Promise<MigrationAction[]> {
  const actions: MigrationAction[] = [];
  for (const name of ["memory.db", "memory.db-wal", "memory.db-shm"]) {
    actions.push(...(await movePath(resolveInside(root, "state", name), resolveInside(root, "state", "memory", name), root)));
  }
  return actions;
}

async function moveDirectoryChildren(from: string, to: string, root: string): Promise<MigrationAction[]> {
  if (!(await isDirectory(from))) return [];
  const actions: MigrationAction[] = [];
  for (const entry of (await readdir(from)).sort()) {
    actions.push(...(await movePath(join(from, entry), join(to, entry), root)));
  }
  return actions;
}

async function movePath(from: string, to: string, root: string): Promise<MigrationAction[]> {
  if (!(await exists(from))) return [];
  if (await exists(to)) {
    throw new Error(`Layout migration collision: ${relative(root, from)} -> ${relative(root, to)}`);
  }
  await ensureParentDir(to);
  await rename(from, to);
  return [{ action: "moved", from: relative(root, from), to: relative(root, to) }];
}

async function ensureDirectory(path: string, label: string): Promise<MigrationAction[]> {
  if (await isDirectory(path)) return [{ action: "kept", path: label }];
  if (await exists(path)) throw new Error(`Expected directory but found a file: ${label}`);
  await mkdir(path, { recursive: true });
  return [{ action: "created-dir", path: label }];
}

async function removeGeneratedScaffold(path: string, root: string): Promise<MigrationAction[]> {
  if (!(await exists(path))) return [];
  const content = await readFile(path, "utf8");
  if (!content.includes("Project Memory is curated for this project.") && !content.includes("Project Memory has not been curated yet.")) {
    return [{ action: "kept", path: relative(root, path) }];
  }
  await rm(path);
  return [{ action: "removed", path: relative(root, path) }];
}

async function removeIfPresent(path: string, root: string): Promise<MigrationAction[]> {
  if (!(await exists(path))) return [];
  await rm(path, { recursive: true });
  return [{ action: "removed", path: relative(root, path) }];
}

async function removeEmptyLegacyDirectories(root: string, key: string): Promise<MigrationAction[]> {
  const actions: MigrationAction[] = [];
  for (const path of [
    projectPath(root, key, "wiki"),
    projectPath(root, key, "state"),
    projectPath(root, key, "sources"),
    projectPath(root, key, "runs"),
    projectPath(root, key, "logs"),
    projectPath(root, key, "log"),
  ]) {
    if (!(await isDirectory(path)) || (await readdir(path)).length > 0) continue;
    await rm(path, { recursive: true });
    actions.push({ action: "removed", path: relative(root, path) });
  }
  const legacySchema = projectPath(root, key, "schema");
  if ((await isDirectory(legacySchema)) && (await readdir(legacySchema)).length === 0) {
    await rm(legacySchema);
    actions.push({ action: "removed", path: relative(root, legacySchema) });
  }
  return actions;
}

async function rewriteProjectStatePaths(root: string, key: string): Promise<MigrationAction[]> {
  const stateRoot = projectStatePath(root, key);
  const actions: MigrationAction[] = [];
  for (const path of await jsonFiles(stateRoot)) {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    const rewritten = rewriteStateValue(parsed, key);
    if (!rewritten.changed) continue;
    await writeFile(path, `${JSON.stringify(rewritten.value, null, 2)}\n`, "utf8");
    actions.push({ action: "updated-state", path: relative(root, path) });
  }
  return actions;
}

function rewriteStateValue(value: unknown, key: string, stateKey?: string): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    if (!stateKey || !PATH_STATE_KEYS.has(stateKey)) return { value, changed: false };
    const rewritten = rewriteRecordedPath(value, key, stateKey);
    return { value: rewritten, changed: rewritten !== value };
  }
  if (Array.isArray(value)) {
    const entries = value.map((entry) => rewriteStateValue(entry, key, stateKey));
    return { value: entries.map((entry) => entry.value), changed: entries.some((entry) => entry.changed) };
  }
  if (!value || typeof value !== "object") return { value, changed: false };

  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(value)) {
    const rewritten = rewriteStateValue(child, key, childKey);
    result[childKey] = rewritten.value;
    changed ||= rewritten.changed;
  }
  return { value: result, changed };
}

function rewriteRecordedPath(value: string, key: string, stateKey: string): string {
  let rewritten = value
    .replaceAll(`projects/${key}/logs/`, `runs/${key}/logs/`)
    .replaceAll(`projects/${key}/runs/`, `runs/${key}/`)
    .replaceAll(`projects/${key}/sources/`, `sources/${key}/`)
    .replaceAll(`projects/${key}/state/`, `state/${key}/`)
    .replaceAll(`projects/${key}/wiki/`, `projects/${key}/`)
    .replaceAll("state/memory.db", "state/memory/memory.db");
  if ((stateKey === "wiki_path" || stateKey === "pages") && rewritten.startsWith("wiki/")) {
    rewritten = rewritten.slice("wiki/".length);
  }
  return rewritten;
}

async function rewriteRepositoryIdentityLinks(root: string, key: string): Promise<MigrationAction[]> {
  const actions: MigrationAction[] = [];
  const identityPath = projectStatePath(root, key, "repository-identity.json");
  for (const path of await markdownFiles(projectPath(root, key))) {
    const content = await readFile(path, "utf8");
    if (!content.includes("../state/repository-identity.json")) continue;
    const target = relative(dirname(path), identityPath).replaceAll("\\", "/");
    const updated = content.replaceAll("../state/repository-identity.json", target);
    await writeFile(path, updated, "utf8");
    actions.push({ action: "updated-state", path: relative(root, path) });
  }
  return actions;
}

async function jsonFiles(root: string): Promise<string[]> {
  return await filesWithExtension(root, ".json");
}

async function markdownFiles(root: string): Promise<string[]> {
  return await filesWithExtension(root, ".md");
}

async function filesWithExtension(root: string, extension: string): Promise<string[]> {
  if (!(await isDirectory(root))) return [];
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesWithExtension(path, extension)));
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(path);
  }
  return files.sort();
}

async function assertDirectory(path: string): Promise<void> {
  if (!(await isDirectory(path))) throw new Error(`Project directory does not exist: ${path}`);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
