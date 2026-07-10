import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bootstrapProject } from "../../src/runtime/bootstrap.ts";
import { readJson } from "../../src/runtime/json.ts";

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-bootstrap-"));
  repo = join(root, "repos", "class-kit");
  await mkdir(repo, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("bootstrap creates an uncurated project memory shell", async () => {
  const result = await bootstrapProject(root, "class-kit", repo);

  expect(result.projectKey).toBe("class-kit");
  expect(result.created).toContain("projects/class-kit/state/project.json");
  expect(result.created).toContain("projects/class-kit/readme.md");
  expect(result.created).toContain("projects/class-kit/wiki/index.md");
  expect(result.created).not.toContain("projects/class-kit/index.md");
  expect(result.created).not.toContain("projects/class-kit/state/index.md");
  expect(result.created).not.toContain("projects/class-kit/log");
  expect(result.created).not.toContain("projects/class-kit/log/index.md");
  expect(result.created).not.toContain("projects/class-kit/log/changelog.md");
  expect(result.created).not.toContain("projects/class-kit/runs/index.md");

  const project = await readJson<{ key: string; name: string; repo_paths: string[] }>(
    join(root, "projects", "class-kit", "state", "project.json"),
  );
  expect(project).toEqual({
    key: "class-kit",
    name: "class-kit",
    repo_paths: [resolve(repo)],
  });

  for (const dir of ["wiki", "state", "runs"]) {
    expect(result.created).toContain(`projects/class-kit/${dir}`);
  }
  expect(await Bun.file(join(root, "projects", "class-kit", "index.md")).exists()).toBe(false);
  expect(await Bun.file(join(root, "projects", "class-kit", "log")).exists()).toBe(false);
  expect(result.created).not.toContain("projects/class-kit/schema");
  expect(result.created).not.toContain("projects/class-kit/sources");
  expect(await Bun.file(join(root, "projects", "class-kit", "schema")).exists()).toBe(false);
  expect(await Bun.file(join(root, "projects", "class-kit", "sources")).exists()).toBe(false);

  expect(await readFile(join(root, "projects", "class-kit", "wiki", "index.md"), "utf8")).toContain(
    "Project Memory has not been curated yet.",
  );
  expect(await readFile(join(root, "projects", "class-kit", "readme.md"), "utf8")).toContain(
    "myelin project learn class-kit",
  );
});

test("bootstrap rerun is idempotent and does not overwrite curated index", async () => {
  await bootstrapProject(root, "class-kit", repo);
  const indexPath = join(root, "projects", "class-kit", "wiki", "index.md");
  await Bun.write(indexPath, "Curated content\n");

  const result = await bootstrapProject(root, "class-kit", repo);

  expect(result.created).toEqual([]);
  expect(result.kept).toContain("projects/class-kit/wiki/index.md");
  expect(await readFile(indexPath, "utf8")).toBe("Curated content\n");
});

test("bootstrap repairs older project shells without deleting preserved material", async () => {
  const projectRoot = join(root, "projects", "class-kit");
  await mkdir(join(projectRoot, "sources"), { recursive: true });
  await mkdir(join(projectRoot, "schema"), { recursive: true });
  await writeFile(join(projectRoot, "index.md"), "# Existing project memory\n", "utf8");
  await writeFile(join(projectRoot, "sources", "source-note.md"), "source material\n", "utf8");

  const result = await bootstrapProject(root, "class-kit", repo);

  expect(result.moved).toContainEqual({
    from: "projects/class-kit/index.md",
    to: "projects/class-kit/wiki/index.md",
  });
  expect(result.removed).toContain("projects/class-kit/schema");
  expect(await readFile(join(projectRoot, "wiki", "index.md"), "utf8")).toBe("# Existing project memory\n");
  expect(await readFile(join(projectRoot, "sources", "source-note.md"), "utf8")).toBe("source material\n");
  expect(await Bun.file(join(projectRoot, "index.md")).exists()).toBe(false);
  expect(await Bun.file(join(projectRoot, "sources", "index.md")).exists()).toBe(false);
  expect(await Bun.file(join(projectRoot, "schema")).exists()).toBe(false);
});

test("bootstrap rejects relative repo paths and invalid project keys", async () => {
  await expect(bootstrapProject(root, "Class Kit", repo)).rejects.toThrow("Invalid project key");
  await expect(bootstrapProject(root, "class-kit", "relative/path")).rejects.toThrow(
    "Repo path must be absolute",
  );
});

test("bootstrap rejects repo path already registered to another key", async () => {
  await bootstrapProject(root, "class-kit", repo);

  await expect(bootstrapProject(root, "other", repo)).rejects.toThrow(
    "Repo path is already registered to project class-kit",
  );
});
