import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { projectPath, resolveInside } from "./fs.ts";
import { readJsonIfExists, writeJson } from "./json.ts";

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
  action: "created-dir" | "moved" | "copied" | "updated-state" | "kept";
  from?: string;
  to?: string;
  path?: string;
};

type UpdateState = {
  latest_run_dir?: string | null;
  [key: string]: unknown;
};

const V2_PROJECT_DIRS = ["sources", "wiki", "schema", "state", "log", "runs"] as const;

export function projectLayout(root: string, key: string): ProjectLayoutPaths {
  const projectRoot = projectPath(root, key);
  return {
    root: projectRoot,
    sources: join(projectRoot, "sources"),
    wiki: join(projectRoot, "wiki"),
    schema: join(projectRoot, "schema"),
    state: join(projectRoot, "state"),
    log: join(projectRoot, "log"),
    runs: join(projectRoot, "runs"),
  };
}

export async function migrateProjectLayout(root: string, key: string): Promise<MigrationAction[]> {
  const paths = projectLayout(root, key);
  await assertDirectory(paths.root);

  const actions: MigrationAction[] = [];
  for (const dir of V2_PROJECT_DIRS) {
    await mkdir(join(paths.root, dir), { recursive: true });
    actions.push({ action: "created-dir", path: `projects/${key}/${dir}` });
  }

  actions.push(...(await moveIfPresent(join(paths.root, "index.md"), join(paths.wiki, "index.md"))));
  actions.push(...(await moveIfPresent(join(paths.root, "changelog.md"), join(paths.log, "changelog.md"))));
  actions.push(...(await moveIfPresent(join(paths.root, "inbox"), join(paths.sources, "inbox"))));
  actions.push(...(await moveDirectoryChildrenIfPresent(resolveInside(root, "artifacts", key, "runs"), paths.runs)));
  actions.push(...(await updateLatestRunPointer(root, key)));

  return actions;
}

async function moveIfPresent(from: string, to: string): Promise<MigrationAction[]> {
  if (!(await exists(from))) return [];
  if (await exists(to)) return [{ action: "kept", path: to }];

  await mkdir(dirnameFor(to), { recursive: true });
  await rename(from, to);
  return [{ action: "moved", from, to }];
}

async function moveDirectoryChildrenIfPresent(from: string, to: string): Promise<MigrationAction[]> {
  if (!(await isDirectory(from))) return [];
  await mkdir(to, { recursive: true });

  const actions: MigrationAction[] = [];
  for (const entry of (await readdir(from)).sort()) {
    const source = join(from, entry);
    const destination = join(to, entry);
    if (await exists(destination)) {
      actions.push({ action: "kept", path: destination });
      continue;
    }

    await rename(source, destination);
    actions.push({ action: "moved", from: source, to: destination });
  }
  return actions;
}

async function updateLatestRunPointer(root: string, key: string): Promise<MigrationAction[]> {
  const statePath = projectPath(root, key, "state", "update-state.json");
  const state = await readJsonIfExists<UpdateState>(statePath);
  const oldPrefix = `artifacts/${key}/runs/`;

  if (!state?.latest_run_dir?.startsWith(oldPrefix)) return [];

  state.latest_run_dir = `projects/${key}/runs/${state.latest_run_dir.slice(oldPrefix.length)}`;
  await writeJson(statePath, state);
  return [{ action: "updated-state", path: `projects/${key}/state/update-state.json` }];
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

function dirnameFor(path: string): string {
  return path.slice(0, -basename(path).length);
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
