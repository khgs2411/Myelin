import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
  expect(result.created).toContain("projects/class-kit/wiki/index.md");

  const project = await readJson<{ key: string; name: string; repo_paths: string[] }>(
    join(root, "projects", "class-kit", "state", "project.json"),
  );
  expect(project).toEqual({
    key: "class-kit",
    name: "class-kit",
    repo_paths: [resolve(repo)],
  });

  for (const dir of ["sources", "wiki", "schema", "state", "log", "runs"]) {
    expect(result.created).toContain(`projects/class-kit/${dir}`);
  }

  expect(await readFile(join(root, "projects", "class-kit", "wiki", "index.md"), "utf8")).toContain(
    "Project Memory has not been curated yet.",
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
